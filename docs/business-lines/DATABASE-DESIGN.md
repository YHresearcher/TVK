# TVK V2.0 P1 — Database Design (Nền tảng database)

Trạng thái: **P1 đã triển khai** (migration `0025_business_lines.sql`, nhánh
`feature/tvk-v2-business-lines`). Tài liệu này mô tả đúng những gì migration
0025 tạo ra — không mô tả các đối tượng thuộc P2–P6.

## 1. Bảng mới

### business_lines — danh mục ngành hàng

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid PK, default gen_random_uuid() | |
| code | text UNIQUE NOT NULL | `OIL`, `AUTO_PARTS` |
| name | text NOT NULL | `Dầu nhớt`, `Phụ tùng` |
| is_active | boolean NOT NULL DEFAULT true | |
| created_at | timestamptz NOT NULL DEFAULT now() | |

Seed: `('OIL', 'Dầu nhớt')`, `('AUTO_PARTS', 'Phụ tùng')` (`ON CONFLICT DO NOTHING`).

### user_business_lines — phân quyền theo ngành (§6.2)

| Cột | Kiểu | Ghi chú |
|---|---|---|
| user_id | uuid NOT NULL → profiles(id) ON DELETE CASCADE | |
| business_line_id | uuid NOT NULL → business_lines(id) ON DELETE CASCADE | |
| created_at | timestamptz NOT NULL DEFAULT now() | |
| PK (user_id, business_line_id) | | + index trên business_line_id |

Một dòng = một user được làm việc trên một ngành. Phân quyền chỉ giới hạn
**phạm vi ngành**, không cấp thêm quyền chức năng (SALES chỉ-OIL vẫn không
xem được giá vốn/lãi của OWNER).

### business_line_group_mappings — mapping tường minh nhóm → ngành (§5.2 E4)

| Cột | Kiểu | Ghi chú |
|---|---|---|
| product_group | text PRIMARY KEY | Giá trị `product_group` (khớp chính xác) |
| business_line_id | uuid NOT NULL → business_lines(id) | |
| created_at | timestamptz NOT NULL DEFAULT now() | |

Seed đã phê duyệt: `'Linh kiện ô tô tải'` → AUTO_PARTS; `'Nhớt'` → OIL;
`'Dầu nhớt'` → OIL. Nhóm không có trong bảng này = chưa phân loại, không tự gán.
Bảng này cũng dùng cho import tạo sản phẩm mới ở P2.

### product_business_line_audit — kiểm toán phân loại (§5.2, §5.3)

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid PK | |
| product_id | uuid NOT NULL → products(id) | |
| sku | text NOT NULL | SKU tại thời điểm ghi |
| product_group | text | Nhóm tại thời điểm ghi |
| business_line_id | uuid → business_lines(id) | NULL = xoá phân loại |
| business_line_code | text | `OIL` / `AUTO_PARTS` / NULL |
| source | text NOT NULL | `MIGRATION_0025_BACKFILL` / `MANUAL_CORRECTION` / `GUARD_TRIGGER` |
| changed_by | uuid → profiles(id) | NULL khi chạy bằng migration |
| created_at | timestamptz NOT NULL DEFAULT now() | |

Append-only: không có policy INSERT/UPDATE/DELETE cho `authenticated`
(RLS) và đã `REVOKE INSERT, UPDATE, DELETE` ở tầng GRANT. Chỉ trigger
`SECURITY DEFINER` (mục 4) và migration chạy bằng postgres mới ghi được.
SELECT cho OWNER/ACCOUNTING/CEO.

## 2. Cột mới trên bảng hiện có (tất cả NULLABLE ở P1)

| Bảng | Cột | Ghi chú |
|---|---|---|
| products | business_line_id uuid → business_lines(id) | + index |
| purchase_receipts | business_line_id uuid → business_lines(id) | + index |
| consignment_receipts | business_line_id uuid → business_lines(id) | + index |
| consignment_out_slips | business_line_id uuid → business_lines(id) | + index |
| consumption_reports | business_line_id uuid → business_lines(id) | + index |
| allocation_slips | business_line_id uuid → business_lines(id) | + index |
| sales_documents | business_line_id uuid → business_lines(id) | + index |
| return_documents | business_line_id uuid → business_lines(id) | + index |

