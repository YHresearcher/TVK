-- ======================================================================
-- TVK V2.0 — P4a: Allocation cutover (§11.7, §11.8)
-- ----------------------------------------------------------------------
-- Vấn đề (§11.7): migration 0027 gộp hai cơ chế trong MỘT trigger
-- `apply_payment_to_balance()`: vừa cộng/trừ `amount_paid` theo kiểu
-- cộng dồn legacy (0019), vừa INSERT dòng `payment_allocations`.
-- Nếu một phiếu đi qua cả hai cơ chế thì tiền bị tính hai lần.
-- Trên thực tế P3 đã hợp nhất hai cơ chế vào cùng một trigger nên
-- không còn đường ghi nào khác, nhưng bất biến "amount_paid =
-- SUM(payment_allocations)" vẫn chỉ được GIỮ bằng kỷ luật code, không
-- được ĐẢM BẢO bằng cấu trúc DB: bất kỳ UPDATE trực tiếp nào vào
-- `amount_paid`/`status` cũng phá vỡ nó mà không ai chặn (lỗ M4).
--
-- P4a cắt hoàn toàn sang cơ chế phân bổ làm nguồn chân lý duy nhất:
--   1. `tvk_recompute_obligation_balance()` — tính lại amount_paid
--      và status của MỘT khoản công nợ từ SUM(payment_allocations).
--   2. `apply_payment_to_balance()` viết lại: mọi chỗ cộng/trừ
--      `amount_paid` (nhánh đảo, phiếu trực tiếp, phiếu đợt đối soát)
--      đều gọi helper trên — không còn phép cộng dồn nào trong
--      trigger. Đây là bản sao y hệt thân 0027, chỉ thay 6 khối
--      UPDATE bằng lệnh PERFORM recompute.
--   3. `tvk_guard_obligation_balance()` + trigger BEFORE UPDATE trên
--      supplier_payables / partner_receivables: chặn mọi UPDATE trực
--      tiếp làm amount_paid lệch SUM(phân bổ) hoặc status lệch với
--      (amount_paid, amount). Đóng lỗ M4 "sửa trực tiếp số dư do
--      trigger tính" cho hai bảng công nợ. Sửa sai chỉ bằng phiếu
--      thu/chi hoặc phiếu đảo (đi qua trigger → recompute → hợp lệ).
--   4. Kiểm chứng cuối migration (cấu trúc + bất biến tài chính):
--      - thân `apply_payment_to_balance` không còn chuỗi cộng dồn;
--      - chỉ còn đúng 1 trigger AFTER INSERT trên payments gọi nó;
--      - mọi khoản công nợ đều thỏa amount_paid = SUM(phân bổ);
--      - tổng số tiền (phải thu/phải trả/phiếu/movements) in ra
--        NOTICE để đối chiếu staging — không đổi số liệu.
--
-- Không đổi dữ liệu, không đổi API, không đổi hành vi nghiệp vụ:
-- phiếu thu/chi và đảo bút toán chạy đúng như P3. Chỉ thay cơ chế
-- ghi số dư bên trong.
-- ======================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 1. Helper: tính lại số dư một khoản công nợ từ phân bổ.
--    p_payable_id / p_receivable_id: truyền đúng một trong hai.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tvk_recompute_obligation_balance(
  p_payable_id uuid,
  p_receivable_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid numeric(15,4);
BEGIN
  IF p_payable_id IS NOT NULL AND p_receivable_id IS NOT NULL THEN
    RAISE EXCEPTION 'tvk_recompute_obligation_balance: chỉ được truyền một trong hai payable_id hoặc receivable_id.';
  END IF;

  IF p_payable_id IS NOT NULL THEN
    SELECT coalesce(sum(amount), 0) INTO v_paid
      FROM public.payment_allocations
     WHERE payable_id = p_payable_id;
    UPDATE public.supplier_payables
       SET amount_paid = v_paid,
           status = CASE
                      WHEN v_paid >= amount THEN 'PAID'::balance_status
                      WHEN v_paid > 0 THEN 'PARTIAL'::balance_status
                      ELSE 'UNPAID'::balance_status
                    END
     WHERE id = p_payable_id;
  ELSIF p_receivable_id IS NOT NULL THEN
    SELECT coalesce(sum(amount), 0) INTO v_paid
      FROM public.payment_allocations
     WHERE receivable_id = p_receivable_id;
    UPDATE public.partner_receivables
       SET amount_paid = v_paid,
           status = CASE
                      WHEN v_paid >= amount THEN 'PAID'::balance_status
                      WHEN v_paid > 0 THEN 'PARTIAL'::balance_status
                      ELSE 'UNPAID'::balance_status
                    END
     WHERE id = p_receivable_id;
  ELSE
    RAISE EXCEPTION 'tvk_recompute_obligation_balance: cần payable_id hoặc receivable_id.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.tvk_recompute_obligation_balance(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tvk_recompute_obligation_balance(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. Viết lại apply_payment_to_balance (bản sao y hệt 0027, chỉ thay
--    6 khối UPDATE cộng dồn bằng PERFORM recompute). Lịch sử:
--    0001 (cộng dồn, không phân biệt kind) -> 0019 (guard trả thừa +
--    phân bổ đợt đối soát, vẫn cộng dồn) -> 0027 (thêm INSERT
--    payment_allocations + nhánh đảo, vẫn cộng dồn) -> 0028 (P4a:
--    amount_paid ĐƯỢC TÍNH LẠI từ phân bổ, không cộng dồn nữa).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_payment_to_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settlement record;
  v_line record;
  v_alloc numeric(15,4);
  v_mirror record;
  v_line_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.reversal_of_id IS NOT NULL THEN
      -- Phiếu đảo: tạo phân bổ gương ÂM cho từng phân bổ gốc, rồi
      -- tính lại số dư từ phân bổ (P4a: không trừ trực tiếp nữa).
      FOR v_mirror IN
        SELECT * FROM public.payment_allocations
         WHERE payment_id = NEW.reversal_of_id
         ORDER BY id
      LOOP
        INSERT INTO public.payment_allocations
          (payment_id, payable_id, receivable_id, settlement_id, settlement_line_id, business_line_id, amount, reversal_of_id)
        VALUES
          (NEW.id, v_mirror.payable_id, v_mirror.receivable_id, v_mirror.settlement_id, v_mirror.settlement_line_id, v_mirror.business_line_id, -v_mirror.amount, v_mirror.id);
        PERFORM public.tvk_recompute_obligation_balance(v_mirror.payable_id, v_mirror.receivable_id);
      END LOOP;
      RETURN NEW;
    END IF;

    IF NEW.payable_id IS NOT NULL THEN
      v_line_id := public.tvk_resolve_obligation_line(NEW.payable_id, NULL);
      INSERT INTO public.payment_allocations (payment_id, payable_id, business_line_id, amount)
      VALUES (NEW.id, NEW.payable_id, v_line_id, NEW.amount);
      PERFORM public.tvk_recompute_obligation_balance(NEW.payable_id, NULL);
    ELSIF NEW.receivable_id IS NOT NULL THEN
      v_line_id := public.tvk_resolve_obligation_line(NULL, NEW.receivable_id);
      INSERT INTO public.payment_allocations (payment_id, receivable_id, business_line_id, amount)
      VALUES (NEW.id, NEW.receivable_id, v_line_id, NEW.amount);
      PERFORM public.tvk_recompute_obligation_balance(NULL, NEW.receivable_id);
    ELSIF NEW.settlement_id IS NOT NULL THEN
      SELECT * INTO v_settlement FROM public.settlements WHERE id = NEW.settlement_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Đợt đối soát % không tồn tại.', NEW.settlement_id;
      END IF;

      IF NEW.amount > v_settlement.total_amount THEN
        RAISE EXCEPTION 'Số tiền phiếu % vượt tổng đợt đối soát % (%).', NEW.doc_code, v_settlement.code, v_settlement.total_amount;
      END IF;

      FOR v_line IN
        SELECT * FROM public.settlement_lines
         WHERE settlement_id = NEW.settlement_id
         ORDER BY id
      LOOP
        IF NEW.amount <= 0 THEN
          EXIT;
        END IF;

        IF v_line.payable_id IS NOT NULL THEN
          SELECT least(NEW.amount, sl.amount - sl.amount_paid) INTO v_alloc
            FROM public.supplier_payables sl WHERE sl.id = v_line.payable_id;
          IF v_alloc > 0 THEN
            v_line_id := public.tvk_resolve_obligation_line(v_line.payable_id, NULL);
            INSERT INTO public.payment_allocations
              (payment_id, payable_id, settlement_id, settlement_line_id, business_line_id, amount)
            VALUES (NEW.id, v_line.payable_id, NEW.settlement_id, v_line.id, v_line_id, v_alloc);
            PERFORM public.tvk_recompute_obligation_balance(v_line.payable_id, NULL);
            NEW.amount := NEW.amount - v_alloc;
          END IF;
        ELSIF v_line.receivable_id IS NOT NULL THEN
          SELECT least(NEW.amount, r.amount - r.amount_paid) INTO v_alloc
            FROM public.partner_receivables r WHERE r.id = v_line.receivable_id;
          IF v_alloc > 0 THEN
            v_line_id := public.tvk_resolve_obligation_line(NULL, v_line.receivable_id);
            INSERT INTO public.payment_allocations
              (payment_id, receivable_id, settlement_id, settlement_line_id, business_line_id, amount)
            VALUES (NEW.id, v_line.receivable_id, NEW.settlement_id, v_line.id, v_line_id, v_alloc);
            PERFORM public.tvk_recompute_obligation_balance(NULL, v_line.receivable_id);
            NEW.amount := NEW.amount - v_alloc;
          END IF;
        END IF;
      END LOOP;

      IF NEW.amount > 0 THEN
        RAISE EXCEPTION 'Phiếu % còn thừa % sau khi phân bổ hết đợt đối soát % — dữ liệu đợt đối soát không khớp.',
          NEW.doc_code, NEW.amount, v_settlement.code;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. Guard: chặn UPDATE trực tiếp làm lệch số dư công nợ.
