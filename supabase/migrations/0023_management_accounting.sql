-- =====================================================================
-- 0023_management_accounting.sql — Sổ Quản Trị Độc Lập & Đối Chiếu Kế Toán 2 Tầng
-- Bổ sung:
--  1. opening_balance_date cho cash_funds & siết RLS ghi chỉ OWNER.
--  2. cash_categories: danh mục thu/chi vận hành ngoài công nợ (12 khoản mặc định).
--  3. Mở rộng cash_movements: thu/chi vận hành, chuyển quỹ nội bộ (đối ứng 2 chân),
--     bút toán đảo và lý do huỷ bảo toàn dấu vết.
--  4. Phân hệ đối chiếu kế toán: reconciliation_periods, reconciliation_entries,
--     reconciliation_snapshots.
--  5. RLS policies phân quyền chặt chẽ: OWNER toàn quyền, CEO chỉ xem,
--     ACCOUNTING xem sổ quỹ/đối chiếu + nhập giải trình, SALES/WAREHOUSE bị chặn.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. NÂNG CẤP CASH_FUNDS
-- ---------------------------------------------------------------------
ALTER TABLE public.cash_funds
  ADD COLUMN IF NOT EXISTS opening_balance_date date NOT NULL DEFAULT '2026-01-01';

-- Siết RLS ghi của cash_funds: chỉ OWNER được tạo/sửa quỹ tiền
DROP POLICY IF EXISTS pol_cash_funds_ins ON public.cash_funds;
DROP POLICY IF EXISTS pol_cash_funds_upd ON public.cash_funds;

CREATE POLICY pol_cash_funds_ins ON public.cash_funds FOR INSERT TO authenticated
  WITH CHECK (current_app_role() = 'OWNER');

CREATE POLICY pol_cash_funds_upd ON public.cash_funds FOR UPDATE TO authenticated
  USING (current_app_role() = 'OWNER')
  WITH CHECK (current_app_role() = 'OWNER');

-- ---------------------------------------------------------------------
-- 2. BẢNG DANH MỤC THU / CHI VẬN HÀNH (CASH_CATEGORIES)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cash_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('IN', 'OUT')), -- Thu / Chi
  group_key       text NOT NULL CHECK (group_key IN ('SALARY', 'RENT', 'TRANSPORT', 'TAX', 'OTHER')),
  is_fixed        boolean NOT NULL DEFAULT false, -- Chi phí cố định dự kiến
  monthly_budget  numeric(15,2) NOT NULL DEFAULT 0, -- Ngân sách ước tính hàng tháng
  is_active       boolean NOT NULL DEFAULT true, -- OWNER bật/tắt
  is_system       boolean NOT NULL DEFAULT false, -- Khoản mục mặc định hệ thống
  created_by      uuid REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_cash_categories_updated ON public.cash_categories;
CREATE TRIGGER trg_cash_categories_updated BEFORE UPDATE ON public.cash_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.cash_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_cash_categories_sel ON public.cash_categories;
CREATE POLICY pol_cash_categories_sel ON public.cash_categories FOR SELECT TO authenticated
  USING (current_app_role() = ANY (ARRAY['OWNER','ACCOUNTING','CEO']::app_role[]));

DROP POLICY IF EXISTS pol_cash_categories_ins ON public.cash_categories;
CREATE POLICY pol_cash_categories_ins ON public.cash_categories FOR INSERT TO authenticated
  WITH CHECK (current_app_role() = 'OWNER');

DROP POLICY IF EXISTS pol_cash_categories_upd ON public.cash_categories;
CREATE POLICY pol_cash_categories_upd ON public.cash_categories FOR UPDATE TO authenticated
  USING (current_app_role() = 'OWNER')
  WITH CHECK (current_app_role() = 'OWNER');

DROP POLICY IF EXISTS pol_cash_categories_del ON public.cash_categories;
CREATE POLICY pol_cash_categories_del ON public.cash_categories FOR DELETE TO authenticated
  USING (current_app_role() = 'OWNER' AND NOT is_system);

