-- =====================================================================
-- p1_business_lines_local.sql — Kiểm chứng migration 0025 (TVK V2.0 P1)
-- trên database local (KHÔNG phải live).
--
-- CHẠY (thứ tự bắt buộc):
--   1. Database local trống -> áp 0001–0024
--   2. psql -v ON_ERROR_STOP=1 -f docs/tests/p1_seed_local.sql
--   3. psql -v ON_ERROR_STOP=1 -f supabase/migrations/0025_business_lines.sql
--   4. psql -v ON_ERROR_STOP=1 -f docs/tests/p1_business_lines_local.sql
-- Mọi assertion fail đều RAISE EXCEPTION (psql dừng ngay nhờ ON_ERROR_STOP).
-- Chạy bằng role postgres (superuser) — các khối mô phỏng role dùng
-- SET LOCAL ROLE authenticated + JWT giả (mẫu p0_sales_view_rls_local.sql).
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. Backfill phân loại sản phẩm (§5.2)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_total integer; v_oil integer; v_parts integer; v_null integer; v_audit integer;
BEGIN
  SELECT count(*) INTO v_total FROM public.products;
  SELECT count(*) INTO v_oil FROM public.products p
    JOIN public.business_lines bl ON bl.id = p.business_line_id WHERE bl.code = 'OIL';
  SELECT count(*) INTO v_parts FROM public.products p
    JOIN public.business_lines bl ON bl.id = p.business_line_id WHERE bl.code = 'AUTO_PARTS';
  SELECT count(*) INTO v_null FROM public.products WHERE business_line_id IS NULL;
  SELECT count(*) INTO v_audit FROM public.product_business_line_audit
   WHERE source = 'MIGRATION_0025_BACKFILL';

  IF v_total <> 7 THEN RAISE EXCEPTION 'FAIL A1: products total=% (expect 7)', v_total; END IF;
  IF v_oil <> 2 THEN RAISE EXCEPTION 'FAIL A2: OIL=% (expect 2)', v_oil; END IF;
  IF v_parts <> 3 THEN RAISE EXCEPTION 'FAIL A3: AUTO_PARTS=% (expect 3)', v_parts; END IF;
  IF v_null <> 2 THEN RAISE EXCEPTION 'FAIL A4: UNCLASSIFIED=% (expect 2)', v_null; END IF;
  IF v_audit <> 5 THEN RAISE EXCEPTION 'FAIL A5: backfill audit rows=% (expect 5)', v_audit; END IF;

  -- Bẫy tên hàng: 'Lọc dầu' và 'Lọc nhớt' PHẢI là AUTO_PARTS (phân loại theo
  -- GIÁ TRỊ product_group, không theo chuỗi con trong tên).
  IF (SELECT bl.code FROM public.products p JOIN public.business_lines bl ON bl.id = p.business_line_id
       WHERE p.sku = 'VG1540080110') <> 'AUTO_PARTS' THEN
    RAISE EXCEPTION 'FAIL A6: Lọc dầu misclassified (name heuristic suspected)';
  END IF;
  IF (SELECT bl.code FROM public.products p JOIN public.business_lines bl ON bl.id = p.business_line_id
       WHERE p.sku = 'LOCNHOT-1') <> 'AUTO_PARTS' THEN
    RAISE EXCEPTION 'FAIL A7: Lọc nhớt misclassified (name heuristic suspected)';
  END IF;
  -- Nhóm lạ + NULL group ở lại NULL.
  IF (SELECT business_line_id FROM public.products WHERE sku = 'STRANGE-1') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL A8: unknown group silently assigned';
  END IF;
  IF (SELECT business_line_id FROM public.products WHERE sku = 'NOGROUP-1') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL A9: NULL group silently assigned';
  END IF;
  -- Hàng đợi chưa phân loại = đúng 2 sản phẩm.
  IF (SELECT count(*) FROM public.v_unclassified_products) <> 2 THEN
    RAISE EXCEPTION 'FAIL A10: v_unclassified_products count wrong';
  END IF;
  -- Bảng mapping: đúng 3 dòng đã phê duyệt.
  IF (SELECT count(*) FROM public.business_line_group_mappings) <> 3 THEN
    RAISE EXCEPTION 'FAIL A11: mapping table rows wrong';
  END IF;
  RAISE NOTICE 'PASS A: classification total=7 OIL=2 AUTO_PARTS=3 UNCLASSIFIED=2 audit=5 (name traps OK)';
