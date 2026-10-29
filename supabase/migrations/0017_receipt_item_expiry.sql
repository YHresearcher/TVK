-- 0017: han dung theo dong phieu nhap (co so cho cot HanDung khi import
-- + o ngay tren form nhap tay). Lo nhot mang expiry_date tu dong phieu;
-- linh kien de trong, phan bo FIFO nhu cu. Chi them cot + truyen gia tri
-- tu dong phieu sang lo trong 2 ham xac nhan; khong sua du lieu cu.
-- Ham confirm_consignment_receipt o day giu nguyen ban 0014 (tong tien
-- chinh xac) + them expiry_date; confirm_purchase_receipt giu ban 0002
-- + them expiry_date.
alter table purchase_receipt_items
  add column if not exists expiry_date date;
comment on column purchase_receipt_items.expiry_date is
  'Han dung cua dong hang (chi nhot); ghi sang lo khi xac nhan phieu';

alter table consignment_receipt_items
  add column if not exists expiry_date date;
comment on column consignment_receipt_items.expiry_date is
  'Han dung cua dong hang (chi nhot); ghi sang lo khi xac nhan phieu';

create or replace function confirm_purchase_receipt(p_receipt_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; item record; v_batch uuid;
begin
  select * into r from purchase_receipts where id = p_receipt_id for update;
  if not found then raise exception 'Không tìm thấy phiếu nhập %', p_receipt_id; end if;
  if r.status <> 'DRAFT' then raise exception 'Phiếu % không ở trạng thái nháp', r.doc_code; end if;

  for item in select * from purchase_receipt_items where receipt_id = p_receipt_id loop
    insert into stock_batches (product_id, ownership, supplier_id, unit_cost, qty_received,
                               received_date, source_doc_type, source_doc_id, expiry_date, created_by)
    values (item.product_id, 'OWNED', null, item.unit_cost, item.qty,
            r.receipt_date, 'PURCHASE_RECEIPT', r.id, item.expiry_date, r.created_by)
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
   where id = p_receipt_id;
end $$;

create or replace function confirm_consignment_receipt(p_receipt_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; item record; v_batch uuid; v_return_by date;
begin
  select * into r from consignment_receipts where id = p_receipt_id for update;
  if not found then raise exception 'Không tìm thấy phiếu nhận ký gửi %', p_receipt_id; end if;
  if r.status <> 'DRAFT' then raise exception 'Phiếu % không ở trạng thái nháp', r.doc_code; end if;

  v_return_by := coalesce(r.return_by_date,
    r.receipt_date + (select consignment_return_days from suppliers where id = r.supplier_id));

  for item in select * from consignment_receipt_items where receipt_id = p_receipt_id loop
    insert into stock_batches (product_id, ownership, supplier_id, unit_cost, qty_received,
                               received_date, source_doc_type, source_doc_id, return_by_date, expiry_date, created_by)
    values (item.product_id, 'CONSIGNED', r.supplier_id, item.consignment_price, item.qty,
            r.receipt_date, 'CONSIGNMENT_RECEIPT', r.id, v_return_by, item.expiry_date, r.created_by)
    returning id into v_batch;

    update consignment_receipt_items set batch_id = v_batch where id = item.id;

    insert into stock_movements (batch_id, movement_kind, qty, from_location_id, to_location_id,
                                 ref_doc_type, ref_doc_id, created_by)
    values (v_batch, 'IN_CONSIGNMENT', item.qty, null, r.warehouse_id,
            'CONSIGNMENT_RECEIPT', r.id, r.created_by);
  end loop;

  update consignment_receipts
     set status = 'CONFIRMED',
         total_amount = (select coalesce(sum(qty * consignment_price), 0)
                           from consignment_receipt_items where receipt_id = p_receipt_id)
   where id = p_receipt_id;
end $$;
