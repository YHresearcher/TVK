-- 0015: Nhóm hàng (Linh kiện ô tô tải / Nhớt) — 2026-10-28
-- Cột tự do (không CHECK) để sau này thêm nhóm mới không cần migration.
-- Backfill: 46 sản phẩm hiện tại toàn là phụ tùng HOWO → Linh kiện ô tô tải.
alter table products add column if not exists product_group text;
comment on column products.product_group is 'Nhóm hàng để quản lý: Linh kiện ô tô tải, Nhớt, ...';
update products set product_group = 'Linh kiện ô tô tải' where product_group is null;
