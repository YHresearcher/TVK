-- 0011: show the supplier on owned lots in inventory.
-- Root cause: purchase (OWNED) batches store supplier_id NULL on purpose.
-- The consignment reconciliation view (v_supplier_consignment) counts
-- batch_locations rows by b.supplier_id at own warehouses WITHOUT an
-- ownership filter, so writing a supplier onto owned batches would
-- pollute consignment figures. The supplier of an owned lot is therefore
-- resolved at read time from its source purchase receipt; consigned lots
-- keep their stored supplier_id. This changes only the displayed
-- supplier_name in v_batch_stock — no batch data is rewritten and no
-- money logic is affected.
create or replace view public.v_batch_stock as
select b.id as batch_id, b.batch_code, b.product_id, p.sku, p.name as product_name,
       b.ownership, b.supplier_id, coalesce(s.name, ps.name) as supplier_name, b.unit_cost,
       bl.location_id, l.name as location_name, l.location_kind, l.partner_id,
       bl.qty, b.received_date, b.return_by_date, b.status
from stock_batches b
join products p on p.id = b.product_id
left join suppliers s on s.id = b.supplier_id
left join purchase_receipts pr
  on pr.id = b.source_doc_id and b.source_doc_type = 'PURCHASE_RECEIPT'
left join suppliers ps on ps.id = pr.supplier_id
join batch_locations bl on bl.batch_id = b.id
join locations l on l.id = bl.location_id;
