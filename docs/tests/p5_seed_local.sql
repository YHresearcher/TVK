-- =====================================================================
-- p5_seed_local.sql — Seed dữ liệu cho kiểm chứng migration 0030 (P5)
-- trên database local (KHÔNG phải live).
--
-- CHẠY: sau khi áp 0001–0029 + p1/p2/p3/p4 seed, TRƯỚC 0030:
--   psql -v ON_ERROR_STOP=1 -f docs/tests/p5_seed_local.sql
-- Sau đó chạy 0030, rồi docs/tests/p5_reporting_local.sql.
--
-- Tạo thêm (ngày chứng từ lấy theo CURRENT_DATE để kiểm 30 ngày):
--   - BH-P5-0001 (AUTO, CONFIRMED, hôm nay): a1 x2 @150.000, gắn lô
--     OWN-SEED-0001 (giá vốn 100.000) -> doanh thu 300.000, giá vốn
--     200.000, lãi 100.000. Dùng kiểm giá vốn theo lô thật (seed P4
--     không gắn batch_id nên giá vốn = 0).
--   - BH-P5-0002 (OIL, CONFIRMED, hôm nay − 5 ngày): a3 x4 @50.000,
--     gắn lô OWN-SEED-0002 (giá vốn 50.000) -> doanh thu 200.000,
--     giá vốn 200.000, lãi 0.
--   - GK-P5-0001 (AUTO, CONFIRMED, hôm nay): lô a1 x3 @150.000 ->
--     đã gửi 3 / 450.000 (đổi trạng thái trực tiếp như mẫu seed P4,
--     không qua RPC — view luồng gửi chỉ đọc phiếu + dòng).
--   - 3 bút toán kho (trigger sổ cái tự cập nhật batch_locations):
--     M1 IN_PURCHASE lô a1 +5 vào Kho TVK; M2 OUT_SALE lô a3 −2 ra
--     khỏi hệ thống; M3 OUT_CONSIGNMENT lô a1 3 từ Kho TVK -> Kho Á Âu.
--   - Hạn thu: R-VAT2 (OIL, 200.000) quá hạn 10 ngày; R-VAT6 (AUTO,
--     200.000) còn hạn 10 ngày (UPDATE due_date được phép — guard
--     0028 chỉ chặn sửa amount_paid/status).
-- =====================================================================

BEGIN;