-- Seed 12 khoản mục thu/chi mặc định
INSERT INTO public.cash_categories (code, name, kind, group_key, is_fixed, monthly_budget, is_system)
VALUES
  ('THU_LAI', 'Thu lãi tiền gửi ngân hàng', 'IN', 'OTHER', false, 0, true),
  ('THU_THANH_LY', 'Thu thanh lý phụ tùng cũ / tài sản', 'IN', 'OTHER', false, 0, true),
  ('THU_HOAN_UNG', 'Thu hoàn ứng / tạm ứng nhân sự', 'IN', 'OTHER', false, 0, true),
  ('THU_KHAC', 'Thu hoạt động khác ngoài công nợ', 'IN', 'OTHER', false, 0, true),
  ('CHI_LUONG', 'Lương và phụ cấp nhân sự', 'OUT', 'SALARY', true, 0, true),
  ('CHI_MAT_BANG', 'Tiền thuê mặt bằng, kho bãi', 'OUT', 'RENT', true, 0, true),
  ('CHI_VAN_CHUYEN', 'Chi phí vận chuyển & giao nhận', 'OUT', 'TRANSPORT', false, 0, true),
  ('CHI_THUE_PHI', 'Tiền thuế, phí & lệ phí nhà nước', 'OUT', 'TAX', false, 0, true),
  ('CHI_DIEN_NUOC', 'Tiền điện, nước, internet, viễn thông', 'OUT', 'OTHER', true, 0, true),
  ('CHI_SUA_CHUA', 'Sửa chữa, bảo trì kho và trang thiết bị', 'OUT', 'OTHER', false, 0, true),
  ('CHI_TIEP_KHACH', 'Chi phí tiếp khách, văn phòng phẩm', 'OUT', 'OTHER', false, 0, true),
  ('CHI_KHAC', 'Chi phí vận hành khác', 'OUT', 'OTHER', false, 0, true)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. MỞ RỘNG CASH_MOVEMENTS
-- ---------------------------------------------------------------------
ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS movement_kind text NOT NULL DEFAULT 'DEBT_PAYMENT'
    CHECK (movement_kind IN ('DEBT_PAYMENT', 'OPERATING', 'INTERNAL_TRANSFER', 'REVERSAL')),
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.cash_categories(id),
  ADD COLUMN IF NOT EXISTS transfer_id uuid,
  ADD COLUMN IF NOT EXISTS counter_fund_id uuid REFERENCES public.cash_funds(id),
  ADD COLUMN IF NOT EXISTS counter_movement_id uuid REFERENCES public.cash_movements(id),
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS is_cancelled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reversal_of_id uuid REFERENCES public.cash_movements(id),
  ADD COLUMN IF NOT EXISTS reversal_entry_id uuid REFERENCES public.cash_movements(id);

-- RLS ghi cho cash_movements: chỉ OWNER được ghi trực tiếp
DROP POLICY IF EXISTS pol_cash_movements_ins ON public.cash_movements;
CREATE POLICY pol_cash_movements_ins ON public.cash_movements FOR INSERT TO authenticated
  WITH CHECK (current_app_role() = 'OWNER');

DROP POLICY IF EXISTS pol_cash_movements_upd ON public.cash_movements;
CREATE POLICY pol_cash_movements_upd ON public.cash_movements FOR UPDATE TO authenticated
  USING (current_app_role() = 'OWNER')
  WITH CHECK (current_app_role() = 'OWNER');

