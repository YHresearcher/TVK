# TVK V2.0 P4b — Thiết kế hoá đơn GTGT tách theo ngành (VAT Design)

Quyết định của chủ (21/11/2026, đã chốt):
- Giá ghi trong hệ thống **LÀ GIÁ ĐÃ GỒM VAT**.
- Thuế suất **8% cho cả hai ngành** (Dầu nhớt / Phụ tùng).
- **TÁCH HOÁ ĐƠN theo ngành**: một hoá đơn GTGT không trộn hai ngành.

## 1. Schema (migration 0029 §2)

- `vat_invoices`: thêm `business_line_id` (nullable FK),
  `total_before_tax`, `total_vat` (cùng `numeric(15,2)`).
  `total_amount` giữ nguyên ý nghĩa cũ (= tổng gồm thuế sau giảm giá).
- `vat_invoice_lines`: thêm `vat_rate` (8.00), `discount_amount`
  (NOT NULL DEFAULT 0), `amount_before_tax`, `vat_amount`,
  `amount_including_tax`. Cột `amount` cũ giữ nguyên ý nghĩa
  (= gồm thuế sau giảm giá) để tương thích ngược.
- Backfill: hoá đơn cũ (live hiện 0 hoá đơn nên rỗng trên live) chia
  tách trên số đã lưu với `discount_amount = 0`; ngành header = ngành
  chung của các dòng còn hiệu lực, khác ngành thì NULL.

## 2. Toán VAT — đồng bộ SQL ↔ TypeScript

- Giảm giá đầu chứng từ (chỉ BH mới có, `chk_discount_only_bh`)
  chia xuống **mọi dòng của chứng từ** theo tỷ lệ `line_total`,
  làm tròn XUỐNG 2 chữ số (`floor(x*100)/100`), phần dư dồn về dòng
  có `line_total` lớn nhất (hoà thì id nhỏ nhất) — tổng phần đã chia
  = đúng discount. SQL: CTE `floor_shares` trong `create_vat_invoice`;
  TS: `allocateDiscount` (`src/lib/vat.ts`) — hai bên khớp nhau.
- Cơ sở thuế dòng = `line_total − phần giảm giá của dòng`.
- Trước thuế = `ROUND(cơ-sở / 1.08, 2)`; VAT = `cơ-sở − trước-thuế`
  (tính bằng phép trừ để trước-thuế + VAT = đúng cơ-sở).
- Header: `total_before_tax` / `total_vat` / `total_amount` = SUM các
  dòng đã tách. Đây là SỬA bản 0020 (lấy `SUM(line_total)` nên bỏ qua
  giảm giá, tính thừa thuế).
- Ví dụ kiểm chứng (BH-VAT-0001, tổng 500.000, giảm 50.000):
  L1 300.000 → giảm 30.000 → cơ sở 270.000 → 250.000 + 20.000;
  L2 200.000 → giảm 20.000 → cơ sở 180.000 → 166.666,67 + 13.333,33;
  header 416.666,67 + 33.333,33 = 450.000.

## 3. Quy tắc ở `create_vat_invoice` (0029, viết lại từ 0020)

Giữ: role OWNER/ACCOUNTING; không rỗng; không trùng dòng; dòng tồn
tại; mọi dòng CONFIRMED + cùng đối tác; dòng chưa ghi hoá đơn lần nào;
đánh dấu `allocation_lines` INVOICED.
Mới:
- Khóa các dòng `FOR UPDATE` (chống ghi trùng đồng thời — kiểm chứng
  VAT-11: 2 phiên cùng ghi một dòng → đúng 1 hoá đơn).
- Giải ngành từng dòng theo sản phẩm; dòng thuộc sản phẩm chưa phân
  loại → chặn (fail-closed); trộn 2 ngành → chặn.
- Kiểm tra quyền ngành của người gọi (`user_can_access_business_line`).
- Giảm giá ≤ tổng chứng từ (chặn giảm vượt tiền hàng).

## 4. Guard ở tầng DB

- `tvk_guard_vat_invoice_line()`: ngành của sản phẩm trên dòng phải
  bằng ngành header; chặn ghi dòng vào hoá đơn cũ chưa có ngành.
- `tvk_guard_vat_invoice_header()`: `business_line_id` và các tổng
  bất biến khi đã gán (đổi trạng thái vẫn được).

## 5. Giao diện

- Trang Hoá đơn GTGT: dòng chưa ghi chia thẻ theo ngành — một thẻ ghi
  một ngành; nhóm chưa phân loại chỉ cảnh báo, không cho ghi (RPC
  cũng chặn). Bảng hoá đơn thêm cột Ngành + Trước thuế + VAT.
- Trang chi tiết hoá đơn (`getInvoiceDetail`): hiện ngành + trước
  thuế/VAT; total dùng số header đã trừ giảm giá.

## 6. Kiểm chứng

- `docs/tests/p4_finance_vat_local.sql` mục VAT-01–VAT-11 (trộn ngành,
  sai đối tác, nháp, trùng dòng, chưa phân loại, quyền ngành, chia
  giảm giá + VAT 8%, ghi lại, đồng thời) + Tier 5 (`allocateDiscount`,
  `splitVat`, `sumVatSplits`, `groupUninvoicedLinesByLine`).
