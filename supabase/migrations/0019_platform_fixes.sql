-- 0019_platform_fixes.sql
-- Tổng hợp các bản vá nền tảng cho 4 giai đoạn theo báo cáo audit TVK:
-- 1. FS-01 & DB-04: Siết chặt trigger guard_profile_privileges, cấm tài khoản thường tự ý đổi must_change_password.
--    Thêm trigger tự động gỡ must_change_password khi encrypted_password trên auth.users thay đổi.
-- 2. DB-01 & FE-01: Cập nhật view v_partner_term_balance và RPC confirm_consignment_out hỗ trợ term PURCHASE/CONSIGNMENT;
--    chặn gửi ký gửi lỗ ở Ô D (transfer_price < unit_cost).
-- 3. FS-03: RPC confirm_sales_document chặn bán lỗ hàng ký gửi (unit_price < unit_cost).
-- 4. DB-03: Đồng bộ kiểu số liệu thập phân numeric(15,4) cho supplier_payables và settlement_lines;
--    sửa delete_receipt chỉ cho xoá phiếu DRAFT, tuyệt đối không xoá sổ cái stock_movements;
--    thêm security_invoker = true cho các view v_product_stock, v_partner_term_balance, v_consumption_progress.
-- 5. DB-02: Cập nhật apply_payment_to_balance chặn overpayment và tự động phân bổ thanh toán khi có settlement_id.

-- =====================================================================
-- 1. DB-04: Siết chặt guard_profile_privileges & trigger auth.users
-- =====================================================================
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Đường service-role: auth.uid() rỗng -> cho qua
  if auth.uid() is null then
    return NEW;
  end if;
  -- Chủ cửa hàng trực tiếp -> cho qua
  if current_app_role() = 'OWNER' then
    return NEW;
  end if;
  -- Trigger hệ thống (auth.users đổi mật khẩu, pg_trigger_depth > 1) hoặc hàm bảo mật nội bộ
  if pg_trigger_depth() > 1 or current_setting('tvk.bypass_profile_guard', true) = 'on' then
    return NEW;
  end if;
  -- Tài khoản thường qua REST API client: cấm đổi vai trò, trạng thái, email và cờ must_change_password
  if NEW.role is distinct from OLD.role
    or NEW.is_active is distinct from OLD.is_active
    or NEW.email is distinct from OLD.email
    or NEW.must_change_password is distinct from OLD.must_change_password then
    raise exception 'Không có quyền thay đổi vai trò, trạng thái, email hoặc cờ bảo mật của tài khoản.';
  end if;
  return NEW;
end;
$$;

-- Hàm RPC an toàn giải phóng cờ must_change_password cho chính người dùng sau khi đổi mật khẩu
create or replace function public.complete_password_change()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập.';
  end if;
  perform set_config('tvk.bypass_profile_guard', 'on', true);
  update public.profiles set must_change_password = false where id = auth.uid();
  perform set_config('tvk.bypass_profile_guard', 'off', true);
end;
$$;

grant execute on function public.complete_password_change() to authenticated;

-- Trigger tự động gỡ must_change_password khi mật khẩu được cập nhật trong auth.users
create or replace function public.on_auth_user_password_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.encrypted_password is distinct from OLD.encrypted_password then
    update public.profiles set must_change_password = false where id = NEW.id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_auth_user_password_change on auth.users;
create trigger trg_auth_user_password_change
  after update on auth.users
  for each row execute function public.on_auth_user_password_change();

-- =====================================================================
-- 2. DB-03: Đồng bộ numeric(15,4) cho supplier_payables & settlement_lines
-- =====================================================================
-- Lưu ý: Trong PostgreSQL, để alter type của cột mà view phụ thuộc, cần drop view trước rồi tạo lại
drop view if exists public.v_supplier_consignment cascade;

alter table public.supplier_payables
  alter column unit_price type numeric(15,4),
  alter column amount type numeric(15,4),
  alter column amount_paid type numeric(15,4);

alter table public.settlement_lines
  alter column amount type numeric(15,4);