-- Cập nhật view v_cash_fund_balances (DROP trước để đổi thứ tự cột an toàn trong Postgres)
DROP VIEW IF EXISTS public.v_cash_fund_balances CASCADE;
CREATE OR REPLACE VIEW public.v_cash_fund_balances AS
SELECT f.id AS fund_id, f.name AS fund_name, f.kind, f.opening_balance, f.opening_balance_date, f.is_active,
  coalesce(sum(m.amount) FILTER (WHERE m.amount > 0 AND (NOT m.is_cancelled OR m.is_cancelled IS NULL) AND coalesce(m.movement_kind, 'DEBT_PAYMENT') <> 'REVERSAL'), 0) AS total_in,
  coalesce(-sum(m.amount) FILTER (WHERE m.amount < 0 AND (NOT m.is_cancelled OR m.is_cancelled IS NULL) AND coalesce(m.movement_kind, 'DEBT_PAYMENT') <> 'REVERSAL'), 0) AS total_out,
  f.opening_balance + coalesce(sum(m.amount), 0) AS balance
FROM public.cash_funds f
LEFT JOIN public.cash_movements m ON m.fund_id = f.id
GROUP BY f.id, f.name, f.kind, f.opening_balance, f.opening_balance_date, f.is_active;

ALTER VIEW public.v_cash_fund_balances SET (security_invoker = true);