--    Chỉ chạy khi amount / amount_paid / status đổi. amount_paid phải
--    bằng SUM(payment_allocations); status phải đúng công thức
--    (amount_paid >= amount -> PAID; > 0 -> PARTIAL; còn lại UNPAID).
--    SECURITY DEFINER để phép SUM luôn đọc được payment_allocations
--    bất kể RLS của người gọi.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tvk_guard_obligation_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alloc_sum numeric(15,4);
  v_expected balance_status;
BEGIN
  IF NEW.amount IS NOT DISTINCT FROM OLD.amount
     AND NEW.amount_paid IS NOT DISTINCT FROM OLD.amount_paid
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'supplier_payables' THEN
    SELECT coalesce(sum(amount), 0) INTO v_alloc_sum
      FROM public.payment_allocations WHERE payable_id = NEW.id;
  ELSIF TG_TABLE_NAME = 'partner_receivables' THEN
    SELECT coalesce(sum(amount), 0) INTO v_alloc_sum
      FROM public.payment_allocations WHERE receivable_id = NEW.id;
  ELSE
    RAISE EXCEPTION 'tvk_guard_obligation_balance gắn sai bảng %.', TG_TABLE_NAME;
  END IF;

  IF NEW.amount_paid IS DISTINCT FROM v_alloc_sum THEN
    RAISE EXCEPTION 'Số đã trả (%) phải bằng tổng phân bổ thanh toán (%). Sửa sai chỉ bằng phiếu thu/chi hoặc phiếu đảo, không sửa trực tiếp.',
      NEW.amount_paid, v_alloc_sum;
  END IF;

  v_expected := CASE
                  WHEN NEW.amount_paid >= NEW.amount THEN 'PAID'::balance_status
                  WHEN NEW.amount_paid > 0 THEN 'PARTIAL'::balance_status
                  ELSE 'UNPAID'::balance_status
                END;
  IF NEW.status IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Trạng thái công nợ (%) không khớp số đã trả (% trên %). Trạng thái do hệ thống tự tính từ phân bổ thanh toán.',
      NEW.status, NEW.amount_paid, NEW.amount;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_supplier_payables_balance ON public.supplier_payables;