**`sales_orders` cố ý KHÔNG có cột này** (§5.4 E2: DH là chứng từ cha chung,
không có dòng; ngành nằm ở `sales_documents`).

Không siết `NOT NULL` ở P1: form chưa ghi được ngành (P2 mới ghi). Chỉ siết
sau khi mọi phân loại bắt buộc đã xong và app đã ghi được ngành.

## 3. View

### v_batches_for_sales — mở rộng theo §6.5

Định nghĩa lại từ 0024, giữ nguyên thứ tự cột cũ + **append 2 cột ở cuối**
(bài học 42P16 — view khớp cột theo vị trí):
`business_line_id`, `business_line_code`.
Giữ `security_invoker = false, security_barrier = true`, giữ guard
active-profile của 0024, thêm điều kiện
`user_can_access_business_line(auth.uid(), p.business_line_id)`.
Grants: `REVOKE ALL FROM PUBLIC, anon; GRANT SELECT TO authenticated`.

### v_unclassified_products — hàng đợi phân loại thủ công

`SELECT id, sku, name, product_group, created_at FROM products WHERE
business_line_id IS NULL`. Đây là "hàng đợi" theo §5.2 — xử lý thủ công
theo quy trình đã phê duyệt, không tự gán.

## 4. Hàm + trigger (migration 0025)

| Đối tượng | Loại | Vai trò |
|---|---|---|
| `user_can_access_business_line(uuid, uuid)` | FUNCTION, SECURITY DEFINER, STABLE | Kiểm tra quyền ngành (xem ACCESS-CONTROL.md) |
| `tvk_guard_product_business_line()` | FUNCTION, SECURITY DEFINER + TRIGGER `trg_products_business_line_guard` BEFORE UPDATE ON products | Cấm đổi ngành khi đã có giao dịch/tồn kho; ghi kiểm toán cho thay đổi được phép (§5.3, BL-016) |
| `tvk_guard_line_business_line()` | FUNCTION, SECURITY DEFINER + 7 TRIGGER `trg_guard_line_bl` BEFORE INSERT OR UPDATE ON các bảng dòng | Cấm dòng lệch ngành với chứng từ — chỉ khi cả hai phía đã gán (NULL-tolerant ở P1) |
| `tvk_guard_header_business_line()` | FUNCTION, SECURITY DEFINER + 7 TRIGGER `trg_guard_header_bl` BEFORE UPDATE ON các bảng chứng từ | Cấm đổi ngành chứng từ khi còn dòng thuộc ngành khác |

Danh sách bảng dòng có guard: `purchase_receipt_items`,
`consignment_receipt_items`, `consignment_out_items` (suy sản phẩm qua lô),
`consumption_report_items`, `allocation_lines`, `sales_document_lines`,
`return_items` (suy sản phẩm qua lô).

## 5. Những gì P1 KHÔNG chạm

- Không bảng tài chính nào: `supplier_payables`, `partner_receivables`,
  `settlements`, `settlement_lines`, `payments`, `cash_funds`,
  `cash_movements`, `reconciliation_*` — không INSERT/UPDATE/DELETE.
- Không sửa `stock_movements` (sổ cái kho bất biến) và không mass-update để
  thêm business_line_id vào lịch sử (§5.5 — suy ra qua
  `stock_movements → stock_batches → products → business_lines`).
- Không đổi mã chứng từ, không đổi `next_doc_code`, không xoá dữ liệu.
- Không đổi logic thanh toán (P3), VAT (P4), báo cáo (P5).
- Không đổi hành vi app hiện tại: mọi guard đều NULL-tolerant, mọi query cũ
  vẫn chạy (cột mới chỉ thêm, không đổi cột cũ).
