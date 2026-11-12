'use strict';
/* FPT LOOP - máy chủ. Không cần cài thư viện nào (dùng node:sqlite có sẵn từ Node 22.13). */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const scrypt = promisify(crypto.scrypt);

/* ---------- Cấu hình ---------- */
const PORT = +process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SEED_DEMO = process.env.SEED_DEMO !== 'false';
const SESSION_DAYS = 30;

const CATS = ['book', 'tech', 'elec', 'dorm', 'cloth', 'bike', 'misc'];
const CAMPUS_N = 5; // 1..5 (Hòa Lạc, TP.HCM, Đà Nẵng, Cần Thơ, Quy Nhơn)
const CAMPUS_NAMES = ['Hòa Lạc', 'TP.HCM', 'Đà Nẵng', 'Cần Thơ', 'Quy Nhơn'];
const SPOTS = ['Căng tin', 'Thư viện', 'Cổng KTX', 'Sảnh Alpha', 'Bãi xe'];
const YEARS = ['Năm 1', 'Năm 2', 'Năm 3', 'Năm 4', 'Cựu sinh viên'];
const MAJORS = ['Kỹ thuật phần mềm', 'Trí tuệ nhân tạo', 'An toàn thông tin', 'Thiết kế đồ họa', 'Quản trị kinh doanh', 'Ngôn ngữ Anh', 'Ngôn ngữ Nhật', 'Ngành khác'];
const BAD = ['lừa', 'hack', 'thuốc', 'vũ khí', 'cá độ', '18+'];