END $$;

-- ---------------------------------------------------------------------
-- B. Backfill business_line_id trên chứng từ (§5.4)
--    Thuần một ngành -> gán; hỗn hợp -> NULL.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_code text;
BEGIN
  SELECT bl.code INTO v_code FROM public.purchase_receipts h
    LEFT JOIN public.business_lines bl ON bl.id = h.business_line_id WHERE h.doc_code = 'PN-SEED-0001';
  IF v_code IS DISTINCT FROM 'AUTO_PARTS' THEN RAISE EXCEPTION 'FAIL B1: PN-SEED-0001=% (expect AUTO_PARTS)', v_code; END IF;

  IF (SELECT business_line_id FROM public.purchase_receipts WHERE doc_code = 'PN-SEED-0002') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL B2: mixed receipt PN-SEED-0002 forced to a line';
  END IF;
  SELECT bl.code INTO v_code FROM public.consignment_receipts h
    LEFT JOIN public.business_lines bl ON bl.id = h.business_line_id WHERE h.doc_code = 'NK-SEED-0001';
  IF v_code IS DISTINCT FROM 'AUTO_PARTS' THEN RAISE EXCEPTION 'FAIL B3: NK-SEED-0001=%', v_code; END IF;
  SELECT bl.code INTO v_code FROM public.consignment_out_slips h
    LEFT JOIN public.business_lines bl ON bl.id = h.business_line_id WHERE h.doc_code = 'GK-SEED-0001';
  IF v_code IS DISTINCT FROM 'AUTO_PARTS' THEN RAISE EXCEPTION 'FAIL B4: GK-SEED-0001=%', v_code; END IF;
  SELECT bl.code INTO v_code FROM public.consumption_reports h
    LEFT JOIN public.business_lines bl ON bl.id = h.business_line_id WHERE h.doc_code = 'BT-SEED-0001';
  IF v_code IS DISTINCT FROM 'AUTO_PARTS' THEN RAISE EXCEPTION 'FAIL B5: BT-SEED-0001=%', v_code; END IF;
  SELECT bl.code INTO v_code FROM public.allocation_slips h
    LEFT JOIN public.business_lines bl ON bl.id = h.business_line_id WHERE h.doc_code = 'PB-SEED-0001';
  IF v_code IS DISTINCT FROM 'AUTO_PARTS' THEN RAISE EXCEPTION 'FAIL B6: PB-SEED-0001=%', v_code; END IF;
  SELECT bl.code INTO v_code FROM public.sales_documents h
    LEFT JOIN public.business_lines bl ON bl.id = h.business_line_id WHERE h.doc_code = 'BH-SEED-0001';
  IF v_code IS DISTINCT FROM 'AUTO_PARTS' THEN RAISE EXCEPTION 'FAIL B7: BH-SEED-0001=%', v_code; END IF;
  IF (SELECT business_line_id FROM public.sales_documents WHERE doc_code = 'BH-SEED-0002') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL B8: mixed sales doc BH-SEED-0002 forced to a line';
  END IF;
  SELECT bl.code INTO v_code FROM public.return_documents h
    LEFT JOIN public.business_lines bl ON bl.id = h.business_line_id WHERE h.doc_code = 'TH-SEED-0001';
  IF v_code IS DISTINCT FROM 'AUTO_PARTS' THEN RAISE EXCEPTION 'FAIL B9: TH-SEED-0001=%', v_code; END IF;
  RAISE NOTICE 'PASS B: header backfill (7 single-line OK, 2 mixed stay NULL)';
END $$;

