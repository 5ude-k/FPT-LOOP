'use strict';
const CATS = [['all', 'Tất cả', '✦'], ['book', 'Sách & giáo trình', '📚'], ['tech', 'Laptop, điện thoại, phụ kiện', '💻'], ['elec', 'Đồ điện tử', '🎧'], ['dorm', 'Nội thất KTX', '🛏️'], ['cloth', 'Quần áo', '👕'], ['bike', 'Xe đạp', '🚲'], ['misc', 'Đồ dùng cá nhân', '🎒']];
const CAMPUS = ['Tất cả campus', 'Hòa Lạc', 'TP.HCM', 'Đà Nẵng', 'Cần Thơ', 'Quy Nhơn'];
const COND = ['Mới 99%', 'Đã dùng ít', 'Đã dùng nhiều'];
const SPOTS = ['Căng tin', 'Thư viện', 'Cổng KTX', 'Sảnh Alpha', 'Bãi xe'];
const YEARS = ['Năm 1', 'Năm 2', 'Năm 3', 'Năm 4', 'Cựu sinh viên'];
const MAJORS = ['Kỹ thuật phần mềm', 'Trí tuệ nhân tạo', 'An toàn thông tin', 'Thiết kế đồ họa', 'Quản trị kinh doanh', 'Ngôn ngữ Anh', 'Ngôn ngữ Nhật', 'Ngành khác'];
const TINT = { book: '#e6eefb', tech: '#e3f1f1', elec: '#fdeede', dorm: '#eaf3e3', cloth: '#f6e7ef', bike: '#e9f0e0', misc: '#efe9f7' };

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vnd = n => n ? n.toLocaleString('vi-VN') + 'đ' : 'Miễn phí';
const cat = id => CATS.find(c => c[0] === id);
const opts = (arr, sel) => arr.map(x => `<option${x === sel ? ' selected' : ''}>${esc(x)}</option>`).join('');

let D = { me: null, items: [], sellers: {}, leaders: [], favs: new Set(), rated: {}, stats: { reused: 0, members: 0 }, config: {}, unread: 0 };
let S = { tab: 'shop', cat: 'all', q: '', min: '', max: '', cond: 'all', sort: 'new', campus: 0, ty: 'all', favOnly: false, view: 'grid', seller: '', lastV: 0 };
let CH = null, chatT = null;

/* ---------- Gọi API ---------- */
async function api(method, url, body) {
  const o = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
  if (method !== 'GET') o.body = JSON.stringify(body || {});
  let r;
  try { r = await fetch(url, o); } catch (e) { throw new Error('Không kết nối được máy chủ, vui lòng thử lại'); }
  let d = null;
  try { d = await r.json(); } catch (e) { /* không phải JSON */ }
  if (!r.ok) throw new Error((d && d.error) || 'Có lỗi xảy ra (' + r.status + ')');
  return d;
}
function safe(f) {
  return async function (...a) {
    const btn = this && this.tagName === 'BUTTON' ? this : null;
    if (btn) { if (btn.disabled) return; btn.disabled = true; }
    try { return await f.apply(this, a); }
    catch (e) { toast(e.message || 'Có lỗi xảy ra'); }
    finally { if (btn) btn.disabled = false; }
  };
}
async function load() {
  const d = await api('GET', '/api/bootstrap');
  D = { me: d.me, items: d.items, sellers: d.sellers, leaders: d.leaders, favs: new Set(d.favs), rated: d.rated, stats: d.stats, config: d.config, unread: d.unread };
  render();
}

/* ---------- Giao diện chung ---------- */
function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), 2600); }
function modal(h) { $('#mb').innerHTML = '<button class="x" aria-label="Đóng" onclick="closeM()">×</button>' + h; $('#m').classList.add('on'); }
function closeM() { S.lastV = 0; CH = null; clearInterval(chatT); $('#m').classList.remove('on'); if (location.hash.startsWith('#tin-')) history.replaceState(null, '', location.pathname + location.search); }
$('#m').addEventListener('click', e => { if (e.target.id === 'm') closeM(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeM(); });
function needLogin() { if (D.me) return false; toast('Bạn cần đăng nhập để tiếp tục'); loginM(); return true; }

$('#campus').innerHTML = CAMPUS.map((c, i) => `<option value="${i}">${c}</option>`).join('');
$('#campus').onchange = e => { S.campus = +e.target.value; render(); };
$('#post').onclick = () => { if (!needLogin()) postM(); };
$('#fav').onclick = () => { S.favOnly = !S.favOnly; S.tab = 'shop'; $('#fav').textContent = (S.favOnly ? '♥' : '♡') + ' Đã lưu'; render(); };
$('#reg').onclick = () => regM();
$('#prof').onclick = () => profM();
$('#login').onclick = safe(async () => {
  if (D.me) { await api('POST', '/api/logout'); S.tab = 'shop'; S.favOnly = false; $('#fav').textContent = '♡ Đã lưu'; await load(); toast('Đã đăng xuất'); }
  else loginM();
});

function tabs() {
  const t = [['shop', 'Chợ'], ['me', 'Tin của tôi'], ['inbox', 'Tin nhắn' + (D.unread ? `<span class="badge">${D.unread}</span>` : '')]];
  if (D.me && D.me.admin) t.push(['admin', 'Quản trị']);
  $('#tabs').innerHTML = t.map(([k, l]) => `<button class="${S.tab === k ? 'on' : ''}" onclick="S.tab='${k}';render()">${l}</button>`).join('');
}

/* ---------- Avatar & ảnh ---------- */
function avHtml(u, z) {
  const a = u && typeof u.avatar === 'string' && u.avatar.startsWith('/api/img/') ? u.avatar : '';
  return a ? `<img src="${a}" alt="" width="${z}" height="${z}" style="border-radius:50%;object-fit:cover;vertical-align:middle">`
    : `<span style="display:inline-flex;width:${z}px;height:${z}px;border-radius:50%;background:var(--blue);color:#fff;align-items:center;justify-content:center;font-weight:700;font-size:${Math.round(z * .45)}px;vertical-align:middle;flex:none">${esc(((u && u.name) || '?')[0].toUpperCase())}</span>`;
}
const acc = n => Object.assign({}, D.sellers[n] || {}, { name: n });
function readImg(f, mx, q, square) {
  return new Promise(r => {
    const fr = new FileReader();
    fr.onload = () => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas'), x = c.getContext('2d');
        if (square) { c.width = c.height = mx; const m = Math.min(im.width, im.height); x.drawImage(im, (im.width - m) / 2, (im.height - m) / 2, m, m, 0, 0, mx, mx); }
        else { const k = Math.min(1, mx / Math.max(im.width, im.height)); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); x.drawImage(im, 0, 0, c.width, c.height); }
        r(c.toDataURL('image/jpeg', q));
      };
      im.onerror = () => r(''); im.src = fr.result;
    };
    fr.onerror = () => r(''); fr.readAsDataURL(f);
  });
}

