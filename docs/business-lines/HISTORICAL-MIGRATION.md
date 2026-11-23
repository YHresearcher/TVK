# TVK V2.0 P1 — Historical Migration (Backfill phân loại + bất biến tài chính)

Trạng thái: **P1 đã triển khai** (migration `0025_business_lines.sql`).
Chiến lược: Expand–Backfill–Validate–Enforce–Contract (§15.1). P1 làm tới
**Validate**; **Enforce** (NOT NULL, bắt buộc gán) thuộc P2.

## 1. Backfill phân loại sản phẩm (§5.2)

### Mapping tường minh (không heuristic tên hàng)

Backfill khớp **chính xác giá trị** `product_group` với bảng
`business_line_group_mappings` (do chủ phê duyệt):

| product_group | Ngành |
|---|---|
| `Linh kiện ô tô tải` | AUTO_PARTS |
| `Nhớt` | OIL |
| `Dầu nhớt` | OIL |

**Cấm tuyệt đối phân loại theo chuỗi con trong tên sản phẩm** (§5.2 E4,
§24): `Lọc nhớt` / `Lọc dầu` là **phụ tùng** (lọc), không phải dầu.
`isOilGroup()` trong `src/lib/product-match.ts` chỉ chọn thứ tự FEFO/FIFO,
không bao giờ được dùng làm luật phân loại backfill.

### Kết quả trên dữ liệu live (Preflight 23/11)

Live chỉ có **1 giá trị nhóm duy nhất**: `Linh kiện ô tô tải` → toàn bộ
**46 sản phẩm → AUTO_PARTS**; OIL = 0 sản phẩm. Không có nhóm lạ, không có
NULL. Backfill trên live là ánh xạ cơ học 46 → AUTO_PARTS.

### Kiểm toán phân loại

- Mọi sản phẩm được phân loại trong migration đều có 1 dòng trong
  `product_business_line_audit` với `source = 'MIGRATION_0025_BACKFILL'`
  (ghi theo `product_id`/`sku` thực tế lúc chạy — migration không hardcode
  UUID sản phẩm vì UUID chỉ tồn tại trên database live).
- Migration in báo cáo phân loại bằng `RAISE NOTICE`:
  tổng / OIL / AUTO_PARTS / chưa phân loại / nhóm lạ / số sản phẩm chưa phân
  loại mà đã có tồn kho hoặc giao dịch.
- Nhóm lạ / NULL / rỗng: ở lại `business_line_id IS NULL`, vào hàng đợi
  `v_unclassified_products`, **không tự gán AUTO_PARTS**. `RAISE WARNING`
  liệt kê các nhóm lạ để phân loại thủ công theo quy trình đã phê duyệt.

### Kiểm chứng trên database local (seed 7 sản phẩm)

| Kiểm tra | Kết quả |
|---|---|
| Tổng 7 / OIL 2 / AUTO_PARTS 3 / chưa phân loại 2 | Đúng |
| `Lọc dầu` → AUTO_PARTS, `Lọc nhớt` → AUTO_PARTS | Đúng (bẫy tên không dính) |
| Nhóm lạ + NULL group → NULL | Đúng |
| Audit backfill = 5 dòng | Đúng |
| `v_unclassified_products` = 2 dòng | Đúng |

## 2. Backfill business_line_id trên chứng từ (§5.4)

7 bảng: `purchase_receipts`, `consignment_receipts`,
`consignment_out_slips`, `consumption_reports`, `allocation_slips`,
`sales_documents`, `return_documents` (dòng suy qua lô với GK và TH).

Luật: chỉ gán khi **mọi dòng đều đã phân loại VÀ cùng một ngành**.
Chứng từ hỗn hợp hoặc có dòng chưa phân loại → giữ `NULL` (không ép một
ngành — §15.2). Migration in báo cáo từng bảng (tổng / đã gán / chưa gán).

Trên dữ liệu live: mọi chứng từ hiện có đều thuần phụ tùng
(BH-2610-0001, GK-2610-0001) → sẽ được gán AUTO_PARTS; không có chứng từ
hỗn hợp (0 sản phẩm dầu → không thể có).

Trên database local (seed): 7 chứng từ thuần một ngành được gán, 2 chứng từ
hỗn hợp (PN-SEED-0002, BH-SEED-0002) ở lại NULL — đúng thiết kế.

## 3. Bất biến phân loại (§5.3 — BL-016)

