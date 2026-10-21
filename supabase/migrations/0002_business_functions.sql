-- =====================================================================
-- 0002_business_functions.sql — Hàm nghiệp vụ (chạy SAU 0001)
-- Mọi thao tác đổi trạng thái kho / công nợ đều đi qua các hàm này để
-- đảm bảo quy tắc: lô, sổ cái, phân bổ trước - hoá đơn sau, công nợ tự sinh.
-- Các hàm dùng SECURITY DEFINER để thao tác nguyên tử (atomic).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Lấy (hoặc tạo) kho ảo của một đối tác
-- ---------------------------------------------------------------------
create or replace function ensure_partner_location(p_partner_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text;
begin
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

-- ---------------------------------------------------------------------
-- XÁC NHẬN PHIẾU NHẬP MUA ĐỨT -> sinh lô OWNED + biến động nhập
-- ---------------------------------------------------------------------
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
   where id = p_receipt_id;
end $$;

-- ---------------------------------------------------------------------
-- XÁC NHẬN PHIẾU NHẬN KÝ GỬI -> sinh lô CONSIGNED + biến động nhập
-- (chưa phát sinh phải trả; phải trả chỉ sinh khi hàng bán được)
-- ---------------------------------------------------------------------
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

  update consignment_receipts set status = 'CONFIRMED' where id = p_receipt_id;
end $$;

-- ---------------------------------------------------------------------
-- XÁC NHẬN PHIẾU GỬI HÀNG CHO ĐỐI TÁC -> chuyển nơi lưu giữ sang kho ảo đối tác
-- - Chỉ đổi custody, không đổi sở hữu, không sinh doanh thu/công nợ.
-- - Ô D (ký gửi chồng ký gửi): lô CONSIGNED chỉ được gửi tiếp khi NCC cho phép.
-- - Kiểm tra hạn mức ký gửi của đối tác (theo giá chuyển giao, phần CONSIGNMENT).
-- ---------------------------------------------------------------------
create or replace function confirm_consignment_out(p_slip_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; item record; v_loc uuid; v_batch record; v_at_partner numeric; v_this numeric;
begin
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

-- ---------------------------------------------------------------------
-- XÁC NHẬN PHIẾU PHÂN BỔ -> kiểm tra 3 khoá:
--  1) Tổng phân bổ theo sản phẩm không vượt số đối tác đã báo tiêu thụ.
--  2) Phân bổ theo từng bản chất không vượt hạn mức đã giao theo bản chất đó
--     (vd: tối đa 5 mua đứt / 10 ký gửi) trừ phần đã phân bổ trước.
--  3) Lô phân bổ phải còn đủ số lượng tại kho ảo của đối tác.
-- ---------------------------------------------------------------------
create or replace function confirm_allocation(p_allocation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; grp record; line record; v_rem numeric; v_loc uuid; v_q integer;
begin
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

-- ---------------------------------------------------------------------
-- XÁC NHẬN CHỨNG TỪ BH / KG -> xuất kho, sinh công nợ:
--  - Dòng thuộc lô CONSIGNED -> phải trả NCC theo GIÁ KÝ GỬI của lô
--    (chiết khấu trên BH không chạm vào khoản này).
--  - Chứng từ bán chịu cho đối tác -> 1 khoản phải thu theo tổng chứng từ
--    (BH đã trừ chiết khấu).
--  - Dòng gắn phân bổ: BH chỉ nhận dòng PURCHASED, KG chỉ nhận dòng CONSIGNED.
-- ---------------------------------------------------------------------
create or replace function confirm_sales_document(p_doc_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; line record; v_batch record; v_subtotal numeric; v_pay_days integer;
begin
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

-- ---------------------------------------------------------------------
-- XUẤT HOÁ ĐƠN GTGT từ các dòng chứng từ quản lý đã xác nhận.
-- Mỗi dòng chỉ được xuất đúng một lần; dòng phân bổ chuyển sang INVOICED.
-- p_line_ids: danh sách sales_document_lines.id được chọn để xuất.
-- ---------------------------------------------------------------------
create or replace function create_vat_invoice(
  p_partner_id uuid, p_invoice_no text, p_symbol text, p_invoice_date date,
  p_provider text, p_line_ids uuid[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_invoice uuid; v_total numeric; v_bad integer;
begin
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

-- ---------------------------------------------------------------------
-- HUỶ HOÁ ĐƠN GTGT -> chỉ mở lại đúng các dòng phân bổ của hoá đơn đó
-- ---------------------------------------------------------------------
create or replace function cancel_vat_invoice(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
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

-- ---------------------------------------------------------------------
-- XÁC NHẬN PHIẾU TRẢ HÀNG -> biến động theo loại trả:
--  CUSTOMER_RETURN : hàng từ ngoài về kho mình (to_location)
--  PARTNER_RETURN  : từ kho ảo đối tác về kho mình
--  SUPPLIER_RETURN : từ kho mình ra khỏi hệ thống, trả NCC
-- Lưu ý công nợ: nếu lô ký gửi đã bán bị khách trả và khoản phải trả NCC
-- chưa thanh toán, kế toán huỷ khoản phải trả đó (status = CANCELLED);
-- đã thanh toán thì ghi giảm vào đợt đối soát kế tiếp. Việc này làm ở
-- tầng ứng dụng vì phụ thuộc chứng từ bán gốc của từng trường hợp.
-- ---------------------------------------------------------------------
create or replace function confirm_return_document(p_return_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; item record; v_kind movement_type;
begin
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
