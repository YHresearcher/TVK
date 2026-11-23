-- =====================================================================
-- p3_seed_local.sql — Seed dữ liệu cho kiểm chứng migration 0027 (P3)
-- trên database local (KHÔNG phải live).
--
-- CHẠY: sau khi áp 0001–0026 + p1_seed_local.sql + p2_seed_local.sql,
-- TRƯỚC 0027:
--   psql -v ON_ERROR_STOP=1 -f docs/tests/p3_seed_local.sql
-- Sau đó chạy 0027, rồi chạy docs/tests/p3_payment_allocations_local.sql.
--
-- Tạo thêm (mọi chứng từ mới đều gán business_line_id tường minh vì
-- trigger P2 bắt buộc header có ngành):
--   - BH-SEED-0003 (OIL, a3 x4 @50.000 = 200.000) + receivable R-OIL 200.000
--   - BH-SEED-0004 (AUTO_PARTS, a2 x2 @100.000 = 200.000) + receivable R-PART2 200.000
--   - KG-SEED-0001 (AUTO_PARTS, a1 x2 @150.000 = 300.000, từ PB-SEED-0001)
--     + payable CONSIGNMENT_SALE 300.000
--   - Payable PURCHASE PN-SEED-0001: 2.000.000 (thuần phụ tùng)
--   - Payable PURCHASE PN-SEED-0002: 350.000 (HỖN HỢP a1+a3 — cố ý để
--     kiểm chứng âm: resolver ngành phải RAISE, không được đoán ngành)
--   - DS-PARTNER (2 dòng phải thu: R-a1 còn 200.000 + R-PART2 200.000 = 400.000)
--   - DS-SUPPLIER (2 dòng phải trả: PAY-P1 2.000.000 + PAY-KG 300.000 = 2.300.000)
-- Không tạo phiếu thanh toán mới ở đây: phiếu lịch sử duy nhất vẫn là
-- PT-SEED-0001 (p1 seed) để kiểm chứng backfill; các phiếu P3 tạo trong
-- file kiểm chứng (sau 0027) để thử trigger mới.
-- =====================================================================

BEGIN;

-- Đơn bán + chứng từ BH dầu (OIL).
INSERT INTO public.sales_orders (id, doc_code, partner_id, order_date, status) VALUES
  ('33333333-3333-3333-3333-333333333301', 'DH-SEED-0003', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-06', 'DRAFT'),
  ('33333333-3333-3333-3333-333333333305', 'DH-SEED-0004', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-06', 'DRAFT')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sales_documents (id, doc_code, doc_kind, sales_order_id, allocation_id, partner_id, doc_date, total_amount, status, business_line_id) VALUES
  ('33333333-3333-3333-3333-333333333302', 'BH-SEED-0003', 'BH', '33333333-3333-3333-3333-333333333301', NULL, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-06', 200000, 'DRAFT', (SELECT id FROM public.business_lines WHERE code = 'OIL')),
  ('33333333-3333-3333-3333-333333333306', 'BH-SEED-0004', 'BH', '33333333-3333-3333-3333-333333333305', NULL, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-06', 200000, 'DRAFT', (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS')),
  ('33333333-3333-3333-3333-333333333309', 'KG-SEED-0001', 'KG', NULL, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee6', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-06', 300000, 'DRAFT', (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sales_document_lines (id, document_id, product_id, qty, unit_price) VALUES
  ('33333333-3333-3333-3333-333333333303', '33333333-3333-3333-3333-333333333302', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 4, 50000),
  ('33333333-3333-3333-3333-333333333307', '33333333-3333-3333-3333-333333333306', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 2, 100000),
  ('33333333-3333-3333-3333-333333333310', '33333333-3333-3333-3333-333333333309', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 2, 150000)
ON CONFLICT (id) DO NOTHING;

-- Phải thu mới: R-OIL 200.000 + R-PART2 200.000.
INSERT INTO public.partner_receivables (id, partner_id, source_document_id, amount, amount_paid, status) VALUES
  ('33333333-3333-3333-3333-333333333304', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '33333333-3333-3333-3333-333333333302', 200000, 0, 'UNPAID'),
  ('33333333-3333-3333-3333-333333333308', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '33333333-3333-3333-3333-333333333306', 200000, 0, 'UNPAID')
ON CONFLICT (id) DO NOTHING;

-- Phải trả mới: PAY-P1 (mua PN1, thuần phụ tùng), PAY-P2 (mua PN2, HỖN HỢP),
-- PAY-KG (ký gửi đã bán KG-SEED-0001).
INSERT INTO public.supplier_payables
  (id, supplier_id, source_document_id, source_line_id, batch_id, qty, unit_price, amount, amount_paid, status, source_kind, purchase_receipt_id) VALUES
  ('33333333-3333-3333-3333-333333333311', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', NULL, NULL, NULL, NULL, NULL, 2000000, 0, 'UNPAID', 'PURCHASE', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1'),
  ('33333333-3333-3333-3333-333333333312', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', NULL, NULL, NULL, NULL, NULL, 350000, 0, 'UNPAID', 'PURCHASE', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2'),
  ('33333333-3333-3333-3333-333333333313', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', '33333333-3333-3333-3333-333333333309', '33333333-3333-3333-3333-333333333310', 'dddddddd-dddd-dddd-dddd-ddddddddddd1', 2, 150000, 300000, 0, 'UNPAID', 'CONSIGNMENT_SALE', NULL)
ON CONFLICT (id) DO NOTHING;

-- Đợt đối soát PARTNER: R-a1 (còn 200.000) + R-PART2 (200.000) = 400.000.
INSERT INTO public.settlements (id, doc_code, party_kind, partner_id, total_amount, status) VALUES
  ('33333333-3333-3333-3333-333333333314', 'DS-SEED-0001', 'PARTNER', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 400000, 'CONFIRMED')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.settlement_lines (id, settlement_id, receivable_id, amount) VALUES
  ('33333333-3333-3333-3333-333333333315', '33333333-3333-3333-3333-333333333314', 'ffffffff-ffff-ffff-ffff-ffffffffffa1', 200000),
  ('33333333-3333-3333-3333-333333333316', '33333333-3333-3333-3333-333333333314', '33333333-3333-3333-3333-333333333308', 200000)
ON CONFLICT (id) DO NOTHING;

-- Đợt đối soát SUPPLIER: PAY-P1 (2.000.000) + PAY-KG (300.000) = 2.300.000.
INSERT INTO public.settlements (id, doc_code, party_kind, supplier_id, total_amount, status) VALUES
  ('33333333-3333-3333-3333-333333333317', 'DS-SEED-0002', 'SUPPLIER', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 2300000, 'CONFIRMED')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.settlement_lines (id, settlement_id, payable_id, amount) VALUES
  ('33333333-3333-3333-3333-333333333318', '33333333-3333-3333-3333-333333333317', '33333333-3333-3333-3333-333333333311', 2000000),
  ('33333333-3333-3333-3333-333333333319', '33333333-3333-3333-3333-333333333317', '33333333-3333-3333-3333-333333333313', 300000)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Baseline tài chính trước 0027.
SELECT 'P3 SEED BASELINE' AS label,
  (SELECT count(*) FROM public.supplier_payables) AS payables,
  (SELECT count(*) FROM public.partner_receivables) AS receivables,
  (SELECT count(*) FROM public.payments) AS payments,
  (SELECT count(*) FROM public.settlements) AS settlements,
  (SELECT count(*) FROM public.settlement_lines) AS settlement_lines,
  (SELECT count(*) FROM public.stock_movements) AS movements;
