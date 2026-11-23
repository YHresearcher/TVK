-- =====================================================================
-- p4_seed_local.sql — Seed dữ liệu cho kiểm chứng migration 0028+0029
-- (TVK V2.0 P4a/P4b) trên database local (KHÔNG phải live).
--
-- CHẠY: sau khi áp 0001–0027 + p1/p2/p3 seed (xem run-all.sh),
-- TRƯỚC 0028:
--   psql -v ON_ERROR_STOP=1 -f docs/tests/p4_seed_local.sql
-- Sau đó chạy 0028, 0029, rồi docs/tests/p4_finance_vat_local.sql.
--
-- Tạo thêm (đối tác Á Âu bbbb...b2, trừ khi ghi khác):
--   - BH-VAT-0001 (AUTO, CONFIRMED): a1 x2 @150.000 + a2 x1 @200.000
--     = 500.000, giảm giá 50.000, tổng 450.000 + phải thu R-VAT1 450.000.
--     Dùng cho VAT-01: chia giảm giá theo dòng + tách VAT 8%.
--   - BH-VAT-0002 (OIL, CONFIRMED): a3 x4 @50.000 = 200.000, không
--     giảm giá + phải thu R-VAT2 200.000. Dùng cho VAT-02.
--   - KG-VAT-0001 (AUTO, CONFIRMED): a1 x1 @150.000 = 150.000 (từ
--     PB-SEED-0001). Dùng cho VAT-03 (trộn ngành) + VAT-05 (sai đối tác).
--   - BH-VAT-0003 (HỖN HỢP a1+a3, DRAFT): header business_line_id
--     NULL + phải thu R-MIX 200.000 (chưa trả). Dùng cho BL-014:
--     không tự chia, phải nằm trong v_unattributed_balances.
--   - BH-VAT-0004 (OIL, CONFIRMED): a3 x2 @50.000 = 100.000 + phải
--     thu R-VAT3 100.000. Dùng cho VAT-04 + VAT-10 (quyền ngành).
--   - BH-VAT-0005 (sản phẩm CHƯA PHÂN LOẠI, CONFIRMED): sp mới
--     5555...5001 x1 @100.000 + phải thu R-VAT4 100.000 (NULL ngành).
--     Dùng cho VAT-09 + BL-014 (hàng chưa phân loại).
--   - BH-VAT-0006 (OIL, CONFIRMED): a3 x1 @50.000 = 50.000 + phải
--     thu R-VAT5 50.000. Dùng cho VAT-11 (đồng thời hai phiên).
--   - BH-VAT-0007 (AUTO, CONFIRMED): a2 x1 @200.000 = 200.000 + phải
--     thu R-VAT6 200.000. Dùng cho BL15-02 (đảo khi chưa có hoá đơn).
--   - Đối tác thứ hai 'Cty Test Khác' 5555...5001: dùng cho VAT-05
--     (ghi hoá đơn sai đối tác phải bị chặn).
-- Không tạo phiếu thanh toán mới ở đây: các phiếu P4 tạo trong file
-- kiểm chứng (sau 0029) để thử trigger cắt (0028) + BL-015.
-- =====================================================================

BEGIN;

-- Đối tác thứ hai (cho test sai đối tác VAT-05).
INSERT INTO public.partners (id, name, partner_kind) VALUES
  ('55555555-5555-5555-5555-555555550001', 'Cty Test Khác', 'OTHER')
ON CONFLICT (id) DO NOTHING;

-- Sản phẩm chưa phân loại ngành (cho VAT-09 + BL-014).
INSERT INTO public.products (id, sku, name, brand, unit, product_group, business_line_id) VALUES
  ('55555555-5555-5555-5555-555555550001', 'SP-CHUA-PL', 'Sản phẩm chưa phân loại', 'Test', 'Cái', 'Linh kiện ô tô tải', NULL)
ON CONFLICT (id) DO NOTHING;

