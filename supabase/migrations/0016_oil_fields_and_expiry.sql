-- 0016: oil attributes + lot expiry date (FEFO foundation).
-- Nho't: quan ly han theo lo, phan bo FEFO (han gan nhat truoc,
-- lo khong han xep sau cung theo FIFO). Linh kien: khong han, FIFO nhu cu.
-- Chi them cot, khong sua du lieu cu. View v_batch_stock duoc tao lai
-- them expiry_date (theo mau 0011/0014) + cap lai quyen xem.
alter table products add column if not exists sae_viscosity text;
alter table products add column if not exists api_standard text;
comment on column products.sae_viscosity is 'Do nhot SAE cua nhot, vd 15W-40';
comment on column products.api_standard is 'Chuan API/ACEA cua nhot, vd CI-4, ACEA E7';

alter table stock_batches add column if not exists expiry_date date;
comment on column stock_batches.expiry_date is 'Han dung cua lo (chi nhot); phan bo FEFO: han gan nhat truoc, lo khong han xep sau cung theo FIFO';

create or replace view public.v_batch_stock as
select b.id as batch_id, b.batch_code, b.product_id, p.sku, p.name as product_name,
       b.ownership, b.supplier_id, coalesce(s.name, ps.name) as supplier_name, b.unit_cost,
       bl.location_id, l.name as location_name, l.location_kind, l.partner_id,
       bl.qty, b.received_date, b.return_by_date, b.status, b.expiry_date
from stock_batches b
join products p on p.id = b.product_id
left join suppliers s on s.id = b.supplier_id
left join purchase_receipts pr
  on pr.id = b.source_doc_id and b.source_doc_type = 'PURCHASE_RECEIPT'
left join suppliers ps on ps.id = pr.supplier_id
join batch_locations bl on bl.batch_id = b.id
join locations l on l.id = bl.location_id;

grant select on public.v_batch_stock to authenticated;