/* ---------- Cơ sở dữ liệu ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'loop.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');
db.exec(`
CREATE TABLE IF NOT EXISTS accounts(
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, username TEXT NOT NULL UNIQUE COLLATE NOCASE, pw TEXT NOT NULL,
  dob TEXT, campus TEXT, year TEXT, major TEXT, zalo TEXT DEFAULT '', bio TEXT DEFAULT '', avatar_img INTEGER,
  admin INTEGER DEFAULT 0, banned INTEGER DEFAULT 0, base_r REAL DEFAULT 0, base_n INTEGER DEFAULT 0, base_deals INTEGER DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS images(id INTEGER PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS items(
  id INTEGER PRIMARY KEY, seller_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL, price INTEGER NOT NULL, oldp INTEGER, cat TEXT NOT NULL, cnd INTEGER NOT NULL, ty TEXT NOT NULL,
  cp INTEGER NOT NULL, spot TEXT, code TEXT DEFAULT '', descr TEXT DEFAULT '', imgs TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'ok', ft INTEGER DEFAULT 0, views INTEGER DEFAULT 0, fav_base INTEGER DEFAULT 0, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS items_status_ts ON items(status, ts);
CREATE INDEX IF NOT EXISTS items_seller ON items(seller_id);
CREATE TABLE IF NOT EXISTS favs(
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE, PRIMARY KEY(account_id, item_id));
CREATE TABLE IF NOT EXISTS ratings(
  rater_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  seller_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY(rater_id, seller_id));
CREATE TABLE IF NOT EXISTS reports(
  id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, why TEXT, ts INTEGER NOT NULL,
  UNIQUE(item_id, reporter_id));
CREATE TABLE IF NOT EXISTS blocks(
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, PRIMARY KEY(account_id, blocked_id));
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  buyer_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  text TEXT NOT NULL, ts INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS msg_thread ON messages(item_id, buyer_id, id);
`);

/* Nâng cấp CSDL cũ (nếu có) */
for (const [t, c, def] of [['accounts', 'base_deals', 'INTEGER DEFAULT 0'], ['items', 'fav_base', 'INTEGER DEFAULT 0']]) {
  if (!db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`);
}

const cache = new Map();
const st = sql => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
const all = (sql, ...a) => st(sql).all(...a);
const get = (sql, ...a) => st(sql).get(...a);
const run = (sql, ...a) => st(sql).run(...a);
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
}

/* ---------- Tiện ích ---------- */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m, s = 400) => new HttpError(s, m);
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const now = () => Date.now();

async function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt, 64);
  return 's1$' + salt.toString('hex') + '$' + h.toString('hex');
}
async function checkPw(pw, stored) {
  const [v, s, h] = String(stored).split('$');
  if (v !== 's1' || !s || !h) return false;
  const x = await scrypt(pw, Buffer.from(s, 'hex'), 64);
  const y = Buffer.from(h, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function str(v, min, max, msg) {
  if (typeof v !== 'string') throw bad(msg);
  const s = v.trim();
  if (s.length < min || s.length > max) throw bad(msg);
  return s;
}
const optStr = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, min, max, msg) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(msg);
  return n;
};

/* Giới hạn tốc độ (bộ nhớ) */
const buckets = new Map();
function rl(key, max, windowMs) {
  const t = now();
  let b = buckets.get(key);
  if (!b || b.reset < t) { b = { n: 0, reset: t + windowMs }; buckets.set(key, b); }
  b.n++;
  return b.n <= max;
}
const tooFast = () => bad('Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút', 429);

/* Captcha phía máy chủ */
const captchas = new Map();
function makeCaptcha() {
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let a = '';
  for (let i = 0; i < 5; i++) a += ch[crypto.randomInt(ch.length)];
  let g = '';
  const R = (n) => crypto.randomInt(n);
  for (let i = 0; i < 7; i++) g += `<line x1="${R(150)}" y1="${R(44)}" x2="${R(150)}" y2="${R(44)}" stroke="hsl(${R(360)},50%,55%)" stroke-width="1.2"/>`;
  for (let i = 0; i < 5; i++) {
    const x = 20 + i * 26, rot = R(40) - 20;
    g += `<text x="${x}" y="30" transform="rotate(${rot} ${x} 22)" font-size="26" font-weight="700" font-family="Arial,sans-serif" fill="hsl(${R(360)},60%,30%)">${a[i]}</text>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="44" viewBox="0 0 150 44"><rect width="150" height="44" fill="#eef3f8"/>${g}</svg>`;
  const id = crypto.randomBytes(12).toString('hex');
  if (captchas.size > 5000) captchas.clear();
  captchas.set(id, { a, exp: now() + 10 * 60e3 });
  return { id, img: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') };
}
function checkCaptcha(id, ans) {
  const c = captchas.get(id);
  captchas.delete(id);
  return !!(c && c.exp > now() && typeof ans === 'string' && ans.trim().toUpperCase() === c.a);
}

/* Ảnh */
const IMG_RE = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;
function saveImage(dataUrl, maxBytes) {
  const m = typeof dataUrl === 'string' && IMG_RE.exec(dataUrl);
  if (!m) throw bad('Ảnh không hợp lệ (chỉ nhận JPG, PNG, WEBP, GIF)');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxBytes) throw bad('Ảnh quá lớn, vui lòng chọn ảnh nhỏ hơn');
  const ok = (buf[0] === 0xff && buf[1] === 0xd8) || buf.subarray(0, 4).toString('hex') === '89504e47' ||
    buf.subarray(0, 4).toString() === 'GIF8' || (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP');
  if (!ok) throw bad('Nội dung ảnh không hợp lệ');
  return run('INSERT INTO images(mime,data) VALUES(?,?)', m[1], buf).lastInsertRowid;
}
const delImages = ids => ids.forEach(i => run('DELETE FROM images WHERE id=?', i));
const imgUrl = id => '/api/img/' + id;

/* ---------- Phiên đăng nhập ---------- */
function cookies(req) {
  const o = {};
  (req.headers.cookie || '').split(';').forEach(s => {
    const i = s.indexOf('=');
    if (i > 0) { try { o[s.slice(0, i).trim()] = decodeURIComponent(s.slice(i + 1).trim()); } catch (_) {} }
  });
  return o;
}
const isHttps = req => IS_PROD || req.headers['x-forwarded-proto'] === 'https';
function setCookie(res, req, token, maxAge) {
  res.setHeader('Set-Cookie', `loop_sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`);
}
function newSession(res, req, accountId) {
  const t = crypto.randomBytes(32).toString('base64url');
  run('INSERT INTO sessions(token,account_id,expires) VALUES(?,?,?)', sha(t), accountId, now() + SESSION_DAYS * 864e5);
  setCookie(res, req, t, SESSION_DAYS * 86400);
}
function getMe(req) {
  const t = cookies(req).loop_sid;
  if (!t) return null;
  const a = get(`SELECT a.* FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token=? AND s.expires>? AND a.banned=0`, sha(t), now());
  return a || null;
}
const meOut = a => a && ({
  id: a.id, name: a.username, email: a.email, campus: a.campus, year: a.year, major: a.major,
  zalo: a.zalo || '', bio: a.bio || '', avatar: a.avatar_img ? imgUrl(a.avatar_img) : '', admin: !!a.admin
});
const unreadOf = id => get(`SELECT COUNT(*) n FROM messages m JOIN items i ON i.id=m.item_id
  WHERE m.sender_id!=:v AND m.seen=0 AND (m.buyer_id=:v OR i.seller_id=:v)`, { v: id }).n;

/* ---------- Router ---------- */
const routes = [];
function route(method, pat, opts, fn) {
  const keys = [];
  const re = new RegExp('^' + pat.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, opts, fn });
}
const RAW = Symbol('raw');

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let n = 0, over = false; const ch = [];
    req.on('data', d => { n += d.length; if (n > limit) over = true; else ch.push(d); });
    req.on('end', () => {
      if (over) return reject(bad('Dữ liệu gửi lên quá lớn', 413));
      try { resolve(n ? JSON.parse(Buffer.concat(ch).toString('utf8')) : {}); } catch (e) { reject(bad('JSON không hợp lệ')); }
    });
    req.on('error', reject);
  });
}
function clientIp(req) {
  const x = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return x.length ? x[x.length - 1] : req.socket.remoteAddress || '?';
}
function send(req, res, status, type, body, extra) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const h = Object.assign({ 'Content-Type': type }, extra);
  if (buf.length > 1024 && /^(text\/|application\/(json|javascript))/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    buf = zlib.gzipSync(buf); h['Content-Encoding'] = 'gzip'; h.Vary = 'Accept-Encoding';
  }
  h['Content-Length'] = buf.length;
  res.writeHead(status, h);
  res.end(req.method === 'HEAD' ? undefined : buf);
}
const json = (req, res, status, obj) => send(req, res, status, 'application/json; charset=utf-8', JSON.stringify(obj), { 'Cache-Control': 'no-store' });

async function handleApi(req, res, u) {
  const p = u.pathname;
  let matched = null, params = {}, pathOk = false;
  for (const r of routes) {
    const m = r.re.exec(p);
    if (!m) continue;
    pathOk = true;
    if (r.method !== req.method && !(r.method === 'GET' && req.method === 'HEAD')) continue;
    matched = r; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break;
  }
  if (!matched) throw bad(pathOk ? 'Phương thức không được hỗ trợ' : 'Không tìm thấy', pathOk ? 405 : 404);
  const ip = clientIp(req);
  let body = {};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (!/application\/json/i.test(req.headers['content-type'] || '')) throw bad('Content-Type phải là application/json', 415);
    if (!rl('w:' + ip, 240, 60e3)) throw tooFast();
    body = await readBody(req, matched.opts.max || 64 * 1024);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw bad('Dữ liệu không hợp lệ');
  }
  const me = getMe(req);
  if ((matched.opts.auth || matched.opts.admin) && !me) throw bad('Bạn cần đăng nhập để tiếp tục', 401);
  if (matched.opts.admin && !me.admin) throw bad('Không có quyền truy cập', 403);
  const out = await matched.fn({ req, res, u, params, body, me, ip });
  if (out !== RAW) json(req, res, 200, out === undefined ? { ok: true } : out);
}

/* ---------- Tài khoản ---------- */
route('GET', '/api/captcha', {}, c => makeCaptcha());

route('POST', '/api/register', { max: 400 * 1024 }, async c => {
  if (!rl('reg:' + c.ip, 8, 3600e3)) throw tooFast();
  const b = c.body;
  const email = str(b.email, 5, 100, 'Vui lòng nhập địa chỉ Gmail hợp lệ').toLowerCase();
  if (!/^[^@\s]+@gmail\.com$/.test(email)) throw bad('Vui lòng nhập địa chỉ Gmail hợp lệ');
  const user = str(b.user, 3, 24, 'Tên đăng nhập chỉ gồm chữ, số, dấu chấm, gạch dưới (3 đến 24 ký tự)');
  if (!/^[A-Za-z0-9._]{3,24}$/.test(user)) throw bad('Tên đăng nhập chỉ gồm chữ, số, dấu chấm, gạch dưới (3 đến 24 ký tự)');
  if (typeof b.password !== 'string' || b.password.length < 6 || b.password.length > 100) throw bad('Mật khẩu cần ít nhất 6 ký tự');
  const dob = optStr(b.dob, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || isNaN(Date.parse(dob)) || Date.parse(dob) > now() || Date.parse(dob) < Date.parse('1940-01-01')) throw bad('Vui lòng chọn ngày sinh hợp lệ');
  if (!CAMPUS_NAMES.includes(b.campus)) throw bad('Cơ sở không hợp lệ');
  if (!YEARS.includes(b.year)) throw bad('Năm học không hợp lệ');
  if (!MAJORS.includes(b.major)) throw bad('Ngành học không hợp lệ');
  const zalo = optStr(b.zalo, 15);
  if (!/^[0-9+ ]*$/.test(zalo)) throw bad('Số Zalo không hợp lệ');
  if (!b.agree) throw bad('Vui lòng đồng ý cam kết giao dịch');
  if (!checkCaptcha(b.captchaId, b.captcha)) throw bad('Mã xác nhận chưa đúng');
  if (get('SELECT 1 x FROM accounts WHERE email=?', email)) throw bad('Gmail này đã được đăng ký');
  if (get('SELECT 1 x FROM accounts WHERE username=?', user)) throw bad('Tên đăng nhập đã có người dùng');
  const pw = await hashPw(b.password);
  const id = tx(() => {
    const av = b.avatar ? saveImage(b.avatar, 200 * 1024) : null;
    return run(`INSERT INTO accounts(email,username,pw,dob,campus,year,major,zalo,bio,avatar_img,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      email, user, pw, dob, b.campus, b.year, b.major, zalo, optStr(b.bio, 80), av, now()).lastInsertRowid;
  });
  newSession(c.res, c.req, id);
  return { ok: true };
});

