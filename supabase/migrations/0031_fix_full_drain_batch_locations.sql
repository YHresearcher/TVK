-- 0031_fix_full_drain_batch_locations.sql
-- ---------------------------------------------------------------------
-- LỖI GỐC (phát hiện 24/11/2026 khi xác nhận GK-2611-0001, 120 cái nhớt):
-- Trigger apply_stock_movement() cập nhật batch_locations về qty = 0 khi
-- xuất HẾT một lô tại kho nguồn, nhưng cột qty có CHECK (qty > 0) nên
-- câu UPDATE về 0 vi phạm constraint 23514 TRƯỚC KHI câu DELETE dọn
-- hàng 0 kịp chạy. Kết quả: mọi phiếu xuất hết lô (xuất toàn bộ số tồn
-- của lô tại kho nguồn) đều lỗi "server-side exception", phiếu ở nháp.
-- Trước đây lỗi chưa lộ vì các phiếu bán/gửi phụ tùng chỉ xuất MỘT PHẦN
-- mỗi lô (qty sau trừ vẫn > 0); GK nhớt là lần đầu xuất hết 100% các lô.
-- SỬA (chỉ đổi khối from_location, giữ nguyên mọi logic còn lại):
-- xuất hết lô tại kho nguồn thì DELETE hàng thay vì UPDATE về 0;
-- xuất một phần vẫn UPDATE; thiếu tồn vẫn raise như cũ.
-- ---------------------------------------------------------------------
BEGIN;

create or replace function apply_stock_movement() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_updated integer;
begin
  if new.from_location_id is not null then
    -- Xuất hết lô tại kho nguồn: xoá hàng thay vì cập nhật về 0
    -- (CHECK qty > 0 trên batch_locations cấm hàng qty = 0).
    delete from batch_locations
     where batch_id = new.batch_id
       and location_id = new.from_location_id
       and qty = new.qty;
    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      update batch_locations
         set qty = qty - new.qty
       where batch_id = new.batch_id
         and location_id = new.from_location_id
         and qty > new.qty;
      get diagnostics v_updated = row_count;
      if v_updated = 0 then
        raise exception 'Không đủ tồn của lô % tại kho nguồn (cần %)', new.batch_id, new.qty;
      end if;
    end if;
  end if;

  if new.to_location_id is not null then
    insert into batch_locations (batch_id, location_id, qty)
    values (new.batch_id, new.to_location_id, new.qty)
    on conflict (batch_id, location_id)
    do update set qty = batch_locations.qty + excluded.qty;
  end if;

  update stock_batches
     set qty_on_hand = qty_on_hand
         - (case when new.from_location_id is not null then new.qty else 0 end)
         + (case when new.to_location_id   is not null then new.qty else 0 end),
         status = case
           when qty_on_hand
                - (case when new.from_location_id is not null then new.qty else 0 end)
                + (case when new.to_location_id   is not null then new.qty else 0 end) = 0
                and status = 'ACTIVE' then 'DEPLETED'::batch_status
           when qty_on_hand
                - (case when new.from_location_id is not null then new.qty else 0 end)
                + (case when new.to_location_id   is not null then new.qty else 0 end) > 0
                and status = 'DEPLETED' then 'ACTIVE'::batch_status
           else status end
   where id = new.batch_id;
  return new;
end $$;

COMMIT;