-- Hàm chuyển quỹ nội bộ (tự tạo 2 dòng đối ứng trên cash_movements)
CREATE OR REPLACE FUNCTION public.transfer_internal_cash_funds(
  p_source_fund_id uuid,
  p_dest_fund_id uuid,
  p_amount numeric(15,2),
  p_transfer_date date,
  p_note text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_transfer_id uuid := gen_random_uuid();
  v_source_mov_id uuid;
  v_dest_mov_id uuid;
BEGIN
  IF current_app_role() IS NULL OR current_app_role() <> 'OWNER' THEN
    RAISE EXCEPTION 'Chỉ Chủ cửa hàng mới được thực hiện chuyển quỹ nội bộ.';
  END IF;
  IF p_source_fund_id = p_dest_fund_id THEN
    RAISE EXCEPTION 'Quỹ nguồn và quỹ đích không được trùng nhau.';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Số tiền chuyển quỹ phải lớn hơn 0.';
  END IF;

  -- 1. Tiền ra khỏi quỹ nguồn (−)
  INSERT INTO public.cash_movements (
    fund_id, movement_kind, amount, movement_date,
    transfer_id, counter_fund_id, note, created_by
  ) VALUES (
    p_source_fund_id, 'INTERNAL_TRANSFER', -p_amount, p_transfer_date,
    v_transfer_id, p_dest_fund_id, coalesce(p_note, 'Chuyển quỹ nội bộ'), auth.uid()
  ) RETURNING id INTO v_source_mov_id;

  -- 2. Tiền vào quỹ đích (+)
  INSERT INTO public.cash_movements (
    fund_id, movement_kind, amount, movement_date,
    transfer_id, counter_fund_id, counter_movement_id, note, created_by
  ) VALUES (
    p_dest_fund_id, 'INTERNAL_TRANSFER', p_amount, p_transfer_date,
    v_transfer_id, p_source_fund_id, v_source_mov_id, coalesce(p_note, 'Chuyển quỹ nội bộ'), auth.uid()
  ) RETURNING id INTO v_dest_mov_id;

  UPDATE public.cash_movements SET counter_movement_id = v_dest_mov_id WHERE id = v_source_mov_id;

  RETURN v_transfer_id;
END $$;

-- Hàm huỷ phiếu & tạo bút toán đảo (Reversal entry)
CREATE OR REPLACE FUNCTION public.cancel_cash_movement_reversal(
  p_movement_id uuid,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_orig record;
  v_reversal_id uuid;
  v_counter_orig record;
  v_counter_reversal_id uuid;
BEGIN
  IF current_app_role() IS NULL OR current_app_role() <> 'OWNER' THEN
    RAISE EXCEPTION 'Chỉ Chủ cửa hàng mới có quyền huỷ phiếu và tạo bút toán đảo.';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Bắt buộc phải nhập lý do huỷ phiếu.';
  END IF;

  SELECT * INTO v_orig FROM public.cash_movements WHERE id = p_movement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy giao dịch quỹ cần huỷ.';
  END IF;
  IF v_orig.is_cancelled THEN
    RAISE EXCEPTION 'Giao dịch này đã được huỷ trước đó.';
  END IF;
  IF v_orig.movement_kind = 'REVERSAL' THEN
    RAISE EXCEPTION 'Không thể huỷ một bút toán đảo.';
  END IF;

  -- 1. Tạo bút toán đảo
  INSERT INTO public.cash_movements (
    fund_id, movement_kind, amount, movement_date,
    category_id, payment_id, transfer_id, counter_fund_id,
    reversal_of_id, note, created_by
  ) VALUES (
    v_orig.fund_id, 'REVERSAL', -v_orig.amount, current_date,
    v_orig.category_id, v_orig.payment_id, v_orig.transfer_id, v_orig.counter_fund_id,
    v_orig.id, 'Bút toán đảo huỷ: ' || coalesce(v_orig.note, '') || ' (Lý do: ' || trim(p_reason) || ')', auth.uid()
  ) RETURNING id INTO v_reversal_id;

  -- 2. Ghi nhận huỷ trên dòng gốc
  UPDATE public.cash_movements
     SET is_cancelled = true,
         cancel_reason = trim(p_reason),
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         reversal_entry_id = v_reversal_id
   WHERE id = v_orig.id;

  -- 3. Nếu là chuyển quỹ, tự động đảo luôn chân đối ứng
  IF v_orig.movement_kind = 'INTERNAL_TRANSFER' AND v_orig.counter_movement_id IS NOT NULL THEN
    SELECT * INTO v_counter_orig FROM public.cash_movements WHERE id = v_orig.counter_movement_id FOR UPDATE;
    IF FOUND AND NOT v_counter_orig.is_cancelled THEN
      INSERT INTO public.cash_movements (
        fund_id, movement_kind, amount, movement_date,
        transfer_id, counter_fund_id, reversal_of_id, note, created_by
      ) VALUES (
        v_counter_orig.fund_id, 'REVERSAL', -v_counter_orig.amount, current_date,
        v_counter_orig.transfer_id, v_counter_orig.counter_fund_id,
        v_counter_orig.id, 'Bút toán đảo đối ứng chuyển quỹ (Lý do: ' || trim(p_reason) || ')', auth.uid()
      ) RETURNING id INTO v_counter_reversal_id;

      UPDATE public.cash_movements
         SET is_cancelled = true,
             cancel_reason = trim(p_reason),
             cancelled_at = now(),
             cancelled_by = auth.uid(),
             reversal_entry_id = v_counter_reversal_id
       WHERE id = v_counter_orig.id;
    END IF;
  END IF;

  -- 4. Nếu là thanh toán công nợ, phục hồi số dư công nợ
  IF v_orig.payment_id IS NOT NULL THEN
    DECLARE
      v_pmt record;
    BEGIN
      SELECT * INTO v_pmt FROM public.payments WHERE id = v_orig.payment_id;
      IF FOUND THEN
        IF v_pmt.payable_id IS NOT NULL THEN
          UPDATE public.supplier_payables
             SET amount_paid = greatest(amount_paid - v_pmt.amount, 0),
                 status = CASE
                   WHEN greatest(amount_paid - v_pmt.amount, 0) = 0 THEN 'UNPAID'::balance_status
                   ELSE 'PARTIAL'::balance_status
                 END
           WHERE id = v_pmt.payable_id;
        ELSIF v_pmt.receivable_id IS NOT NULL THEN
          UPDATE public.partner_receivables
             SET amount_paid = greatest(amount_paid - v_pmt.amount, 0),
                 status = CASE
                   WHEN greatest(amount_paid - v_pmt.amount, 0) = 0 THEN 'UNPAID'::balance_status
                   ELSE 'PARTIAL'::balance_status
                 END
           WHERE id = v_pmt.receivable_id;
        END IF;
      END IF;
    END;
  END IF;

  RETURN v_reversal_id;
END $$;

-- ---------------------------------------------------------------------
-- 4. PHÂN HỆ ĐỐI CHIẾU KẾ TOÁN 2 TẦNG (RECONCILIATION)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reconciliation_periods (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_type  text NOT NULL CHECK (period_type IN ('MONTH', 'WEEK', 'CUSTOM')),
  name         text NOT NULL,
  from_date    date NOT NULL,
  to_date      date NOT NULL,
  status       text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RECONCILED', 'LOCKED')),
  note         text,
  created_by   uuid REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_reconciliation_period_dates CHECK (to_date >= from_date)
);

DROP TRIGGER IF EXISTS trg_reconciliation_periods_updated ON public.reconciliation_periods;
CREATE TRIGGER trg_reconciliation_periods_updated BEFORE UPDATE ON public.reconciliation_periods
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.reconciliation_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id           uuid NOT NULL REFERENCES public.reconciliation_periods(id) ON DELETE CASCADE,
  data_group          text NOT NULL CHECK (data_group IN (
                        'CASH_FUND',       -- (1) Quỹ tiền két / ngân hàng
                        'RECEIVABLE',      -- (2) Phải thu đối tác
                        'PAYABLE',         -- (3) Phải trả nhà cung cấp
                        'INVENTORY',       -- (4) Tồn kho tổng hợp
                        'REVENUE_EXPENSE'  -- (5) Doanh thu & Chi phí nhóm gọn
                      )),
  item_key            text NOT NULL,
  item_name           text NOT NULL,
  item_subtext        text,
  tvk_amount          numeric(15,2) NOT NULL DEFAULT 0,
  accounting_amount   numeric(15,2) NOT NULL DEFAULT 0,
  difference_amount   numeric(15,2) NOT NULL DEFAULT 0,
  discrepancy_status  text NOT NULL DEFAULT 'PENDING' CHECK (discrepancy_status IN (
                        'MATCHED',             -- Đã khớp
                        'PENDING',             -- Chờ giải trình
                        'VALID_TAX_TIMING',    -- Lệch hợp lệ (Thuế vs Nội bộ)
                        'ACCOUNTING_ERROR',    -- Lỗi bên kế toán
                        'TVK_ERROR'            -- Lỗi bên TVK
                      )),
  explanation_note    text,
  drilldown_data      jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, data_group, item_key)
);