route('POST', '/api/login', {}, async c => {
  const k = optStr(c.body.id, 100).toLowerCase();
  if (!k || typeof c.body.password !== 'string') throw bad('Tài khoản hoặc mật khẩu chưa đúng');
  if (!rl('login:' + c.ip, 15, 10 * 60e3) || !rl('loginu:' + k, 10, 10 * 60e3)) throw tooFast();
  const a = get('SELECT * FROM accounts WHERE email=? OR username=?', k, k);
  if (!a || !(await checkPw(c.body.password, a.pw))) throw bad('Tài khoản hoặc mật khẩu chưa đúng');
  if (a.banned) throw bad('Tài khoản này đã bị khóa', 403);
  newSession(c.res, c.req, a.id);
  return { ok: true };
});

route('POST', '/api/logout', {}, c => {
  const t = cookies(c.req).loop_sid;
  if (t) run('DELETE FROM sessions WHERE token=?', sha(t));
  setCookie(c.res, c.req, '', 0);
});

route('PATCH', '/api/me', { auth: 1, max: 400 * 1024 }, c => {
  const b = c.body, me = c.me;
  const campus = b.campus === undefined ? me.campus : b.campus, year = b.year === undefined ? me.year : b.year, major = b.major === undefined ? me.major : b.major;
  if (!CAMPUS_NAMES.includes(campus) || !YEARS.includes(year) || !MAJORS.includes(major)) throw bad('Thông tin không hợp lệ');
  const zalo = b.zalo === undefined ? me.zalo : optStr(b.zalo, 15);
  if (!/^[0-9+ ]*$/.test(zalo)) throw bad('Số Zalo không hợp lệ');
  const bio = b.bio === undefined ? me.bio : optStr(b.bio, 80);
  tx(() => {
    let av = me.avatar_img;
    if (b.avatar === '') { if (av) delImages([av]); av = null; }
    else if (b.avatar) { const n = saveImage(b.avatar, 200 * 1024); if (av) delImages([av]); av = n; }
    run('UPDATE accounts SET campus=?,year=?,major=?,zalo=?,bio=?,avatar_img=? WHERE id=?', campus, year, major, zalo, bio, av, me.id);
  });
});