CREATE TRIGGER trg_guard_supplier_payables_balance
BEFORE UPDATE ON public.supplier_payables
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_obligation_balance();

DROP TRIGGER IF EXISTS trg_guard_partner_receivables_balance ON public.partner_receivables;
CREATE TRIGGER trg_guard_partner_receivables_balance
BEFORE UPDATE ON public.partner_receivables
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_obligation_balance();

-- ---------------------------------------------------------------------
-- 4. Kiểm chứng cuối migration (§11.7): không còn đường ghi cũ.
--    - Thân apply_payment_to_balance không còn mẫu cộng dồn.
--    - Đúng 1 trigger AFTER INSERT trên payments gọi hàm này.
--    - Mọi khoản công nợ thỏa amount_paid = SUM(phân bổ).
--    - In tổng số tiền để đối chiếu staging (không đổi số liệu).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_fn text;
  v_trg integer;
  v_bad integer;
  v_pay_total numeric;
  v_rec_total numeric;
  v_pmt_total numeric;
  v_mov_total numeric;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_fn
    FROM pg_proc WHERE proname = 'apply_payment_to_balance' AND pronamespace = 'public'::regnamespace;
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'P4a POST-CHECK FAIL: không tìm thấy apply_payment_to_balance.';
  END IF;
  IF v_fn ILIKE '%amount_paid = amount_paid +%' OR v_fn ILIKE '%amount_paid = amount_paid -%' THEN
    RAISE EXCEPTION 'P4a POST-CHECK FAIL: apply_payment_to_balance vẫn còn phép cộng dồn amount_paid.';
  END IF;
  IF v_fn NOT ILIKE '%tvk_recompute_obligation_balance%' THEN
    RAISE EXCEPTION 'P4a POST-CHECK FAIL: apply_payment_to_balance không gọi tvk_recompute_obligation_balance.';
  END IF;

  SELECT count(*) INTO v_trg
    FROM pg_trigger
   WHERE tgrelid = 'public.payments'::regclass
     AND tgenabled <> 'D'
     AND tgname = 'trg_payments_apply';
  IF v_trg <> 1 THEN
    RAISE EXCEPTION 'P4a POST-CHECK FAIL: trg_payments_apply trên payments phải đúng 1, thực tế %.', v_trg;
  END IF;

  SELECT count(*) INTO v_bad FROM (
    SELECT p.id FROM public.supplier_payables p
     WHERE (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.payable_id = p.id) <> p.amount_paid
    UNION ALL
    SELECT r.id FROM public.partner_receivables r
     WHERE (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.receivable_id = r.id) <> r.amount_paid
  ) s;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'P4a POST-CHECK FAIL: % khoản công nợ lệch SUM(phân bổ) so với amount_paid.', v_bad;
  END IF;

  SELECT coalesce(sum(amount), 0) INTO v_pay_total FROM public.supplier_payables;
  SELECT coalesce(sum(amount), 0) INTO v_rec_total FROM public.partner_receivables;
  SELECT coalesce(sum(amount), 0) INTO v_pmt_total FROM public.payments;
  SELECT coalesce(sum(amount), 0) INTO v_mov_total FROM public.cash_movements;
  RAISE NOTICE 'P4a POST-CHECK | cutover OK | phai-tra-total=% phai-thu-total=% payments-total=% cash-movements-total=% khoan-lech=%',
    v_pay_total, v_rec_total, v_pmt_total, v_mov_total, v_bad;
END $$;

COMMIT;