-- ---------------------------------------------------------------------
-- C. Bất biến tài chính P1 (§15.7): số lượng bảng tài chính + sổ cái kho
--    phải bằng đúng baseline seed (payables 0 / receivables 1 / payments 1 /
--    movements 0). Migration 0025 không được tạo/sửa/xoá dòng nào ở đây.
-- ---------------------------------------------------------------------
DO $$
DECLARE v_pay integer; v_rec integer; v_paym integer; v_mov integer;
BEGIN
  SELECT count(*) INTO v_pay FROM public.supplier_payables;
  SELECT count(*) INTO v_rec FROM public.partner_receivables;
  SELECT count(*) INTO v_paym FROM public.payments;
  SELECT count(*) INTO v_mov FROM public.stock_movements;
  IF v_pay <> 0 OR v_rec <> 1 OR v_paym <> 1 OR v_mov <> 0 THEN
    RAISE EXCEPTION 'FAIL C: financial counts changed payables=% receivables=% payments=% movements=% (expect 0/1/1/0)',
      v_pay, v_rec, v_paym, v_mov;
  END IF;
  -- Receivable seed vẫn đúng số tiền (payment 100k đã trừ vào amount_paid bởi
  -- trigger 0019 khi seed — kiểm tra trạng thái, không kiểm tra lại logic 0019).
  IF (SELECT amount FROM public.partner_receivables WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffa1') <> 300000 THEN
    RAISE EXCEPTION 'FAIL C2: receivable amount changed';
  END IF;
  RAISE NOTICE 'PASS C: financial invariants (payables=0 receivables=1 payments=1 movements=0)';
END $$;

-- ---------------------------------------------------------------------
-- D. Guard bất biến phân loại (§5.3 — BL-016)
-- ---------------------------------------------------------------------
DO $$
DECLARE v_audit_before integer; v_audit_after integer;
BEGIN
  -- D1: sản phẩm đã có lô (p1) -> đổi ngành phải bị chặn.
  BEGIN
    UPDATE public.products
       SET business_line_id = (SELECT id FROM public.business_lines WHERE code = 'OIL')
     WHERE sku = 'VG1540080110';
    RAISE EXCEPTION 'FAIL D1: product with stock changed line without error';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Không được đổi ngành hàng%' THEN
      RAISE EXCEPTION 'FAIL D1: wrong error: %', SQLERRM;
    END IF;
  END;
  -- D2: sản phẩm dầu đã có lô (p3) -> đổi ngành phải bị chặn.
  BEGIN
    UPDATE public.products
       SET business_line_id = (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS')
     WHERE sku = 'OIL-10W40';
    RAISE EXCEPTION 'FAIL D2: oil product with stock changed line without error';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Không được đổi ngành hàng%' THEN
      RAISE EXCEPTION 'FAIL D2: wrong error: %', SQLERRM;
    END IF;
  END;
  -- D3: sản phẩm chưa có giao dịch (p5) -> đổi NULL -> OIL được, ghi kiểm toán,
  -- rồi trả về NULL (khôi phục trạng thái seed).
  SELECT count(*) INTO v_audit_before FROM public.product_business_line_audit
   WHERE product_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  UPDATE public.products
     SET business_line_id = (SELECT id FROM public.business_lines WHERE code = 'OIL')
   WHERE sku = 'STRANGE-1';
  IF (SELECT bl.code FROM public.products p JOIN public.business_lines bl ON bl.id = p.business_line_id
       WHERE p.sku = 'STRANGE-1') <> 'OIL' THEN
    RAISE EXCEPTION 'FAIL D3a: allowed reclassification did not apply';
  END IF;
  UPDATE public.products SET business_line_id = NULL WHERE sku = 'STRANGE-1';
  SELECT count(*) INTO v_audit_after FROM public.product_business_line_audit
   WHERE product_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5' AND source = 'GUARD_TRIGGER';
  IF v_audit_after - v_audit_before <> 2 THEN
    RAISE EXCEPTION 'FAIL D3b: guard audit rows=% (expect 2)', v_audit_after - v_audit_before;
  END IF;
  RAISE NOTICE 'PASS D: immutability guard (BL-016) — transacted products blocked, clean product allowed + audited';
END $$;

-- ---------------------------------------------------------------------
-- E. Guard dòng-chứng từ (§5.4)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  -- E1: thêm dòng OIL vào chứng từ BH-SEED-0001 (AUTO_PARTS) -> chặn.
  BEGIN
    INSERT INTO public.sales_document_lines (id, document_id, product_id, qty, unit_price)
    VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffb1',
            'ffffffff-ffff-ffff-ffff-fffffffffff3',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 1, 50000);
    RAISE EXCEPTION 'FAIL E1: mixed line inserted without error';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Không được trộn ngành hàng%' THEN
      RAISE EXCEPTION 'FAIL E1: wrong error: %', SQLERRM;
    END IF;
  END;
  -- E2: thêm dòng OIL vào chứng từ hỗn hợp BH-SEED-0002 (header NULL) -> cho
  -- (NULL-tolerant ở P1), rồi xoá dòng thử để giữ seed sạch.
  INSERT INTO public.sales_document_lines (id, document_id, product_id, qty, unit_price)
  VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffb1',
          'ffffffff-ffff-ffff-ffff-fffffffffff4',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 1, 50000);
  DELETE FROM public.sales_document_lines WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffb1';
  -- E3: thêm dòng phụ tùng vào phiếu nhập hỗn hợp PN-SEED-0002 (header NULL) -> cho.
  INSERT INTO public.purchase_receipt_items (id, receipt_id, product_id, qty, unit_cost)
  VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeb1',
          'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 1, 200000);
  DELETE FROM public.purchase_receipt_items WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeb1';
  RAISE NOTICE 'PASS E: line-header guard (mismatch blocked, NULL header tolerated)';
