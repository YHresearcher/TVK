-- 0018: cung co phan quyen — M1+M2+M3 (kiem toan role 2026-10-29).
-- M1: 9 ham nghiep vu + ensure_partner_location + create_stock_adjustment +
--     delete_receipt duoc chen kiem tra vai tro DANG-FAIL-CLOSED (role NULL cung
--     bi chan), than ham giu nguyen ban dang chay live (0002 + 0014 + 0017).
--     Thu hoi EXECUTE khoi public, chi cap cho authenticated (anon khong goi duoc).
-- M2: stock_batches chi OWNER/WAREHOUSE/ACCOUNTING/CEO duoc SELECT truc tiep;
--     SALES dung view an toan v_batches_for_sales (them supplier_id,
--     return_by_date, expiry_date o CUOI danh sach cot).
--     v_batch_stock dat security_invoker=true de RLS cua bang goc ap dung.
-- M3: v_supplier_consignment + v_partner_consignment dat security_invoker=true
--     de RLS cua bang cong no ap dung (SALES khong thay phai tra NCC;
--     WAREHOUSE khong thay phai thu doi tac). CEO giu quyen doc day du.

create or replace function ensure_partner_location(p_partner_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text;
begin
  if current_app_role() is null or current_app_role() not in ('OWNER','WAREHOUSE') then
    raise exception 'Chỉ Chủ cửa hàng và Thủ kho mới được tạo kho đối tác.';
  end if;
  select id into v_id from locations
   where partner_id = p_partner_id and location_kind = 'PARTNER_VIRTUAL';
  if v_id is null then
    select name into v_name from partners where id = p_partner_id;
    insert into locations (name, location_kind, partner_id)
    values ('Kho đối tác: ' || coalesce(v_name, ''), 'PARTNER_VIRTUAL', p_partner_id)
    returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function confirm_purchase_receipt(p_receipt_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; item record; v_batch uuid;
begin
  if current_app_role() is null or current_app_role() not in ('OWNER','WAREHOUSE') then
    raise exception 'Chỉ Chủ cửa hàng và Thủ kho mới được xác nhận phiếu nhập.';
  end if;
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
  if current_app_role() is null or current_app_role() not in ('OWNER','WAREHOUSE') then
    raise exception 'Chỉ Chủ cửa hàng và Thủ kho mới được xác nhận phiếu nhận ký gửi.';
  end if;
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

create or replace function confirm_consignment_out(p_slip_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; item record; v_loc uuid; v_batch record; v_at_partner numeric; v_this numeric;
begin
  if current_app_role() is null or current_app_role() not in ('OWNER','WAREHOUSE') then
    raise exception 'Chỉ Chủ cửa hàng và Thủ kho mới được xác nhận phiếu gửi ký gửi.';
  end if;
  select * into r from consignment_out_slips where id = p_slip_id for update;
  if not found then raise exception 'Không tìm thấy phiếu gửi %', p_slip_id; end if;
  if r.status <> 'DRAFT' then raise exception 'Phiếu % không ở trạng thái nháp', r.doc_code; end if;

  v_loc := ensure_partner_location(r.partner_id);

  -- Hạn mức ký gửi: giá trị hàng ký gửi đang nằm tại đối tác + đợt này
  select coalesce(sum(bl.qty * b.unit_cost), 0) into v_at_partner
    from batch_locations bl
    join stock_batches b on b.id = bl.batch_id
    join locations l on l.id = bl.location_id
   where l.partner_id = r.partner_id;
  select coalesce(sum(qty * transfer_price), 0) into v_this
    from consignment_out_items where slip_id = p_slip_id and term = 'CONSIGNMENT';
  if (select consignment_limit from partners where id = r.partner_id) > 0
     and v_at_partner + v_this > (select consignment_limit from partners where id = r.partner_id) then
    raise exception 'Vượt hạn mức ký gửi của đối tác (đang giữ %, đợt này thêm %)', v_at_partner, v_this;
  end if;

  for item in select * from consignment_out_items where slip_id = p_slip_id loop
    select * into v_batch from stock_batches where id = item.batch_id;
    if v_batch.ownership = 'CONSIGNED'
       and not coalesce((select allow_sub_consignment from suppliers where id = v_batch.supplier_id), false) then
      raise exception 'Lô % là hàng ký gửi của NCC chưa cho phép ký gửi tiếp (ô D đang khoá)', v_batch.batch_code;
    end if;

    insert into stock_movements (batch_id, movement_kind, qty, from_location_id, to_location_id,
                                 ref_doc_type, ref_doc_id, created_by)
    values (item.batch_id, 'OUT_CONSIGNMENT', item.qty, item.from_location_id, v_loc,
            'CONSIGNMENT_OUT', r.id, r.created_by);
  end loop;

  update consignment_out_slips set status = 'CONFIRMED' where id = p_slip_id;
end $$;

create or replace function confirm_allocation(p_allocation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; grp record; line record; v_rem numeric; v_loc uuid; v_q integer;
begin
  if current_app_role() is null or current_app_role() not in ('OWNER','SALES','ACCOUNTING') then
    raise exception 'Chỉ Chủ cửa hàng, Bán hàng và Kế toán mới được xác nhận phân bổ.';
  end if;
  select * into r from allocation_slips where id = p_allocation_id for update;
  if not found then raise exception 'Không tìm thấy phiếu phân bổ %', p_allocation_id; end if;
  if r.status <> 'DRAFT' then raise exception 'Phiếu % không ở trạng thái nháp', r.doc_code; end if;

  -- Khoá 1: theo báo cáo tiêu thụ
  if r.report_id is not null then
    for grp in select product_id, sum(qty) as q from allocation_lines
                where allocation_id = p_allocation_id group by product_id loop
      select qty_not_yet_allocated into v_rem from v_consumption_progress
       where report_id = r.report_id and product_id = grp.product_id;
      if v_rem is null or grp.q > v_rem then
        raise exception 'Phân bổ vượt số lượng đã báo tiêu thụ của sản phẩm %', grp.product_id;
      end if;
    end loop;
  end if;

  -- Khoá 2: hạn mức theo bản chất (đã giao - đã phân bổ)
  for grp in select product_id, nature, sum(qty) as q from allocation_lines
              where allocation_id = p_allocation_id group by product_id, nature loop
    select qty_remaining_allocatable into v_rem from v_partner_term_balance
     where partner_id = r.partner_id and product_id = grp.product_id and nature = grp.nature::text;
    if v_rem is null or grp.q > v_rem then
      raise exception 'Phân bổ vượt hạn mức % của sản phẩm % (còn %)', grp.nature, grp.product_id, coalesce(v_rem, 0);
    end if;
  end loop;

  -- Khoá 3: lô còn hàng tại kho đối tác
  select id into v_loc from locations
   where partner_id = r.partner_id and location_kind = 'PARTNER_VIRTUAL';
  for line in select * from allocation_lines where allocation_id = p_allocation_id loop
    select qty into v_q from batch_locations
     where batch_id = line.batch_id and location_id = v_loc;
    if coalesce(v_q, 0) < line.qty then
      raise exception 'Lô phân bổ không còn đủ hàng tại kho đối tác';
    end if;
  end loop;

  update allocation_slips set status = 'CONFIRMED' where id = p_allocation_id;
end $$;

create or replace function confirm_sales_document(p_doc_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; line record; v_batch record; v_subtotal numeric; v_pay_days integer;
begin
  if current_app_role() is null or current_app_role() not in ('OWNER','SALES') then
    raise exception 'Chỉ Chủ cửa hàng và Bán hàng mới được xác nhận chứng từ bán hàng.';
  end if;
  select * into r from sales_documents where id = p_doc_id for update;
  if not found then raise exception 'Không tìm thấy chứng từ %', p_doc_id; end if;
  if r.status <> 'DRAFT' then raise exception 'Chứng từ % không ở trạng thái nháp', r.doc_code; end if;

  select coalesce(sum(line_total), 0) into v_subtotal
    from sales_document_lines where document_id = p_doc_id;

  for line in select * from sales_document_lines where document_id = p_doc_id loop
    if line.allocation_line_id is not null then
      if exists (select 1 from allocation_lines al
                  where al.id = line.allocation_line_id
                    and ((r.doc_kind = 'BH' and al.nature <> 'PURCHASED')
                      or (r.doc_kind = 'KG' and al.nature <> 'CONSIGNED'))) then
        raise exception 'Bản chất dòng phân bổ không khớp loại chứng từ %', r.doc_kind;
      end if;
    end if;

    if line.batch_id is not null then
      if line.from_location_id is null then
        raise exception 'Dòng bán thiếu kho xuất (from_location_id)';
      end if;
      insert into stock_movements (batch_id, movement_kind, qty, from_location_id, to_location_id,
                                   ref_doc_type, ref_doc_id, created_by)
      values (line.batch_id, 'OUT_SALE', line.qty, line.from_location_id, null,
              'SALES_DOCUMENT', r.id, r.created_by);

      select * into v_batch from stock_batches where id = line.batch_id;
      if v_batch.ownership = 'CONSIGNED' then
        select consignment_pay_days into v_pay_days from suppliers where id = v_batch.supplier_id;
        insert into supplier_payables (supplier_id, source_document_id, source_line_id, batch_id,
                                       qty, unit_price, amount, due_date)
        values (v_batch.supplier_id, r.id, line.id, line.batch_id,
                line.qty, v_batch.unit_cost, line.qty * v_batch.unit_cost,
                r.doc_date + coalesce(v_pay_days, 30));
      end if;
    end if;
  end loop;

  if r.partner_id is not null and r.is_credit then
    select payment_days into v_pay_days from partners where id = r.partner_id;
    insert into partner_receivables (partner_id, source_document_id, amount, due_date)
    values (r.partner_id, r.id, v_subtotal - r.discount_amount,
            r.doc_date + coalesce(v_pay_days, 0));
  end if;

  update sales_documents
     set subtotal = v_subtotal,
         total_amount = v_subtotal - discount_amount,
         status = 'CONFIRMED'
   where id = p_doc_id;
end $$;

create or replace function create_vat_invoice(
  p_partner_id uuid, p_invoice_no text, p_symbol text, p_invoice_date date,
  p_provider text, p_line_ids uuid[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_invoice uuid; v_total numeric; v_bad integer;
begin
  if current_app_role() is null or current_app_role() not in ('OWNER','ACCOUNTING') then
    raise exception 'Chỉ Chủ cửa hàng và Kế toán mới được xuất hoá đơn GTGT.';
  end if;
  if (select count(*) from sales_document_lines where id = any(p_line_ids))
     <> coalesce(array_length(p_line_ids, 1), 0) then
    raise exception 'Có dòng chứng từ không tồn tại trong danh sách xuất hoá đơn';
  end if;

  select count(*) into v_bad
    from sales_document_lines l
    join sales_documents d on d.id = l.document_id
   where l.id = any(p_line_ids) and d.status <> 'CONFIRMED';
  if v_bad > 0 then raise exception 'Có dòng thuộc chứng từ chưa xác nhận'; end if;

  select count(*) into v_bad
    from vat_invoice_lines where sales_document_line_id = any(p_line_ids) and is_active;
  if v_bad > 0 then raise exception 'Có dòng đã được xuất hoá đơn trước đó'; end if;

  select coalesce(sum(line_total), 0) into v_total
    from sales_document_lines where id = any(p_line_ids);

  insert into vat_invoices (invoice_no, symbol, invoice_date, provider, partner_id, total_amount)
  values (p_invoice_no, p_symbol, p_invoice_date, p_provider, p_partner_id, v_total)
  returning id into v_invoice;

  insert into vat_invoice_lines (vat_invoice_id, sales_document_line_id, line_no, amount)
  select v_invoice, l.id, row_number() over (order by u.ord), l.line_total
    from unnest(p_line_ids) with ordinality as u(id, ord)
    join sales_document_lines l on l.id = u.id;

  update allocation_lines al
     set invoice_status = 'INVOICED'
   where al.id in (select allocation_line_id from sales_document_lines
                    where id = any(p_line_ids) and allocation_line_id is not null);

  return v_invoice;
end $$;

create or replace function cancel_vat_invoice(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_app_role() is null or current_app_role() not in ('OWNER','ACCOUNTING') then
    raise exception 'Chỉ Chủ cửa hàng và Kế toán mới được huỷ hoá đơn GTGT.';
  end if;
  if not exists (select 1 from vat_invoices where id = p_invoice_id and status = 'ISSUED') then
    raise exception 'Hoá đơn không tồn tại hoặc đã huỷ';
  end if;

  update allocation_lines al
     set invoice_status = 'NOT_INVOICED'
   where al.id in (select sdl.allocation_line_id
                     from vat_invoice_lines vil
                     join sales_document_lines sdl on sdl.id = vil.sales_document_line_id
                    where vil.vat_invoice_id = p_invoice_id and vil.is_active
                      and sdl.allocation_line_id is not null);

  update vat_invoice_lines set is_active = false where vat_invoice_id = p_invoice_id;
  update vat_invoices set status = 'CANCELLED' where id = p_invoice_id;
end $$;

create or replace function confirm_return_document(p_return_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; item record; v_kind movement_type;
begin
  if current_app_role() is null or current_app_role() not in ('OWNER','WAREHOUSE') then
    raise exception 'Chỉ Chủ cửa hàng và Thủ kho mới được xác nhận phiếu trả hàng.';
  end if;
  select * into r from return_documents where id = p_return_id for update;
  if not found then raise exception 'Không tìm thấy phiếu trả %', p_return_id; end if;
  if r.status <> 'DRAFT' then raise exception 'Phiếu % không ở trạng thái nháp', r.doc_code; end if;

  v_kind := case r.return_kind
              when 'SUPPLIER_RETURN' then 'OUT_RETURN_SUPPLIER'::movement_type
              else 'IN_RETURN'::movement_type end;

  for item in select * from return_items where return_id = p_return_id loop
    insert into stock_movements (batch_id, movement_kind, qty, from_location_id, to_location_id,
                                 ref_doc_type, ref_doc_id, created_by)
    values (item.batch_id, v_kind, item.qty, item.from_location_id, item.to_location_id,
            'RETURN_DOCUMENT', r.id, r.created_by);
  end loop;

  update return_documents set status = 'CONFIRMED' where id = p_return_id;
end $$;

create or replace function create_stock_adjustment(
  p_batch_id uuid, p_location_id uuid, p_qty_delta integer, p_note text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if current_app_role() is null or current_app_role() not in ('OWNER','WAREHOUSE') then
    raise exception 'Không có quyền điều chỉnh kho';
  end if;
  if p_qty_delta = 0 then raise exception 'Số lượng điều chỉnh phải khác 0'; end if;

  if p_qty_delta > 0 then
    insert into stock_movements (batch_id, movement_kind, qty, from_location_id, to_location_id,
                                 ref_doc_type, note, created_by)
    values (p_batch_id, 'ADJUSTMENT', p_qty_delta, null, p_location_id,
            'STOCK_ADJUSTMENT', p_note, auth.uid())
    returning id into v_id;
  else
    insert into stock_movements (batch_id, movement_kind, qty, from_location_id, to_location_id,
                                 ref_doc_type, note, created_by)
    values (p_batch_id, 'ADJUSTMENT', -p_qty_delta, p_location_id, null,
            'STOCK_ADJUSTMENT', p_note, auth.uid())
    returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function delete_receipt(p_receipt_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_batch_ids uuid[];
  v_block_code text;
  v_other_moves int;
  v_doc_type text;
begin
  if current_app_role() is null or current_app_role() <> 'OWNER' then
    raise exception 'Chỉ chủ cửa hàng mới được xoá phiếu nhập.';
  end if;

  if p_kind = 'PN' then
    v_doc_type := 'PURCHASE_RECEIPT';
    select doc_code into v_code from purchase_receipts where id = p_receipt_id for update;
    if not found then raise exception 'Không tìm thấy phiếu nhập.'; end if;
  elsif p_kind = 'NK' then
    v_doc_type := 'CONSIGNMENT_RECEIPT';
    select doc_code into v_code from consignment_receipts where id = p_receipt_id for update;
    if not found then raise exception 'Không tìm thấy phiếu nhập.'; end if;
  else
    raise exception 'Loại phiếu không hợp lệ.';
  end if;

  select coalesce(array_agg(id), '{}') into v_batch_ids from stock_batches
    where source_doc_type = v_doc_type and source_doc_id = p_receipt_id;

  -- Lô đã đi tiếp thì không xoá được: đã gửi ký gửi, đã phân bổ, đã
  -- bán, đã sinh phải trả, đã trả hàng.
  select b.batch_code into v_block_code from stock_batches b
    where b.id = any (v_batch_ids)
      and (exists (select 1 from consignment_out_items where batch_id = b.id)
        or exists (select 1 from allocation_lines where batch_id = b.id)
        or exists (select 1 from sales_document_lines where batch_id = b.id)
        or exists (select 1 from supplier_payables where batch_id = b.id)
        or exists (select 1 from return_items where batch_id = b.id))
    limit 1;
  if v_block_code is not null then
    raise exception 'Lô % đã phát sinh bán/gửi đi, không xoá được phiếu %.', v_block_code, v_code;
  end if;

  -- Biến động khác ngoài biến động nhập của chính phiếu này cũng chặn.
  select count(*) into v_other_moves from stock_movements m
    where m.batch_id = any (v_batch_ids)
      and not (m.ref_doc_type = v_doc_type and m.ref_doc_id = p_receipt_id);
  if v_other_moves > 0 then
    raise exception 'Phiếu % đã có biến động kho tiếp theo, không xoá được.', v_code;
  end if;

  -- Xoá theo thứ tự khoá ngoại: biến động nhập của phiếu → phiếu
  -- (dòng cascade theo) → lô (vị trí tồn cascade theo).
  delete from stock_movements
    where batch_id = any (v_batch_ids)
      and ref_doc_type = v_doc_type and ref_doc_id = p_receipt_id;
  if p_kind = 'PN' then
    delete from purchase_receipts where id = p_receipt_id;
  else
    delete from consignment_receipts where id = p_receipt_id;
  end if;
  delete from stock_batches where id = any (v_batch_ids);
end $$;

-- Thu hoi EXECUTE khoi public, chi cap cho authenticated.
revoke execute on function ensure_partner_location(uuid) from public;
grant execute on function ensure_partner_location(uuid) to authenticated;
revoke execute on function confirm_purchase_receipt(uuid) from public;
grant execute on function confirm_purchase_receipt(uuid) to authenticated;
revoke execute on function confirm_consignment_receipt(uuid) from public;
grant execute on function confirm_consignment_receipt(uuid) to authenticated;
revoke execute on function confirm_consignment_out(uuid) from public;
grant execute on function confirm_consignment_out(uuid) to authenticated;
revoke execute on function confirm_allocation(uuid) from public;
grant execute on function confirm_allocation(uuid) to authenticated;
revoke execute on function confirm_sales_document(uuid) from public;
grant execute on function confirm_sales_document(uuid) to authenticated;
revoke execute on function create_vat_invoice(uuid, text, text, date, text, uuid[]) from public;
grant execute on function create_vat_invoice(uuid, text, text, date, text, uuid[]) to authenticated;
revoke execute on function cancel_vat_invoice(uuid) from public;
grant execute on function cancel_vat_invoice(uuid) to authenticated;
revoke execute on function confirm_return_document(uuid) from public;
grant execute on function confirm_return_document(uuid) to authenticated;
revoke execute on function create_stock_adjustment(uuid, uuid, integer, text) from public;
grant execute on function create_stock_adjustment(uuid, uuid, integer, text) to authenticated;
revoke execute on function delete_receipt(uuid, text) from public;
grant execute on function delete_receipt(uuid, text) to authenticated;

-- M2: SELECT truc tiep tren stock_batches — loai SALES (giua nguyen ghi=khong ai).
drop policy if exists pol_stock_batches_sel on stock_batches;
create policy pol_stock_batches_sel on stock_batches for select to authenticated
  using (current_app_role() = any (array['OWNER','WAREHOUSE','ACCOUNTING','CEO']::app_role[]));

-- View an toan cho SALES: 3 cot moi (supplier_id, return_by_date,
-- expiry_date) PHAI nam o CUOI danh sach — CREATE OR REPLACE VIEW so cot
-- theo vi tri, chen giua se doi ten cot cu va loi 42P16.
create or replace view v_batches_for_sales as
select b.id as batch_id, b.batch_code, b.product_id, p.sku, p.name as product_name,
       b.ownership, s.name as supplier_name,
       bl.location_id, l.name as location_name, l.location_kind, l.partner_id,
       bl.qty, b.received_date, b.status, b.supplier_id, b.return_by_date, b.expiry_date
from stock_batches b
join products p on p.id = b.product_id
left join suppliers s on s.id = b.supplier_id
join batch_locations bl on bl.batch_id = b.id
join locations l on l.id = bl.location_id;

-- M2+M3: view tien/tong hop chay theo quyen cua nguoi goi (RLS bang goc ap dung).
alter view v_batch_stock set (security_invoker = true);
alter view v_supplier_consignment set (security_invoker = true);
alter view v_partner_consignment set (security_invoker = true);

grant select on v_batch_stock, v_batches_for_sales, v_supplier_consignment,
  v_partner_consignment to authenticated;