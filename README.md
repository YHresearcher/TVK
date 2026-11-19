# TVK — Hệ Thống Quản Trị Doanh Nghiệp, Dòng Tiền & Đối Chiếu Kế Toán

Hệ thống quản trị doanh nghiệp chuyên sâu và **Sổ quản trị độc lập (Shadow Book)** dành cho cửa hàng / doanh nghiệp kinh doanh phụ tùng ô tô. 

Hệ thống được thiết kế theo triết lý thực dụng cho Ban giám đốc và Chủ doanh nghiệp: **Bộ phận vận hành (Kho, Bán hàng, Điều hành) ghi nhận dữ liệu thực tế trên TVK**, kế toán tiếp tục làm sổ sách trên phần mềm kế toán chuyên dụng (MISA, Fast, Excel...), và TVK đóng vai trò là **trung tâm kiểm soát dòng tiền thực** cùng **công cụ đối chiếu chéo 2 tầng với kế toán**.

---

## 🌟 Các Phân Hệ Quản Trị Trọng Tâm

### 1. Sổ Quỹ, Chi Phí Vận Hành & Dòng Tiền (`/cashflow`)
- **Quản lý đa quỹ tiền**: Két tiền mặt và các tài khoản ngân hàng, kiểm soát số dư đầu kỳ (`opening_balance_date`) và tổng tiền sẵn có tức thời.
- **Thu/Chi vận hành ngoài công nợ**: Ghi nhận thuần *Thực thu – Thực chi* theo 12 nhóm khoản mục chuẩn (Lương, Mặt bằng, Vận chuyển, Thuế & Lệ phí, Điện nước, Tiếp khách...). Chủ cửa hàng có thể thêm mới hoặc bật/tắt linh hoạt.
- **Chuyển quỹ nội bộ (Internal Transfer)**: Điều chuyển tiền giữa Két ↔ Ngân hàng hoặc giữa các tài khoản ngân hàng. Stored Procedure tự động tạo **2 dòng đối ứng** (`−` quỹ nguồn, `+` quỹ đích) bảo toàn tổng ngân quỹ và không ảnh hưởng đến doanh thu/chi phí.
- **Huỷ phiếu bằng Bút toán đảo (Audit Trail Reversal)**: Khi huỷ phiếu thu/chi/chuyển quỹ, hệ thống bắt buộc nhập lý do và tự sinh **bút toán đảo** trên sổ quỹ để số dư luôn chuẩn xác và bảo toàn 100% dấu vết kiểm toán.
- **Báo cáo Dòng tiền & Lãi ròng quản trị**: Tổng hợp biến động tiền mặt theo tháng và bảng tính lãi ròng quản trị:
  $$\text{Lãi ròng} = \text{Doanh thu thuần} - \text{Giá vốn (COGS)} - \text{Chi phí vận hành}$$
- **Dự báo Dòng tiền 14–30 ngày nâng cấp (Runway Forecast)**:
  $$\text{Dòng tiền khả dụng} = \text{Tiền sẵn có} + \text{Phải thu đến hạn} - \text{Phải trả NCC đến hạn} - \text{Chi phí cố định dự kiến}$$
  Dữ liệu dự báo được đồng bộ thời gian thực sang cả Bàn điều hành CEO (`/executive`).

### 2. Đối Chiếu Kế Toán 2 Tầng & Chốt Kỳ (`/reconciliation`)
- **Đối chiếu 5 nhóm dữ liệu theo kỳ** (Tháng, Tuần hoặc Tuỳ chọn ngày):
  1. *Quỹ tiền*: Số dư cuối kỳ từng két tiền mặt và tài khoản ngân hàng.
  2. *Phải thu đối tác*: Công nợ cuối kỳ từng khách hàng / gara / đối tác.
  3. *Phải trả NCC*: Công nợ cuối kỳ từng nhà cung cấp (gồm cả mua đứt và ký gửi đã bán).
  4. *Tồn kho tổng hợp*: Giá trị vốn hàng sở hữu (Kho TVK + Ký gửi tại đối tác); tách riêng dòng tham khảo hàng nhận ký gửi từ NCC để tránh kế toán tính trùng tài sản.
  5. *Doanh thu & Chi phí*: Doanh thu TVK (tách sẵn Đã xuất HĐ GTGT vs Chưa xuất HĐ GTGT) và Chi phí vận hành theo nhóm gọn.