END $$;

-- ---------------------------------------------------------------------
-- F. Guard đổi ngành chứng từ (§5.4)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  -- F1: BH-SEED-0001 (AUTO_PARTS) -> OIL: còn dòng phụ tùng -> chặn.
  BEGIN
    UPDATE public.sales_documents
       SET business_line_id = (SELECT id FROM public.business_lines WHERE code = 'OIL')
     WHERE doc_code = 'BH-SEED-0001';
    RAISE EXCEPTION 'FAIL F1: header line change allowed despite mismatched lines';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Không được đổi ngành của chứng từ%' THEN
      RAISE EXCEPTION 'FAIL F1: wrong error: %', SQLERRM;
    END IF;
  END;
  -- F2: PN-SEED-0002 (hỗn hợp) -> AUTO_PARTS: còn dòng OIL -> chặn.
  BEGIN
    UPDATE public.purchase_receipts
       SET business_line_id = (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS')
     WHERE doc_code = 'PN-SEED-0002';
    RAISE EXCEPTION 'FAIL F2: mixed header forced to a line';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Không được đổi ngành của chứng từ%' THEN
      RAISE EXCEPTION 'FAIL F2: wrong error: %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'PASS F: header-change guard';
END $$;

-- ---------------------------------------------------------------------
-- G. Hàm user_can_access_business_line (§6.3 — BL-001/BL-002, mức hàm)
-- ---------------------------------------------------------------------
DO $$
DECLARE v_oil uuid; v_parts uuid;
BEGIN
  SELECT id INTO v_oil FROM public.business_lines WHERE code = 'OIL';
  SELECT id INTO v_parts FROM public.business_lines WHERE code = 'AUTO_PARTS';
  -- Gán sales-oil chỉ OIL (chuẩn bị cho mục H).
  INSERT INTO public.user_business_lines (user_id, business_line_id)
  VALUES ('22222222-2222-2222-2222-222222222222', v_oil)
  ON CONFLICT DO NOTHING;

  IF NOT public.user_can_access_business_line('11111111-1111-1111-1111-111111111111', v_oil) THEN
    RAISE EXCEPTION 'FAIL G1: OWNER cannot access OIL';
  END IF;
  IF NOT public.user_can_access_business_line('66666666-6666-6666-6666-666666666666', v_parts) THEN
    RAISE EXCEPTION 'FAIL G2: CEO cannot access AUTO_PARTS';
  END IF;
  IF NOT public.user_can_access_business_line('22222222-2222-2222-2222-222222222222', v_oil) THEN
    RAISE EXCEPTION 'FAIL G3: OIL-only user cannot access OIL';
  END IF;
  IF public.user_can_access_business_line('22222222-2222-2222-2222-222222222222', v_parts) THEN
    RAISE EXCEPTION 'FAIL G4: OIL-only user CAN access AUTO_PARTS (BL-001)';
  END IF;
  -- User chưa gán ngành nào -> tương thích P1: thấy toàn bộ.
  IF NOT public.user_can_access_business_line('33333333-3333-3333-3333-333333333333', v_parts) THEN
    RAISE EXCEPTION 'FAIL G5: unassigned user blocked (P1 compatibility broken)';
  END IF;
  -- User không có profile -> false.
  IF public.user_can_access_business_line('00000000-0000-4000-8000-000000000000', v_oil) THEN
    RAISE EXCEPTION 'FAIL G6: ghost user can access a line';
  END IF;
  -- Ngành NULL (chưa phân loại) -> cho qua (legacy).
  IF NOT public.user_can_access_business_line('22222222-2222-2222-2222-222222222222', NULL) THEN
    RAISE EXCEPTION 'FAIL G7: unclassified line hidden from assigned user';
  END IF;
  RAISE NOTICE 'PASS G: user_can_access_business_line (OWNER/CEO all, OIL-only denied AUTO_PARTS, unassigned legacy-open, ghost denied)';
END $$;

-- ---------------------------------------------------------------------
-- H. v_batches_for_sales theo role (§6.5 — BL-001/BL-002, mức view)
--    Seed có 2 lô: batch1 AUTO_PARTS (p1), batch2 OIL (p3).
-- ---------------------------------------------------------------------
-- H0: không JWT -> 0 dòng (fail-closed).
DO $$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.v_batches_for_sales;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL H0: no-JWT sees % rows', v_n; END IF;
  RAISE NOTICE 'PASS H0: no JWT sees 0 rows';
END $$;

-- H1: sales-oil (chỉ OIL) -> chỉ 1 lô OIL, không thấy AUTO_PARTS, không có cột giá vốn.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
DO $$
DECLARE v_n bigint; v_oil_n bigint; v_parts_n bigint;
BEGIN
  IF public.current_app_role() IS DISTINCT FROM 'SALES'::public.app_role THEN
    RAISE EXCEPTION 'FAIL H1a: role simulation not SALES';
  END IF;
  SELECT count(*) INTO v_n FROM public.v_batches_for_sales;
  SELECT count(*) INTO v_oil_n FROM public.v_batches_for_sales WHERE business_line_code = 'OIL';
  SELECT count(*) INTO v_parts_n FROM public.v_batches_for_sales WHERE business_line_code = 'AUTO_PARTS';
  IF v_n <> 1 OR v_oil_n <> 1 OR v_parts_n <> 0 THEN
    RAISE EXCEPTION 'FAIL H1b: OIL-only user sees total=% oil=% parts=% (expect 1/1/0)', v_n, v_oil_n, v_parts_n;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'v_batches_for_sales'
               AND column_name IN ('unit_cost', 'consignment_price')) THEN
    RAISE EXCEPTION 'FAIL H1c: cost column leaked in sales view';
  END IF;
  RAISE NOTICE 'PASS H1: OIL-only SALES sees 1 OIL batch, 0 AUTO_PARTS, no cost columns';
