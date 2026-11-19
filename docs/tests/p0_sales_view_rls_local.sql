-- Run ONLY against restored Supabase LOCAL DB after 0020 and 0021.
-- psql -v ON_ERROR_STOP=1 -f docs/tests/p0_sales_view_rls_local.sql
-- This test does not modify business data.
SELECT id AS sales_id FROM public.profiles WHERE role='SALES' AND is_active = true LIMIT 1
\gset
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'sales_id', true);
DO $$
DECLARE v_visible bigint; v_direct bigint;
BEGIN
  IF public.current_app_role() IS DISTINCT FROM 'SALES'::public.app_role THEN
    RAISE EXCEPTION 'FAIL: SALES role simulation';
  END IF;
  SELECT count(*) INTO v_visible FROM public.v_batches_for_sales;
  SELECT count(*) INTO v_direct FROM public.stock_batches;
  IF v_visible = 0 THEN RAISE EXCEPTION 'FAIL: SALES cannot see permitted stock'; END IF;
  IF v_direct <> 0 THEN RAISE EXCEPTION 'FAIL: SALES can directly read stock_batches'; END IF;
  RAISE NOTICE 'PASS: SALES sees % view rows and 0 direct batch rows', v_visible;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000000', true);
DO $$
DECLARE v_visible bigint;
BEGIN
  SELECT count(*) INTO v_visible FROM public.v_batches_for_sales;
  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'FAIL: authenticated user without TVK profile sees % stock rows', v_visible;
  END IF;
  RAISE NOTICE 'PASS: authenticated user without TVK profile sees 0 stock rows';
END $$;
ROLLBACK;

-- Check no cost field is projected by this view.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='v_batches_for_sales'
               AND column_name IN ('unit_cost','consignment_price')) THEN
    RAISE EXCEPTION 'FAIL: cost column leaked in sales view';
  END IF;
  RAISE NOTICE 'PASS: sales stock view has no cost columns';
END $$;
