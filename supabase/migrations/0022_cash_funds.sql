-- 0022: quỹ tiền (số dư quỹ + gắn thanh toán vào quỹ) — bản gọn, 18/11/2026
-- Quyết của chủ cửa hàng: chỉ thêm số dư quỹ, gắn thanh toán vào quỹ
-- (không làm sổ thu/chi ngoài công nợ, không làm báo cáo dòng tiền thực).
--
-- Thiết kế:
-- - cash_funds: két tiền mặt + tài khoản ngân hàng, mỗi quỹ có số dư đầu
--   kỳ (opening_balance) do chủ/kế toán nhập một lần ở Cài đặt. Seed sẵn
--   1 quỹ "Két tiền mặt" (số dư đầu kỳ 0); tài khoản ngân hàng do người
--   dùng tự thêm ở Cài đặt. Quỹ không xoá, chỉ tắt (is_active) để giữ
--   nguyên lịch sử biến động.
-- - cash_movements: sổ biến động của quỹ — mỗi lần ghi nhận thu/chi tiền
--   (payments) có chọn quỹ thì trigger tự ghi 1 dòng: thu (+) / chi (−).
--   Số dư quỹ = số dư đầu kỳ + tổng biến động (tính qua view, không lưu
--   sẵn để khỏi lệch).
-- - payments.fund_id: quỹ tiền của lần thu/chi đó. Các phiếu thu/chi cũ
--   (trước migration này) để NULL — số dư đầu kỳ nhập ở Cài đặt là số
--   tiền thực tế tại thời điểm nhập, đã bao gồm ảnh hưởng của các phiếu cũ.
-- - RLS: xem OWNER/ACCOUNTING/CEO (CEO xem số dư ở Tổng quan), ghi quỹ
--   OWNER/ACCOUNTING; cash_movements không có policy ghi — chỉ trigger
--   SECURITY DEFINER được ghi. Grants: default privileges ở 0005 đã cấp
--   sẵn cho bảng mới (authenticated), không cần GRANT thêm.
-- - Trigger ghi biến động là trigger RIÊNG, không đụng vào
--   apply_payment_to_balance (đã được 0019_platform_fixes siết chặn
--   trả vượt + phân bổ đối soát).
-- - Giới hạn cố ý (bản gọn): payments UPDATE/DELETE trực tiếp không cập
--   nhật lại biến động quỹ (hệ thống chưa có trigger bất biến cho
--   payments — M4). Sửa phiếu thu/chi đã ghi cần ghi phiếu mới bù trừ.

create table cash_funds (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  kind            text not null check (kind in ('CASH', 'BANK')),
  opening_balance numeric(15,2) not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_cash_funds_updated before update on cash_funds
  for each row execute function set_updated_at();

create table cash_movements (
  id             uuid primary key default gen_random_uuid(),
  fund_id        uuid not null references cash_funds(id),
  payment_id     uuid unique references payments(id),
  amount         numeric(15,2) not null, -- + tiền thu vào quỹ, − tiền chi ra khỏi quỹ
  movement_date  date not null default current_date,
  created_at     timestamptz not null default now()
);

alter table payments
  add column if not exists fund_id uuid references cash_funds(id);

-- RLS
alter table cash_funds enable row level security;
alter table cash_movements enable row level security;

create policy pol_cash_funds_sel on cash_funds for select to authenticated
  using (current_app_role() = any (array['OWNER','ACCOUNTING','CEO']::app_role[]));
create policy pol_cash_funds_ins on cash_funds for insert to authenticated
  with check (current_app_role() = any (array['OWNER','ACCOUNTING']::app_role[]));
create policy pol_cash_funds_upd on cash_funds for update to authenticated
  using (current_app_role() = any (array['OWNER','ACCOUNTING']::app_role[]))
  with check (current_app_role() = any (array['OWNER','ACCOUNTING']::app_role[]));
-- Không có policy DELETE cho cash_funds: quỹ chỉ tắt (is_active), không xoá.

create policy pol_cash_movements_sel on cash_movements for select to authenticated
  using (current_app_role() = any (array['OWNER','ACCOUNTING','CEO']::app_role[]));
-- Không có policy ghi cho cash_movements: chỉ trigger SECURITY DEFINER được ghi.

-- View số dư từng quỹ (security_invoker: RLS của bảng gốc vẫn áp dụng).
create or replace view v_cash_fund_balances as
select f.id as fund_id, f.name as fund_name, f.kind, f.opening_balance, f.is_active,
  coalesce(sum(m.amount) filter (where m.amount > 0), 0) as total_in,
  coalesce(-sum(m.amount) filter (where m.amount < 0), 0) as total_out,
  f.opening_balance + coalesce(sum(m.amount), 0) as balance
from cash_funds f
left join cash_movements m on m.fund_id = f.id
group by f.id, f.name, f.kind, f.opening_balance, f.is_active;
alter view v_cash_fund_balances set (security_invoker = true);

-- Trigger: mỗi phiếu thu/chi có chọn quỹ thì tự ghi biến động quỹ.
create or replace function apply_payment_to_cash_fund() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.fund_id is null then return new; end if;
  insert into cash_movements (fund_id, payment_id, amount, movement_date)
  values (new.fund_id, new.id,
    case when new.payment_kind = 'IN' then new.amount else -new.amount end,
    new.payment_date);
  return new;
end $$;
create trigger trg_payments_cash_fund after insert on payments
  for each row execute function apply_payment_to_cash_fund();

-- Seed: két tiền mặt (số dư đầu kỳ 0 — chủ/kế toán sửa ở Cài đặt).
insert into cash_funds (name, kind, opening_balance)
select 'Két tiền mặt', 'CASH', 0
where not exists (select 1 from cash_funds where name = 'Két tiền mặt' and kind = 'CASH');
