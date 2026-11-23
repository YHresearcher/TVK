-- =====================================================================
-- p1_seed_local.sql — Seed dữ liệu GIẢ LẬP trạng thái live TRƯỚC khi chạy
-- migration 0025 (TVK V2.0 P1).
--
-- CHẠY: sau khi áp 0001–0024 lên database local trống, TRƯỚC 0025.
--   psql -d tvk_p1_test -v ON_ERROR_STOP=1 -f docs/tests/p1_seed_local.sql
-- Sau đó chạy 0025, rồi chạy docs/tests/p1_business_lines_local.sql.
--
-- Dữ liệu cố ý chứa các bẫy kiểm chứng:
--   - 'Lọc dầu' và 'Lọc nhớt' có TÊN chứa "dầu"/"nhớt" nhưng là PHỤ TÙNG
--     (nhóm 'Linh kiện ô tô tải') — phân loại theo tên sẽ sai.
--   - Nhóm lạ 'Nhóm lạ XYZ' và product_group NULL -> phải ở lại NULL.
--   - Chứng từ hỗn hợp (dòng AUTO_PARTS + OIL) -> header phải ở lại NULL.
-- UUID cố định để file kiểm chứng tham chiếu được.
-- Tài chính seed: 1 receivable + 1 payment (để kiểm bất biến tài chính P1).
-- =====================================================================

BEGIN;

-- auth.users stub (database local không có Supabase Auth thật)
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'sales-oil@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'sales-none@test.local'),
  ('44444444-4444-4444-4444-444444444444', 'warehouse@test.local'),
  ('55555555-5555-5555-5555-555555555555', 'accounting@test.local'),
  ('66666666-6666-6666-6666-666666666666', 'ceo@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name, role, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', 'Chủ cửa hàng', 'OWNER', true),
  ('22222222-2222-2222-2222-222222222222', 'sales-oil@test.local', 'Bán hàng (chỉ dầu)', 'SALES', true),
  ('33333333-3333-3333-3333-333333333333', 'sales-none@test.local', 'Bán hàng (chưa gán)', 'SALES', true),
  ('44444444-4444-4444-4444-444444444444', 'warehouse@test.local', 'Thủ kho', 'WAREHOUSE', true),
  ('55555555-5555-5555-5555-555555555555', 'accounting@test.local', 'Kế toán', 'ACCOUNTING', true),
  ('66666666-6666-6666-6666-666666666666', 'ceo@test.local', 'CEO', 'CEO', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.suppliers (id, name) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'Trung Quốc')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.partners (id, name, partner_kind) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'Cty Á Âu', 'OTHER')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.locations (id, name, location_kind, partner_id) VALUES
  ('cccccccc-cccc-cccc-cccc-ccccccccccc1', 'Kho TVK', 'OWN_WAREHOUSE', NULL),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc2', 'Kho Cty Á Âu', 'PARTNER_VIRTUAL', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2')
ON CONFLICT (id) DO NOTHING;

-- Sản phẩm: p1/p2/p7 phụ tùng (p1, p7 là bẫy tên), p3/p4 dầu, p5/p6 chưa phân loại được.
INSERT INTO public.products (id, sku, name, product_group, unit) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'VG1540080110', 'Lọc dầu', 'Linh kiện ô tô tải', 'cái'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'WG9725190102', 'Bầu hơi cabin', 'Linh kiện ô tô tải', 'cái'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'OIL-10W40', 'Nhớt 10W40', 'Nhớt', 'chai'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'OIL-20W50', 'Dầu nhớt 20W50', 'Dầu nhớt', 'chai'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', 'STRANGE-1', 'Nhóm lạ', 'Nhóm lạ XYZ', 'cái'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6', 'NOGROUP-1', 'Chưa có nhóm', NULL, 'cái'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7', 'LOCNHOT-1', 'Lọc nhớt', 'Linh kiện ô tô tải', 'cái')
ON CONFLICT (id) DO NOTHING;

-- Lô hàng: p1 (phụ tùng) và p3 (dầu) có tồn kho.
INSERT INTO public.stock_batches (id, batch_code, product_id, ownership, unit_cost, qty_received, qty_on_hand, received_date, status) VALUES
  ('dddddddd-dddd-dddd-dddd-ddddddddddd1', 'OWN-SEED-0001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'OWNED', 100000, 100, 100, '2026-09-01', 'ACTIVE'),
  ('dddddddd-dddd-dddd-dddd-ddddddddddd2', 'OWN-SEED-0002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'OWNED', 50000, 50, 50, '2026-09-01', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.batch_locations (batch_id, location_id, qty) VALUES
  ('dddddddd-dddd-dddd-dddd-ddddddddddd1', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', 100),
  ('dddddddd-dddd-dddd-dddd-ddddddddddd2', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', 50)
ON CONFLICT (batch_id, location_id) DO NOTHING;

-- Phiếu nhập: pr1 thuần phụ tùng, pr2 hỗn hợp.
INSERT INTO public.purchase_receipts (id, doc_code, supplier_id, warehouse_id, receipt_date, status) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', 'PN-SEED-0001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', '2026-09-01', 'DRAFT'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2', 'PN-SEED-0002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', '2026-09-02', 'DRAFT')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.purchase_receipt_items (id, receipt_id, product_id, qty, unit_cost) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeea1', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 10, 100000),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeea2', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 5, 200000),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeea3', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 2, 100000),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeea4', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 3, 50000)
ON CONFLICT (id) DO NOTHING;

-- Phiếu nhận ký gửi: thuần phụ tùng.
INSERT INTO public.consignment_receipts (id, doc_code, supplier_id, warehouse_id, receipt_date, status) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3', 'NK-SEED-0001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', '2026-09-03', 'DRAFT')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.consignment_receipt_items (id, receipt_id, product_id, qty, consignment_price) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeea5', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 4, 180000)
ON CONFLICT (id) DO NOTHING;

