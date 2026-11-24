# TVK V2.0 P4b — Đối chiếu theo ngành (Reconciliation)

## 1. Nguyên tắc (§16.1)

- **Bảng đối chiếu (entries) vẫn hợp nhất theo tổng**: so sánh với sổ
  kế toán ngoài là so sánh tổng tiền, không tách ngành ở cấp entry.
- **Chi tiết theo ngành nằm trong `drilldown_data`**: mỗi entry
  RECEIVABLE / PAYABLE có thêm `by_line: [{business_line_id, label,
  remaining}]` — dư nợ còn lại tách theo ngành (Dầu nhớt / Phụ tùng /
  Chưa phân loại).

## 2. Thay đổi P4 (migration 0029 §1 + app)

- `partner_receivables` / `supplier_payables` có `business_line_id`
  (xem IMPLEMENTATION-REPORT P4.1) — `computeLiveTVKMetrics`
  (`src/lib/reconciliation-queries.ts`) gom dư nợ theo ngành ngay khi
  tính tổng, không query thêm.
- `DrillDownDrawer.tsx`: mục RECEIVABLE/PAYABLE hiện hộp "Dư nợ theo
  ngành:" trên danh sách chứng từ khi `by_line` có dữ liệu.
- Sửa bug tiềm ẩn trong cùng hàm: query PAYABLE chọn
  `purchase_receipts.receipt_no` (cột không tồn tại) → `doc_code`;
  trước sửa, PostgREST lỗi làm cả mục PAYABLE trống lặng lẽ.

## 3. Bản chụp đã chốt là bất biến (BL-017, §15.6)

- `reconciliation_snapshots` không có cột trạng thái — mọi bản chụp
  đều đã chốt ngay khi tạo (chỉ tạo qua luồng chốt kỳ, kỳ chuyển
  RECONCILED). Vì vậy chặn **mọi** UPDATE/DELETE:
  - Trigger `tvk_guard_reconciliation_snapshots_immutable` (chặn mọi
    role, kể cả service role — trigger chạy trước RLS).
  - FK `period_id`: 0023:356 **CÓ** `ON DELETE CASCADE` (trái với ghi
    chú §15.6 trong prompt nói "không tìm thấy CASCADE") → đổi thành
    `ON DELETE RESTRICT` (xoá kỳ đang có bản chụp bị chặn).
  - Bỏ policy UPDATE/DELETE của OWNER (giữ SELECT/INSERT).
- Sửa sai bằng **bản chụp hiệu chỉnh mới** (tạo qua RPC như thường);
  không sửa hay xoá bản cũ. Nút "Xoá bản này" đã bỏ khỏi
  `SnapshotHistoryModal.tsx`; server action xoá đã xoá hẳn.
- Kiểm chứng: mục V trong `docs/tests/p4_finance_vat_local.sql`
  (V0 tạo qua RPC; V1–V3 superuser UPDATE/DELETE/FK bị chặn; V4 bản
  hiệu chỉnh mới được; V5 hết policy UPDATE/DELETE; V6 RLS chặn sửa
  trực tiếp — 0 dòng bị đổi).

## 4. Kiểm chứng

- Mục V (BL-017) + mục D (BL-014: view `v_unattributed_balances`) +
  mục W (dòng tiền theo quỹ × ngành) trong
  `docs/tests/p4_finance_vat_local.sql`; đối chiếu theo ngành hiển
  thị qua `by_line` trong drilldown (chưa có test UI tự động — kiểm
  tra tay trên staging khi có số liệu thật).
