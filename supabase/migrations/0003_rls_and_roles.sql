-- =====================================================================
-- 0003_rls_and_roles.sql — Row Level Security theo vai trò (chạy SAU 0002)
-- Vai trò: OWNER (chủ) | SALES (bán hàng) | WAREHOUSE (kho) | ACCOUNTING (kế toán)
-- Nguyên tắc:
--  - Tồn kho (stock_batches, batch_locations, stock_movements) KHÔNG ai sửa
--    trực tiếp qua API: chỉ các hàm nghiệp vụ SECURITY DEFINER ở 0002 mới ghi.
--  - Dữ liệu tài chính (phải trả NCC, đối soát, thanh toán) chỉ OWNER + ACCOUNTING.
--  - SALES không truy cập được bảng chứa giá vốn / giá ký gửi ở tầng bảng.
--    Ở tầng cột (unit_cost trong stock_batches), Supabase dùng chung một DB role
--    'authenticated' cho mọi người dùng nên không tách cột bằng RLS được;
--    giao diện SALES bắt buộc dùng view v_batches_for_sales (không có unit_cost).
-- =====================================================================

-- Vai trò của người dùng đang đăng nhập (đọc từ profiles)
create or replace function current_app_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

-- Trigger áp sổ cái chạy với quyền chủ sở hữu để luôn cập nhật được tồn
alter function apply_stock_movement() security definer;
alter function apply_stock_movement() set search_path = public;

-- ---------------------------------------------------------------------
-- Bật RLS cho toàn bộ bảng
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','app_settings','document_counters',
    'products','product_codes','vehicles','product_fitments',
    'suppliers','partners','locations',
    'stock_batches','batch_locations','stock_movements',
    'purchase_receipts','purchase_receipt_items',
    'consignment_receipts','consignment_receipt_items',
    'consignment_out_slips','consignment_out_items',
    'consumption_reports','consumption_report_items',
    'allocation_slips','allocation_lines',
    'sales_orders','sales_documents','sales_document_lines',
    'vat_invoices','vat_invoice_lines',
    'supplier_payables','partner_receivables',
    'return_documents','return_items',
    'settlements','settlement_lines','payments'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- profiles & app_settings & document_counters (xử lý riêng)
-- ---------------------------------------------------------------------
create policy pol_profiles_sel on profiles for select to authenticated
  using (auth.uid() is not null);
create policy pol_profiles_ins on profiles for insert to authenticated
  with check (current_app_role() = 'OWNER');
create policy pol_profiles_upd_owner on profiles for update to authenticated
  using (current_app_role() = 'OWNER') with check (current_app_role() = 'OWNER');
create policy pol_profiles_upd_self on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy pol_profiles_del on profiles for delete to authenticated
  using (current_app_role() = 'OWNER');

create policy pol_settings_sel on app_settings for select to authenticated
  using (auth.uid() is not null);
create policy pol_settings_write on app_settings for all to authenticated
  using (current_app_role() = 'OWNER') with check (current_app_role() = 'OWNER');

-- document_counters: không có policy nào -> chỉ hàm SECURITY DEFINER truy cập được

-- ---------------------------------------------------------------------
-- Sinh policy hàng loạt theo nhóm quyền
--   sel = null  -> mọi người dùng đã đăng nhập được xem
--   wr  = null  -> không ai ghi trực tiếp (chỉ qua hàm nghiệp vụ)
--   del = true  -> cho phép xoá (chỉ áp dụng bảng dòng chi tiết của phiếu nháp)
-- ---------------------------------------------------------------------
do $$
declare
  cfg record;
  sel_arr text; wr_arr text;