route('POST', '/api/me/password', { auth: 1 }, async c => {
  if (!rl('pw:' + c.me.id, 8, 3600e3)) throw tooFast();
  if (typeof c.body.old !== 'string' || typeof c.body.next !== 'string') throw bad('Thiếu thông tin');
  if (!(await checkPw(c.body.old, c.me.pw))) throw bad('Mật khẩu hiện tại chưa đúng');
  if (c.body.next.length < 6 || c.body.next.length > 100) throw bad('Mật khẩu mới cần ít nhất 6 ký tự');
  run('UPDATE accounts SET pw=? WHERE id=?', await hashPw(c.body.next), c.me.id);
  const t = cookies(c.req).loop_sid;
  run('DELETE FROM sessions WHERE account_id=? AND token!=?', c.me.id, sha(t || ''));
});

/* ---------- Dữ liệu chính ---------- */
function itemOut(r, fav) {
  let imgs = [];
  try { imgs = JSON.parse(r.imgs).map(imgUrl); } catch (_) {}
  return {
    id: r.id, t: r.title, p: r.price, oldp: r.oldp || 0, c: r.cat, cond: r.cnd, ty: r.ty, cp: r.cp, spot: r.spot,
    code: r.code || '', d: r.descr || '', s: r.seller, st: r.status, ft: r.ft ? 1 : 0, views: r.views, fc: r.fc || 0, ts: r.ts, imgs
  };
}
const ITEM_SQL = `SELECT i.*, a.username AS seller, (i.fav_base + (SELECT COUNT(*) FROM favs f WHERE f.item_id=i.id)) AS fc
  FROM items i JOIN accounts a ON a.id=i.seller_id`;

route('GET', '/api/bootstrap', {}, c => {
  const me = c.me, v = me ? me.id : 0, adm = me && me.admin ? 1 : 0;
  const rows = all(`${ITEM_SQL} WHERE a.banned=0
    AND (i.status IN ('ok','sold') OR i.seller_id=:v OR :adm=1)
    AND (i.seller_id=:v OR i.seller_id NOT IN (SELECT blocked_id FROM blocks WHERE account_id=:v))
    ORDER BY i.ts DESC LIMIT 1500`, { v, adm });
  const sellers = {}, leaders = [];
  all(`SELECT a.username, a.campus, a.year, a.major, a.bio, a.zalo, a.avatar_img, a.base_r, a.base_n, a.admin,
      a.base_deals + (SELECT COUNT(*) FROM items WHERE seller_id=a.id AND status='sold') AS deals,
      (SELECT COALESCE(SUM(stars),0) FROM ratings WHERE seller_id=a.id) AS sm, (SELECT COUNT(*) FROM ratings WHERE seller_id=a.id) AS cnt
      FROM accounts a WHERE a.banned=0`).forEach(a => {
    const n = a.base_n + a.cnt, r = n ? Math.round(((a.base_r * a.base_n + a.sm) / n) * 10) / 10 : 0;
    const o = {
      r, n, deals: a.deals, trust: a.deals >= 15 && r >= 4.5 ? 1 : 0, year: a.year, major: a.major, bio: a.bio || '',
      zalo: me ? a.zalo || '' : '', avatar: a.avatar_img ? imgUrl(a.avatar_img) : ''
    };
    sellers[a.username] = o;
    if (!a.admin && a.deals > 0) leaders.push({ name: a.username, campus: a.campus, deals: a.deals, r, n, avatar: o.avatar });
  });
  leaders.sort((x, y) => y.deals - x.deals || y.r - x.r || (x.name < y.name ? -1 : 1));
  return {
    me: meOut(me),
    items: rows.map(itemOut),
    sellers,
    leaders: leaders.slice(0, 8),
    favs: me ? all('SELECT item_id FROM favs WHERE account_id=?', me.id).map(r => r.item_id) : [],
    rated: me ? Object.fromEntries(all(`SELECT a.username u, r.stars s FROM ratings r JOIN accounts a ON a.id=r.seller_id WHERE r.rater_id=?`, me.id).map(r => [r.u, r.s])) : {},
    stats: { reused: get(`SELECT COALESCE(SUM(base_deals),0) + (SELECT COUNT(*) FROM items WHERE status='sold') AS n FROM accounts`).n, members: get('SELECT COUNT(*) n FROM accounts WHERE banned=0').n },
    unread: me ? unreadOf(me.id) : 0,
    config: { demo: !!get(`SELECT 1 x FROM accounts WHERE username='demo' AND banned=0`) }
  };
});

