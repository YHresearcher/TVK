-- =====================================================================
-- 0027_payment_allocations_reversal.sql — TVK V2.0 P3: Payment
-- Architecture + Reversal (theo Prompt-TVK-V2.0-FINAL.md §11, §12, §20 P3).
--
-- Mục tiêu: mọi đồng tiền thu/chi công nợ đều có phân bổ tường minh theo
-- chứng từ + ngành (payment_allocations); đảo bút toán là phiếu mới
-- append-only (payments.reversal_of_id), KHÔNG sửa/xoá phiếu gốc; sổ
-- quỹ được siết ghi trực tiếp (§12.6, BL-022).
--
-- CÁC QUYẾT ĐỊNH ĐÃ CHỐT (không tự bịa):
--   - Overpayment vẫn BỊ CHẶN như trigger 0019 (E6): không có "unapplied
--     cash"; tiền thừa/ứng trước chỉ qua chứng từ tạm ứng/đặt cọc riêng
--     (ngoài phạm vi V2.0).
--   - Cutover ATOMIC trong cùng migration này: viết lại hàm
--     apply_payment_to_balance (cơ chế ghi sổ duy nhất) để vừa ghi phân
--     bổ vừa giữ nguyên logic 0019 (guard trả thừa + thứ tự phân bổ
--     settlement theo ORDER BY id). Không có cửa sổ 2 cơ chế cùng chạy.
--   - Đảo bút toán: CHỈ Kế toán (quyết định kế toán 28/10/2026: chỉ KẾ
--     TOÁN được đảo chứng từ). Đảo toàn bộ phiếu (không đảo từng phần);
--     phiếu đảo có chiều tiền ngược, cùng quỹ, cùng số tiền, cùng công
--     nợ/đợt đối soát với phiếu gốc.
--   - cancel_cash_movement_reversal (0023) CHẮC CHẮN fail với bút toán
--     gắn payment (E7: copy payment_id trong khi UNIQUE) — thiết kế lại:
--     từ chối bút toán gắn payment (đi qua đảo phiếu thanh toán), bỏ bước
--     phục hồi công nợ cũ (nay thuộc reverse_payment), không copy
--     payment_id nữa.
--   - Sổ quỹ: bỏ policy OWNER ghi trực tiếp (BL-022); thu/chi vận hành
--     đi qua RPC record_operating_cash_movement; trigger chặn mọi
--     UPDATE/DELETE ngoài các cột chuyển trạng thái huỷ.
--   - payments bất biến: trigger chặn mọi UPDATE/DELETE (phiếu đã ghi
--     chỉ đảo bằng phiếu mới).
--
-- Backfill: mọi phiếu thanh toán lịch sử đều được tái tạo phân bổ bằng
-- cách replay đúng thuật toán 0019 theo thứ tự (created_at, id); cuối
-- migration kiểm tra bất biến SUM(phân bổ) = amount_paid cho từng khoản
-- công nợ — lệch là FAIL migration (không im lặng xây trên sổ lệch).
-- Live hiện có payments = 0 nên backfill là no-op trên live; kiểm chứng
-- thật nằm ở database scratch (docs/tests/p3_payment_allocations_local.sql).
--
-- KHÔNG chạy trực tiếp lên live trong P3: chạy staging (bản sao live) +
-- đối chiếu trước (prompt §21.5/§21.6).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. payments.reversal_of_id — bút toán đảo tham chiếu phiếu gốc (§12.1)
--    Một phiếu gốc chỉ được đảo đúng một lần (unique partial index).
-- ---------------------------------------------------------------------
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS reversal_of_id uuid REFERENCES public.payments(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_one_reversal
  ON public.payments (reversal_of_id) WHERE reversal_of_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_reversal_of ON public.payments (reversal_of_id);

COMMENT ON COLUMN public.payments.reversal_of_id IS
  'P3: phiếu này là bút toán đảo của phiếu gốc (cùng số tiền, chiều tiền ngược, cùng quỹ). NULL = phiếu thường.';

-- ---------------------------------------------------------------------
-- 2. payment_allocations — phân bổ thanh toán theo chứng từ + ngành (§11.3)
--    amount DƯƠNG cho phân bổ thường, ÂM cho phân bổ đảo (mirror row, ghi
--    reversal_of_id trỏ về phân bổ gốc). Bất biến (§11.8):
--    obligation.amount_paid = SUM(phân bổ hiệu lực) của khoản đó.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         uuid NOT NULL REFERENCES public.payments(id),
  receivable_id      uuid REFERENCES public.partner_receivables(id),
  payable_id         uuid REFERENCES public.supplier_payables(id),
  settlement_id      uuid REFERENCES public.settlements(id),
  settlement_line_id uuid REFERENCES public.settlement_lines(id),
  business_line_id   uuid NOT NULL REFERENCES public.business_lines(id),
  amount             numeric(15,4) NOT NULL,
  reversal_of_id     uuid REFERENCES public.payment_allocations(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_alloc_one_obligation CHECK (
    (receivable_id IS NOT NULL AND payable_id IS NULL) OR
    (receivable_id IS NULL AND payable_id IS NOT NULL)
  ),
  CONSTRAINT chk_alloc_settlement_line CHECK (
    settlement_line_id IS NULL OR settlement_id IS NOT NULL
  ),
  CONSTRAINT chk_alloc_sign CHECK (
    (reversal_of_id IS NULL AND amount > 0) OR
    (reversal_of_id IS NOT NULL AND amount < 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_alloc_payment ON public.payment_allocations (payment_id);
CREATE INDEX IF NOT EXISTS idx_alloc_receivable ON public.payment_allocations (receivable_id);
CREATE INDEX IF NOT EXISTS idx_alloc_payable ON public.payment_allocations (payable_id);
CREATE INDEX IF NOT EXISTS idx_alloc_settlement ON public.payment_allocations (settlement_id);
CREATE INDEX IF NOT EXISTS idx_alloc_line ON public.payment_allocations (business_line_id);
-- Một phiếu chỉ có tối đa 1 phân bổ cho mỗi (khoản công nợ, dòng đối soát):
-- chặn double-count do ghi trùng.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alloc_one_per_obligation_line
  ON public.payment_allocations (payment_id, receivable_id, payable_id, settlement_line_id)
  NULLS NOT DISTINCT;

ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_alloc_sel ON public.payment_allocations;
CREATE POLICY pol_alloc_sel ON public.payment_allocations FOR SELECT TO authenticated
  USING (current_app_role() = ANY (ARRAY['OWNER','ACCOUNTING','CEO']::app_role[]));
-- KHÔNG có policy INSERT/UPDATE/DELETE: chỉ trigger ghi sổ (SECURITY
-- DEFINER) được ghi phân bổ. Không ai sửa tay được phân bổ.

COMMENT ON TABLE public.payment_allocations IS
  'P3 (§11.3): một dòng = một phần tiền của một phiếu áp vào đúng một khoản công nợ, mang ngành của chứng từ gốc. Dòng đảo có amount âm và reversal_of_id.';

-- ---------------------------------------------------------------------
-- 3. tvk_resolve_obligation_line — ngành của khoản công nợ (§11.4)
--    Lấy từ business_line_id của chứng từ gốc; nếu chứng từ gốc chưa có
--    ngành (chứng từ hỗn hợp lịch sử) thì suy ra từ ngành của các dòng
--    hàng trong chứng từ khi chỉ có đúng 1 ngành; vẫn không xác định
--    được thì RAISE (fail-closed: phân loại chứng từ gốc trước).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tvk_resolve_obligation_line(
  p_payable_id uuid,
  p_receivable_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_doc_id uuid;
  v_receipt_id uuid;
  v_kind text;
  v_line uuid;
  v_cnt integer;
BEGIN
  IF (p_payable_id IS NULL) = (p_receivable_id IS NULL) THEN
    RAISE EXCEPTION 'tvk_resolve_obligation_line: phải cho đúng một trong payable_id / receivable_id.';
  END IF;

  IF p_receivable_id IS NOT NULL THEN
    SELECT source_document_id INTO v_doc_id
      FROM public.partner_receivables WHERE id = p_receivable_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Không tìm thấy khoản phải thu %', p_receivable_id;
    END IF;
    v_kind := 'SALES';
  ELSE
    SELECT source_kind, source_document_id, purchase_receipt_id
      INTO v_kind, v_doc_id, v_receipt_id
      FROM public.supplier_payables WHERE id = p_payable_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Không tìm thấy khoản phải trả %', p_payable_id;
    END IF;
  END IF;

  IF v_kind = 'PURCHASE' THEN
    SELECT business_line_id INTO v_line
      FROM public.purchase_receipts WHERE id = v_receipt_id;
    IF v_line IS NULL THEN
      SELECT count(DISTINCT p.business_line_id) INTO v_cnt
        FROM public.purchase_receipt_items i
        JOIN public.products p ON p.id = i.product_id
       WHERE i.receipt_id = v_receipt_id AND p.business_line_id IS NOT NULL;
      IF v_cnt = 1 THEN
        SELECT DISTINCT p.business_line_id INTO v_line
          FROM public.purchase_receipt_items i
          JOIN public.products p ON p.id = i.product_id
         WHERE i.receipt_id = v_receipt_id AND p.business_line_id IS NOT NULL;
      END IF;
    END IF;
  ELSE
    SELECT business_line_id INTO v_line
      FROM public.sales_documents WHERE id = v_doc_id;
    IF v_line IS NULL THEN
      SELECT count(DISTINCT p.business_line_id) INTO v_cnt
        FROM public.sales_document_lines l
        JOIN public.products p ON p.id = l.product_id
       WHERE l.document_id = v_doc_id AND p.business_line_id IS NOT NULL;
      IF v_cnt = 1 THEN
        SELECT DISTINCT p.business_line_id INTO v_line
          FROM public.sales_document_lines l
          JOIN public.products p ON p.id = l.product_id
         WHERE l.document_id = v_doc_id AND p.business_line_id IS NOT NULL;
      END IF;
    END IF;
  END IF;

  IF v_line IS NULL THEN
    RAISE EXCEPTION 'Không xác định được ngành hàng cho khoản công nợ % — phân loại chứng từ gốc trước khi ghi nhận thanh toán.',
      coalesce(p_payable_id, p_receivable_id);
  END IF;
  RETURN v_line;
END $$;

REVOKE ALL ON FUNCTION public.tvk_resolve_obligation_line(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tvk_resolve_obligation_line(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. VIẾT LẠI apply_payment_to_balance — CƠ CHẾ GHI SỔ DUY NHẤT (§11.7)
--    Cutover atomic: thay thân hàm trong cùng migration với bảng
--    payment_allocations — không có cửa sổ 2 cơ chế cùng chạy, không
--    double-count. Logic 0019 được giữ NGUYÊN (guard trả thừa + thứ tự
--    phân bổ settlement ORDER BY id + thông điệp lỗi), chỉ thêm:
--      (a) mỗi lần cộng amount_paid thì INSERT 1 dòng payment_allocations
--          (mang ngành của chứng từ gốc, số tiền đúng phân bổ);
--      (b) nhánh đảo (NEW.reversal_of_id NOT NULL): trừ đúng các phân
--          bổ gốc bằng dòng mirror âm, KHÔNG cộng dồn như phiếu thường
--          (lỗi cũ: dòng đảo làm amount_paid TĂNG).
--    Trigger trg_payments_apply (AFTER INSERT ON payments) giữ nguyên tên
--    và vẫn trỏ vào hàm này.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_payment_to_balance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_target_amount numeric;
  v_already_paid numeric;
  v_rem_pay numeric;
  v_line record;
  v_alloc numeric;
  v_cur_paid numeric;
  v_cur_tot numeric;
  v_line_id uuid;
  v_orig record;
  v_mirror record;
  v_alloc_count integer;
BEGIN
  -- 0. BÚT TOÁN ĐẢO (§12.2–12.4): trừ đúng các phân bổ gốc, giữ nguyên
  --    phiếu gốc + đợt đối soát + dòng đối soát. Chỉ đảo toàn bộ phiếu.
  IF NEW.reversal_of_id IS NOT NULL THEN
    SELECT * INTO v_orig FROM public.payments WHERE id = NEW.reversal_of_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Không tìm thấy phiếu thanh toán gốc %', NEW.reversal_of_id;
    END IF;
    IF v_orig.reversal_of_id IS NOT NULL THEN
      RAISE EXCEPTION 'Không được đảo một bút toán đảo.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.payments WHERE reversal_of_id = NEW.reversal_of_id AND id <> NEW.id) THEN
      RAISE EXCEPTION 'Phiếu % đã được đảo trước đó.', v_orig.doc_code;
    END IF;
    IF NEW.amount <> v_orig.amount THEN
      RAISE EXCEPTION 'Số tiền đảo (%) phải bằng đúng số tiền phiếu gốc % (%).',
        NEW.amount, v_orig.doc_code, v_orig.amount;
    END IF;
    IF NEW.payment_kind = v_orig.payment_kind THEN
      RAISE EXCEPTION 'Bút toán đảo phải có chiều tiền ngược lại với phiếu gốc.';
    END IF;
    IF NEW.payable_id IS DISTINCT FROM v_orig.payable_id
       OR NEW.receivable_id IS DISTINCT FROM v_orig.receivable_id
       OR NEW.settlement_id IS DISTINCT FROM v_orig.settlement_id THEN
      RAISE EXCEPTION 'Bút toán đảo phải gắn đúng công nợ/đợt đối soát của phiếu gốc.';
    END IF;
    IF NEW.fund_id IS DISTINCT FROM v_orig.fund_id THEN
      RAISE EXCEPTION 'Bút toán đảo phải dùng cùng quỹ tiền với phiếu gốc.';
    END IF;

    SELECT count(*) INTO v_alloc_count
      FROM public.payment_allocations
     WHERE payment_id = NEW.reversal_of_id AND reversal_of_id IS NULL;
    IF v_alloc_count = 0 THEN
      RAISE EXCEPTION 'Phiếu gốc % chưa có phân bổ thanh toán — không đảo được, kiểm tra lại dữ liệu backfill.',
        v_orig.doc_code;
    END IF;

    FOR v_mirror IN
      SELECT * FROM public.payment_allocations
       WHERE payment_id = NEW.reversal_of_id AND reversal_of_id IS NULL
       ORDER BY id
    LOOP
      INSERT INTO public.payment_allocations
        (payment_id, receivable_id, payable_id, settlement_id, settlement_line_id,
         business_line_id, amount, reversal_of_id)
      VALUES
        (NEW.id, v_mirror.receivable_id, v_mirror.payable_id, v_mirror.settlement_id,
         v_mirror.settlement_line_id, v_mirror.business_line_id, -v_mirror.amount, v_mirror.id);

      IF v_mirror.payable_id IS NOT NULL THEN
        UPDATE public.supplier_payables
           SET amount_paid = amount_paid - v_mirror.amount,
               status = CASE
                 WHEN amount_paid - v_mirror.amount >= amount THEN 'PAID'::balance_status
                 WHEN amount_paid - v_mirror.amount > 0     THEN 'PARTIAL'::balance_status
                 ELSE 'UNPAID'::balance_status END
         WHERE id = v_mirror.payable_id;
      ELSIF v_mirror.receivable_id IS NOT NULL THEN
        UPDATE public.partner_receivables
           SET amount_paid = amount_paid - v_mirror.amount,
               status = CASE
                 WHEN amount_paid - v_mirror.amount >= amount THEN 'PAID'::balance_status
                 WHEN amount_paid - v_mirror.amount > 0     THEN 'PARTIAL'::balance_status
                 ELSE 'UNPAID'::balance_status END
         WHERE id = v_mirror.receivable_id;
      END IF;
    END LOOP;

    RETURN NEW;
  END IF;

  -- 1. Trả trực tiếp cho khoản phải trả NCC (payable_id) — giữ nguyên 0019.
  IF NEW.payable_id IS NOT NULL THEN
    SELECT amount, amount_paid INTO v_target_amount, v_already_paid
      FROM public.supplier_payables WHERE id = NEW.payable_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Không tìm thấy khoản phải trả %', NEW.payable_id;
    END IF;
    IF v_already_paid + NEW.amount > v_target_amount THEN
      RAISE EXCEPTION 'Thanh toán vượt quá công nợ còn lại của khoản phải trả (còn %, trả %)',
        v_target_amount - v_already_paid, NEW.amount;
    END IF;

    v_line_id := public.tvk_resolve_obligation_line(NEW.payable_id, NULL);
    INSERT INTO public.payment_allocations (payment_id, payable_id, business_line_id, amount)
    VALUES (NEW.id, NEW.payable_id, v_line_id, NEW.amount);

    UPDATE public.supplier_payables
       SET amount_paid = amount_paid + NEW.amount,
           status = CASE
             WHEN amount_paid + NEW.amount >= amount THEN 'PAID'::balance_status
             WHEN amount_paid + NEW.amount > 0     THEN 'PARTIAL'::balance_status
             ELSE status END
     WHERE id = NEW.payable_id;
  END IF;

  -- 2. Thu trực tiếp cho khoản phải thu đối tác (receivable_id) — giữ nguyên 0019.
  IF NEW.receivable_id IS NOT NULL THEN
    SELECT amount, amount_paid INTO v_target_amount, v_already_paid
      FROM public.partner_receivables WHERE id = NEW.receivable_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Không tìm thấy khoản phải thu %', NEW.receivable_id;
    END IF;
    IF v_already_paid + NEW.amount > v_target_amount THEN
      RAISE EXCEPTION 'Thu tiền vượt quá công nợ còn lại của khoản phải thu (còn %, thu %)',
        v_target_amount - v_already_paid, NEW.amount;
    END IF;

    v_line_id := public.tvk_resolve_obligation_line(NULL, NEW.receivable_id);
    INSERT INTO public.payment_allocations (payment_id, receivable_id, business_line_id, amount)
    VALUES (NEW.id, NEW.receivable_id, v_line_id, NEW.amount);

    UPDATE public.partner_receivables
       SET amount_paid = amount_paid + NEW.amount,
           status = CASE
             WHEN amount_paid + NEW.amount >= amount THEN 'PAID'::balance_status
             WHEN amount_paid + NEW.amount > 0     THEN 'PARTIAL'::balance_status
             ELSE status END
     WHERE id = NEW.receivable_id;
  END IF;

  -- 3. Thanh toán theo đợt đối soát (settlement_id) -> Tự động phân bổ vào settlement_lines
  --    Giữ nguyên thứ tự 0019 (ORDER BY id) + guard DB-02; mỗi dòng phân
  --    bổ được ghi 1 dòng payment_allocations (kèm settlement_line_id).
  IF NEW.settlement_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.settlements WHERE id = NEW.settlement_id) THEN
      RAISE EXCEPTION 'Không tìm thấy đợt đối soát %', NEW.settlement_id;
    END IF;

    v_rem_pay := NEW.amount;
    FOR v_line IN
      SELECT * FROM public.settlement_lines
       WHERE settlement_id = NEW.settlement_id
       ORDER BY id
    LOOP
      IF v_rem_pay <= 0 THEN
        EXIT;
      END IF;

      IF v_line.payable_id IS NOT NULL THEN
        SELECT amount, amount_paid INTO v_cur_tot, v_cur_paid
          FROM public.supplier_payables WHERE id = v_line.payable_id FOR UPDATE;
        v_alloc := least(v_rem_pay, v_cur_tot - v_cur_paid);
        IF v_alloc > 0 THEN
          v_line_id := public.tvk_resolve_obligation_line(v_line.payable_id, NULL);
          INSERT INTO public.payment_allocations
            (payment_id, payable_id, settlement_id, settlement_line_id, business_line_id, amount)
          VALUES (NEW.id, v_line.payable_id, NEW.settlement_id, v_line.id, v_line_id, v_alloc);
          UPDATE public.supplier_payables
             SET amount_paid = amount_paid + v_alloc,
                 status = CASE
                   WHEN amount_paid + v_alloc >= amount THEN 'PAID'::balance_status
                   WHEN amount_paid + v_alloc > 0     THEN 'PARTIAL'::balance_status
                   ELSE status END
           WHERE id = v_line.payable_id;
          v_rem_pay := v_rem_pay - v_alloc;
        END IF;
      ELSIF v_line.receivable_id IS NOT NULL THEN
        SELECT amount, amount_paid INTO v_cur_tot, v_cur_paid
          FROM public.partner_receivables WHERE id = v_line.receivable_id FOR UPDATE;
        v_alloc := least(v_rem_pay, v_cur_tot - v_cur_paid);
        IF v_alloc > 0 THEN
          v_line_id := public.tvk_resolve_obligation_line(NULL, v_line.receivable_id);
          INSERT INTO public.payment_allocations
            (payment_id, receivable_id, settlement_id, settlement_line_id, business_line_id, amount)
          VALUES (NEW.id, v_line.receivable_id, NEW.settlement_id, v_line.id, v_line_id, v_alloc);
          UPDATE public.partner_receivables
             SET amount_paid = amount_paid + v_alloc,
                 status = CASE
                   WHEN amount_paid + v_alloc >= amount THEN 'PAID'::balance_status
                   WHEN amount_paid + v_alloc > 0     THEN 'PARTIAL'::balance_status
                   ELSE status END
           WHERE id = v_line.receivable_id;
          v_rem_pay := v_rem_pay - v_alloc;
        END IF;
      END IF;
    END LOOP;

    -- DB-02: Chặn thanh toán vượt quá tổng công nợ còn lại của đợt đối soát
    IF v_rem_pay > 0 THEN
      RAISE EXCEPTION 'Số tiền thanh toán (%) vượt quá tổng công nợ còn lại của đợt đối soát (thừa %)',
        NEW.amount, v_rem_pay;
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 5. reverse_payment — RPC đảo bút toán thanh toán (§12.2–12.5)
--    CHỈ Kế toán (quyết định kế toán 28/10/2026). Tạo phiếu đảo mới
--    (chiều tiền ngược, cùng quỹ/số tiền/công nợ/đợt đối soát, lý do bắt
--    buộc); trigger trg_payments_apply (nhánh đảo) trừ đúng phân bổ gốc,
--    trigger trg_payments_cash_fund tự tạo bút toán quỹ ngược chiều.
--    Đồng thời đánh dấu bút toán quỹ gốc "Đã đảo huỷ" để sổ quỹ hiện
--    đúng trạng thái (theo mẫu huỷ của 0023).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_payment(
  p_payment_id uuid,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_orig record;
  v_new_id uuid;
  v_rev_mov_id uuid;
BEGIN
  IF current_app_role() IS NULL OR current_app_role() <> 'ACCOUNTING' THEN
    RAISE EXCEPTION 'Chỉ Kế toán mới được đảo bút toán thanh toán.';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Bắt buộc phải nhập lý do đảo bút toán.';
  END IF;

  SELECT * INTO v_orig FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu thanh toán %', p_payment_id;
  END IF;
  IF v_orig.reversal_of_id IS NOT NULL THEN
    RAISE EXCEPTION 'Không được đảo một bút toán đảo.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payments WHERE reversal_of_id = p_payment_id) THEN
    RAISE EXCEPTION 'Phiếu % đã được đảo trước đó.', v_orig.doc_code;
  END IF;

  INSERT INTO public.payments
    (payment_kind, payment_date, amount, method, settlement_id, payable_id,
     receivable_id, fund_id, note, created_by, reversal_of_id)
  VALUES
    (CASE WHEN v_orig.payment_kind = 'IN' THEN 'OUT'::payment_type ELSE 'IN'::payment_type END,
     current_date, v_orig.amount, v_orig.method, v_orig.settlement_id, v_orig.payable_id,
     v_orig.receivable_id, v_orig.fund_id,
     'Đảo bút toán ' || v_orig.doc_code || ' (Lý do: ' || trim(p_reason) || ')',
     auth.uid(), p_payment_id)
  RETURNING id INTO v_new_id;

  -- Bút toán quỹ đảo (payment_id = v_new_id, kind REVERSAL) đã được
  -- trg_payments_cash_fund tự tạo; đánh dấu bút toán quỹ gốc đã đảo huỷ.
  SELECT id INTO v_rev_mov_id FROM public.cash_movements WHERE payment_id = v_new_id;
  UPDATE public.cash_movements
     SET is_cancelled = true,
         cancel_reason = 'Đã đảo bút toán ' || v_orig.doc_code || ' (Lý do: ' || trim(p_reason) || ')',
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         reversal_entry_id = v_rev_mov_id
   WHERE payment_id = p_payment_id;

  RETURN v_new_id;
END $$;

REVOKE ALL ON FUNCTION public.reverse_payment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_payment(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.reverse_payment(uuid, text) IS
  'P3 (§12): đảo toàn bộ một phiếu thanh toán (chỉ Kế toán). Tạo phiếu đảo mới; trigger trừ đúng phân bổ gốc và tạo bút toán quỹ ngược chiều.';

-- ---------------------------------------------------------------------
-- 6. VIẾT LẠI cancel_cash_movement_reversal — sửa lỗi chắc chắn E7 (§12.5)
--    Bản 0023 INSERT bút toán đảo copy nguyên payment_id trong khi
--    cash_movements.payment_id là UNIQUE -> đảo bút toán gắn payment nào
--    cũng fail. Thiết kế lại:
--      (a) Bút toán gắn payment: TỪ CHỐI — phải đi qua reverse_payment
--          (Kế toán) để phục hồi cả công nợ lẫn quỹ trong một giao dịch.
--          Không cho huỷ lẻ ở sổ quỹ rồi để công nợ lệch.
--      (b) Bút toán đảo KHÔNG copy payment_id nữa (luôn NULL); liên kết
--          qua reversal_of_id (đã có sẵn trên cash_movements).
--      (c) BỎ bước 4 cũ (tự trừ amount_paid trực tiếp): phục hồi công nợ
--          nay thuộc về reverse_payment; giữ lại là double-restore.
--    Nhánh đảo chuyển quỹ đối ứng giữ nguyên (không copy payment_id).
-- ---------------------------------------------------------------------
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
  -- P3 (E7): bút toán gắn phiếu thanh toán không được huỷ lẻ ở sổ quỹ.
  IF v_orig.payment_id IS NOT NULL THEN
    RAISE EXCEPTION 'Giao dịch này gắn với phiếu thanh toán — không huỷ trực tiếp ở sổ quỹ. Kế toán đảo phiếu thanh toán tương ứng để phục hồi cả công nợ lẫn số dư quỹ.';
  END IF;

  -- 1. Tạo bút toán đảo (payment_id LUÔN NULL — không reuse như bản 0023).
  INSERT INTO public.cash_movements (
    fund_id, movement_kind, amount, movement_date,
    category_id, transfer_id, counter_fund_id,
    reversal_of_id, note, created_by
  ) VALUES (
    v_orig.fund_id, 'REVERSAL', -v_orig.amount, current_date,
    v_orig.category_id, v_orig.transfer_id, v_orig.counter_fund_id,
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

  RETURN v_reversal_id;
END $$;

-- ---------------------------------------------------------------------
-- 6b. apply_payment_to_cash_fund — bút toán quỹ của PHIẾU ĐẢO (§12.5)
--    Phiếu đảo sinh bút toán quỹ kind='REVERSAL' (không tính vào
--    total_in/total_out của view v_cash_fund_balances, khớp mẫu huỷ của
--    0023) và liên kết reversal_of_id về bút toán quỹ gốc.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_payment_to_cash_fund() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_orig_mov uuid;
BEGIN
  IF NEW.fund_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.reversal_of_id IS NOT NULL THEN
    SELECT id INTO v_orig_mov FROM public.cash_movements WHERE payment_id = NEW.reversal_of_id;
  END IF;
  INSERT INTO public.cash_movements (fund_id, payment_id, amount, movement_date, movement_kind, reversal_of_id)
  VALUES (NEW.fund_id, NEW.id,
    CASE WHEN NEW.payment_kind = 'IN' THEN NEW.amount ELSE -NEW.amount END,
    NEW.payment_date,
    CASE WHEN NEW.reversal_of_id IS NOT NULL THEN 'REVERSAL' ELSE 'DEBT_PAYMENT' END,
    v_orig_mov);
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 7. record_operating_cash_movement — biên ghi có kiểm soát cho thu/chi
--    vận hành (§12.6). App trước đây INSERT trực tiếp cash_movements
--    (nhờ policy OWNER 0023); sau khi bỏ policy đó, đường ghi duy nhất
--    cho thu/chi vận hành là RPC này (OWNER, validate quỹ + khoản mục).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_operating_cash_movement(
  p_fund_id uuid,
  p_category_id uuid,
  p_amount numeric(15,2),
  p_movement_date date,
  p_note text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fund record;
  v_cat record;
  v_id uuid;
BEGIN
  IF current_app_role() IS NULL OR current_app_role() <> 'OWNER' THEN
    RAISE EXCEPTION 'Chỉ Chủ cửa hàng mới được ghi nhận thu/chi vận hành.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Số tiền thu/chi phải lớn hơn 0.';
  END IF;
  SELECT id, is_active INTO v_fund FROM public.cash_funds WHERE id = p_fund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy quỹ tiền.';
  END IF;
  IF NOT v_fund.is_active THEN
    RAISE EXCEPTION 'Quỹ tiền đã chọn đang tắt.';
  END IF;
  SELECT id, kind, name, is_active INTO v_cat FROM public.cash_categories WHERE id = p_category_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy thông tin khoản mục.';
  END IF;
  IF NOT v_cat.is_active THEN
    RAISE EXCEPTION 'Khoản mục đã tắt.';
  END IF;

  INSERT INTO public.cash_movements
    (fund_id, movement_kind, category_id, amount, movement_date, note, created_by)
  VALUES
    (p_fund_id, 'OPERATING', p_category_id,
     CASE WHEN v_cat.kind = 'IN' THEN p_amount ELSE -p_amount END,
     coalesce(p_movement_date, current_date),
     coalesce(NULLIF(btrim(p_note), ''),
       CASE WHEN v_cat.kind = 'IN' THEN 'Thu vận hành: ' || v_cat.name
            ELSE 'Chi vận hành: ' || v_cat.name END),
     auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.record_operating_cash_movement(uuid, uuid, numeric, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_operating_cash_movement(uuid, uuid, numeric, date, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 8. Siết sổ quỹ (§12.6, BL-022): bỏ quyền OWNER ghi trực tiếp + trigger
--    chặn sửa/xoá ngoài các cột chuyển trạng thái huỷ.
--    Sau bước này, mọi đường ghi cash_movements đều qua trigger/RPC
--    SECURITY DEFINER (ghi phiếu thu/chi, chuyển quỹ, huỷ phiếu, đảo
--    phiếu, thu/chi vận hành). UPDATE chỉ được đổi: is_cancelled,
--    cancel_reason, cancelled_at, cancelled_by, reversal_entry_id,
--    counter_movement_id (các cột mà hàm huỷ / chuyển quỹ chạm tới).
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS pol_cash_movements_ins ON public.cash_movements;
DROP POLICY IF EXISTS pol_cash_movements_upd ON public.cash_movements;

CREATE OR REPLACE FUNCTION public.tvk_guard_cash_movements_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Không được xoá dòng sổ quỹ — dùng bút toán đảo để huỷ.';
  END IF;
  IF OLD.fund_id IS DISTINCT FROM NEW.fund_id
     OR OLD.payment_id IS DISTINCT FROM NEW.payment_id
     OR OLD.amount IS DISTINCT FROM NEW.amount
     OR OLD.movement_date IS DISTINCT FROM NEW.movement_date
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.movement_kind IS DISTINCT FROM NEW.movement_kind
     OR OLD.category_id IS DISTINCT FROM NEW.category_id
     OR OLD.transfer_id IS DISTINCT FROM NEW.transfer_id
     OR OLD.counter_fund_id IS DISTINCT FROM NEW.counter_fund_id
     OR OLD.note IS DISTINCT FROM NEW.note
     OR OLD.created_by IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'Không được sửa nội dung dòng sổ quỹ — chỉ được huỷ qua bút toán đảo.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cash_movements_no_direct_mutation ON public.cash_movements;
CREATE TRIGGER trg_cash_movements_no_direct_mutation
  BEFORE UPDATE OR DELETE ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_cash_movements_immutable();

-- ---------------------------------------------------------------------
-- 9. payments bất biến (append-only, §12.2): chặn mọi UPDATE/DELETE.
--    Phiếu đã ghi chỉ đảo bằng phiếu mới (reverse_payment). Không code
--    nào trong app UPDATE payments (chỉ INSERT) nên trigger này an toàn.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tvk_guard_payments_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Không được sửa/xoá phiếu thu/chi đã ghi — đảo bút toán bằng phiếu mới.';
END $$;

DROP TRIGGER IF EXISTS trg_payments_no_mutation ON public.payments;
CREATE TRIGGER trg_payments_no_mutation
  BEFORE UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_payments_immutable();

-- ---------------------------------------------------------------------
-- 10. Backfill phân bổ cho phiếu lịch sử (§11.7, §11.8)
--     Replay đúng thuật toán 0019 theo thứ tự (created_at, id), giữ số
--     tiền đã trả chạy (paid-so-far) cho từng khoản công nợ để phân bổ
--     settlement đúng như lúc ghi phiếu. Cuối cùng assert bất biến
--     SUM(phân bổ) = amount_paid cho từng khoản — lệch là FAIL.
--     Hàm idempotent: bỏ qua phiếu đã có phân bổ.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tvk_backfill_payment_allocations() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pmt record;
  v_line record;
  v_rem numeric(15,4);
  v_alloc numeric(15,4);
  v_line_id uuid;
  v_count integer := 0;
  v_bad record;
BEGIN
  DROP TABLE IF EXISTS _bf_paid;
  CREATE TEMP TABLE _bf_paid (
    kind text NOT NULL,
    oid uuid NOT NULL,
    paid numeric(15,4) NOT NULL DEFAULT 0,
    PRIMARY KEY (kind, oid)
  ) ON COMMIT DROP;

  FOR v_pmt IN
    SELECT * FROM public.payments
     WHERE reversal_of_id IS NULL
     ORDER BY created_at, doc_code, id
  LOOP
    IF EXISTS (SELECT 1 FROM public.payment_allocations WHERE payment_id = v_pmt.id) THEN
      CONTINUE;
    END IF;

    IF v_pmt.payable_id IS NOT NULL THEN
      v_line_id := public.tvk_resolve_obligation_line(v_pmt.payable_id, NULL);
      INSERT INTO public.payment_allocations (payment_id, payable_id, business_line_id, amount)
      VALUES (v_pmt.id, v_pmt.payable_id, v_line_id, v_pmt.amount);
      INSERT INTO _bf_paid (kind, oid, paid) VALUES ('P', v_pmt.payable_id, v_pmt.amount)
        ON CONFLICT (kind, oid) DO UPDATE SET paid = _bf_paid.paid + EXCLUDED.paid;
      v_count := v_count + 1;
    ELSIF v_pmt.receivable_id IS NOT NULL THEN
      v_line_id := public.tvk_resolve_obligation_line(NULL, v_pmt.receivable_id);
      INSERT INTO public.payment_allocations (payment_id, receivable_id, business_line_id, amount)
      VALUES (v_pmt.id, v_pmt.receivable_id, v_line_id, v_pmt.amount);
      INSERT INTO _bf_paid (kind, oid, paid) VALUES ('R', v_pmt.receivable_id, v_pmt.amount)
        ON CONFLICT (kind, oid) DO UPDATE SET paid = _bf_paid.paid + EXCLUDED.paid;
      v_count := v_count + 1;
    ELSIF v_pmt.settlement_id IS NOT NULL THEN
      v_rem := v_pmt.amount;
      FOR v_line IN
        SELECT * FROM public.settlement_lines
         WHERE settlement_id = v_pmt.settlement_id
         ORDER BY id
      LOOP
        EXIT WHEN v_rem <= 0;
        IF v_line.payable_id IS NOT NULL THEN
          SELECT least(v_rem, sl.amount - coalesce(bf.paid, 0)) INTO v_alloc
            FROM public.supplier_payables sl
            LEFT JOIN _bf_paid bf ON bf.kind = 'P' AND bf.oid = v_line.payable_id
           WHERE sl.id = v_line.payable_id;
          IF v_alloc > 0 THEN
            v_line_id := public.tvk_resolve_obligation_line(v_line.payable_id, NULL);
            INSERT INTO public.payment_allocations
              (payment_id, payable_id, settlement_id, settlement_line_id, business_line_id, amount)
            VALUES (v_pmt.id, v_line.payable_id, v_pmt.settlement_id, v_line.id, v_line_id, v_alloc);
            INSERT INTO _bf_paid (kind, oid, paid) VALUES ('P', v_line.payable_id, v_alloc)
              ON CONFLICT (kind, oid) DO UPDATE SET paid = _bf_paid.paid + EXCLUDED.paid;
            v_rem := v_rem - v_alloc;
            v_count := v_count + 1;
          END IF;
        ELSIF v_line.receivable_id IS NOT NULL THEN
          SELECT least(v_rem, r.amount - coalesce(bf.paid, 0)) INTO v_alloc
            FROM public.partner_receivables r
            LEFT JOIN _bf_paid bf ON bf.kind = 'R' AND bf.oid = v_line.receivable_id
           WHERE r.id = v_line.receivable_id;
          IF v_alloc > 0 THEN
            v_line_id := public.tvk_resolve_obligation_line(NULL, v_line.receivable_id);
            INSERT INTO public.payment_allocations
              (payment_id, receivable_id, settlement_id, settlement_line_id, business_line_id, amount)
            VALUES (v_pmt.id, v_line.receivable_id, v_pmt.settlement_id, v_line.id, v_line_id, v_alloc);
            INSERT INTO _bf_paid (kind, oid, paid) VALUES ('R', v_line.receivable_id, v_alloc)
              ON CONFLICT (kind, oid) DO UPDATE SET paid = _bf_paid.paid + EXCLUDED.paid;
            v_rem := v_rem - v_alloc;
            v_count := v_count + 1;
          END IF;
        END IF;
      END LOOP;
      IF v_rem > 0 THEN
        RAISE EXCEPTION 'Backfill: phiếu % (đợt đối soát %) còn thừa % sau khi replay phân bổ — dữ liệu lịch sử không khớp thuật toán 0019.',
          v_pmt.doc_code, v_pmt.settlement_id, v_rem;
      END IF;
    ELSE
      RAISE NOTICE 'Backfill: bỏ qua phiếu % (không gắn công nợ/đợt đối soát nào).', v_pmt.doc_code;
    END IF;
  END LOOP;

  -- Assert bất biến: SUM(phân bổ) phải bằng amount_paid của từng khoản.
  SELECT p.id INTO v_bad
    FROM public.supplier_payables p
   WHERE (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.payable_id = p.id) <> p.amount_paid
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Backfill FAIL: khoản phải trả % lệch SUM(phân bổ) so với amount_paid.', v_bad.id;
  END IF;
  SELECT r.id INTO v_bad
    FROM public.partner_receivables r
   WHERE (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.receivable_id = r.id) <> r.amount_paid
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Backfill FAIL: khoản phải thu % lệch SUM(phân bổ) so với amount_paid.', v_bad.id;
  END IF;

  RAISE NOTICE 'P3 BACKFILL: đã tạo % dòng phân bổ cho phiếu lịch sử.', v_count;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.tvk_backfill_payment_allocations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tvk_backfill_payment_allocations() TO authenticated;

SELECT public.tvk_backfill_payment_allocations();

-- ---------------------------------------------------------------------
-- 11. Kiểm chứng cuối migration: mọi phiếu có công nợ đều có phân bổ,
--    bất biến tài chính không đổi. Lệch là FAIL (không im lặng).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_payments integer;
  v_allocs integer;
  v_unalloc integer;
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_payments FROM public.payments WHERE reversal_of_id IS NULL;
  SELECT count(*) INTO v_allocs FROM public.payment_allocations;
  SELECT count(*) INTO v_unalloc
    FROM public.payments p
   WHERE p.reversal_of_id IS NULL
     AND (p.payable_id IS NOT NULL OR p.receivable_id IS NOT NULL OR p.settlement_id IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM public.payment_allocations a WHERE a.payment_id = p.id);
  SELECT count(*) INTO v_bad FROM (
    SELECT p.id FROM public.supplier_payables p
     WHERE (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.payable_id = p.id) <> p.amount_paid
    UNION ALL
    SELECT r.id FROM public.partner_receivables r
     WHERE (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.receivable_id = r.id) <> r.amount_paid
  ) s;
  RAISE NOTICE 'P3 POST-CHECK | payments=% allocations=% payments-co-cong-no-ma-chua-co-phan-bo=% khoan-cong-no-lech-sum=%',
    v_payments, v_allocs, v_unalloc, v_bad;
  IF v_unalloc > 0 OR v_bad > 0 THEN
    RAISE EXCEPTION 'P3 POST-CHECK FAIL: % phiếu có công nợ nhưng chưa có phân bổ, % khoản công nợ lệch SUM(phân bổ) so với amount_paid.',
      v_unalloc, v_bad;
  END IF;
END $$;

COMMIT;
