-- Xoá phiếu nhập (PN/NK) — chỉ Chủ cửa hàng, chỉ khi các lô của phiếu
-- chưa phát sinh nghiệp vụ tiếp theo. Hàm chạy trong một transaction
-- duy nhất: phiếu + dòng + lô + vị trí tồn + biến động nhập cùng biến
-- mất; mã phiếu không tái sử dụng (document_counters không đụng tới).
-- Sản phẩm trong danh mục KHÔNG bị xoá theo (có thể đã dùng ở phiếu
-- khác). Quyền kiểm tra NGAY TRONG HÀM vì security definer bỏ qua RLS.
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
  if current_app_role() <> 'OWNER' then
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

revoke execute on function delete_receipt(uuid, text) from public;
grant execute on function delete_receipt(uuid, text) to authenticated;
