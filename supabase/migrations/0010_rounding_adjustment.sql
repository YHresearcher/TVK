-- 0010: rounding adjustment on stock-in receipts.
-- Import totals must match the accountant's convention: round ONCE at the
-- end (round of the sum of exact line values), while per-line unit costs
-- stay rounded integers (matching supplier invoice lines). The difference
-- is stored explicitly per receipt as rounding_adjustment (usually a few
-- dozen dong, may be negative), so that:
--   receipt total = sum(qty * unit_cost) + rounding_adjustment
-- and every displayed integer adds up exactly.
-- Existing receipts keep adjustment 0, so their totals are unchanged.
-- The import action (src/lib/actions.ts importStockAction) computes the
-- adjustment from the file's USD prices, form rate and VAT; the preview
-- (src/components/ImportExcel.tsx) shows the same three numbers.
alter table public.purchase_receipts
  add column if not exists rounding_adjustment integer not null default 0;
alter table public.consignment_receipts
  add column if not exists rounding_adjustment integer not null default 0;

-- confirm_purchase_receipt: same body as 0002, except total_amount now
-- includes the receipt's rounding adjustment.
create or replace function confirm_purchase_receipt(p_receipt_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; item record; v_batch uuid;
begin
  select * into r from purchase_receipts where id = p_receipt_id for update;
  if not found then raise exception 'Không tìm thấy phiếu nhập %', p_receipt_id; end if;
  if r.status <> 'DRAFT' then raise exception 'Phiếu % không ở trạng thái nháp', r.doc_code; end if;

  for item in select * from purchase_receipt_items where receipt_id = p_receipt_id loop
    insert into stock_batches (product_id, ownership, supplier_id, unit_cost, qty_received,
                               received_date, source_doc_type, source_doc_id, created_by)
    values (item.product_id, 'OWNED', null, item.unit_cost, item.qty,
            r.receipt_date, 'PURCHASE_RECEIPT', r.id, r.created_by)
    returning id into v_batch;

    update purchase_receipt_items set batch_id = v_batch where id = item.id;

    insert into stock_movements (batch_id, movement_kind, qty, from_location_id, to_location_id,
                                 ref_doc_type, ref_doc_id, created_by)
    values (v_batch, 'IN_PURCHASE', item.qty, null, r.warehouse_id,
            'PURCHASE_RECEIPT', r.id, r.created_by);
  end loop;

  update purchase_receipts
     set status = 'CONFIRMED',
         total_amount = (select coalesce(sum(qty * unit_cost), 0)
                           from purchase_receipt_items where receipt_id = p_receipt_id)
                        + coalesce(r.rounding_adjustment, 0)
   where id = p_receipt_id;
end $$;