-- Phiếu gửi ký gửi: lô p1 (phụ tùng).
INSERT INTO public.consignment_out_slips (id, doc_code, partner_id, slip_date, status) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee4', 'GK-SEED-0001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-04', 'DRAFT')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.consignment_out_items (id, slip_id, batch_id, from_location_id, qty, term, transfer_price) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeea6', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee4', 'dddddddd-dddd-dddd-dddd-ddddddddddd1', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', 5, 'CONSIGNMENT', 150000)
ON CONFLICT (id) DO NOTHING;

-- Báo cáo tiêu thụ + phân bổ: thuần phụ tùng (p1).
INSERT INTO public.consumption_reports (id, doc_code, partner_id, period_from, period_to, status) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5', 'BT-SEED-0001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-01', '2026-09-30', 'DRAFT')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.consumption_report_items (id, report_id, product_id, qty_consumed) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeea7', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.allocation_slips (id, doc_code, report_id, partner_id, alloc_date, status) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee6', 'PB-SEED-0001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-05', 'DRAFT')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.allocation_lines (id, allocation_id, product_id, batch_id, nature, qty, unit_price) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeea8', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee6', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'dddddddd-dddd-dddd-dddd-ddddddddddd1', 'PURCHASED', 2, 150000)
ON CONFLICT (id) DO NOTHING;

-- Đơn bán tại quầy + chứng từ BH: sd1 thuần phụ tùng, sd2 hỗn hợp.
INSERT INTO public.sales_orders (id, doc_code, partner_id, order_date, status) VALUES
  ('ffffffff-ffff-ffff-ffff-fffffffffff1', 'DH-SEED-0001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-06', 'DRAFT'),
  ('ffffffff-ffff-ffff-ffff-fffffffffff2', 'DH-SEED-0002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-06', 'DRAFT')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sales_documents (id, doc_code, doc_kind, sales_order_id, partner_id, doc_date, total_amount, status) VALUES
  ('ffffffff-ffff-ffff-ffff-fffffffffff3', 'BH-SEED-0001', 'BH', 'ffffffff-ffff-ffff-ffff-fffffffffff1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-06', 300000, 'DRAFT'),
  ('ffffffff-ffff-ffff-ffff-fffffffffff4', 'BH-SEED-0002', 'BH', 'ffffffff-ffff-ffff-ffff-fffffffffff2', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-06', 200000, 'DRAFT')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sales_document_lines (id, document_id, product_id, qty, unit_price) VALUES
  ('ffffffff-ffff-ffff-ffff-fffffffffff5', 'ffffffff-ffff-ffff-ffff-fffffffffff3', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 2, 150000),
  ('ffffffff-ffff-ffff-ffff-fffffffffff6', 'ffffffff-ffff-ffff-ffff-fffffffffff4', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 1, 150000),
  ('ffffffff-ffff-ffff-ffff-fffffffffff7', 'ffffffff-ffff-ffff-ffff-fffffffffff4', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 1, 50000)
ON CONFLICT (id) DO NOTHING;

-- Phiếu trả hàng: lô p1 (phụ tùng).
INSERT INTO public.return_documents (id, doc_code, return_kind, partner_id, return_date, status) VALUES
  ('ffffffff-ffff-ffff-ffff-fffffffffff8', 'TH-SEED-0001', 'CUSTOMER_RETURN', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-07', 'DRAFT')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.return_items (id, return_id, batch_id, qty, reason) VALUES
  ('ffffffff-ffff-ffff-ffff-fffffffffff9', 'ffffffff-ffff-ffff-ffff-fffffffffff8', 'dddddddd-dddd-dddd-dddd-ddddddddddd1', 1, 'OTHER')
ON CONFLICT (id) DO NOTHING;

-- Tài chính seed: 1 receivable (sd1) + 1 payment (để kiểm bất biến tài chính P1).
INSERT INTO public.partner_receivables (id, partner_id, source_document_id, amount, amount_paid, status) VALUES
  ('ffffffff-ffff-ffff-ffff-ffffffffffa1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'ffffffff-ffff-ffff-ffff-fffffffffff3', 300000, 0, 'UNPAID')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.payments (id, doc_code, payment_kind, payment_date, amount, method, receivable_id) VALUES
  ('ffffffff-ffff-ffff-ffff-ffffffffffa2', 'PT-SEED-0001', 'IN', '2026-09-08', 100000, 'BANK', 'ffffffff-ffff-ffff-ffff-ffffffffffa1')
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Ghi lại baseline tài chính để đối chiếu sau 0025 (kỳ vọng không đổi).
SELECT 'SEED BASELINE' AS label,
  (SELECT count(*) FROM public.supplier_payables) AS payables,
  (SELECT count(*) FROM public.partner_receivables) AS receivables,
  (SELECT count(*) FROM public.payments) AS payments,
  (SELECT count(*) FROM public.stock_movements) AS movements,
  (SELECT count(*) FROM public.products) AS products;