/* ---------- Đăng nhập / đăng ký / hồ sơ ---------- */
function loginM() {
  modal(`<h2>Đăng nhập</h2><div class="f">
<label>Gmail hoặc tên đăng nhập<input id="em" autocomplete="username"></label>
<label>Mật khẩu<input id="pw" type="password" autocomplete="current-password" onkeydown="if(event.key==='Enter')doLogin.call($('#lg'))"></label>
<button class="btn p" id="lg" onclick="doLogin.call(this)">Đăng nhập</button>
${D.config.demo ? '<p class="meta" style="margin:0">Dùng thử: tên đăng nhập <b>demo</b>, mật khẩu <b>123456</b></p>' : ''}
<p class="meta" style="margin:4px 0 0">Chưa có tài khoản? <a href="#" onclick="regM();return false">Đăng ký</a></p></div>`);
}
const doLogin = safe(async () => {
  await api('POST', '/api/login', { id: $('#em').value, password: $('#pw').value });
  closeM(); await load(); toast('Đăng nhập thành công');
});

let CAPID = '', AV = '';
const drawCap = safe(async () => {
  const d = await api('GET', '/api/captcha'); CAPID = d.id;
  const e = $('#cvimg'); if (e) e.src = d.img;
});
function regM() {
  AV = '';
  modal(`<h2>Đăng ký tài khoản</h2><div class="f">
<div class="row" style="flex-wrap:nowrap;margin:0"><span id="avp" style="flex:none">${avHtml({ name: '?' }, 48)}</span><label style="flex:1">Ảnh đại diện (không bắt buộc)<input id="rav" type="file" accept="image/*"></label></div>
<label>Gmail<input id="rem" type="email" autocomplete="email" placeholder="ten@gmail.com"></label>
<label>Tên đăng nhập (chữ, số, dấu chấm hoặc gạch dưới, 3 đến 24 ký tự)<input id="ru" autocomplete="username" maxlength="24"></label>
<label>Mật khẩu (tối thiểu 6 ký tự)<input id="rp" type="password" autocomplete="new-password"></label>
<div class="two"><label>Sinh ngày<input id="rd" type="date"></label>
<label>Bạn đang là<select id="ry">${opts(YEARS)}</select></label></div>
<div class="two"><label>Cơ sở<select id="rc">${opts(CAMPUS.slice(1))}</select></label>
<label>Ngành học<select id="rm">${opts(MAJORS)}</select></label></div>
<label>Zalo liên hệ (không bắt buộc, chỉ thành viên đã đăng nhập mới thấy)<input id="rz" inputmode="tel" maxlength="15"></label>
<label>Giới thiệu ngắn (không bắt buộc)<input id="rb" maxlength="80" placeholder="VD: Thanh lý sách năm 1, ở KTX B"></label>
<label>Mã xác nhận<div class="row" style="margin:0;flex-wrap:nowrap"><img id="cvimg" width="150" height="44" alt="Mã captcha" style="border-radius:8px;flex:none;background:#eef3f8"><button class="btn s" type="button" onclick="drawCap()">Đổi mã</button></div><input id="rcap" autocomplete="off" placeholder="Nhập 5 ký tự trong ảnh"></label>
<label class="row" style="flex-direction:row;flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" id="rt" style="width:auto;margin-top:4px"> Mình cam kết giao dịch trung thực và hẹn gặp ở nơi công cộng trong trường</label>
<button class="btn p" onclick="doReg.call(this)">Tạo tài khoản</button>
<p class="meta" style="margin:4px 0 0">Đã có tài khoản? <a href="#" onclick="loginM();return false">Đăng nhập</a></p></div>`);
  drawCap();
  $('#rav').onchange = async e => {
    const f = e.target.files[0];
    if (f && f.size > 8e6) { toast('Ảnh tối đa 8MB'); e.target.value = ''; return; }
    AV = f ? await readImg(f, 96, .8, true) : '';
    if (AV) $('#avp').innerHTML = `<img src="${AV}" alt="" width="48" height="48" style="border-radius:50%;object-fit:cover">`;
  };
}
const doReg = safe(async () => {
  if (!$('#rt').checked) { toast('Vui lòng đồng ý cam kết giao dịch'); return; }
  await api('POST', '/api/register', {
    email: $('#rem').value, user: $('#ru').value, password: $('#rp').value, dob: $('#rd').value, year: $('#ry').value, campus: $('#rc').value,
    major: $('#rm').value, zalo: $('#rz').value, bio: $('#rb').value, avatar: AV || undefined, captchaId: CAPID, captcha: $('#rcap').value, agree: true
  }).catch(e => { drawCap(); if ($('#rcap')) $('#rcap').value = ''; throw e; });
  closeM(); await load(); toast('Đăng ký thành công, chào ' + D.me.name);
});