-- Tái tạo view v_supplier_consignment với security_invoker = true
create or replace view public.v_supplier_consignment
with (security_invoker = true) as
select s.id as supplier_id, s.name as supplier_name,
       coalesce((select sum(qty_received) from stock_batches b
                  where b.supplier_id = s.id and b.ownership = 'CONSIGNED'), 0) as qty_received,
       coalesce((select sum(qty) from supplier_payables sp
                  where sp.supplier_id = s.id and sp.status <> 'CANCELLED'), 0) as qty_sold,
       coalesce((select sum(m.qty) from stock_movements m
                  join stock_batches b on b.id = m.batch_id
                  where b.supplier_id = s.id and m.movement_kind = 'OUT_RETURN_SUPPLIER'), 0) as qty_returned,
       coalesce((select sum(bl.qty) from batch_locations bl
                  join stock_batches b on b.id = bl.batch_id
                  join locations l on l.id = bl.location_id
                  where b.supplier_id = s.id and l.location_kind = 'OWN_WAREHOUSE'), 0) as qty_on_hand_own_wh,
       coalesce((select sum(amount - amount_paid) from supplier_payables sp
                  where sp.supplier_id = s.id and sp.status in ('UNPAID','PARTIAL')), 0) as payable_outstanding
from suppliers s;

grant select on public.v_supplier_consignment to authenticated;

