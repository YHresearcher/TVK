-- 0014: giá vốn chính xác tới 4 số lẻ, không làm tròn đơn giá.
--
-- Quyết định của chủ cửa hàng 28/10 ("tính đúng từng xu, để số lẻ"):
-- đơn giá vốn = GiaUSD × Tỷ giá × (1 + VAT%) giữ nguyên giá trị chính
-- xác (tối đa 4 số lẻ với đầu vào USD 2 số lẻ, tỷ giá nguyên, VAT 8/10%);
-- tổng phiếu = tổng chính xác các dòng, không còn chênh lệch làm tròn.
-- Dữ liệu cũ giữ nguyên (đơn giá nguyên đã lưu không đổi giá trị, chỉ
-- đổi kiểu cột). Cột rounding_adjustment giữ lại làm chốt lịch sử:
-- phiếu mới luôn ghi 0; hàm xác nhận cộng nó như cũ nên không đổi.
-- Giá bán (lẻ/gara/đại lý) vẫn làm tròn đồng chẵn như trước — chỉ phần
-- giá vốn và tổng tiền là tính chính xác.
alter table public.stock_batches
  alter column unit_cost type numeric(15,4);
alter table public.purchase_receipt_items
  alter column unit_cost type numeric(15,4);
alter table public.purchase_receipts
  alter column total_amount type numeric(15,4);
alter table public.consignment_receipt_items
  alter column consignment_price type numeric(15,4);
alter table public.consignment_receipts
  add column if not exists total_amount numeric(15,4) not null default 0;

-- confirm_consignment_receipt: như 0002, cộng thêm ghi total_amount =
-- tổng chính xác các dòng (phiếu NK trước đây không có cột tổng tiền).
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
                               received_date, source_doc_type, source_doc_id, return_by_date, created_by)
    values (item.product_id, 'CONSIGNED', r.supplier_id, item.consignment_price, item.qty,
            r.receipt_date, 'CONSIGNMENT_RECEIPT', r.id, v_return_by, r.created_by)
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