let NEWAV;
function profM() {
  const u = D.me; NEWAV = undefined;
  modal(`<h2>Hồ sơ của bạn</h2><div class="f">
<div class="row" style="flex-wrap:nowrap;margin:0"><span id="avp" style="flex:none">${avHtml(u, 48)}</span><label style="flex:1">Đổi ảnh đại diện<input id="pav" type="file" accept="image/*"></label></div>
<div class="meta">Gmail: ${esc(u.email)} · Tên đăng nhập: <b>${esc(u.name)}</b></div>
<div class="two"><label>Bạn đang là<select id="py">${opts(YEARS, u.year)}</select></label><label>Cơ sở<select id="pcm">${opts(CAMPUS.slice(1), u.campus)}</select></label></div>
<label>Ngành học<select id="pm">${opts(MAJORS, u.major)}</select></label>
<label>Zalo liên hệ<input id="pz" inputmode="tel" maxlength="15" value="${esc(u.zalo)}"></label>
<label>Giới thiệu ngắn<input id="pb" maxlength="80" value="${esc(u.bio)}"></label>
<button class="btn p" onclick="saveProf.call(this)">Lưu hồ sơ</button>
<h2 style="font-size:17px;margin:12px 0 0">Đổi mật khẩu</h2>
<label>Mật khẩu hiện tại<input id="po" type="password" autocomplete="current-password"></label>
<label>Mật khẩu mới (tối thiểu 6 ký tự)<input id="pn" type="password" autocomplete="new-password"></label>
<button class="btn" onclick="savePw.call(this)">Đổi mật khẩu</button></div>`);
  $('#pav').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 8e6) { toast('Ảnh tối đa 8MB'); e.target.value = ''; return; }
    NEWAV = await readImg(f, 96, .8, true);
    $('#avp').innerHTML = `<img src="${NEWAV}" alt="" width="48" height="48" style="border-radius:50%;object-fit:cover">`;
  };
}
const saveProf = safe(async () => {
  await api('PATCH', '/api/me', { year: $('#py').value, campus: $('#pcm').value, major: $('#pm').value, zalo: $('#pz').value, bio: $('#pb').value, avatar: NEWAV });
  closeM(); await load(); toast('Đã lưu hồ sơ');
});
const savePw = safe(async () => {
  await api('POST', '/api/me/password', { old: $('#po').value, next: $('#pn').value });
  $('#po').value = $('#pn').value = ''; toast('Đã đổi mật khẩu');
});