-- =====================================================================
-- 3. DB-01 & FS-03: confirm_consignment_out & v_partner_term_balance
-- =====================================================================
create or replace function confirm_consignment_out(p_slip_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  item record;
  v_loc uuid;
  v_batch record;
  v_at_partner numeric;
  v_this numeric;
begin
  if current_app_role() is null or current_app_role() not in ('OWNER','WAREHOUSE') then
    raise exception 'Chỉ Chủ cửa hàng và Thủ kho mới được xác nhận phiếu gửi ký gửi.';
  end if;
  select * into r from consignment_out_slips where id = p_slip_id for update;
  if not found then raise exception 'Không tìm thấy phiếu gửi %', p_slip_id; end if;
  if r.status <> 'DRAFT' then raise exception 'Phiếu % không ở trạng thái nháp', r.doc_code; end if;

  v_loc := ensure_partner_location(r.partner_id);

  -- Hạn mức ký gửi: chỉ tính hàng ký gửi đang nằm tại đối tác + đợt này (term = CONSIGNMENT)
  select coalesce(sum(bl.qty * b.unit_cost), 0) into v_at_partner
    from batch_locations bl
    join stock_batches b on b.id = bl.batch_id
    join locations l on l.id = bl.location_id
   where l.partner_id = r.partner_id;

  select coalesce(sum(qty * transfer_price), 0) into v_this
    from consignment_out_items
   where slip_id = p_slip_id and term = 'CONSIGNMENT';

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

    -- FS-03: Chặn gửi ký gửi lỗ ở Ô D (transfer_price < unit_cost)
    if v_batch.ownership = 'CONSIGNED' and item.transfer_price < v_batch.unit_cost then
      raise exception 'Giá chuyển giao (%) thấp hơn giá vốn ký gửi (%) của lô % (chặn gửi ký gửi lỗ ở Ô D)',
        item.transfer_price, v_batch.unit_cost, v_batch.batch_code;
    end if;

    insert into stock_movements (batch_id, movement_kind, qty, from_location_id, to_location_id,
                                 ref_doc_type, ref_doc_id, created_by)
    values (item.batch_id, 'OUT_CONSIGNMENT', item.qty, item.from_location_id, v_loc,
            'CONSIGNMENT_OUT', r.id, r.created_by);
  end loop;

  update consignment_out_slips set status = 'CONFIRMED' where id = p_slip_id;
end $$;

-- FS-03: confirm_sales_document chặn bán lỗ hàng ký gửi
create or replace function confirm_sales_document(p_doc_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  line record;
  v_batch record;
  v_subtotal numeric;
  v_pay_days integer;
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

      select * into v_batch from stock_batches where id = line.batch_id;

      -- FS-03: Chặn bán lỗ hàng ký gửi (unit_price < unit_cost)
      if v_batch.ownership = 'CONSIGNED' and line.unit_price < v_batch.unit_cost then
        raise exception 'Giá bán (%) thấp hơn giá vốn ký gửi (%) của lô % (chặn bán lỗ hàng ký gửi)',
          line.unit_price, v_batch.unit_cost, v_batch.batch_code;
      end if;

      insert into stock_movements (batch_id, movement_kind, qty, from_location_id, to_location_id,
                                   ref_doc_type, ref_doc_id, created_by)
      values (line.batch_id, 'OUT_SALE', line.qty, line.from_location_id, null,
              'SALES_DOCUMENT', r.id, r.created_by);

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

-- View v_partner_term_balance cập nhật điều khoản phân bổ Section 8.4 SPEC
create or replace view public.v_partner_term_balance as
with delivered as (
  select s.partner_id, b.product_id,
         case when i.term = 'PURCHASE' then 'PURCHASED' else 'CONSIGNED' end as nature,
         sum(i.qty) as qty_delivered
  from consignment_out_items i
  join consignment_out_slips s on s.id = i.slip_id and s.status = 'CONFIRMED'
  join stock_batches b on b.id = i.batch_id
  group by s.partner_id, b.product_id, nature
),
allocated as (
  select a.partner_id, al.product_id, al.nature::text as nature, sum(al.qty) as qty_allocated
  from allocation_lines al
  join allocation_slips a on a.id = al.allocation_id and a.status = 'CONFIRMED'
  group by a.partner_id, al.product_id, al.nature
)
select d.partner_id, d.product_id, d.nature,
       d.qty_delivered,
       coalesce(a.qty_allocated, 0) as qty_allocated,
       d.qty_delivered - coalesce(a.qty_allocated, 0) as qty_remaining_allocatable
from delivered d
left join allocated a
  on a.partner_id = d.partner_id and a.product_id = d.product_id and a.nature = d.nature;

alter view public.v_partner_term_balance set (security_invoker = true);
grant select on public.v_partner_term_balance to authenticated;

-- =====================================================================
-- 4. DB-03: Sửa logic delete_receipt (chỉ cho xoá DRAFT, cấm xoá sổ cái)
-- =====================================================================
create or replace function public.delete_receipt(p_receipt_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_status doc_status;
begin
  if current_app_role() is null or current_app_role() <> 'OWNER' then
    raise exception 'Chỉ chủ cửa hàng mới được xoá phiếu nhập.';
  end if;

  if p_kind = 'PN' then
    select doc_code, status into v_code, v_status
      from purchase_receipts where id = p_receipt_id for update;
    if not found then raise exception 'Không tìm thấy phiếu nhập mua.'; end if;
    if v_status <> 'DRAFT' then
      raise exception 'Chỉ được xoá phiếu nhập ở trạng thái nháp (DRAFT). Phiếu % đã được xác nhận, cấm xoá khỏi sổ cái.', v_code;
    end if;

    delete from purchase_receipt_items where receipt_id = p_receipt_id;
    delete from purchase_receipts where id = p_receipt_id;

  elsif p_kind = 'NK' then
    select doc_code, status into v_code, v_status
      from consignment_receipts where id = p_receipt_id for update;
    if not found then raise exception 'Không tìm thấy phiếu nhận ký gửi.'; end if;
    if v_status <> 'DRAFT' then
      raise exception 'Chỉ được xoá phiếu nhập ở trạng thái nháp (DRAFT). Phiếu % đã được xác nhận, cấm xoá khỏi sổ cái.', v_code;
    end if;

    delete from consignment_receipt_items where receipt_id = p_receipt_id;
    delete from consignment_receipts where id = p_receipt_id;

  else
    raise exception 'Loại phiếu không hợp lệ (phải là PN hoặc NK).';
  end if;
end $$;

-- Thêm security_invoker = true cho các view
alter view public.v_product_stock set (security_invoker = true);
alter view public.v_consumption_progress set (security_invoker = true);
alter view public.v_batches_for_sales set (security_invoker = true);

grant select on public.v_product_stock, public.v_consumption_progress, public.v_batches_for_sales to authenticated;

-- =====================================================================
-- 5. DB-02: apply_payment_to_balance chặn overpayment & phân bổ settlement
-- =====================================================================
create or replace function public.apply_payment_to_balance() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_target_amount numeric;
  v_already_paid numeric;
  v_rem_pay numeric;
  v_line record;
  v_alloc numeric;
  v_cur_paid numeric;
  v_cur_tot numeric;
begin
  -- 1. Trả trực tiếp cho khoản phải trả NCC (payable_id)
  if new.payable_id is not null then
    select amount, amount_paid into v_target_amount, v_already_paid
      from supplier_payables where id = new.payable_id for update;
    if not found then
      raise exception 'Không tìm thấy khoản phải trả %', new.payable_id;
    end if;
    if v_already_paid + new.amount > v_target_amount then
      raise exception 'Thanh toán vượt quá công nợ còn lại của khoản phải trả (còn %, trả %)',
        v_target_amount - v_already_paid, new.amount;
    end if;

    update supplier_payables
       set amount_paid = amount_paid + new.amount,
           status = case
             when amount_paid + new.amount >= amount then 'PAID'::balance_status
             when amount_paid + new.amount > 0     then 'PARTIAL'::balance_status
             else status end
     where id = new.payable_id;
  end if;

  -- 2. Thu trực tiếp cho khoản phải thu đối tác (receivable_id)
  if new.receivable_id is not null then
    select amount, amount_paid into v_target_amount, v_already_paid
      from partner_receivables where id = new.receivable_id for update;
    if not found then
      raise exception 'Không tìm thấy khoản phải thu %', new.receivable_id;
    end if;
    if v_already_paid + new.amount > v_target_amount then
      raise exception 'Thu tiền vượt quá công nợ còn lại của khoản phải thu (còn %, thu %)',
        v_target_amount - v_already_paid, new.amount;
    end if;

    update partner_receivables
       set amount_paid = amount_paid + new.amount,
           status = case
             when amount_paid + new.amount >= amount then 'PAID'::balance_status
             when amount_paid + new.amount > 0     then 'PARTIAL'::balance_status
             else status end
     where id = new.receivable_id;
  end if;

  -- 3. Thanh toán theo đợt đối soát (settlement_id) -> Tự động phân bổ vào settlement_lines
  if new.settlement_id is not null then
    if not exists (select 1 from settlements where id = new.settlement_id) then
      raise exception 'Không tìm thấy đợt đối soát %', new.settlement_id;
    end if;

    v_rem_pay := new.amount;
    for v_line in
      select * from settlement_lines
       where settlement_id = new.settlement_id
       order by id
    loop
      if v_rem_pay <= 0 then
        exit;
      end if;

      if v_line.payable_id is not null then
        select amount, amount_paid into v_cur_tot, v_cur_paid
          from supplier_payables where id = v_line.payable_id for update;
        v_alloc := least(v_rem_pay, v_cur_tot - v_cur_paid);
        if v_alloc > 0 then
          update supplier_payables
             set amount_paid = amount_paid + v_alloc,
                 status = case
                   when amount_paid + v_alloc >= amount then 'PAID'::balance_status
                   when amount_paid + v_alloc > 0     then 'PARTIAL'::balance_status
                   else status end
           where id = v_line.payable_id;
          v_rem_pay := v_rem_pay - v_alloc;
        end if;
      elsif v_line.receivable_id is not null then
        select amount, amount_paid into v_cur_tot, v_cur_paid
          from partner_receivables where id = v_line.receivable_id for update;
        v_alloc := least(v_rem_pay, v_cur_tot - v_cur_paid);
        if v_alloc > 0 then
          update partner_receivables
             set amount_paid = amount_paid + v_alloc,
                 status = case
                   when amount_paid + v_alloc >= amount then 'PAID'::balance_status
                   when amount_paid + v_alloc > 0     then 'PARTIAL'::balance_status
                   else status end
           where id = v_line.receivable_id;
          v_rem_pay := v_rem_pay - v_alloc;
        end if;
      end if;
    end loop;

    -- DB-02: Chặn thanh toán vượt quá tổng công nợ còn lại của đợt đối soát
    if v_rem_pay > 0 then
      raise exception 'Số tiền thanh toán (%) vượt quá tổng công nợ còn lại của đợt đối soát (thừa %)',
        new.amount, v_rem_pay;
    end if;
  end if;

  return new;
end $$;
