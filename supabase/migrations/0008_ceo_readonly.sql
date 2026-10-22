-- =====================================================================
-- 0008_ceo_readonly.sql — Quyền của vai trò CEO (chạy SAU 0007)
-- CEO là vai trò CHỈ XEM ở tầng cơ sở dữ liệu: xem được toàn bộ số liệu
-- kho và tài chính (tồn kho, chứng từ, công nợ, đối soát, thanh toán)
-- nhưng KHÔNG có bất kỳ policy ghi nào — không INSERT/UPDATE/DELETE
-- được ở mọi bảng. Các policy dưới đây chỉ cộng thêm quyền SELECT cho
-- CEO, không thay đổi quyền của các vai trò khác.
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'products','product_codes','vehicles','product_fitments','locations',
    'suppliers','partners',
    'purchase_receipts','purchase_receipt_items',
    'consignment_receipts','consignment_receipt_items',
    'consignment_out_slips','consignment_out_items',
    'consumption_reports','consumption_report_items',
    'allocation_slips','allocation_lines',
    'sales_orders','sales_documents','sales_document_lines',
    'vat_invoices','vat_invoice_lines',
    'return_documents','return_items',
    'settlements','settlement_lines','payments',
    'supplier_payables','partner_receivables','app_settings'
  ] loop
    execute format('drop policy if exists pol_ceo_sel_%s on %I', t, t);
    execute format(
      'create policy pol_ceo_sel_%s on %I for select to authenticated using (current_app_role() = ''CEO'')',
      t, t);
  end loop;
end $$;