begin
  for cfg in
    select * from (values
      -- bảng, quyền xem, quyền ghi, cho xoá
      ('products',               null, array['OWNER','WAREHOUSE']::app_role[], true),
      ('product_codes',          null, array['OWNER','WAREHOUSE']::app_role[], true),
      ('vehicles',               null, array['OWNER','WAREHOUSE']::app_role[], true),
      ('product_fitments',       null, array['OWNER','WAREHOUSE']::app_role[], true),
      ('locations',              null, array['OWNER','WAREHOUSE']::app_role[], true),
      ('suppliers',              null, array['OWNER','ACCOUNTING']::app_role[], false),
      ('partners',               null, array['OWNER','ACCOUNTING','SALES']::app_role[], false),
      -- Tồn kho: xem tất cả, ghi không ai (chỉ hàm nghiệp vụ)
      ('stock_batches',          null, null, false),
      ('batch_locations',        null, null, false),
      ('stock_movements',        null, null, false),
      -- Nhập hàng / gửi ký gửi: kho vận hành, kế toán xem
      ('purchase_receipts',      array['OWNER','WAREHOUSE','ACCOUNTING']::app_role[], array['OWNER','WAREHOUSE']::app_role[], false),
      ('purchase_receipt_items', array['OWNER','WAREHOUSE','ACCOUNTING']::app_role[], array['OWNER','WAREHOUSE']::app_role[], true),
      ('consignment_receipts',      array['OWNER','WAREHOUSE','ACCOUNTING']::app_role[], array['OWNER','WAREHOUSE']::app_role[], false),
      ('consignment_receipt_items', array['OWNER','WAREHOUSE','ACCOUNTING']::app_role[], array['OWNER','WAREHOUSE']::app_role[], true),
      ('consignment_out_slips',  array['OWNER','WAREHOUSE','ACCOUNTING']::app_role[], array['OWNER','WAREHOUSE']::app_role[], false),
      ('consignment_out_items',  array['OWNER','WAREHOUSE','ACCOUNTING']::app_role[], array['OWNER','WAREHOUSE']::app_role[], true),
      -- Tiêu thụ / phân bổ: bán hàng + kế toán
      ('consumption_reports',    array['OWNER','SALES','ACCOUNTING']::app_role[], array['OWNER','SALES','ACCOUNTING']::app_role[], false),
      ('consumption_report_items', array['OWNER','SALES','ACCOUNTING']::app_role[], array['OWNER','SALES','ACCOUNTING']::app_role[], true),
      ('allocation_slips',       array['OWNER','SALES','ACCOUNTING']::app_role[], array['OWNER','SALES','ACCOUNTING']::app_role[], false),
      ('allocation_lines',       array['OWNER','SALES','ACCOUNTING']::app_role[], array['OWNER','SALES','ACCOUNTING']::app_role[], true),
      -- Bán hàng
      ('sales_orders',           array['OWNER','SALES','ACCOUNTING']::app_role[], array['OWNER','SALES']::app_role[], false),
      ('sales_documents',        array['OWNER','SALES','ACCOUNTING']::app_role[], array['OWNER','SALES']::app_role[], false),
      ('sales_document_lines',   array['OWNER','SALES','ACCOUNTING']::app_role[], array['OWNER','SALES']::app_role[], true),
      -- Hoá đơn GTGT
      ('vat_invoices',           array['OWNER','SALES','ACCOUNTING']::app_role[], array['OWNER','ACCOUNTING']::app_role[], false),
      ('vat_invoice_lines',      array['OWNER','SALES','ACCOUNTING']::app_role[], array['OWNER','ACCOUNTING']::app_role[], false),
      -- Trả hàng
      ('return_documents',       array['OWNER','WAREHOUSE','ACCOUNTING']::app_role[], array['OWNER','WAREHOUSE']::app_role[], false),
      ('return_items',           array['OWNER','WAREHOUSE','ACCOUNTING']::app_role[], array['OWNER','WAREHOUSE']::app_role[], true),
      -- Đối soát & tiền: chỉ chủ + kế toán
      ('settlements',            array['OWNER','ACCOUNTING']::app_role[], array['OWNER','ACCOUNTING']::app_role[], false),
      ('settlement_lines',       array['OWNER','ACCOUNTING']::app_role[], array['OWNER','ACCOUNTING']::app_role[], true),
      ('payments',               array['OWNER','ACCOUNTING']::app_role[], array['OWNER','ACCOUNTING']::app_role[], false)
    ) as t(tbl, sel, wr, del)
  loop
    if cfg.sel is null then
      execute format(
        'create policy pol_%s_sel on %I for select to authenticated using (auth.uid() is not null)',
        cfg.tbl, cfg.tbl);
    else
      execute format(
        'create policy pol_%s_sel on %I for select to authenticated using (current_app_role() = any (%L::app_role[]))',
        cfg.tbl, cfg.tbl, cfg.sel);
    end if;

    if cfg.wr is not null then
      execute format(
        'create policy pol_%s_ins on %I for insert to authenticated with check (current_app_role() = any (%L::app_role[]))',
        cfg.tbl, cfg.tbl, cfg.wr);
      execute format(
        'create policy pol_%s_upd on %I for update to authenticated using (current_app_role() = any (%L::app_role[])) with check (current_app_role() = any (%L::app_role[]))',
        cfg.tbl, cfg.tbl, cfg.wr, cfg.wr);
      if cfg.del then
        execute format(
          'create policy pol_%s_del on %I for delete to authenticated using (current_app_role() = any (%L::app_role[]))',
          cfg.tbl, cfg.tbl, cfg.wr);
      end if;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Công nợ: sinh tự động bằng hàm nghiệp vụ (không insert trực tiếp),