CREATE OR REPLACE FUNCTION public.calc_reconciliation_difference() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  new.difference_amount := coalesce(new.tvk_amount, 0) - coalesce(new.accounting_amount, 0);
  IF abs(new.difference_amount) < 0.01 THEN
    new.discrepancy_status := 'MATCHED';
  ELSE
    IF new.discrepancy_status = 'MATCHED' THEN
      new.discrepancy_status := 'PENDING';
    END IF;
  END IF;
  new.updated_at := now();
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS trg_reconciliation_entries_diff ON public.reconciliation_entries;
CREATE TRIGGER trg_reconciliation_entries_diff
BEFORE INSERT OR UPDATE ON public.reconciliation_entries
FOR EACH ROW EXECUTE FUNCTION public.calc_reconciliation_difference();

CREATE TABLE IF NOT EXISTS public.reconciliation_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id      uuid NOT NULL REFERENCES public.reconciliation_periods(id) ON DELETE CASCADE,
  snapshot_no    integer NOT NULL DEFAULT 1,
  name           text NOT NULL,
  period_name    text NOT NULL,
  from_date      date NOT NULL,
  to_date        date NOT NULL,
  total_tvk      numeric(15,2) NOT NULL DEFAULT 0,
  total_acc      numeric(15,2) NOT NULL DEFAULT 0,
  total_diff     numeric(15,2) NOT NULL DEFAULT 0,
  summary        jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  note           text,
  created_by     uuid REFERENCES public.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- RLS Phân hệ Đối chiếu
ALTER TABLE public.reconciliation_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_snapshots ENABLE ROW LEVEL SECURITY;

