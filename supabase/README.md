# Database — Hệ thống quản lý hàng hoá phụ tùng ô tô (Supabase / PostgreSQL)

## Thứ tự chạy migration

Chạy lần lượt trong Supabase SQL Editor (hoặc `supabase db push`):

1. `migrations/0001_schema.sql` — enum, 35 bảng, bộ đếm mã chứng từ, trigger sổ cái kho, 6 view báo cáo.
2. `migrations/0002_business_functions.sql` — hàm nghiệp vụ: xác nhận phiếu nhập / nhận ký gửi / gửi ký gửi / phân bổ / chứng từ BH-KG, xuất & huỷ hoá đơn GTGT, xác nhận phiếu trả.
3. `migrations/0003_rls_and_roles.sql` — RLS theo 4 vai trò, view an toàn cho Sales, hàm điều chỉnh kiểm kê.
4. `migrations/0004_username_login.sql` — cột `profiles.username` (unique không phân biệt hoa thường) + hàm `resolve_login_email` để đăng nhập bằng username hoặc email; đặt username trong Settings → Users & roles.
5. `migrations/0005_grants.sql` — cấp quyền bảng cho role `authenticated` (bắt buộc: thiếu GRANT thì API bị Postgres từ chối 42501 trước cả RLS, app không đọc được dữ liệu sau đăng nhập).
6. `migrations/0006_service_role_grants.sql` — cấp quyền bảng cho role `service_role`, phục vụ tính năng Quản lý tài khoản của OWNER (Cài đặt). Tính năng này cần thêm biến môi trường phía máy chủ `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API → service_role; chỉ đặt trên server/Vercel, tuyệt đối không dùng tiền tố NEXT_PUBLIC và không commit).

## Tạo tài khoản Chủ cửa hàng (OWNER) đầu tiên

Sau khi tạo user trong Supabase Auth, chạy trong SQL Editor (quyền postgres, bỏ qua RLS):

```sql
insert into profiles (id, email, full_name, role)
values ('<auth-user-uuid>', '<email>', '<Họ tên>', 'OWNER');
```

Các nhân viên còn lại do OWNER tạo hồ sơ tương tự với role SALES / WAREHOUSE / ACCOUNTING.

## Nguyên tắc vận hành được ép ở tầng database

- Tồn kho chỉ thay đổi qua `stock_movements` (bất biến — không UPDATE/DELETE); tồn của lô và theo kho do trigger tự duy trì.
- Mã chứng từ (PN, NK, GK, BT, PB, BH, KG, TH, DS, PT, PC, DH) và mã lô (OWN, CONS) do hệ thống sinh, unique, không tái sử dụng.
- Chiết khấu chỉ tồn tại trên chứng từ BH (ràng buộc CHECK); khoản phải trả NCC luôn tính theo giá ký gửi của lô.
- Một dòng phân bổ chỉ vào tối đa một chứng từ và một hoá đơn GTGT đang hiệu lực (unique index từng phần).
- Ô D (ký gửi chồng ký gửi) bị chặn ở `confirm_consignment_out` nếu NCC chưa bật `allow_sub_consignment`.

## Giới hạn đã biết

- Supabase dùng chung DB role `authenticated` cho mọi người dùng, nên không giấu được *cột* `unit_cost` bằng RLS. Giao diện SALES phải dùng view `v_batches_for_sales` (không có giá vốn) và không truy cập các bảng tài chính (đã chặn bằng RLS ở tầng bảng).
- Cảnh báo "giá bán sau chiết khấu thấp hơn giá ký gửi" là cảnh báo hiển thị ở giao diện; database không chặn vì vẫn có trường hợp chủ cửa hàng chủ động bán lỗ.