-- Đơn đặt hàng (DH) cho các chứng từ BH (chk_sales_doc_source bắt
-- buộc BH phải có sales_order_id).
INSERT INTO public.sales_orders (id, doc_code, partner_id, order_date, status) VALUES
  ('55555555-5555-5555-5555-555555550101', 'DH-VAT-0001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-07', 'DRAFT'),
  ('55555555-5555-5555-5555-555555550102', 'DH-VAT-0002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-07', 'DRAFT'),
  ('55555555-5555-5555-5555-555555550103', 'DH-VAT-0003', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-07', 'DRAFT'),
  ('55555555-5555-5555-5555-555555550104', 'DH-VAT-0004', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-07', 'DRAFT'),
  ('55555555-5555-5555-5555-555555550105', 'DH-VAT-0005', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-07', 'DRAFT'),
  ('55555555-5555-5555-5555-555555550106', 'DH-VAT-0006', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-07', 'DRAFT'),
  ('55555555-5555-5555-5555-555555550107', 'DH-VAT-0007', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-07', 'DRAFT')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sales_documents
  (id, doc_code, doc_kind, sales_order_id, allocation_id, partner_id, doc_date, subtotal, discount_amount, total_amount, status, business_line_id) VALUES
  ('55555555-5555-5555-5555-555555550201', 'BH-VAT-0001', 'BH', '55555555-5555-5555-5555-555555550101', NULL, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-07', 500000, 50000, 450000, 'DRAFT', (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS')),
  ('55555555-5555-5555-5555-555555550202', 'BH-VAT-0002', 'BH', '55555555-5555-5555-5555-555555550102', NULL, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-07', 200000, 0, 200000, 'DRAFT', (SELECT id FROM public.business_lines WHERE code = 'OIL')),
  ('55555555-5555-5555-5555-555555550203', 'KG-VAT-0001', 'KG', NULL, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee6', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-07', 150000, 0, 150000, 'DRAFT', (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS')),
  ('55555555-5555-5555-5555-555555550204', 'BH-VAT-0003', 'BH', '55555555-5555-5555-5555-555555550103', NULL, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-07', 200000, 0, 200000, 'DRAFT', (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS')),
  ('55555555-5555-5555-5555-555555550205', 'BH-VAT-0004', 'BH', '55555555-5555-5555-5555-555555550104', NULL, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-07', 100000, 0, 100000, 'DRAFT', (SELECT id FROM public.business_lines WHERE code = 'OIL')),
  ('55555555-5555-5555-5555-555555550206', 'BH-VAT-0005', 'BH', '55555555-5555-5555-5555-555555550105', NULL, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-07', 100000, 0, 100000, 'DRAFT', (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS')),
  ('55555555-5555-5555-5555-555555550207', 'BH-VAT-0006', 'BH', '55555555-5555-5555-5555-555555550106', NULL, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-07', 50000, 0, 50000, 'DRAFT', (SELECT id FROM public.business_lines WHERE code = 'OIL')),
  ('55555555-5555-5555-5555-555555550208', 'BH-VAT-0007', 'BH', '55555555-5555-5555-5555-555555550107', NULL, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-07', 200000, 0, 200000, 'DRAFT', (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS'))
ON CONFLICT (id) DO NOTHING;

-- BH-VAT-0003 (hỗn hợp) và BH-VAT-0005 (sản phẩm chưa phân loại) phải
-- có header NULL: P2 chặn INSERT với ngành NULL và chặn bỏ ngành khi
-- còn dòng, nên INSERT với ngành tạm rồi bỏ ngành TRƯỚC khi thêm dòng
-- (lúc này chưa có dòng nên UPDATE được cho phép; guard dòng cho qua
-- khi header NULL).
UPDATE public.sales_documents SET business_line_id = NULL
 WHERE id IN ('55555555-5555-5555-5555-555555550204', '55555555-5555-5555-5555-555555550206');

INSERT INTO public.sales_document_lines (id, document_id, product_id, qty, unit_price) VALUES
  ('55555555-5555-5555-5555-555555550301', '55555555-5555-5555-5555-555555550201', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 2, 150000),
  ('55555555-5555-5555-5555-555555550302', '55555555-5555-5555-5555-555555550201', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 1, 200000),
  ('55555555-5555-5555-5555-555555550303', '55555555-5555-5555-5555-555555550202', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 4, 50000),
  ('55555555-5555-5555-5555-555555550304', '55555555-5555-5555-5555-555555550203', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 1, 150000),
  ('55555555-5555-5555-5555-555555550307', '55555555-5555-5555-5555-555555550205', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 2, 50000),
  ('55555555-5555-5555-5555-555555550309', '55555555-5555-5555-5555-555555550207', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 1, 50000),
  ('55555555-5555-5555-5555-555555550310', '55555555-5555-5555-5555-555555550208', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 1, 200000)
ON CONFLICT (id) DO NOTHING;

-- Dòng của hai chứng từ header NULL (thêm sau khi bỏ ngành).
INSERT INTO public.sales_document_lines (id, document_id, product_id, qty, unit_price) VALUES
  ('55555555-5555-5555-5555-555555550305', '55555555-5555-5555-5555-555555550204', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 1, 150000),
  ('55555555-5555-5555-5555-555555550306', '55555555-5555-5555-5555-555555550204', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 1, 50000),
  ('55555555-5555-5555-5555-555555550308', '55555555-5555-5555-5555-555555550206', '55555555-5555-5555-5555-555555550001', 1, 100000)
ON CONFLICT (id) DO NOTHING;

-- Chốt các chứng từ VAT (0020 chặn thêm dòng vào chứng từ đã xác nhận
-- nên phải thêm dòng lúc còn DRAFT rồi mới chuyển CONFIRMED).
UPDATE public.sales_documents SET status = 'CONFIRMED'
 WHERE id IN ('55555555-5555-5555-5555-555555550201', '55555555-5555-5555-5555-555555550202',
              '55555555-5555-5555-5555-555555550203', '55555555-5555-5555-5555-555555550205',
              '55555555-5555-5555-5555-555555550207', '55555555-5555-5555-5555-555555550208');
-- BH-VAT-0005 (sản phẩm chưa phân loại, header NULL) không chốt được
-- qua đường thường: P2 chặn mọi UPDATE khi header NULL mà còn dòng.
-- Tắt trigger P2 trong lúc seed để dựng dữ liệu legacy này rồi bật
-- lại ngay (chỉ trong seed test, không ảnh hưởng migration).
ALTER TABLE public.sales_documents DISABLE TRIGGER trg_require_header_bl;
UPDATE public.sales_documents SET status = 'CONFIRMED' WHERE id = '55555555-5555-5555-5555-555555550206';
ALTER TABLE public.sales_documents ENABLE TRIGGER trg_require_header_bl;
-- BH-VAT-0003 ở lại DRAFT (chứng từ hỗn hợp, dùng cho BL-014).

-- Phải thu P4: R-VAT1..R-VAT6 + R-MIX (hỗn hợp, chưa trả) + R-VAT4
-- (sản phẩm chưa phân loại). amount_paid = 0 tất cả (không có phiếu
-- lịch sử nào cho chúng — giữ bất biến SUM(phân bổ) = amount_paid
-- cho post-check của 0028).
INSERT INTO public.partner_receivables (id, partner_id, source_document_id, amount, amount_paid, status) VALUES
  ('55555555-5555-5555-5555-555555550401', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '55555555-5555-5555-5555-555555550201', 450000, 0, 'UNPAID'),
  ('55555555-5555-5555-5555-555555550402', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '55555555-5555-5555-5555-555555550202', 200000, 0, 'UNPAID'),
  ('55555555-5555-5555-5555-555555550403', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '55555555-5555-5555-5555-555555550204', 200000, 0, 'UNPAID'),
  ('55555555-5555-5555-5555-555555550404', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '55555555-5555-5555-5555-555555550205', 100000, 0, 'UNPAID'),
  ('55555555-5555-5555-5555-555555550405', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '55555555-5555-5555-5555-555555550206', 100000, 0, 'UNPAID'),
  ('55555555-5555-5555-5555-555555550406', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '55555555-5555-5555-5555-555555550207', 50000, 0, 'UNPAID'),
  ('55555555-5555-5555-5555-555555550407', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '55555555-5555-5555-5555-555555550208', 200000, 0, 'UNPAID')
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Baseline tài chính trước 0028 (đối chiếu sau khi chạy 0028+0029).
SELECT 'P4 SEED BASELINE' AS label,
  (SELECT count(*) FROM public.supplier_payables) AS payables,
  (SELECT count(*) FROM public.partner_receivables) AS receivables,
  (SELECT count(*) FROM public.payments) AS payments,
  (SELECT count(*) FROM public.vat_invoices) AS vat_invoices,
  (SELECT count(*) FROM public.cash_movements) AS movements,
  (SELECT coalesce(sum(amount - amount_paid), 0) FROM public.partner_receivables) AS rec_open,
  (SELECT coalesce(sum(amount - amount_paid), 0) FROM public.supplier_payables) AS pay_open;