-- Periods
DROP POLICY IF EXISTS pol_reconciliation_periods_sel ON public.reconciliation_periods;
CREATE POLICY pol_reconciliation_periods_sel ON public.reconciliation_periods FOR SELECT TO authenticated
  USING (current_app_role() = ANY (ARRAY['OWNER','ACCOUNTING','CEO']::app_role[]));

DROP POLICY IF EXISTS pol_reconciliation_periods_ins ON public.reconciliation_periods;
CREATE POLICY pol_reconciliation_periods_ins ON public.reconciliation_periods FOR INSERT TO authenticated
  WITH CHECK (current_app_role() = 'OWNER');

DROP POLICY IF EXISTS pol_reconciliation_periods_upd ON public.reconciliation_periods;
CREATE POLICY pol_reconciliation_periods_upd ON public.reconciliation_periods FOR UPDATE TO authenticated
  USING (current_app_role() = 'OWNER') WITH CHECK (current_app_role() = 'OWNER');

DROP POLICY IF EXISTS pol_reconciliation_periods_del ON public.reconciliation_periods;
CREATE POLICY pol_reconciliation_periods_del ON public.reconciliation_periods FOR DELETE TO authenticated
  USING (current_app_role() = 'OWNER');

-- Entries: ACCOUNTING được cập nhật số liệu KT & ghi chú giải trình
DROP POLICY IF EXISTS pol_reconciliation_entries_sel ON public.reconciliation_entries;
CREATE POLICY pol_reconciliation_entries_sel ON public.reconciliation_entries FOR SELECT TO authenticated
  USING (current_app_role() = ANY (ARRAY['OWNER','ACCOUNTING','CEO']::app_role[]));

DROP POLICY IF EXISTS pol_reconciliation_entries_ins ON public.reconciliation_entries;
CREATE POLICY pol_reconciliation_entries_ins ON public.reconciliation_entries FOR INSERT TO authenticated
  WITH CHECK (current_app_role() = 'OWNER');

DROP POLICY IF EXISTS pol_reconciliation_entries_upd ON public.reconciliation_entries;
CREATE POLICY pol_reconciliation_entries_upd ON public.reconciliation_entries FOR UPDATE TO authenticated
  USING (current_app_role() = ANY (ARRAY['OWNER','ACCOUNTING']::app_role[]))
  WITH CHECK (current_app_role() = ANY (ARRAY['OWNER','ACCOUNTING']::app_role[]));

DROP POLICY IF EXISTS pol_reconciliation_entries_del ON public.reconciliation_entries;
CREATE POLICY pol_reconciliation_entries_del ON public.reconciliation_entries FOR DELETE TO authenticated
  USING (current_app_role() = 'OWNER');

-- Snapshots: Chỉ OWNER tạo bản chốt
DROP POLICY IF EXISTS pol_reconciliation_snapshots_sel ON public.reconciliation_snapshots;
CREATE POLICY pol_reconciliation_snapshots_sel ON public.reconciliation_snapshots FOR SELECT TO authenticated
  USING (current_app_role() = ANY (ARRAY['OWNER','ACCOUNTING','CEO']::app_role[]));

DROP POLICY IF EXISTS pol_reconciliation_snapshots_ins ON public.reconciliation_snapshots;
CREATE POLICY pol_reconciliation_snapshots_ins ON public.reconciliation_snapshots FOR INSERT TO authenticated
  WITH CHECK (current_app_role() = 'OWNER');

DROP POLICY IF EXISTS pol_reconciliation_snapshots_upd ON public.reconciliation_snapshots;
CREATE POLICY pol_reconciliation_snapshots_upd ON public.reconciliation_snapshots FOR UPDATE TO authenticated
  USING (current_app_role() = 'OWNER') WITH CHECK (current_app_role() = 'OWNER');

DROP POLICY IF EXISTS pol_reconciliation_snapshots_del ON public.reconciliation_snapshots;
CREATE POLICY pol_reconciliation_snapshots_del ON public.reconciliation_snapshots FOR DELETE TO authenticated
  USING (current_app_role() = 'OWNER');