- **Nhập liệu & Import Excel linh hoạt**: Hỗ trợ nhập trực tiếp trên bảng hoặc import file Excel từ kế toán (tự động nhận diện cột thông minh, hỗ trợ mẫu chuẩn TVK hoặc ánh xạ cột tuỳ biến từ MISA/Fast, nhận diện số âm ngoặc đơn `(xxx)`).
- **Tự động tính chênh lệch & Soi chi tiết (Tầng 2 - Drill-down)**: Tính toán $\text{Chênh lệch} = \text{Số TVK} - \text{Số Kế toán}$; bấm vào dòng lệch để mở Drawer tra cứu từng chứng từ/giao dịch nguồn bên TVK.
- **Phân loại sai lệch & Giải trình**: 5 trạng thái chuẩn hoá (`Đã khớp`, `Chờ giải trình`, `Lệch hợp lệ Thuế vs Nội bộ`, `Lỗi bên kế toán`, `Lỗi bên TVK`) kèm ghi chú giải trình.
- **Chốt kỳ đối chiếu (Snapshot)**: Đóng băng dữ liệu đối chiếu dạng JSONB bất biến để lưu lịch sử mà **không khoá cứng** chứng từ nhập liệu trên TVK.
- **Xuất biên bản Excel**: Tải về file Excel 2 sheets: *Biên bản tổng hợp đối chiếu* và *Danh sách chi tiết các khoản chênh lệch*.

### 3. Kiểm Soát Nội Bộ 3 Chiều (`/audit-center`) & Bàn Điều Hành CEO (`/executive`)
- **So khớp 3 chiều**: Thực tế giao nhận kho ↔ Doanh số & Giá vốn nội bộ ↔ Hoá đơn GTGT & Công nợ pháp lý. Phát hiện tức thì các đơn hàng chậm xuất hoá đơn quá 5 ngày, công nợ quá hạn hoặc bán dưới giá vốn.
- **Bàn điều hành CEO**: Chỉ số tài chính toàn diện dành cho Ban Giám đốc (Strictly Read-Only): Doanh thu, Lợi nhuận gộp, Biên LN gộp, Vốn tồn kho TVK, Tỷ lệ nợ quá hạn, Vòng quay tồn kho, và Dự báo an toàn thanh khoản 14–30 ngày.

### 4. Quản Trị Kho Theo Lô & Ký Gửi Hai Chiều (Mô Hình Cốt Lõi TVK)
- **Quản lý theo LÔ (Batch/Lot)**: Phân biệt quyền sở hữu (`OWNED` - mua đứt và `CONSIGNED` - ký gửi từ NCC) ngay tại từng lô hàng dán nhãn (`OWN-...` nhãn trắng, `CONS-...` nhãn vàng).
- **Ký gửi hai chiều & Kho ảo đối tác**: Gửi hàng cho các đối tác/gara mà vẫn giữ quyền sở hữu; quản lý qua kho ảo đối tác.
- **Phân bổ trước — Hoá đơn sau**: Xuất bán nhiều lần theo đợt tiêu thụ của đối tác; chứng từ bán trực tiếp (`BH`, áp chiết khấu) và chứng từ ký gửi (`KG`, sinh nợ NCC) luôn tách biệt và gắn liên kết với hoá đơn GTGT.

---

## 🔐 Ma Trận Phân Quyền Bảo Mật 5 Vai Trò

Hệ thống kiểm soát quyền hạn nghiêm ngặt ở cả 3 lớp: **Sidebar giao diện**, **Server Actions kiểm tra role** và **Supabase Row Level Security (RLS)** ở tầng cơ sở dữ liệu:

| Phân hệ / Thao tác | Chủ cửa hàng (OWNER) | Ban điều hành (CEO) | Kế toán (ACCOUNTING) | Bán hàng (SALES) | Thủ kho (WAREHOUSE) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Sổ quỹ & Dòng tiền (`/cashflow`)** | Toàn quyền | Chỉ xem | Chỉ xem | ⛔ Không truy cập | ⛔ Không truy cập |
| **Ghi thu/chi vận hành, Chuyển quỹ** | ✅ Có quyền | ⛔ Chặn | ⛔ Chặn | ⛔ Không truy cập | ⛔ Không truy cập |
| **Huỷ phiếu bằng bút toán đảo** | ✅ Có quyền | ⛔ Chặn | ⛔ Chặn | ⛔ Không truy cập | ⛔ Không truy cập |
| **Bảng Đối chiếu Kế toán (`/reconciliation`)** | Toàn quyền | Chỉ xem | Xem & Nhập số | ⛔ Không truy cập | ⛔ Không truy cập |
| **Nhập số kế toán, Import Excel** | ✅ Có quyền | ⛔ Chặn | ✅ Có quyền | ⛔ Không truy cập | ⛔ Không truy cập |
| **Chốt kỳ đối chiếu (Snapshot)** | ✅ Có quyền | ⛔ Chặn | ⛔ Chặn | ⛔ Không truy cập | ⛔ Không truy cập |
| **Bàn điều hành CEO (`/executive`)** | ✅ Có quyền | 👁️ Chỉ xem | 👁️ Chỉ xem | ⛔ Không truy cập | ⛔ Không truy cập |
| **Trung tâm Kiểm soát 3 bên (`/audit-center`)** | ✅ Có quyền | 👁️ Chỉ xem | 👁️ Chỉ xem | ⛔ Không truy cập | ⛔ Không truy cập |
| **Xem giá vốn & Lợi nhuận** | ✅ Thấy | ✅ Thấy | ✅ Thấy | ⛔ Ẩn tuyệt đối | ⛔ Ẩn tuyệt đối |