-- Đơn bán cho 2 chứng từ P5 (BH bắt buộc có sales_order_id).
INSERT INTO public.sales_orders (id, doc_code, partner_id, order_date, status) VALUES
  ('66666666-6666-6666-6666-666666660101', 'DH-P5-0001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', CURRENT_DATE, 'DRAFT'),
  ('66666666-6666-6666-6666-666666660102', 'DH-P5-0002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', CURRENT_DATE - 5, 'DRAFT')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sales_documents
  (id, doc_code, doc_kind, sales_order_id, allocation_id, partner_id, doc_date, subtotal, discount_amount, total_amount, status, business_line_id) VALUES
  ('66666666-6666-6666-6666-666666660201', 'BH-P5-0001', 'BH', '66666666-6666-6666-6666-666666660101', NULL, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', CURRENT_DATE, 300000, 0, 300000, 'DRAFT', (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS')),
  ('66666666-6666-6666-6666-666666660202', 'BH-P5-0002', 'BH', '66666666-6666-6666-6666-666666660102', NULL, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', CURRENT_DATE - 5, 200000, 0, 200000, 'DRAFT', (SELECT id FROM public.business_lines WHERE code = 'OIL'))
ON CONFLICT (id) DO NOTHING;

-- Dòng bán gắn lô thật để có giá vốn (chèn lúc còn DRAFT — 0020 chặn
-- thêm dòng vào chứng từ đã xác nhận).
INSERT INTO public.sales_document_lines (id, document_id, product_id, batch_id, qty, unit_price) VALUES
  ('66666666-6666-6666-6666-666666660301', '66666666-6666-6666-6666-666666660201', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'dddddddd-dddd-dddd-dddd-ddddddddddd1', 2, 150000),
  ('66666666-6666-6666-6666-666666660302', '66666666-6666-6666-6666-666666660202', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'dddddddd-dddd-dddd-dddd-ddddddddddd2', 4, 50000)
ON CONFLICT (id) DO NOTHING;

UPDATE public.sales_documents SET status = 'CONFIRMED'
 WHERE id IN ('66666666-6666-6666-6666-666666660201', '66666666-6666-6666-6666-666666660202');

-- Phiếu gửi ký gửi P5 (AUTO, đã xác nhận).
INSERT INTO public.consignment_out_slips (id, doc_code, partner_id, slip_date, status, business_line_id) VALUES
  ('66666666-6666-6666-6666-666666660401', 'GK-P5-0001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', CURRENT_DATE, 'DRAFT', (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS'))
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.consignment_out_items (id, slip_id, batch_id, from_location_id, qty, term, transfer_price) VALUES
  ('66666666-6666-6666-6666-666666660402', '66666666-6666-6666-6666-666666660401', 'dddddddd-dddd-dddd-dddd-ddddddddddd1', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', 3, 'CONSIGNMENT', 150000)
ON CONFLICT (id) DO NOTHING;
UPDATE public.consignment_out_slips SET status = 'CONFIRMED' WHERE id = '66666666-6666-6666-6666-666666660401';

-- 3 bút toán kho (trigger sổ cái tự trừ/cộng batch_locations).
INSERT INTO public.stock_movements (id, batch_id, movement_kind, qty, from_location_id, to_location_id, ref_doc_type, ref_doc_id, created_by) VALUES
  ('66666666-6666-6666-6666-666666660501', 'dddddddd-dddd-dddd-dddd-ddddddddddd1', 'IN_PURCHASE', 5, NULL, 'cccccccc-cccc-cccc-cccc-ccccccccccc1', 'PURCHASE_RECEIPT', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', '11111111-1111-1111-1111-111111111111'),
  ('66666666-6666-6666-6666-666666660502', 'dddddddd-dddd-dddd-dddd-ddddddddddd2', 'OUT_SALE', 2, 'cccccccc-cccc-cccc-cccc-ccccccccccc1', NULL, 'SALES_DOCUMENT', '66666666-6666-6666-6666-666666660202', '11111111-1111-1111-1111-111111111111'),
  ('66666666-6666-6666-6666-666666660503', 'dddddddd-dddd-dddd-dddd-ddddddddddd1', 'OUT_CONSIGNMENT', 3, 'cccccccc-cccc-cccc-cccc-ccccccccccc1', 'cccccccc-cccc-cccc-cccc-ccccccccccc2', 'CONSIGNMENT_OUT', '66666666-6666-6666-6666-666666660401', '11111111-1111-1111-1111-111111111111')
ON CONFLICT (id) DO NOTHING;

-- Hạn thu cho 2 khoản phải thu (quá hạn / còn hạn).
UPDATE public.partner_receivables SET due_date = CURRENT_DATE - 10
 WHERE id = '55555555-5555-5555-5555-555555550402';
UPDATE public.partner_receivables SET due_date = CURRENT_DATE + 10
 WHERE id = '55555555-5555-5555-5555-555555550407';

COMMIT;

-- Baseline trước 0030 (đối chiếu sau khi chạy 0030 — view chỉ đọc,
-- số liệu gốc không được đổi).
SELECT 'P5 SEED BASELINE' AS label,
  (SELECT count(*) FROM public.supplier_payables) AS payables,
  (SELECT count(*) FROM public.partner_receivables) AS receivables,
  (SELECT count(*) FROM public.payments) AS payments,
  (SELECT count(*) FROM public.stock_movements) AS movements,
  (SELECT count(*) FROM public.sales_documents WHERE status = 'CONFIRMED') AS confirmed_docs,
  (SELECT coalesce(sum(amount - amount_paid), 0) FROM public.partner_receivables) AS rec_open,
  (SELECT coalesce(sum(amount - amount_paid), 0) FROM public.supplier_payables) AS pay_open;