-- Hàm chốt kỳ đối chiếu (Lưu snapshot lịch sử)
CREATE OR REPLACE FUNCTION public.create_reconciliation_snapshot(
  p_period_id uuid,
  p_name text,
  p_note text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period record;
  v_next_no integer;
  v_items jsonb;
  v_tot_tvk numeric(15,2);
  v_tot_acc numeric(15,2);
  v_tot_diff numeric(15,2);
  v_summary jsonb;
  v_snapshot_id uuid;
BEGIN
  IF current_app_role() IS NULL OR current_app_role() <> 'OWNER' THEN
    RAISE EXCEPTION 'Chỉ Chủ cửa hàng mới có quyền chốt kỳ đối chiếu.';
  END IF;

  SELECT * INTO v_period FROM public.reconciliation_periods WHERE id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy kỳ đối chiếu %', p_period_id; END IF;

  SELECT coalesce(max(snapshot_no), 0) + 1 INTO v_next_no
    FROM public.reconciliation_snapshots WHERE period_id = p_period_id;

  SELECT coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb),
         coalesce(sum(e.tvk_amount) FILTER (WHERE e.item_key NOT IN ('REV_TOTAL', 'INV_CONSIGNED_REF')), 0),
         coalesce(sum(e.accounting_amount) FILTER (WHERE e.item_key NOT IN ('REV_TOTAL', 'INV_CONSIGNED_REF')), 0),
         coalesce(sum(e.difference_amount) FILTER (WHERE e.item_key NOT IN ('REV_TOTAL', 'INV_CONSIGNED_REF')), 0)
    INTO v_items, v_tot_tvk, v_tot_acc, v_tot_diff
    FROM public.reconciliation_entries e
   WHERE e.period_id = p_period_id;

  SELECT jsonb_build_object(
    'total_entries', count(*),
    'matched_count', count(*) FILTER (WHERE discrepancy_status = 'MATCHED'),
    'pending_count', count(*) FILTER (WHERE discrepancy_status = 'PENDING'),
    'explained_count', count(*) FILTER (WHERE discrepancy_status NOT IN ('MATCHED', 'PENDING')),
    'by_group', coalesce((
      SELECT jsonb_object_agg(
        g.data_group,
        jsonb_build_object('tvk', g.tvk, 'acc', g.acc, 'diff', g.diff)
      )
      FROM (
        SELECT data_group,
               coalesce(sum(tvk_amount) FILTER (WHERE item_key NOT IN ('REV_TOTAL', 'INV_CONSIGNED_REF')), 0) AS tvk,
               coalesce(sum(accounting_amount) FILTER (WHERE item_key NOT IN ('REV_TOTAL', 'INV_CONSIGNED_REF')), 0) AS acc,
               coalesce(sum(difference_amount) FILTER (WHERE item_key NOT IN ('REV_TOTAL', 'INV_CONSIGNED_REF')), 0) AS diff
        FROM public.reconciliation_entries
        WHERE period_id = p_period_id
        GROUP BY data_group
      ) g
    ), '{}'::jsonb)
  ) INTO v_summary
  FROM public.reconciliation_entries
  WHERE period_id = p_period_id;

  INSERT INTO public.reconciliation_snapshots (
    period_id, snapshot_no, name, period_name, from_date, to_date,
    total_tvk, total_acc, total_diff, summary, snapshot_items, note, created_by
  ) VALUES (
    p_period_id, v_next_no, coalesce(p_name, v_period.name || ' - Bản chốt ' || v_next_no),
    v_period.name, v_period.from_date, v_period.to_date,
    v_tot_tvk, v_tot_acc, v_tot_diff, coalesce(v_summary, '{}'::jsonb),
    v_items, p_note, auth.uid()
  ) RETURNING id INTO v_snapshot_id;

  UPDATE public.reconciliation_periods SET status = 'RECONCILED', updated_at = now() WHERE id = p_period_id;

  RETURN v_snapshot_id;
END $$;

COMMIT;
