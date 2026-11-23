# TVK V2.0 P4b — Thiết kế quỹ tiền theo ngành (Cash Fund Design)

Mô hình quỹ **CHƯA CHỐT** (chủ chưa quyết chung két hay riêng két —
mục này trong checklist kế toán đã bị chủ xoá, chưa rõ cố ý hay vô ý).
P4 chỉ chuẩn bị để cả hai mô hình đều chạy được; **không** thêm UI
gán quỹ, **không** ép chọn mô hình nào.

## 1. Hai mô hình

- **Model A — Quỹ chung (shared):** một quỹ dùng cho cả hai ngành.
  `cash_funds.business_line_id = NULL`.
- **Model B — Quỹ riêng ngành (dedicated):** mỗi ngành có quỹ riêng.
  `cash_funds.business_line_id` = ngành của quỹ.

## 2. Schema (migration 0029 §5)

- `cash_funds.business_line_id` nullable FK → `business_lines` (+ index).
  Quỹ "Két tiền mặt" hiện có giữ NULL (Model A) cho tới khi chủ chốt.
- Không đổi cơ chế ghi quỹ: phiếu PT/PC vẫn ghi quỹ qua `fund_id`;
  trigger `trg_payments_cash_fund` (0027) tạo dòng tiền; dòng vận
  hành ghi qua RPC `record_operating_cash_movement` (OWNER-only);
  ghi trực tiếp `cash_movements` đã bỏ (BL-022).

## 3. View `v_cash_flow_by_line` — dòng tiền theo quỹ × ngành

Suy ra từ `payment_allocations` (phiếu đảo mang phân bổ âm nên tự
triệt tiêu), join `payments` + `cash_movements` + `cash_funds`:

- Phân loại theo kind của **phiếu gốc** (`coalesce(orig.payment_kind,
  p.payment_kind)`) — vì phiếu đảo đảo chiều IN↔OUT (như 0027);
  phân loại theo kind phiếu đảo sẽ sai ngăn thu/chi (đã gặp ở W khi
  soát P4: in=550.000/out=−100.000; sửa xong về đúng 450.000/0).
- Cột: `fund_id`, `fund_name`, `fund_line_id`, `line_id`,
  `in_amount`, `out_amount`, `net_amount`, `payment_count`.
- Phiếu vận hành không gắn công nợ không có phân bổ nên không vào view
  này; tổng quỹ vẫn đọc `v_cash_fund_balances`.

## 4. Khi chủ chốt mô hình

- Chọn Model B: gán `business_line_id` cho từng quỹ (migration nhỏ
  hoặc UI Cài đặt → Quỹ tiền — chưa làm trong P4); phiếu thu/chi phải
  chọn quỹ đúng ngành của khoản công nợ (cần thêm kiểm tra ở
  `validateFundForMethod` — chưa làm, ghi nhận ở đây).
- Chọn Model A: giữ nguyên, không cần làm gì thêm.
- Quyết này không ảnh hưởng số dư đã ghi (quỹ chung hay riêng đều
  cộng/trừ cùng một sổ dòng tiền).

## 5. Kiểm chứng

- `docs/tests/p4_finance_vat_local.sql` mục W: quỹ Két × Phụ tùng
  in=450.000/out=0/net=450.000/5 phiếu; không có dòng Dầu khi chưa có
  phiếu Dầu nào.