---

## 🛠️ Công Nghệ Sử Dụng

- **Frontend / Full-stack**: Next.js 14 (App Router, Server Actions, React 18, Server Components).
- **Ngôn ngữ**: TypeScript 5 (Strict Mode).
- **Giao diện**: Tailwind CSS 3, Lucide / Heroicons, giao diện responsive tối ưu cho máy tính và thiết bị di động.
- **Cơ sở dữ liệu**: Supabase (PostgreSQL 15+, PL/pgSQL, Triggers, Views, Functions `SECURITY DEFINER`).
- **Bảo mật**: Supabase Auth + Row Level Security (RLS) theo vai trò người dùng.
- **Xử lý tệp & Báo cáo**: SheetJS (`xlsx`) đọc/ghi Excel đa cấu trúc, JsBarcode in mã vạch lô hàng.
- **Kiểm thử tự động**: TSX + Bộ kiểm thử Opaque-Box E2E 4 tầng (60/60 tests pass).
- **Triển khai**: Vercel / Docker.

---

## 🚀 Hướng Dẫn Cài Đặt & Vận Hành

### 1. Chuẩn bị Cơ sở dữ liệu Supabase
1. Tạo một dự án mới trên [Supabase](https://supabase.com).
2. Vào **SQL Editor** và chạy tuần tự các tệp migration trong thư mục `supabase/migrations/`:
   - `0001_schema.sql` đến `0022_cash_funds.sql` (cấu trúc lõi hàng hoá, kho lô, công nợ).
   - `0023_management_accounting.sql` (sổ quản trị, danh mục thu chi, chuyển quỹ, đối chiếu 2 tầng & snapshot).
3. Tạo tài khoản người dùng đầu tiên trong **Supabase Auth** và gắn quyền `OWNER` trong bảng `profiles`:
   ```sql
   INSERT INTO public.profiles (id, email, full_name, role)
   VALUES ('<USER_UUID>', 'owner@tvk.vn', 'Chủ Doanh Nghiệp TVK', 'OWNER');
   ```

### 2. Cấu hình Biến môi trường
Sao chép tệp cấu hình:
```bash
cp .env.example .env.local
```
Điền các thông số kết nối từ Supabase Project Settings (API):
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key # Phục vụ tạo user nội bộ từ Settings
```

### 3. Cài đặt và Chạy hệ thống
```bash
# Cài đặt dependencies
npm install

# Khởi chạy máy chủ phát triển
npm run dev
```
Mở trình duyệt tại: **`http://localhost:3000`**

### 4. Kiểm tra Chất lượng & Kiểm thử Tự động
```bash
# Kiểm tra định dạng và quy chuẩn mã nguồn
npm run lint

# Kiểm tra an toàn kiểu dữ liệu TypeScript
npx tsc --noEmit

# Chạy toàn bộ 60 ca kiểm thử tự động E2E (Tiers 1–4, gồm đối chiếu dữ liệu HOWO thực tế)
npm run test:e2e

# Biên dịch thử nghiệm bản phát hành Production (29/29 routes)
npm run build
```

---

## 📐 Nguyên Tắc Thiết Kế Bất Biến

1. **Sổ cái kho & Sổ quỹ bất biến**: Tồn kho chỉ thay đổi qua `stock_movements`; quỹ tiền chỉ thay đổi qua `cash_movements`. Không sửa tay trực tiếp số dư, sửa sai bằng **bút toán đảo** có lý do.
2. **Mã chứng từ duy nhất**: Mọi chứng từ (`PN`, `NK`, `GK`, `BT`, `PB`, `BH`, `KG`, `TH`, `DS`, `PT`, `PC`, `DH`) và mã lô (`OWN-...`, `CONS-...`) do hệ thống tự sinh theo định dạng thời gian + số thứ tự, không bao giờ tái sử dụng ngay cả khi bị huỷ.
3. **Phân bổ độc lập**: Một mặt hàng xuất hoá đơn có thể tách thành 2 chứng từ quản lý riêng (`BH` cho hàng mua đứt có chiết khấu, `KG` cho hàng ký gửi bảo toàn giá vốn nhà cung cấp).
4. **Bất biến số liệu chốt kỳ**: Khi đã chốt kỳ đối chiếu, snapshot được lưu cố định làm bằng chứng kiểm toán; các chứng từ nhập lùi ngày trên TVK sẽ được phân hệ phát hiện và cảnh báo chênh lệch biến động sau chốt kỳ.

---

## 📄 Bản Quyền & Giấy Phép
Dự án được phát triển riêng cho doanh nghiệp phụ tùng ô tô TVK. Toàn quyền sở hữu nội bộ.