Trigger `trg_products_business_line_guard` (BEFORE UPDATE ON products):

- `NULL → giá trị` (phân loại lần đầu): cho, ghi kiểm toán
  (`source = 'GUARD_TRIGGER'`).
- Đổi ngành / xoá ngành khi sản phẩm đã có tham chiếu ở bất kỳ bảng nào sau
  đây: `stock_batches`, `purchase_receipt_items`,
  `consignment_receipt_items`, `consumption_report_items`, `allocation_lines`,
  `sales_document_lines`, `return_items` (qua lô) → **chặn** với lỗi tiếng Việt.
- Đổi ngành khi chưa có tham chiếu nào: cho, ghi kiểm toán.
- Sản phẩm đã có tồn kho cũng bị chặn (tồn kho = có dòng `stock_batches`).

Đổi ngành lịch sử phải dùng quy trình điều chỉnh đã phê duyệt riêng (không
thuộc P1) — không sửa lịch sử bán hàng/tồn kho/tài chính.

## 4. Bất biến tài chính (§15.7)

Migration 0025 **không INSERT/UPDATE/DELETE** bất kỳ dòng nào trong:
`supplier_payables`, `partner_receivables`, `settlements`,
`settlement_lines`, `payments`, `cash_funds`, `cash_movements`,
`reconciliation_*`, và không đụng `stock_movements`.

Kiểm chứng trên database local (seed: payables 0 / receivables 1 /
payments 1 / movements 0): số lượng **không đổi** sau khi chạy 0025; số tiền
receivable seed (300.000đ) không đổi.

Bất biến cần giữ khi chạy 0025 trên staging/live (đối chiếu trước/sau):
Tổng tồn kho, tổng phải thu, tổng phải trả, số dư quỹ, doanh thu đã ghi nhận
đều không đổi; `OIL + AUTO_PARTS + chưa phân loại = tổng hợp nhất`.

## 5. Lịch sử sổ cái (§5.5)

Không mass-update `stock_movements` hay `cash_movements` để thêm
business_line_id. Phân bổ theo ngành của lịch sử được suy ra qua:
`stock_movements → stock_batches → products → business_lines`; tiền mặt suy
ra từ payment allocations và công nợ gốc (P3/P4).

## 6. Rollback (P1)

Migration 0025 chỉ thêm đối tượng mới (expand) nên rollback là drop các đối
tượng đã thêm, theo thứ tự ngược (chạy bằng postgres, trong transaction):

```sql
BEGIN;
DROP VIEW IF EXISTS public.v_unclassified_products;
DROP VIEW IF EXISTS public.v_batches_for_sales;  -- rồi chạy lại 0024 để khôi phục view gốc
-- (chạy lại file 0024_sales_view_profile_guard.sql)
DROP TRIGGER IF EXISTS trg_guard_header_bl ON public.purchase_receipts;
-- ... lặp cho 7 bảng chứng từ ...
DROP TRIGGER IF EXISTS trg_guard_line_bl ON public.purchase_receipt_items;
-- ... lặp cho 7 bảng dòng ...
DROP TRIGGER IF EXISTS trg_products_business_line_guard ON public.products;
DROP FUNCTION IF EXISTS public.tvk_guard_header_business_line();
DROP FUNCTION IF EXISTS public.tvk_guard_line_business_line();
DROP FUNCTION IF EXISTS public.tvk_guard_product_business_line();
DROP FUNCTION IF EXISTS public.user_can_access_business_line(uuid, uuid);
DROP TABLE IF EXISTS public.product_business_line_audit;
DROP TABLE IF EXISTS public.business_line_group_mappings;
DROP TABLE IF EXISTS public.user_business_lines;
DROP TABLE IF EXISTS public.business_lines;
ALTER TABLE public.products DROP COLUMN IF EXISTS business_line_id;
ALTER TABLE public.purchase_receipts DROP COLUMN IF EXISTS business_line_id;
-- ... lặp cho 6 bảng chứng từ còn lại ...
COMMIT;
```

Lưu ý: rollback **không khôi phục được dữ liệu đã ghi vào
`product_business_line_audit`** (bảng audit bị drop cùng) — xuất bảng audit
ra file trước khi rollback nếu cần giữ vết kiểm toán. Không có dữ liệu nghiệp
vụ nào bị mất khi rollback (mọi cột mới đều là dữ liệu suy ra được, backfill
lại được bằng cách chạy lại 0025).
