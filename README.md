# FPT LOOP

Chợ mua bán, trao đổi đồ cũ cho sinh viên. Web hoàn chỉnh gồm máy chủ Node.js, cơ sở dữ liệu SQLite và giao diện.
**Không cần cài thêm thư viện nào** (không có `npm install`), chỉ cần Node.js 22.13 trở lên.

## Tính năng

- Đăng ký, đăng nhập (mật khẩu băm scrypt, phiên đăng nhập qua cookie HttpOnly, captcha phía máy chủ)
- Đăng tin có ảnh (bán, trao đổi, tặng), lọc theo danh mục, campus, giá, tình trạng, mã môn
- Lưu tin yêu thích, đếm lượt xem, giảm giá, đánh dấu đã bán, đẩy tin nổi bật
- Nhắn tin thật giữa người mua và người bán, trả giá, hộp thư có số tin chưa đọc
- Đánh giá người bán (chỉ sau khi đã nhắn tin với họ), chặn người dùng, báo cáo tin
- Mỗi tài khoản có số **giao dịch hoàn thành** (tính từ các tin đã bán). Người bán càng nhiều giao dịch, tin càng được đẩy lên cao (mỗi giao dịch cộng 4 giờ "độ mới" khi xếp tin)
- **Bảng xếp hạng nổi bật** bên phải trang chủ, bấm vào tên để xem tin của người đó
- Trang quản trị: duyệt tin chứa từ khóa nhạy cảm, xử lý báo cáo, khóa và mở khóa người dùng
- Hồ sơ cá nhân: ảnh đại diện, Zalo, đổi mật khẩu

## Chạy trên máy

```bash
node server.js
# mở http://localhost:3000
```

Lần chạy đầu tiên sẽ tạo tài khoản `admin` (mật khẩu hiện trong log, hoặc đặt bằng `ADMIN_PASSWORD`) và nạp dữ liệu mẫu cùng tài khoản `demo` / `123456`.

## Triển khai lên Railway

1. Đưa thư mục này lên một repo GitHub (`data/` đã nằm trong `.gitignore`).
2. Trên Railway: **New Project → Deploy from GitHub repo** và chọn repo.
3. **Quan trọng, thêm Volume để dữ liệu không mất khi deploy lại:**
   Service → **Settings → Volumes → Add Volume**, Mount path: `/data`.
4. Service → **Variables**, thêm:

   | Biến | Giá trị | Ý nghĩa |
   |---|---|---|
   | `DATA_DIR` | `/data` | Nơi lưu file CSDL (trùng với Mount path của Volume) |
   | `ADMIN_PASSWORD` | mật khẩu mạnh của bạn | Mật khẩu tài khoản `admin`. Nếu bỏ trống, hệ thống tự sinh và in ra log lần chạy đầu |
   | `SEED_DEMO` | `false` | Tắt dữ liệu mẫu và tài khoản `demo` khi chạy thật |
   | `ADMIN_EMAIL` | (tuỳ chọn) | Email của tài khoản admin |

5. **Settings → Networking → Generate Domain** để có địa chỉ công khai (hoặc gắn tên miền riêng).
6. Xong. Mỗi lần push lên GitHub, Railway tự deploy lại. Dữ liệu trong Volume được giữ nguyên.

Railway tự cấp biến `PORT`, `railway.json` đã cấu hình kiểm tra sức khỏe tại `/healthz`.

## Lưu ý khi chạy thật

- Chỉ chạy **1 replica** (SQLite ghi vào một file trên một Volume).
- Hãy sao lưu file `loop.db` trong Volume định kỳ (Railway có tính năng backup cho Volume).
- Ảnh được nén ở trình duyệt rồi lưu trong CSDL. Với lượng ảnh lớn, nên mở rộng Volume.
- Đăng ký hiện **chưa xác minh email** (cần dịch vụ gửi mail như Resend/SendGrid). Hiện chỉ kiểm tra định dạng `@gmail.com` và captcha.
- Nút "Đẩy tin nổi bật" đang **miễn phí**. Nếu muốn thu phí, cần tích hợp cổng thanh toán.
- Giới hạn tốc độ nằm trong bộ nhớ, đủ cho một server đơn lẻ.

## Cấu trúc

```
server.js        máy chủ + API + CSDL SQLite
public/          giao diện (index.html, app.js)
seed.json        dữ liệu mẫu (10 người bán, 27 tin, có số giao dịch và đánh giá sẵn)
railway.json     cấu hình Railway
```
