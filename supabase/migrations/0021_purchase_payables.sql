-- 0021: tự tạo khoản phải trả khi xác nhận phiếu nhập mua hàng (PN)
-- Ngày: 2026-11-18. Quyết của chủ cửa hàng: tự động tạo khoản nợ khi xác
-- nhận phiếu nhập (không nhập tay).
--
-- Vấn đề: confirm_purchase_receipt trước đây chỉ tạo lô + ghi sổ cái, KHÔNG
-- tạo khoản phải trả — nhập mua đứt chưa trả tiền thì kho có hàng nhưng trang
-- Phải trả vẫn 0đ, không hạn trả, dashboard không thấy nợ. Bảng
-- supplier_payables trước đây chỉ chứa được khoản phải trả từ bán lô ký gửi
-- (source_document_id/source_line_id/batch_id đều NOT NULL, trỏ sang chứng
-- từ bán + lô), nên phải nới lỏng các cột đó và thêm nguồn "mua hàng".
--
-- Thiết kế:
-- - suppliers.purchase_pay_days (mặc định 30): số ngày trả tiền mua hàng
--   riêng của từng nhà cung cấp, tính từ ngày nhập kho (receipt_date).
-- - 1 khoản phải trả cho cả phiếu nhập, số tiền = tổng tiền phiếu
--   (sum qty*unit_cost, giống total_amount), hạn trả = ngày nhập +
--   purchase_pay_days. Trả nhiều đợt đã có sẵn (PARTIAL + nhiều lần trả).
-- - Khoản mua hàng có qty/unit_price NULL (không phải tiền theo lô) nên
--   không làm lệch cột "đã bán" của view v_supplier_consignment (sum(qty)
--   bỏ qua NULL), nhưng vẫn cộng đúng vào "còn phải trả" của view đó.
-- - Ràng buộc chk_payable_source: khoản ký gửi phải đủ 3 tham chiếu cũ,
--   khoản mua hàng phải có purchase_receipt_id và không có 3 tham chiếu cũ.
-- - Phiếu nhập cũ đã xác nhận (vd PN-2610-0001) KHÔNG tự sinh khoản phải
--   trả ngược — chỉ phiếu xác nhận sau migration này mới có.

alter table suppliers
  add column if not exists purchase_pay_days integer not null default 30; -- hạn trả tiền mua hàng tính từ ngày nhập

alter table supplier_payables
  alter column source_document_id drop not null,
  alter column source_line_id drop not null,
  alter column batch_id drop not null,
  alter column qty drop not null,
  alter column unit_price drop not null,
  add column if not exists source_kind text not null default 'CONSIGNMENT_SALE',
  add column if not exists purchase_receipt_id uuid references purchase_receipts(id);

alter table supplier_payables
  add constraint chk_payable_source check (
    (source_kind = 'PURCHASE' and purchase_receipt_id is not null
      and source_document_id is null and source_line_id is null and batch_id is null)
    or
    (source_kind = 'CONSIGNMENT_SALE' and purchase_receipt_id is null
      and source_document_id is not null and source_line_id is not null and batch_id is not null)
  );

comment on column suppliers.purchase_pay_days is 'Số ngày trả tiền mua hàng, tính từ ngày nhập kho (migration 0021)';
comment on column supplier_payables.source_kind is 'CONSIGNMENT_SALE: bán lô ký gửi; PURCHASE: nhập mua hàng (migration 0021)';
comment on column supplier_payables.purchase_receipt_id is 'Phiếu nhập mua hàng gốc, chỉ dùng khi source_kind = PURCHASE (migration 0021)';

-- confirm_purchase_receipt: giữ nguyên toàn bộ thân hàm live (migration
-- 0018), chỉ thêm khối tạo khoản phải trả mua hàng sau khi chốt phiếu.
create or replace function confirm_purchase_receipt(p_receipt_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; item record; v_batch uuid; v_total numeric; v_pay_days integer;
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

  -- Khoản phải trả mua hàng: 1 khoản cho cả phiếu, bằng tổng tiền nhập,
  -- hạn trả = ngày nhập + số ngày trả khi mua hàng của nhà cung cấp đó.
  -- Chỉ tạo khi tổng tiền > 0 và chưa có khoản nào cho phiếu này.
  select coalesce(sum(qty * unit_cost), 0) into v_total
    from purchase_receipt_items where receipt_id = p_receipt_id;
  if v_total > 0
     and not exists (select 1 from supplier_payables where purchase_receipt_id = p_receipt_id) then
    select purchase_pay_days into v_pay_days from suppliers where id = r.supplier_id;
    insert into supplier_payables (supplier_id, source_kind, purchase_receipt_id, amount, due_date)
    values (r.supplier_id, 'PURCHASE', p_receipt_id, v_total,
            r.receipt_date + coalesce(v_pay_days, 30));
  end if;
end $$;