-- kế toán được cập nhật (huỷ khoản, điều chỉnh hạn) và xem.
-- ---------------------------------------------------------------------
create policy pol_payables_sel on supplier_payables for select to authenticated
  using (current_app_role() = any (array['OWNER','ACCOUNTING']::app_role[]));
create policy pol_payables_upd on supplier_payables for update to authenticated
  using (current_app_role() = any (array['OWNER','ACCOUNTING']::app_role[]))
  with check (current_app_role() = any (array['OWNER','ACCOUNTING']::app_role[]));

create policy pol_receivables_sel on partner_receivables for select to authenticated
  using (current_app_role() = any (array['OWNER','ACCOUNTING','SALES']::app_role[]));
create policy pol_receivables_upd on partner_receivables for update to authenticated
  using (current_app_role() = any (array['OWNER','ACCOUNTING']::app_role[]))
  with check (current_app_role() = any (array['OWNER','ACCOUNTING']::app_role[]));

-- ---------------------------------------------------------------------
-- View an toàn cho SALES: tồn theo lô nhưng KHÔNG có giá vốn / giá ký gửi
-- ---------------------------------------------------------------------
create or replace view v_batches_for_sales as
select b.id as batch_id, b.batch_code, b.product_id, p.sku, p.name as product_name,
       b.ownership, s.name as supplier_name,
       bl.location_id, l.name as location_name, l.location_kind, l.partner_id,
       bl.qty, b.received_date, b.status
from stock_batches b
join products p on p.id = b.product_id
left join suppliers s on s.id = b.supplier_id
join batch_locations bl on bl.batch_id = b.id
join locations l on l.id = bl.location_id;

grant select on v_batch_stock, v_product_stock, v_supplier_consignment,
              v_partner_consignment, v_partner_term_balance, v_consumption_progress,
              v_batches_for_sales
  to authenticated;

-- ---------------------------------------------------------------------
-- Điều chỉnh tồn khi kiểm kê — chỉ OWNER / WAREHOUSE, luôn qua sổ cái
-- p_qty_delta > 0: tăng tồn tại kho; < 0: giảm tồn tại kho
-- ---------------------------------------------------------------------
create or replace function create_stock_adjustment(
  p_batch_id uuid, p_location_id uuid, p_qty_delta integer, p_note text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if current_app_role() not in ('OWNER','WAREHOUSE') then
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