END $$;
ROLLBACK;

-- H2: sales-none (chưa gán) -> tương thích P1: thấy cả 2 lô.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
DO $$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.v_batches_for_sales;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL H2: unassigned SALES sees % rows (expect 2)', v_n; END IF;
  RAISE NOTICE 'PASS H2: unassigned SALES sees all 2 batches (P1 compatibility)';
END $$;
ROLLBACK;

-- H3: CEO -> cả 2 lô (chỉ xem, gộp toàn doanh nghiệp).
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
DO $$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.v_batches_for_sales;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL H3: CEO sees % rows (expect 2)', v_n; END IF;
  RAISE NOTICE 'PASS H3: CEO sees all 2 batches';
END $$;
ROLLBACK;

-- H4: OWNER -> cả 2 lô.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
DO $$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.v_batches_for_sales;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL H4: OWNER sees % rows (expect 2)', v_n; END IF;
  RAISE NOTICE 'PASS H4: OWNER sees all 2 batches';
END $$;
ROLLBACK;

-- H5: user đã đăng nhập nhưng không có profile TVK -> 0 dòng (guard 0024 giữ nguyên).
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000000', true);
DO $$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.v_batches_for_sales;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL H5: profile-less user sees % rows', v_n; END IF;
  RAISE NOTICE 'PASS H5: authenticated user without TVK profile sees 0 rows';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------
