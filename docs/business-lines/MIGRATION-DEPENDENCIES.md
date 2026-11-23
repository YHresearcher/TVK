# TVK V2.0 P1 — Migration Dependencies (Phụ thuộc migration)

## 1. Vị trí của 0025 trong chuỗi migration

| Migration | Vai trò với P1 |
|---|---|
| 0001_schema | Bảng gốc: products, profiles, chứng từ, dòng, sổ cái, views. 0025 thêm cột + tham chiếu vào các bảng này. |
| 0002_business_functions | Hàm nghiệp vụ gốc (`confirm_*`, `apply_payment_to_balance` bản cũ). 0025 không sửa hàm nào ở đây. |
| 0003_rls_and_roles | RLS + `current_app_role()` + `v_batches_for_sales` bản gốc. 0025 dùng `current_app_role()` trong policy mới và định nghĩa lại view. |
| 0004_username_login | Không liên quan trực tiếp. |
| 0005_grants | `GRANT ... TO authenticated` + default privileges — bảng mới của 0025 được hưởng default privileges; 0025 vẫn grant tường minh. |
| 0006_service_role_grants | Không liên quan trực tiếp. |
| 0007_ceo_enum / 0008_ceo_readonly | Thêm role CEO — ma trận P1 (§6.3) dùng đủ 5 vai trò. |
| 0009_password_policy | Không liên quan trực tiếp. |
| 0010_rounding_adjustment | Không liên quan trực tiếp. |
| 0011_supplier_name_for_owned_lots | Không liên quan trực tiếp. |
| 0012_delete_receipt | Không liên quan trực tiếp. |
| 0013_profile_privilege_guard | Guard phân quyền profiles — 0025 không đổi profiles; phân quyền ngành là lớp riêng (`user_business_lines`). |
| 0014_exact_unit_costs | Không liên quan trực tiếp. |
| 0015_product_group | Thêm `products.product_group` + backfill 46 sản phẩm → `'Linh kiện ô tô tải'`. **0025 backfill dựa trên chính cột này.** |
| 0016_oil_fields_and_expiry | SAE/API + expiry — khung kỹ thuật dầu (P2 dùng cho FEFO). |
| 0017_receipt_item_expiry | Hạn dùng trên dòng phiếu nhập. |
| 0018_role_hardening_m1_m2_m3 | Siết role trong 11 hàm nghiệp vụ + `security_invoker = true` cho views. 0025 giữ nguyên các hàm này. |
| 0019_platform_fixes | `apply_payment_to_balance` bản mới (settlement + overpayment guard). 0025 không đụng trigger thanh toán — P3/P4 mới đụng (cutover). |
| 0020_p0_integrity_security | `v_batches_for_sales` bản security_invoker=false + `tvk_guard_sales_document_lines` + `create_vat_invoice`. 0025 định nghĩa lại view (giữ guard) và thêm trigger line-guard **song song** (không thay thế guard 0020). |
| 0021_purchase_payables | `supplier_payables.source_kind` + `purchase_receipt_id`. 0025 không đụng. |
| 0022_cash_funds | `cash_funds`/`cash_movements`/`payments.fund_id`. 0025 không đụng. |
| 0023_management_accounting | Đối chiếu, snapshot, `transfer_internal_cash_funds`, `cancel_cash_movement_reversal`. 0025 không đụng. |
| 0024_sales_view_profile_guard | **Tiền điều kiện trực tiếp**: 0025 định nghĩa lại `v_batches_for_sales` từ đúng bản 0024 (giữ nguyên thứ tự cột + guard active-profile). Chạy 0025 trước 0024 sẽ mất guard 0024 khi 0024 chạy sau? Không — 0024 chạy trước (thứ tự số), và 0025 đã sao chép đúng định nghĩa 0024 + phần mở rộng. |

**0025 chạy sau 0024. Không chạy 0025 trước khi 0001–0024 đã áp xong.**

## 2. Đối tượng 0025 phụ thuộc

- Kiểu `app_role` (0001 + 0007): dùng trong policy (`'OWNER'`, `'CEO'`).
- `auth.uid()` (Supabase Auth): dùng trong policy + view + trigger audit.
- `current_app_role()` (0003): dùng trong policy mới.
- `products.product_group` (0015): nguồn backfill.
- `stock_batches`, `batch_locations`, `locations`, `suppliers` (0001):
  dùng trong view `v_batches_for_sales` và backfill GK/TH.
- `profiles` (0001): FK cho `user_business_lines.user_id` và audit `changed_by`.

## 3. Đối tượng P2–P6 sẽ dựa trên 0025

- P2: form + switcher đọc `business_lines` / `user_business_lines`;
  `NOT NULL` cho `products.business_line_id` và header (sau khi app ghi được);
  siết bắt buộc gán (nếu chủ phê duyệt); FEFO/FIFO dùng `business_line_id`.
- P3: `payment_allocations` tham chiếu công nợ đã có ngành (sau P2).
- P4: VAT tách theo ngành dùng `sales_documents.business_line_id`.
- P5: dashboard theo ngành dùng `business_lines` + các cột mới.

## 4. Thứ tự áp dụng

1. Preflight: xác minh 0001–0024 đã live (đặc biệt 0019/0020/0023/0024).
   Trạng thái live 23/11: 0019 ✅, 0020 một phần (`create_vat_invoice` có;
   phần view được 0024 thay thế), 0023 ✅, 0024 ✅ (vừa chạy live 23/11
   16:51, đã xác minh lại 46 lô / 114 lần nhập xuất / 1 đơn bán không đổi).
   Vì 0024 đã live, 0025 định nghĩa lại view từ đúng bản 0024.
2. Staging: áp 0025 lên bản sao dữ liệu, chạy
   `docs/tests/p1_business_lines_local.sql`, đối chiếu bất biến tài chính.
3. Production: backup → áp 0025 → kiểm tra báo cáo phân loại (46 → AUTO_PARTS,
   0 chưa phân loại) → đối chiếu số liệu → smoke test app.