/* ---------- Đăng tin ---------- */
function postM() {
  modal(`<h2>Đăng tin mới</h2><div class="f">
<label>Tiêu đề<input id="pt" maxlength="120"></label>
<div class="two"><label>Giá (đ)<input id="pp" type="number" min="0" value="0"></label>
<label>Hình thức<select id="pty"><option value="sell">Bán</option><option value="swap">Trao đổi</option><option value="free">Tặng miễn phí</option></select></label></div>
<div class="two"><label>Danh mục<select id="pc">${CATS.slice(1).map(c => `<option value="${c[0]}">${c[1]}</option>`).join('')}</select></label>
<label>Tình trạng<select id="pcd">${COND.map((c, i) => `<option value="${i}">${c}</option>`).join('')}</select></label></div>
<div class="two"><label>Campus<select id="pcp">${CAMPUS.slice(1).map((c, i) => `<option value="${i + 1}"${D.me && D.me.campus === c ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
<label>Điểm hẹn giao dịch<select id="psp">${opts(SPOTS)}</select></label></div>
<label>Mã môn học (nếu là sách)<input id="pco" maxlength="20" placeholder="VD: PRF192"></label>
<label>Ảnh (tối đa 8)<input id="pim" type="file" accept="image/*" multiple></label>
<label>Mô tả<textarea id="pd" rows="3" maxlength="2000"></textarea></label>
<button class="btn o" onclick="submitPost.call(this)">Đăng tin</button></div>`);
}
const submitPost = safe(async () => {
  const t = $('#pt').value.trim(); if (t.length < 3) { toast('Nhập tiêu đề (ít nhất 3 ký tự)'); return; }
  const fl = [...$('#pim').files]; if (fl.length > 8) { toast('Tối đa 8 ảnh'); return; }
  const imgs = []; for (const f of fl) { const r = await readImg(f, 800, .7); if (r) imgs.push(r); }
  const r = await api('POST', '/api/items', {
    t, p: +$('#pp').value || 0, ty: $('#pty').value, c: $('#pc').value, cond: +$('#pcd').value, cp: +$('#pcp').value,
    spot: $('#psp').value, code: $('#pco').value, d: $('#pd').value, imgs
  });
  closeM(); S.tab = 'shop'; await load();
  toast(r.status === 'pending' ? 'Tin có từ khóa cần kiểm duyệt, đang chờ admin' : 'Đã đăng tin');
});

/* ---------- Danh sách & thẻ ---------- */
function list() {
  let a = D.items.filter(i => i.st === 'ok' || i.st === 'sold');
  if (S.favOnly) a = a.filter(i => D.favs.has(i.id));
  if (S.seller) a = a.filter(i => i.s === S.seller);
  if (S.cat !== 'all') a = a.filter(i => i.c === S.cat);
  if (S.campus) a = a.filter(i => i.cp === S.campus);
  if (S.ty !== 'all') a = a.filter(i => i.ty === S.ty);
  if (S.cond !== 'all') a = a.filter(i => i.cond === +S.cond);
  if (S.q) { const q = S.q.toLowerCase(); a = a.filter(i => (i.t + ' ' + (i.code || '')).toLowerCase().includes(q)); }
  if (S.min !== '') a = a.filter(i => i.p >= +S.min);
  if (S.max !== '') a = a.filter(i => i.p <= +S.max);
  a.sort((x, y) => (x.st === 'sold') - (y.st === 'sold') || (y.ft || 0) - (x.ft || 0) || (S.sort === 'lo' ? x.p - y.p : S.sort === 'hi' ? y.p - x.p : score(y) - score(x)));
  return a;
}
/* Mỗi giao dịch hoàn thành của người bán cộng thêm 4 giờ "độ mới" cho tin của họ */
const score = i => i.ts + ((D.sellers[i.s] || {}).deals || 0) * 4 * 3600e3;
const rankOf = n => D.leaders.findIndex(l => l.name === n) + 1;
function ago(t) { if (!t) return ''; const m = Math.floor((Date.now() - t) / 6e4); return m < 1 ? 'Vừa xong' : m < 60 ? m + ' phút trước' : m < 1440 ? Math.floor(m / 60) + ' giờ trước' : Math.floor(m / 1440) + ' ngày trước'; }
function card(i, mine) {
  const c = cat(i.c), sold = i.st === 'sold', m = i.imgs && i.imgs[0], sl = D.sellers[i.s] || { r: 0, n: 0 }, isNew = i.ts && Date.now() - i.ts < 864e5;
  const tags = [i.st === 'pending' ? '<span class="tag" style="background:#b7791f">Chờ duyệt</span>' : '', i.ft && !sold ? '<span class="tag">Nổi bật</span>' : '', sold ? '<span class="tag" style="background:#6b7787">Đã bán</span>' : '', !sold && i.oldp && i.oldp > i.p ? '<span class="tag" style="background:#d0343f">Giảm giá</span>' : '', isNew && !sold && i.st === 'ok' ? '<span class="tag" style="background:#0b8f6a">Mới</span>' : '', rankOf(i.s) && rankOf(i.s) <= 3 && !sold ? `<span class="tag" style="background:#7a4fd0">🏆 Top ${rankOf(i.s)}</span>` : '', i.ty === 'free' ? '<span class="tag f">Tặng</span>' : i.ty === 'swap' ? '<span class="tag x">Trao đổi</span>' : ''].join('');
  return `<div class="card ${i.ft && !sold ? 'ft' : ''}" role="button" tabindex="0" style="${sold ? 'opacity:.6' : ''}" onclick="openItem(${i.id})" onkeydown="if(event.key==='Enter')openItem(${i.id})"><div class="tile" style="${m ? `background-image:url(${m});background-size:cover;background-position:center` : `background:${TINT[i.c]}`};color:#000">${m ? '' : c[2]}<div class="tags">${tags}</div>
<span class="fav" role="button" aria-label="Lưu tin" onclick="event.stopPropagation();tf(${i.id})">${D.favs.has(i.id) ? '♥' : '♡'}</span></div>
<div class="cb"><h3>${esc(i.t)}</h3><div><span class="price">${vnd(i.p)}</span>${i.oldp && i.oldp > i.p && !sold ? ' <s class="meta">' + vnd(i.oldp) + '</s>' : ''}</div>
<div class="meta">${COND[i.cond]} · ${CAMPUS[i.cp]}</div>
<div class="meta" style="display:flex;align-items:center;gap:5px;margin-top:3px">${avHtml(acc(i.s), 18)}<span>${esc(i.s)}</span>${sl.n ? `<span style="color:#e59b12">★ ${sl.r.toFixed(1)}</span>` : ''}${sl.deals ? `<span class="deals" title="Giao dịch hoàn thành">✔ ${sl.deals}</span>` : ''}</div>
<div class="meta" style="margin-top:2px">${ago(i.ts)} · 👁 ${i.views || 0} · ♥ ${i.fc || 0}</div></div>${mine && !sold && i.st === 'ok' ? `<span class="mk" role="button" onclick="event.stopPropagation();mark(${i.id})">Đánh dấu đã bán</span>` : ''}</div>`;
}
function gal(i) {
  const im = i.imgs || [];
  if (!im.length) return `<div class="tile" style="background:${TINT[i.c]};border-radius:10px;height:150px">${cat(i.c)[2]}</div>`;
  return `<img id="gm" src="${im[0]}" alt="" style="width:100%;max-height:320px;object-fit:contain;background:var(--bg);border-radius:10px">` +
    (im.length > 1 ? `<div class="row" style="margin:6px 0">${im.map(x => `<img src="${x}" alt="" onclick="$('#gm').src=this.src" style="width:56px;height:56px;object-fit:cover;border-radius:6px;cursor:pointer;border:1px solid var(--line)">`).join('')}</div>` : '');
}
function rel(i) {
  const a = D.items.filter(x => x.c === i.c && x.id !== i.id && x.st === 'ok').slice(0, 3);
  return a.length ? `<div class="box"><b>Tin liên quan</b><div class="row">${a.map(r => `<button class="chip" onclick="openItem(${r.id})">${esc(r.t)} · ${vnd(r.p)}</button>`).join('')}</div></div>` : '';
}
function clr() { Object.assign(S, { q: '', min: '', max: '', cond: 'all', cat: 'all', ty: 'all', sort: 'new', favOnly: false, seller: '' }); $('#fav').textContent = '♡ Đã lưu'; render(); }

function shop() {
  return `<section class="hero"><h1>Đồ cũ của bạn, khởi đầu mới cho bạn khác.</h1><p>Mua bán và trao đổi đồ cũ an toàn giữa sinh viên Đại học FPT. Mua thông minh, bán dễ dàng, sống xanh.</p>
<div class="counter"><div><b>${(D.stats.reused || 0).toLocaleString('vi-VN')}</b><span>món đồ được tái sử dụng</span></div><div><b>${(D.stats.members || 0).toLocaleString('vi-VN')}</b><span>thành viên đã đăng ký</span></div></div></section>
<div class="filters"><input id="q" placeholder="Tìm tên món đồ hoặc mã môn (VD: PRF192)" value="${esc(S.q)}" aria-label="Tìm kiếm">
<input id="mn" type="number" placeholder="Giá từ" value="${esc(S.min)}"><input id="mx" type="number" placeholder="Giá đến" value="${esc(S.max)}">
<select id="cd"><option value="all">Mọi tình trạng</option>${COND.map((c, i) => `<option value="${i}" ${S.cond == i && S.cond !== 'all' ? 'selected' : ''}>${c}</option>`).join('')}</select>
<select id="so"><option value="new">Mới nhất</option><option value="lo" ${S.sort === 'lo' ? 'selected' : ''}>Giá thấp đến cao</option><option value="hi" ${S.sort === 'hi' ? 'selected' : ''}>Giá cao đến thấp</option></select></div>
<div class="cats">${CATS.slice(1).map(c => `<button class="cat ${S.cat === c[0] ? 'on' : ''}" onclick="S.cat=S.cat==='${c[0]}'?'all':'${c[0]}';render()"><span>${c[2]}</span>${c[1]}<small>${D.items.filter(i => i.c === c[0] && i.st === 'ok').length} tin</small></button>`).join('')}</div>
<div class="chips">${[['all', 'Mọi hình thức'], ['sell', 'Bán'], ['swap', 'Trao đổi'], ['free', 'Tặng']].map(t => `<button class="chip ${S.ty === t[0] ? 'on' : ''}" onclick="S.ty='${t[0]}';render()">${t[1]}</button>`).join('')}<span style="flex:1"></span>${S.seller ? `<button class="chip on" onclick="S.seller='';render()">Người bán: ${esc(S.seller)} ✕</button>` : ''}<button class="chip" onclick="clr()">Xóa bộ lọc</button><button class="chip ${S.view !== 'list' ? 'on' : ''}" onclick="S.view='grid';render()">Lưới</button><button class="chip ${S.view === 'list' ? 'on' : ''}" onclick="S.view='list';render()">Danh sách</button></div>
<div class="layout"><div id="g"></div>${rankBox()}</div>`;
}
function rankBox() {
  if (!D.leaders.length) return '';
  const medal = ['🥇', '🥈', '🥉'];
  return `<aside class="rank" aria-label="Bảng xếp hạng"><h2>🏆 Bảng xếp hạng nổi bật</h2><p class="meta">Xếp theo số giao dịch hoàn thành. Người bán càng nhiều giao dịch, tin càng được ưu tiên hiển thị.</p><div class="rk">${D.leaders.slice(0, 6).map((l, i) => `<button class="rk-row ${S.seller === l.name ? 'on' : ''}" data-u="${esc(l.name)}" onclick="filterSeller(this.dataset.u)" title="Xem tin của ${esc(l.name)}"><span class="rk-n">${medal[i] || i + 1}</span>${avHtml(l, 34)}<span class="rk-i"><b>${esc(l.name)}</b><span class="meta">${esc(l.campus)}${l.n ? ' · ★ ' + l.r.toFixed(1) : ''}</span></span><span class="rk-d">${l.deals}<small>giao dịch</small></span></button>`).join('')}</div></aside>`;
}
function filterSeller(n) { S.seller = S.seller === n ? '' : n; S.tab = 'shop'; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function fillGrid() {
  const a = list(), act = S.seller || S.q || S.cat !== 'all' || S.ty !== 'all' || S.cond !== 'all' || S.min !== '' || S.max !== '' || S.favOnly;
  const gr = arr => `<div class="${S.view === 'list' ? 'lst' : 'grid'}">${arr.map(i => card(i)).join('')}</div>`;
  let h;
  if (!a.length) h = '<div class="empty">Chưa có tin nào. Hãy là người đầu tiên đăng bán món đồ của bạn.</div>';
  else if (act) h = `<h2 class="sec">Kết quả (${a.length})</h2>` + gr(a);
  else { const f = a.filter(i => i.ft && i.st === 'ok'), r = a.filter(i => !(i.ft && i.st === 'ok')); h = (f.length ? '<h2 class="sec">Tin nổi bật</h2>' + gr(f) : '') + (r.length ? '<h2 class="sec">Tin mới nhất</h2>' + gr(r) : ''); }
  $('#g').innerHTML = h;
}
function bindShop() {
  const f = (id, k, ev = 'input') => $(id).addEventListener(ev, e => { S[k] = e.target.value; fillGrid(); });
  f('#q', 'q'); f('#mn', 'min'); f('#mx', 'max'); f('#cd', 'cond', 'change'); f('#so', 'sort', 'change');
}

function mine() {
  if (!D.me) return '<div class="empty">Đăng nhập để xem tin của bạn.</div>';
  const a = D.items.filter(i => i.s === D.me.name), v = a.reduce((t, i) => t + (i.views || 0), 0), f = a.reduce((t, i) => t + (i.fc || 0), 0), sd = a.filter(i => i.st === 'sold').length;
  return `<h2 class="sec">Tin của tôi</h2><div class="st"><div><b>${a.length}</b>Tin đã đăng</div><div><b>${v}</b>Lượt xem</div><div><b>${f}</b>Lượt lưu</div><div><b>${(D.sellers[D.me.name] || {}).deals || sd}</b>Giao dịch hoàn thành</div></div><div class="grid">${a.length ? a.map(i => card(i, 1)).join('') : '<div class="empty">Bạn chưa có tin nào. Bấm "+ Đăng tin" để bắt đầu.</div>'}</div>`;
}

/* ---------- Tin nhắn ---------- */
async function renderInbox() {
  const m = $('#main');
  if (!D.me) { m.innerHTML = '<div class="empty">Đăng nhập để xem tin nhắn.</div>'; return; }
  m.innerHTML = '<div class="loading">Đang tải...</div>';
  try {
    const d = await api('GET', '/api/inbox');
    if (S.tab !== 'inbox') return;
    m.innerHTML = '<h2 class="sec">Tin nhắn</h2>' + (d.threads.length ? d.threads.map(t => `<button class="th" onclick="chatM(${t.id},'${esc(t.buyer)}')">${avHtml(acc(t.other), 36)}<div style="flex:1;min-width:0"><b>${esc(t.other)}</b> <span class="meta">· ${esc(t.title)}${t.st === 'sold' ? ' (đã bán)' : ''}</span><div class="meta">${esc(t.last)}</div></div><div class="meta">${ago(t.ts)}${t.unread ? `<span class="badge">${t.unread}</span>` : ''}</div></button>`).join('') : '<div class="empty">Chưa có cuộc trò chuyện nào. Mở một tin đăng và bấm "Nhắn tin cho người bán" để bắt đầu.</div>');
  } catch (e) { m.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}
async function pollChat() {
  if (!CH) return;
  const { id, buyer } = CH;
  let d;
  try { d = await api('GET', `/api/items/${id}/messages?buyer=${encodeURIComponent(buyer)}`); } catch (e) { return; }
  if (!CH || CH.id !== id) return;
  $('#chh').innerHTML = `Với <b>${esc(d.other)}</b> · ${esc(d.title)}`;
  const box = $('#ch'), atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40, first = CH.n < 0;
  const sig = d.msgs.length;
  if (CH.n !== sig) {
    box.innerHTML = d.msgs.map(m => `<div class="msg ${m.me ? 'me' : ''}">${esc(m.t)}<small>${ago(m.ts)}</small></div>`).join('') || '<span class="meta">Hãy hỏi về tình trạng món đồ hoặc hẹn giờ gặp.</span>';
    if (atEnd || first) box.scrollTop = box.scrollHeight;
    CH.n = sig;
  }
  const off = $('#ofr'); if (off) off.style.display = d.isSeller || d.status !== 'ok' ? 'none' : '';
  refreshUnread();
}
async function refreshUnread() {
  if (!D.me) return;
  try { const d = await api('GET', '/api/unread'); if (d.unread !== D.unread) { D.unread = d.unread; tabs(); } } catch (e) { /* bỏ qua */ }
}
function chatM(id, buyer) {
  if (needLogin()) return;
  clearInterval(chatT);
  modal(`<h2>Tin nhắn</h2><div class="meta" id="chh"></div><div class="chat" id="ch" style="max-height:300px;margin-top:8px"></div>
<div class="row" style="flex-wrap:nowrap"><input id="cm" maxlength="500" placeholder="Nhập tin nhắn" onkeydown="if(event.key==='Enter')sendMsg()"><button class="btn p" onclick="sendMsg.call(this)">Gửi</button></div>
<div class="row" id="ofr" style="flex-wrap:nowrap"><input id="of" type="number" min="0" placeholder="Đề nghị giá (đ)"><button class="btn" onclick="offer.call(this)">Trả giá</button></div>
<p class="meta" style="margin:6px 0 0">Hãy hẹn gặp ở nơi công cộng trong trường và kiểm tra hàng trước khi thanh toán.</p>`);
  CH = { id, buyer, n: -1 };
  pollChat(); chatT = setInterval(pollChat, 4000);
}
async function pushMsg(text) {
  await api('POST', `/api/items/${CH.id}/messages`, { text, buyer: CH.buyer });
  await pollChat();
}
const sendMsg = safe(async () => { const v = $('#cm').value.trim(); if (!v) return; $('#cm').value = ''; await pushMsg(v); });
const offer = safe(async () => { const v = +$('#of').value; if (!v || v < 0) return; $('#of').value = ''; await pushMsg('Mình trả ' + vnd(v) + ' được không bạn?'); });

/* ---------- Quản trị ---------- */
async function renderAdmin() {
  const m = $('#main'); m.innerHTML = '<div class="loading">Đang tải...</div>';
  try {
    const d = await api('GET', '/api/admin/data');
    if (S.tab !== 'admin') return;
    const dt = t => new Date(t).toLocaleDateString('vi-VN');
    m.innerHTML = `<h2 class="sec">Trang quản trị</h2><div class="st"><div><b>${d.stats.users}</b>Người dùng</div><div><b>${d.stats.items}</b>Tin đăng</div><div><b>${d.stats.sold}</b>Giao dịch</div><div><b>${d.stats.featured}</b>Tin nổi bật</div></div>
<h2 class="sec">Tin chờ duyệt (${d.pending.length})</h2><div class="tbl"><table>${d.pending.map(i => `<tr><td>${esc(i.t)}<div class="meta">${esc(i.s)}</div></td><td><button class="btn s g" onclick="mod(${i.id},'approve')">Duyệt</button> <button class="btn s" onclick="mod(${i.id},'reject')">Từ chối</button></td></tr>`).join('') || '<tr><td>Không có tin nào chờ duyệt.</td></tr>'}</table></div>
<h2 class="sec">Báo cáo vi phạm (${d.reports.length})</h2><div class="tbl"><table>${d.reports.map(r => `<tr><td>${esc(r.title)}<div class="meta">Người bán: ${esc(r.seller)} · ${esc(r.why)} · ${esc(r.reporter)}</div></td><td><button class="btn s" onclick="rep(${r.id},1)">Khóa tài khoản</button> <button class="btn s" onclick="rep(${r.id},0)">Bỏ qua</button></td></tr>`).join('') || '<tr><td>Không có báo cáo.</td></tr>'}</table></div>
<h2 class="sec">Người dùng (${d.users.length})</h2><div class="tbl"><table>${d.users.map(u => `<tr><td>${esc(u.username)}${u.admin ? ' <span class="tag x">admin</span>' : ''}${u.banned ? ' <span class="tag" style="background:#d0343f">đã khóa</span>' : ''}<div class="meta">${esc(u.email)} · ${esc(u.campus)} · ${dt(u.created)}</div></td><td>${u.admin ? '' : `<button class="btn s" onclick="ban(${u.id},${u.banned ? 0 : 1})">${u.banned ? 'Mở khóa' : 'Khóa'}</button>`}</td></tr>`).join('')}</table></div>`;
  } catch (e) { m.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}
const mod = safe(async (id, a) => { await api('POST', '/api/admin/items/' + id, { action: a }); toast(a === 'approve' ? 'Đã duyệt tin' : 'Đã từ chối tin'); await load(); });
const rep = safe(async (id, lock) => { await api('POST', '/api/admin/reports/' + id, { lock: !!lock }); toast(lock ? 'Đã khóa tài khoản' : 'Đã bỏ qua báo cáo'); await load(); });
const ban = safe(async (id, b) => { await api('POST', '/api/admin/users/' + id, { banned: !!b }); toast(b ? 'Đã khóa tài khoản' : 'Đã mở khóa'); await load(); });

/* ---------- Chi tiết tin ---------- */
function stars(n) { return '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n)); }
function openItem(id) {
  const i = D.items.find(x => x.id === id); if (!i) { toast('Tin không còn tồn tại'); return; }
  const ac = acc(i.s), s = D.sellers[i.s] || { r: 0, n: 0 }, own = D.me && D.me.name === i.s;
  if (S.lastV !== id) { S.lastV = id; if (!own && i.st === 'ok') { i.views = (i.views || 0) + 1; api('POST', `/api/items/${id}/view`).catch(() => { }); } }
  if (location.hash !== '#tin-' + id) history.replaceState(null, '', '#tin-' + id);
  modal(`<h2>${esc(i.t)}</h2>${gal(i)}<div class="price" style="font-size:22px">${vnd(i.p)}${i.oldp && i.oldp > i.p && i.st !== 'sold' ? ' <s class="meta" style="font-size:15px">' + vnd(i.oldp) + '</s>' : ''}${i.ty === 'swap' ? ' <span class="meta">(hoặc trao đổi)</span>' : ''}</div>
<div class="meta">${cat(i.c)[1]} · ${COND[i.cond]} · ${CAMPUS[i.cp]}${i.code ? ' · Môn ' + esc(i.code) : ''} · ${ago(i.ts)} · 👁 ${i.views || 0} · ♥ ${i.fc || 0}</div><p style="white-space:pre-wrap">${esc(i.d)}</p>
<div class="box">Điểm hẹn giao dịch: <b>${esc(i.spot)}</b></div>
<div class="box"><div class="row" style="margin:0 0 4px;flex-wrap:nowrap">${avHtml(ac, 40)}<div><b>${esc(i.s)}</b> <span class="meta">${esc(ac.year || 'Thành viên')}${ac.major ? ' · ' + esc(ac.major) : ''}</span>${ac.bio ? '<div class="meta">' + esc(ac.bio) + '</div>' : ''}${D.me && ac.zalo ? '<div class="meta">Zalo: ' + esc(ac.zalo) + '</div>' : ''}</div></div> ${s.trust ? '<span class="meta">· 🏅 Người bán uy tín</span>' : ''}${rankOf(i.s) ? `<span class="meta">· 🏆 Hạng ${rankOf(i.s)}</span>` : ''}
<div class="deals">✔ ${s.deals || 0} giao dịch hoàn thành</div>
<div>${s.n ? `<span style="color:#f5a623">${stars(s.r)}</span> ${s.r.toFixed(1)} (${s.n} đánh giá)` : 'Chưa có đánh giá'}</div>
${!own ? `<div class="stars" aria-label="Đánh giá người bán">${D.rated[i.s] ? '<span class="meta">Bạn đã đánh giá ' + D.rated[i.s] + ' sao (bấm sao để đổi)</span><br>' : ''}${[1, 2, 3, 4, 5].map(n => `<button data-u="${esc(i.s)}" onclick="rate.call(this,${n},${id})" aria-label="${n} sao">${D.rated[i.s] >= n ? '★' : '☆'}</button>`).join('')}</div>` : ''}</div>
<div class="row"><button class="btn" onclick="tf(${id});openItem(${id})">${D.favs.has(id) ? '♥ Đã lưu' : '♡ Lưu tin'}</button><button class="btn" onclick="share(${id})">Sao chép liên kết</button>
${own ? `${i.st === 'ok' ? `<button class="btn g" onclick="mark(${id})">Đánh dấu đã bán</button><input id="np" type="number" min="0" placeholder="Giá mới (đ)" style="width:125px"><button class="btn" onclick="setP.call(this,${id})">Cập nhật giá</button>${i.ft ? '' : `<button class="btn" onclick="boost(${id})">Đẩy tin nổi bật</button>`}` : ''}<button class="btn" onclick="del(${id})">Xóa tin</button>` :
      `<button class="btn" onclick="report(${id})">Báo cáo</button><button class="btn" data-u="${esc(i.s)}" onclick="block.call(this)">Chặn người bán</button>`}</div>
${own ? (i.st === 'pending' ? '<div class="box">Tin đang chờ admin duyệt.</div>' : '') : i.st === 'sold' ? '<div class="box">Món này đã bán.</div>' : `<div class="box safe"><b>Liên hệ người bán</b><div class="row"><button class="btn p" onclick="chatM(${id},'${esc(D.me ? D.me.name : '')}')">💬 Nhắn tin / Trả giá</button></div><div class="meta">Hẹn gặp ở nơi công cộng trong trường, kiểm tra hàng trước khi thanh toán.</div></div>`}${rel(i)}`);
}
const rate = safe(async function (n, id) {
  if (needLogin()) return;
  await api('POST', `/api/sellers/${encodeURIComponent(this.dataset.u)}/rate`, { stars: n });
  await load(); toast('Cảm ơn bạn đã đánh giá'); openItem(id);
});
const setP = safe(async function (id) {
  const v = $('#np').value; if (v === '' || +v < 0) { toast('Nhập giá mới'); return; }
  await api('PATCH', '/api/items/' + id, { action: 'price', price: +v }); await load(); toast('Đã cập nhật giá'); openItem(id);
});
function share(id) { const u = location.origin + location.pathname + '#tin-' + id; try { navigator.clipboard.writeText(u).then(() => toast('Đã sao chép liên kết'), () => toast('Không sao chép được')); } catch (e) { toast('Không sao chép được'); } }
function tf(id) {
  if (needLogin()) return;
  const i = D.items.find(x => x.id === id), on = !D.favs.has(id);
  if (on) { D.favs.add(id); if (i) i.fc = (i.fc || 0) + 1; } else { D.favs.delete(id); if (i) i.fc = Math.max(0, (i.fc || 0) - 1); }
  render();
  api('POST', `/api/items/${id}/fav`, { on }).catch(e => { toast(e.message); load(); });
}
const mark = safe(async id => { await api('PATCH', '/api/items/' + id, { action: 'sold' }); closeM(); await load(); toast('Đã đánh dấu đã bán, cảm ơn bạn đã tái sử dụng'); });
const boost = safe(async id => { await api('PATCH', '/api/items/' + id, { action: 'boost' }); closeM(); await load(); toast('Tin đã được đẩy lên đầu'); });
const del = safe(async id => { if (!confirm('Xóa tin này?')) return; await api('DELETE', '/api/items/' + id); closeM(); await load(); toast('Đã xóa tin'); });
const report = safe(async id => {
  if (needLogin()) return;
  const why = prompt('Lý do báo cáo (lừa đảo, sai mô tả, nội dung cấm...):', ''); if (why === null) return;
  await api('POST', `/api/items/${id}/report`, { why }); closeM(); toast('Đã gửi báo cáo tới admin');
});
const block = safe(async function () {
  if (needLogin()) return;
  const n = this.dataset.u; if (!confirm('Chặn ' + n + '? Tin của người này sẽ bị ẩn.')) return;
  await api('POST', '/api/blocks', { user: n, on: true }); closeM(); await load(); toast('Đã chặn ' + n);
});

/* ---------- Vẽ giao diện ---------- */
function render() {
  if (S.tab === 'admin' && !(D.me && D.me.admin)) S.tab = 'shop';
  $('#login').innerHTML = D.me ? avHtml(D.me, 22) + ' Thoát (' + esc(D.me.name) + ')' : 'Đăng nhập';
  $('#reg').style.display = D.me ? 'none' : '';
  $('#prof').style.display = D.me ? '' : 'none';
  tabs();
  const m = $('#main');
  if (S.tab === 'shop') { m.innerHTML = shop(); fillGrid(); bindShop(); }
  else if (S.tab === 'me') m.innerHTML = mine();
  else if (S.tab === 'inbox') renderInbox();
  else renderAdmin();
}

(async function init() {
  try { await load(); } catch (e) { $('#main').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; return; }
  const hm = location.hash.match(/^#tin-(\d+)$/); if (hm) openItem(+hm[1]);
  setInterval(() => { if (!document.hidden) refreshUnread(); }, 20000);
})();