-- I. RLS trên bảng mới (§6.2, §6.4)
-- ---------------------------------------------------------------------
-- I1: SALES không tự gán phân quyền cho mình (chỉ OWNER).
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.user_business_lines (user_id, business_line_id)
    VALUES ('33333333-3333-3333-3333-333333333333',
            (SELECT id FROM public.business_lines WHERE code = 'OIL'));
    RAISE EXCEPTION 'FAIL I1: SALES self-assigned a business line';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS I1: SALES self-assign blocked (42501)';
  WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'FAIL I1: wrong error % %', SQLSTATE, SQLERRM; END IF;
    RAISE NOTICE 'PASS I1: SALES self-assign blocked (42501)';
  END;
  -- I2: SALES vẫn đọc được danh mục ngành (cần cho bộ chọn ngành P2).
  IF (SELECT count(*) FROM public.business_lines) <> 2 THEN
    RAISE EXCEPTION 'FAIL I2: SALES cannot read business_lines';
  END IF;
  RAISE NOTICE 'PASS I2: SALES reads business_lines (2 rows)';
END $$;
ROLLBACK;

-- I3: SALES không tạo được ngành mới (chỉ OWNER).
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.business_lines (code, name) VALUES ('TEST', 'Test');
    RAISE EXCEPTION 'FAIL I3: SALES created a business line';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS I3: SALES create business_line blocked (42501)';
  WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'FAIL I3: wrong error % %', SQLSTATE, SQLERRM; END IF;
    RAISE NOTICE 'PASS I3: SALES create business_line blocked (42501)';
  END;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------
-- J. Cấu trúc: sales_orders KHÔNG có business_line_id (§5.4 E2);
--    7 bảng chứng từ CÓ cột; products CÓ cột.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'sales_orders'
               AND column_name = 'business_line_id') THEN
    RAISE EXCEPTION 'FAIL J1: sales_orders has business_line_id (must stay neutral)';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'business_line_id'
        AND table_name IN ('products', 'purchase_receipts', 'consignment_receipts',
          'consignment_out_slips', 'consumption_reports', 'allocation_slips',
          'sales_documents', 'return_documents')) <> 8 THEN
    RAISE EXCEPTION 'FAIL J2: business_line_id missing on some table (expect 8)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'business_lines') THEN
    RAISE EXCEPTION 'FAIL J3: business_lines missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'user_business_lines') THEN
    RAISE EXCEPTION 'FAIL J4: user_business_lines missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'product_business_line_audit') THEN
    RAISE EXCEPTION 'FAIL J5: product_business_line_audit missing';
  END IF;
  RAISE NOTICE 'PASS J: structure (sales_orders neutral, 8 tables carry business_line_id)';
END $$;

-- Dọn assignment thử (giữ DB test sạch cho lần chạy sau).
DELETE FROM public.user_business_lines WHERE user_id = '22222222-2222-2222-2222-222222222222';

SELECT 'P1 LOCAL TESTS: ALL PASS' AS result;