route('GET', '/api/unread', { auth: 1 }, c => ({ unread: unreadOf(c.me.id) }));

route('GET', '/api/img/:id', {}, c => {
  const r = get('SELECT mime,data FROM images WHERE id=?', +c.params.id);
  if (!r) throw bad('Không tìm thấy ảnh', 404);
  c.res.writeHead(200, {
    'Content-Type': r.mime, 'Content-Length': r.data.length, 'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"
  });
  c.res.end(c.req.method === 'HEAD' ? undefined : Buffer.from(r.data));
  return RAW;
});

/* ---------- Tin đăng ---------- */
route('POST', '/api/items', { auth: 1, max: 8 * 1024 * 1024 }, c => {
  const b = c.body, me = c.me;
  if (!rl('post:' + me.id, 10, 3600e3)) throw tooFast();
  const title = str(b.t, 3, 120, 'Tiêu đề cần từ 3 đến 120 ký tự');
  const ty = ['sell', 'swap', 'free'].includes(b.ty) ? b.ty : null;
  if (!ty) throw bad('Hình thức không hợp lệ');
  const price = ty === 'free' ? 0 : int(b.p ?? 0, 0, 1e9, 'Giá không hợp lệ');
  if (!CATS.includes(b.c)) throw bad('Danh mục không hợp lệ');
  const cnd = int(b.cond, 0, 2, 'Tình trạng không hợp lệ');
  const cp = int(b.cp, 1, CAMPUS_N, 'Campus không hợp lệ');
  if (!SPOTS.includes(b.spot)) throw bad('Điểm hẹn không hợp lệ');
  const code = optStr(b.code, 20), descr = optStr(b.d, 2000) || 'Chưa có mô tả.';
  const imgIn = Array.isArray(b.imgs) ? b.imgs : [];
  if (imgIn.length > 8) throw bad('Tối đa 8 ảnh');
  if (get(`SELECT COUNT(*) n FROM items WHERE seller_id=? AND ts>?`, me.id, now() - 864e5).n >= 20) throw bad('Bạn đã đăng quá số tin cho phép trong 24 giờ', 429);
  const flagged = BAD.some(w => (title + ' ' + descr).toLowerCase().includes(w));
  const status = flagged && !me.admin ? 'pending' : 'ok';
  const id = tx(() => {
    const ids = imgIn.map(x => saveImage(x, 500 * 1024));
    return run(`INSERT INTO items(seller_id,title,price,cat,cnd,ty,cp,spot,code,descr,imgs,status,ts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      me.id, title, price, b.c, cnd, ty, cp, b.spot, code, descr, JSON.stringify(ids), status, now()).lastInsertRowid;
  });
  return { id, status };
});

function ownItem(c) {
  const it = get('SELECT * FROM items WHERE id=?', +c.params.id);
  if (!it) throw bad('Tin không tồn tại', 404);
  if (it.seller_id !== c.me.id && !c.me.admin) throw bad('Bạn không có quyền với tin này', 403);
  return it;
}
function removeItem(it) {
  let ids = []; try { ids = JSON.parse(it.imgs); } catch (_) {}
  run('DELETE FROM items WHERE id=?', it.id);
  delImages(ids);
}

route('PATCH', '/api/items/:id', { auth: 1 }, c => {
  const it = ownItem(c), a = c.body.action;
  if (a === 'sold') run(`UPDATE items SET status='sold', ft=0 WHERE id=? AND status='ok'`, it.id);
  else if (a === 'price') {
    const n = int(c.body.price, 0, 1e9, 'Giá không hợp lệ');
    let oldp = it.oldp;
    if (n < it.price && !oldp) oldp = it.price;
    if (oldp && n >= oldp) oldp = null;
    run('UPDATE items SET price=?, oldp=? WHERE id=?', n, oldp, it.id);
  } else if (a === 'boost') {
    if (it.status !== 'ok') throw bad('Chỉ đẩy được tin đang hiển thị');
    run('UPDATE items SET ft=1 WHERE id=?', it.id);
  } else throw bad('Thao tác không hợp lệ');
});
route('DELETE', '/api/items/:id', { auth: 1 }, c => { removeItem(ownItem(c)); });

const seenViews = new Map();
route('POST', '/api/items/:id/view', {}, c => {
  const id = +c.params.id;
  const it = get(`SELECT seller_id FROM items WHERE id=? AND status='ok'`, id);
  if (!it || (c.me && c.me.id === it.seller_id)) return {};
  const key = (c.me ? 'u' + c.me.id : 'ip' + c.ip) + ':' + id;
  const t = now();
  if ((seenViews.get(key) || 0) > t) return {};
  if (seenViews.size > 50000) seenViews.clear();
  seenViews.set(key, t + 3600e3);
  run('UPDATE items SET views=views+1 WHERE id=?', id);
  return {};
});

route('POST', '/api/items/:id/fav', { auth: 1 }, c => {
  const id = +c.params.id;
  if (!get(`SELECT 1 x FROM items WHERE id=? AND status IN ('ok','sold')`, id)) throw bad('Tin không tồn tại', 404);
  if (c.body.on) run('INSERT OR IGNORE INTO favs(account_id,item_id) VALUES(?,?)', c.me.id, id);
  else run('DELETE FROM favs WHERE account_id=? AND item_id=?', c.me.id, id);
});

route('POST', '/api/items/:id/report', { auth: 1 }, c => {
  const id = +c.params.id;
  if (!get('SELECT 1 x FROM items WHERE id=?', id)) throw bad('Tin không tồn tại', 404);
  if (!rl('rep:' + c.me.id, 20, 3600e3)) throw tooFast();
  run('INSERT OR REPLACE INTO reports(item_id,reporter_id,why,ts) VALUES(?,?,?,?)', id, c.me.id, optStr(c.body.why, 200) || 'Người dùng báo cáo', now());
});

route('POST', '/api/blocks', { auth: 1 }, c => {
  const u = get('SELECT id FROM accounts WHERE username=?', optStr(c.body.user, 24));
  if (!u || u.id === c.me.id) throw bad('Không thể chặn người dùng này');
  if (c.body.on === false) run('DELETE FROM blocks WHERE account_id=? AND blocked_id=?', c.me.id, u.id);
  else run('INSERT OR IGNORE INTO blocks(account_id,blocked_id) VALUES(?,?)', c.me.id, u.id);
});

route('POST', '/api/sellers/:user/rate', { auth: 1 }, c => {
  const s = get('SELECT id FROM accounts WHERE username=? AND banned=0', c.params.user);
  if (!s) throw bad('Không tìm thấy người bán', 404);
  if (s.id === c.me.id) throw bad('Bạn không thể tự đánh giá mình');
  const stars = int(c.body.stars, 1, 5, 'Số sao không hợp lệ');
  if (!get(`SELECT 1 x FROM messages m JOIN items i ON i.id=m.item_id WHERE m.buyer_id=? AND i.seller_id=? LIMIT 1`, c.me.id, s.id))
    throw bad('Bạn cần nhắn tin với người bán trước khi đánh giá');
  run('INSERT OR REPLACE INTO ratings(rater_id,seller_id,stars,ts) VALUES(?,?,?,?)', c.me.id, s.id, stars, now());
});

/* ---------- Tin nhắn ---------- */
const blockedEither = (a, b) => !!get('SELECT 1 x FROM blocks WHERE (account_id=? AND blocked_id=?) OR (account_id=? AND blocked_id=?)', a, b, b, a);

function threadCtx(c) {
  const it = get('SELECT i.*, a.username AS seller FROM items i JOIN accounts a ON a.id=i.seller_id WHERE i.id=?', +c.params.id);
  if (!it) throw bad('Tin không tồn tại', 404);
  const isSeller = c.me.id === it.seller_id;
  let buyer;
  if (isSeller) {
    const name = optStr(c.u.searchParams.get('buyer') || c.body.buyer, 24);
    buyer = get('SELECT id, username FROM accounts WHERE username=?', name);
    if (!buyer) throw bad('Không tìm thấy người mua', 404);
  } else buyer = { id: c.me.id, username: c.me.username };
  return { it, isSeller, buyer };
}

route('GET', '/api/items/:id/messages', { auth: 1 }, c => {
  const { it, isSeller, buyer } = threadCtx(c);
  const msgs = all('SELECT sender_id,text,ts FROM messages WHERE item_id=? AND buyer_id=? ORDER BY id LIMIT 500', it.id, buyer.id);
  run('UPDATE messages SET seen=1 WHERE item_id=? AND buyer_id=? AND sender_id!=?', it.id, buyer.id, c.me.id);
  return { title: it.title, status: it.status, isSeller, other: isSeller ? buyer.username : it.seller, msgs: msgs.map(m => ({ me: m.sender_id === c.me.id ? 1 : 0, t: m.text, ts: m.ts })) };
});

route('POST', '/api/items/:id/messages', { auth: 1 }, c => {
  const { it, isSeller, buyer } = threadCtx(c);
  const text = str(c.body.text, 1, 500, 'Tin nhắn từ 1 đến 500 ký tự');
  if (!rl('msg:' + c.me.id, 30, 60e3)) throw tooFast();
  const otherId = isSeller ? buyer.id : it.seller_id;
  if (blockedEither(c.me.id, otherId)) throw bad('Không thể gửi tin nhắn cho người dùng này', 403);
  if (isSeller) {
    if (!get('SELECT 1 x FROM messages WHERE item_id=? AND buyer_id=? LIMIT 1', it.id, buyer.id)) throw bad('Chưa có cuộc trò chuyện với người mua này');
  } else if (it.status !== 'ok') throw bad('Tin này không còn nhận tin nhắn');
  run('INSERT INTO messages(item_id,buyer_id,sender_id,text,ts) VALUES(?,?,?,?,?)', it.id, buyer.id, c.me.id, text, now());
});

route('GET', '/api/inbox', { auth: 1 }, c => ({
  threads: all(`SELECT m.item_id, m.buyer_id, i.title, i.status, sa.username AS seller, ba.username AS buyer, MAX(m.ts) AS last_ts,
      (SELECT text FROM messages m2 WHERE m2.item_id=m.item_id AND m2.buyer_id=m.buyer_id ORDER BY m2.id DESC LIMIT 1) AS last_text,
      SUM(CASE WHEN m.sender_id!=:v AND m.seen=0 THEN 1 ELSE 0 END) AS unread
    FROM messages m JOIN items i ON i.id=m.item_id JOIN accounts sa ON sa.id=i.seller_id JOIN accounts ba ON ba.id=m.buyer_id
    WHERE m.buyer_id=:v OR i.seller_id=:v GROUP BY m.item_id, m.buyer_id ORDER BY last_ts DESC LIMIT 100`, { v: c.me.id })
    .map(t => ({ id: t.item_id, title: t.title, st: t.status, buyer: t.buyer, other: t.buyer === c.me.username ? t.seller : t.buyer, last: t.last_text, ts: t.last_ts, unread: t.unread }))
}));

/* ---------- Quản trị ---------- */
route('GET', '/api/admin/data', { admin: 1 }, c => ({
  stats: {
    users: get('SELECT COUNT(*) n FROM accounts').n, items: get('SELECT COUNT(*) n FROM items').n,
    sold: get(`SELECT COUNT(*) n FROM items WHERE status='sold'`).n, featured: get('SELECT COUNT(*) n FROM items WHERE ft=1').n
  },
  pending: all(`${ITEM_SQL} WHERE i.status='pending' ORDER BY i.ts DESC LIMIT 200`).map(itemOut),
  reports: all(`SELECT r.id, r.why, r.ts, i.id AS item_id, i.title, sa.username AS seller, ra.username AS reporter
    FROM reports r JOIN items i ON i.id=r.item_id JOIN accounts sa ON sa.id=i.seller_id JOIN accounts ra ON ra.id=r.reporter_id ORDER BY r.id DESC LIMIT 200`),
  users: all('SELECT id, username, email, campus, created, banned, admin FROM accounts ORDER BY id DESC LIMIT 300')
}));

route('POST', '/api/admin/items/:id', { admin: 1 }, c => {
  const it = get('SELECT * FROM items WHERE id=?', +c.params.id);
  if (!it) throw bad('Tin không tồn tại', 404);
  const a = c.body.action;
  if (a === 'approve') run(`UPDATE items SET status='ok' WHERE id=?`, it.id);
  else if (a === 'reject') removeItem(it);
  else throw bad('Thao tác không hợp lệ');
});

function banUser(id, banned) {
  const u = get('SELECT admin FROM accounts WHERE id=?', id);
  if (!u) throw bad('Không tìm thấy người dùng', 404);
  if (u.admin) throw bad('Không thể khóa tài khoản quản trị');
  run('UPDATE accounts SET banned=? WHERE id=?', banned ? 1 : 0, id);
  if (banned) run('DELETE FROM sessions WHERE account_id=?', id);
}
route('POST', '/api/admin/users/:id', { admin: 1 }, c => banUser(+c.params.id, !!c.body.banned));
route('POST', '/api/admin/reports/:id', { admin: 1 }, c => {
  const r = get('SELECT r.id, i.seller_id FROM reports r JOIN items i ON i.id=r.item_id WHERE r.id=?', +c.params.id);
  if (!r) throw bad('Báo cáo không tồn tại', 404);
  if (c.body.lock) banUser(r.seller_id, true);
  run('DELETE FROM reports WHERE id=?', r.id);
});

/* ---------- File tĩnh ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, p) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw bad('Phương thức không được hỗ trợ', 405);
  let rel; try { rel = decodeURIComponent(p); } catch (_) { throw bad('Đường dẫn không hợp lệ'); }
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw bad('Không tìm thấy trang', 404);
  const ext = path.extname(file);
  send(req, res, 200, MIME[ext] || 'application/octet-stream', fs.readFileSync(file), { 'Cache-Control': ext === '.html' || ext === '.js' ? 'no-cache' : 'public, max-age=3600' });
}

/* ---------- Máy chủ ---------- */
const server = http.createServer(async (req, res) => {
  try {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (u.pathname.startsWith('/api/')) return await handleApi(req, res, u);
    return serveStatic(req, res, u.pathname);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (!(e instanceof HttpError)) console.error(e);
    if (res.headersSent) return res.end();
    if (req.url.startsWith('/api/')) json(req, res, status, { error: e instanceof HttpError ? e.message : 'Lỗi máy chủ, vui lòng thử lại' });
    else send(req, res, status, 'text/plain; charset=utf-8', status === 404 ? 'Không tìm thấy trang' : 'Lỗi', {});
  }
});
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

/* ---------- Khởi tạo dữ liệu ---------- */
async function ensureAdmin() {
  const envPw = process.env.ADMIN_PASSWORD;
  const a = get(`SELECT * FROM accounts WHERE username='admin'`);
  if (!a) {
    const pw = envPw || (IS_PROD ? crypto.randomBytes(9).toString('base64url') : 'admin123');
    run(`INSERT INTO accounts(email,username,pw,dob,campus,year,major,bio,admin,created) VALUES(?,?,?,?,?,?,?,?,1,?)`,
      (process.env.ADMIN_EMAIL || 'admin@gmail.com').toLowerCase(), 'admin', await hashPw(pw), '2000-01-01', 'Hòa Lạc', 'Năm 4', 'Kỹ thuật phần mềm', 'Quản trị viên FPT LOOP', now());
    console.log('==========================================================');
    console.log(' Đã tạo tài khoản quản trị:  admin');
    console.log(envPw ? ' Mật khẩu: lấy từ biến môi trường ADMIN_PASSWORD' : ` Mật khẩu: ${pw}   <-- hãy lưu lại và đổi trong mục Hồ sơ`);
    console.log('==========================================================');
  } else if (envPw && !(await checkPw(envPw, a.pw))) {
    run('UPDATE accounts SET pw=?, admin=1, banned=0 WHERE id=?', await hashPw(envPw), a.id);
    console.log('Đã đồng bộ mật khẩu admin theo ADMIN_PASSWORD');
  }
}

async function seedDemo() {
  if (!SEED_DEMO || get('SELECT COUNT(*) n FROM items').n > 0 || get(`SELECT 1 x FROM accounts WHERE username='demo'`)) return;
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));
  const ids = {};
  for (const a of seed.accounts) {
    if (a.admin) continue;
    const pw = await hashPw(a.user === 'demo' ? '123456' : crypto.randomBytes(12).toString('hex'));
    const s = seed.sellers[a.user] || {};
    ids[a.user] = run(`INSERT INTO accounts(email,username,pw,dob,campus,year,major,zalo,bio,base_r,base_n,base_deals,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      a.email, a.user, pw, a.dob, a.campus, a.year, a.major, a.zalo, a.bio, s.r || 0, s.n || 0, s.deals || 0, now()).lastInsertRowid;
  }
  tx(() => {
    for (const it of seed.items) {
      if (!ids[it.s]) continue;
      const imgs = (it.imgs || []).map(d => {
        const m = /^data:(image\/svg\+xml);base64,(.+)$/.exec(d);
        return m ? run('INSERT INTO images(mime,data) VALUES(?,?)', m[1], Buffer.from(m[2], 'base64')).lastInsertRowid : null;
      }).filter(Boolean);
      run(`INSERT INTO items(seller_id,title,price,oldp,cat,cnd,ty,cp,spot,code,descr,imgs,status,ft,views,fav_base,ts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ids[it.s], it.t, it.p, it.oldp || null, it.c, it.cond, it.ty, it.cp, it.spot, it.code || '', it.d, JSON.stringify(imgs), it.st, it.ft ? 1 : 0, it.views || 0, it.fc || 0, now() - (it.ago || 0));
    }
  });
  console.log('Đã nạp dữ liệu mẫu (tắt bằng SEED_DEMO=false). Tài khoản dùng thử: demo / 123456');
}

setInterval(() => {
  const t = now();
  run('DELETE FROM sessions WHERE expires<?', t);
  for (const [k, v] of buckets) if (v.reset < t) buckets.delete(k);
  for (const [k, v] of captchas) if (v.exp < t) captchas.delete(k);
  for (const [k, v] of seenViews) if (v < t) seenViews.delete(k);
}, 3600e3).unref();

(async () => {
  await ensureAdmin();
  await seedDemo();
  server.listen(PORT, '0.0.0.0', () => console.log(`FPT LOOP đang chạy tại cổng ${PORT} (dữ liệu: ${DATA_DIR})`));
})().catch(e => { console.error(e); process.exit(1); });

function shutdown() {
  server.close(() => { try { db.close(); } catch (_) {} process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
