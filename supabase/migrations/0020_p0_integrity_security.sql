-- TVK P0 security and transaction integrity. Apply to STAGING first.
-- Requires migrations through 0019_platform_fixes.sql.
BEGIN;

-- SALES uses this cost-free projection, while RLS on stock_batches denies direct access.
ALTER VIEW public.v_batches_for_sales SET (security_invoker = false, security_barrier = true);
REVOKE ALL ON public.v_batches_for_sales FROM PUBLIC, anon;
GRANT SELECT ON public.v_batches_for_sales TO authenticated;

-- Prevent edits to sales lines after confirmation.
CREATE OR REPLACE FUNCTION public.tvk_guard_sales_document_lines()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status doc_status;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_status FROM public.sales_documents WHERE id = OLD.document_id FOR UPDATE;
    IF v_status IS DISTINCT FROM 'DRAFT'::doc_status THEN
      RAISE EXCEPTION 'Cannot delete line from a non-draft sales document';
    END IF;
    RETURN OLD;
  END IF;
  SELECT status INTO v_status FROM public.sales_documents WHERE id = NEW.document_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'DRAFT'::doc_status THEN
    RAISE EXCEPTION 'Cannot change lines of a non-draft sales document';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT status INTO v_status FROM public.sales_documents WHERE id = OLD.document_id FOR UPDATE;
    IF v_status IS DISTINCT FROM 'DRAFT'::doc_status THEN
      RAISE EXCEPTION 'Cannot move line out of a non-draft sales document';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tvk_guard_sales_document_lines ON public.sales_document_lines;
CREATE TRIGGER trg_tvk_guard_sales_document_lines
BEFORE INSERT OR UPDATE OR DELETE ON public.sales_document_lines
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_sales_document_lines();
REVOKE ALL ON FUNCTION public.tvk_guard_sales_document_lines() FROM PUBLIC;

-- VAT invoice must not silently mix different partners or repeated document lines.
CREATE OR REPLACE FUNCTION public.create_vat_invoice(
  p_partner_id uuid, p_invoice_no text, p_symbol text, p_invoice_date date,
  p_provider text, p_line_ids uuid[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_invoice uuid; v_total numeric; v_bad integer; v_n integer;
BEGIN
  IF current_app_role() IS NULL OR current_app_role() NOT IN ('OWNER','ACCOUNTING') THEN
    RAISE EXCEPTION 'Chỉ Chủ cửa hàng và Kế toán mới được xuất hoá đơn GTGT.';
  END IF;
  v_n := coalesce(array_length(p_line_ids, 1), 0);
  IF v_n = 0 OR v_n <> (SELECT count(DISTINCT id) FROM unnest(p_line_ids) AS t(id)) THEN
    RAISE EXCEPTION 'Danh sách dòng hoá đơn rỗng hoặc có dòng bị lặp';
  END IF;
  IF (SELECT count(*) FROM public.sales_document_lines WHERE id = ANY(p_line_ids)) <> v_n THEN
    RAISE EXCEPTION 'Có dòng chứng từ không tồn tại trong danh sách xuất hoá đơn';
  END IF;
  SELECT count(*) INTO v_bad
    FROM public.sales_document_lines l
    JOIN public.sales_documents d ON d.id = l.document_id
   WHERE l.id = ANY(p_line_ids)
     AND (d.status <> 'CONFIRMED' OR d.partner_id IS DISTINCT FROM p_partner_id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Dòng chứng từ chưa xác nhận hoặc không thuộc đối tác trên hoá đơn';
  END IF;
  SELECT count(*) INTO v_bad FROM public.vat_invoice_lines
   WHERE sales_document_line_id = ANY(p_line_ids) AND is_active;
  IF v_bad > 0 THEN RAISE EXCEPTION 'Có dòng đã được xuất hoá đơn trước đó'; END IF;
  SELECT coalesce(sum(line_total), 0) INTO v_total
    FROM public.sales_document_lines WHERE id = ANY(p_line_ids);
  INSERT INTO public.vat_invoices (invoice_no, symbol, invoice_date, provider, partner_id, total_amount)
  VALUES (p_invoice_no, p_symbol, p_invoice_date, p_provider, p_partner_id, v_total)
  RETURNING id INTO v_invoice;
  INSERT INTO public.vat_invoice_lines (vat_invoice_id, sales_document_line_id, line_no, amount)
  SELECT v_invoice, l.id, row_number() OVER (ORDER BY u.ord), l.line_total
    FROM unnest(p_line_ids) WITH ORDINALITY AS u(id, ord)
    JOIN public.sales_document_lines l ON l.id = u.id;
  UPDATE public.allocation_lines al SET invoice_status = 'INVOICED'
   WHERE al.id IN (SELECT allocation_line_id FROM public.sales_document_lines
                   WHERE id = ANY(p_line_ids) AND allocation_line_id IS NOT NULL);
  RETURN v_invoice;
END $$;
REVOKE ALL ON FUNCTION public.create_vat_invoice(uuid,text,text,date,text,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_vat_invoice(uuid,text,text,date,text,uuid[]) TO authenticated;
COMMIT;
