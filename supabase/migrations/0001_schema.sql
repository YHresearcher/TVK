-- =====================================================================
-- 0001_schema.sql — Hệ thống quản lý hàng hoá cửa hàng phụ tùng ô tô
-- Bảng, enum, index, bộ đếm mã chứng từ, trigger sổ cái kho, view báo cáo
-- Chạy trong Supabase SQL Editor (hoặc supabase db push) TRƯỚC 0002, 0003.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
create type app_role          as enum ('OWNER','SALES','WAREHOUSE','ACCOUNTING');
create type ownership_type    as enum ('OWNED','CONSIGNED');           -- của mình / ký gửi
create type location_type     as enum ('OWN_WAREHOUSE','PARTNER_VIRTUAL');
create type partner_type      as enum ('RETAIL','GARAGE','TRANSPORT','SHOP','OTHER');
create type code_type         as enum ('OEM','MANUFACTURER','AFTERMARKET','EQUIVALENT');
create type batch_status      as enum ('ACTIVE','DEPLETED','CLOSED');
create type movement_type     as enum ('IN_PURCHASE','IN_CONSIGNMENT','IN_RETURN',
                                       'OUT_SALE','OUT_CONSIGNMENT','OUT_RETURN_SUPPLIER',
                                       'TRANSFER','ADJUSTMENT');
create type doc_status        as enum ('DRAFT','CONFIRMED','CANCELLED');
create type delivery_term     as enum ('CONSIGNMENT','PURCHASE');      -- điều kiện giao cho đối tác
create type source_nature     as enum ('PURCHASED','CONSIGNED');       -- bản chất nguồn khi phân bổ
create type invoice_line_status as enum ('NOT_INVOICED','INVOICED');
create type sales_doc_type    as enum ('BH','KG');                     -- bán trực tiếp / hàng ký gửi
create type return_type       as enum ('CUSTOMER_RETURN','PARTNER_RETURN','SUPPLIER_RETURN');
create type return_reason     as enum ('DEFECT','WRONG_ITEM','WARRANT','UNSOLD','OTHER');
create type party_type        as enum ('SUPPLIER','PARTNER');
create type balance_status    as enum ('UNPAID','PARTIAL','PAID','CANCELLED');
create type payment_type      as enum ('IN','OUT');
create type vat_invoice_status as enum ('ISSUED','CANCELLED');

-- ---------------------------------------------------------------------
-- HÀM TIỆN ÍCH: updated_at
-- ---------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- NGƯỜI DÙNG & CÀI ĐẶT
-- ---------------------------------------------------------------------
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text not null,
  role       app_role not null default 'SALES',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();

create table app_settings (
  key        text primary key,          -- vd: vat_invoice_mode = "COMBINED" | "SEPARATE"
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- BỘ ĐẾM MÃ CHỨNG TỪ — mã unique, chạy liên tục theo tháng, không tái sử dụng
-- ---------------------------------------------------------------------
create table document_counters (
  prefix   text not null,               -- PN, NK, GK, BT, PB, BH, KG, TH, DS, PT, PC, DH, OWN, CONS
  period   char(4) not null,            -- YYMM theo giờ Asia/Saigon
  last_seq integer not null default 0,
  primary key (prefix, period)
);

create or replace function next_doc_code(p_prefix text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_period char(4) := to_char(now() at time zone 'Asia/Saigon', 'YYMM');
  v_seq    integer;
begin
  insert into document_counters (prefix, period, last_seq)
  values (p_prefix, v_period, 1)
  on conflict (prefix, period)
  do update set last_seq = document_counters.last_seq + 1
  returning last_seq into v_seq;
  return p_prefix || '-' || v_period || '-' || lpad(v_seq::text, 4, '0');
end $$;

-- Trigger tự sinh doc_code cho các bảng chứng từ (tiền tố truyền qua TG_ARGV)
create or replace function assign_doc_code() returns trigger
language plpgsql as $$
begin
  if new.doc_code is null then
    new.doc_code := next_doc_code(tg_argv[0]);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- DANH MỤC HÀNG HOÁ
-- ---------------------------------------------------------------------
create table products (
  id            uuid primary key default gen_random_uuid(),
  sku           text not null unique,
  name          text not null,
  brand         text,
  unit          text not null default 'cái',
  retail_price  numeric(15,2) not null default 0,
  garage_price  numeric(15,2) not null default 0,
  wholesale_price numeric(15,2) not null default 0,
  min_stock     integer not null default 0,
  image_url     text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_products_updated before update on products
  for each row execute function set_updated_at();

create table product_codes (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  code       text not null,
  code_kind  code_type not null default 'OEM',
  note       text,
  unique (product_id, code, code_kind)
);
create index idx_product_codes_code on product_codes (code);

create table vehicles (
  id        uuid primary key default gen_random_uuid(),
  make      text not null,
  model     text not null,
  year_from integer,
  year_to   integer,
  engine    text,
  unique (make, model, year_from, year_to, engine)
);

create table product_fitments (
  product_id uuid not null references products(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  note       text,
  primary key (product_id, vehicle_id)
);

-- ---------------------------------------------------------------------
-- NHÀ CUNG CẤP & ĐỐI TÁC
-- ---------------------------------------------------------------------
create table suppliers (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  contact_name            text,
  phone                   text,
  email                   text,
  address                 text,
  tax_code                text,
  consignment_pay_days    integer not null default 30,  -- hạn thanh toán sau khi hàng ký gửi bán được
  consignment_return_days integer not null default 90,  -- hạn trả hàng ký gửi chưa bán
  allow_sub_consignment   boolean not null default false, -- ô D: khoá mặc định
  notes                   text,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create trigger trg_suppliers_updated before update on suppliers
  for each row execute function set_updated_at();

create table partners (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  partner_kind      partner_type not null default 'GARAGE',
  contact_name      text,
  phone             text,
  email             text,
  address           text,
  tax_code          text,
  payment_days      integer not null default 0,   -- hạn thanh toán công nợ (ngày)
  credit_limit      numeric(15,2) not null default 0,
  consignment_limit numeric(15,2) not null default 0,
  notes             text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_partners_updated before update on partners
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- KHO (thật + ảo của đối tác) — trục LƯU GIỮ
-- ---------------------------------------------------------------------
create table locations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  location_kind location_type not null default 'OWN_WAREHOUSE',
  partner_id    uuid references partners(id),
  detail        text,                            -- kệ / ô / địa chỉ kho đối tác
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint chk_location_partner check (
    (location_kind = 'OWN_WAREHOUSE' and partner_id is null) or
    (location_kind = 'PARTNER_VIRTUAL' and partner_id is not null)
  )
);
create unique index uq_partner_virtual_location
  on locations (partner_id) where location_kind = 'PARTNER_VIRTUAL';

-- ---------------------------------------------------------------------
-- LÔ HÀNG — trái tim hệ thống. Trục SỞ HỮU nằm ở đây.
-- ---------------------------------------------------------------------
create table stock_batches (
  id              uuid primary key default gen_random_uuid(),
  batch_code      text not null unique,          -- OWN-… / CONS-… (trigger tự sinh)
  product_id      uuid not null references products(id),
  ownership       ownership_type not null,
  supplier_id     uuid references suppliers(id), -- bắt buộc nếu CONSIGNED
  unit_cost       numeric(15,2) not null,        -- giá mua đứt, hoặc giá ký gửi thoả thuận
  qty_received    integer not null check (qty_received > 0),
  qty_on_hand     integer not null default 0,    -- do trigger sổ cái duy trì, KHÔNG sửa tay
  received_date   date not null default current_date,
  source_doc_type text,                          -- PURCHASE_RECEIPT | CONSIGNMENT_RECEIPT | RETURN
  source_doc_id   uuid,
  pay_due_date    date,                          -- hạn thanh toán (lô ký gửi)
  return_by_date  date,                          -- hạn trả hàng chưa bán (lô ký gửi)
  status          batch_status not null default 'ACTIVE',
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint chk_batch_supplier check (
    (ownership = 'CONSIGNED' and supplier_id is not null) or
    (ownership = 'OWNED' and supplier_id is null)
  )
);
create index idx_batches_product on stock_batches (product_id);
create index idx_batches_supplier on stock_batches (supplier_id);
create trigger trg_batches_updated before update on stock_batches
  for each row execute function set_updated_at();

create or replace function assign_batch_code() returns trigger
language plpgsql as $$
begin
  if new.batch_code is null then
    new.batch_code := next_doc_code(case when new.ownership = 'CONSIGNED' then 'CONS' else 'OWN' end);
  end if;
  return new;
end $$;
create trigger trg_batches_code before insert on stock_batches
  for each row execute function assign_batch_code();

-- Số lượng của từng lô tại từng kho (một lô có thể nằm ở 2 nơi khi gửi ký gửi một phần)
create table batch_locations (
  batch_id    uuid not null references stock_batches(id) on delete cascade,
  location_id uuid not null references locations(id),
  qty         integer not null check (qty > 0),
  primary key (batch_id, location_id)
);
create index idx_batch_locations_loc on batch_locations (location_id);

-- ---------------------------------------------------------------------
-- SỔ CÁI KHO — bất biến: không UPDATE, không DELETE. Sai thì ghi dòng đảo.
-- ---------------------------------------------------------------------
create table stock_movements (
  id               uuid primary key default gen_random_uuid(),
  batch_id         uuid not null references stock_batches(id),
  movement_kind    movement_type not null,
  qty              integer not null check (qty > 0),
  from_location_id uuid references locations(id),  -- null = từ ngoài hệ thống vào
  to_location_id   uuid references locations(id),  -- null = ra khỏi hệ thống (đã bán / trả NCC)
  ref_doc_type     text,
  ref_doc_id       uuid,
  reversal_of_id   uuid references stock_movements(id),
  note             text,
  created_by       uuid references profiles(id),
  created_at       timestamptz not null default now(),
  constraint chk_movement_direction check (
    not (from_location_id is null and to_location_id is null)
    and (from_location_id is null or to_location_id is null or from_location_id <> to_location_id)
  )
);
create index idx_movements_batch on stock_movements (batch_id, created_at);
create index idx_movements_ref on stock_movements (ref_doc_type, ref_doc_id);

-- Trigger áp biến động vào batch_locations + qty_on_hand của lô
create or replace function apply_stock_movement() returns trigger
language plpgsql as $$
declare
  v_updated integer;
begin
  if new.from_location_id is not null then
    update batch_locations
       set qty = qty - new.qty
     where batch_id = new.batch_id
       and location_id = new.from_location_id
       and qty >= new.qty;
    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      raise exception 'Không đủ tồn của lô % tại kho nguồn (cần %)', new.batch_id, new.qty;
    end if;
    delete from batch_locations
     where batch_id = new.batch_id and location_id = new.from_location_id and qty = 0;
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
create trigger trg_movements_apply after insert on stock_movements
  for each row execute function apply_stock_movement();

-- Chặn sửa/xoá sổ cái
create or replace function block_movement_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'Sổ cái kho là bất biến: không được sửa/xoá, hãy ghi dòng đảo (reversal).';
end $$;
create trigger trg_movements_no_update before update or delete on stock_movements
  for each row execute function block_movement_mutation();

-- ---------------------------------------------------------------------
-- PHIẾU NHẬP MUA ĐỨT (PN)
-- ---------------------------------------------------------------------
create table purchase_receipts (
  id                 uuid primary key default gen_random_uuid(),
  doc_code           text not null unique,
  supplier_id        uuid not null references suppliers(id),
  warehouse_id       uuid not null references locations(id),  -- kho đích của mình
  receipt_date       date not null default current_date,
  supplier_invoice_no text,                                   -- số hoá đơn của NCC
  total_amount       numeric(15,2) not null default 0,
  status             doc_status not null default 'DRAFT',
  note               text,
  created_by         uuid references profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_pr_code before insert on purchase_receipts
  for each row execute function assign_doc_code('PN');
create trigger trg_pr_updated before update on purchase_receipts
  for each row execute function set_updated_at();

create table purchase_receipt_items (
  id         uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references purchase_receipts(id) on delete cascade,
  product_id uuid not null references products(id),
  qty        integer not null check (qty > 0),
  unit_cost  numeric(15,2) not null check (unit_cost >= 0),
  batch_id   uuid references stock_batches(id)   -- sinh khi xác nhận phiếu
);
create index idx_pr_items_receipt on purchase_receipt_items (receipt_id);

-- ---------------------------------------------------------------------
-- PHIẾU NHẬN KÝ GỬI (NK)
-- ---------------------------------------------------------------------
create table consignment_receipts (
  id             uuid primary key default gen_random_uuid(),
  doc_code       text not null unique,
  supplier_id    uuid not null references suppliers(id),
  warehouse_id   uuid not null references locations(id),
  receipt_date   date not null default current_date,
  return_by_date date,                                        -- mặc định = receipt_date + NCC.consignment_return_days
  status         doc_status not null default 'DRAFT',
  note           text,
  created_by     uuid references profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_cr_code before insert on consignment_receipts
  for each row execute function assign_doc_code('NK');
create trigger trg_cr_updated before update on consignment_receipts
  for each row execute function set_updated_at();

create table consignment_receipt_items (
  id               uuid primary key default gen_random_uuid(),
  receipt_id       uuid not null references consignment_receipts(id) on delete cascade,
  product_id       uuid not null references products(id),
  qty              integer not null check (qty > 0),
  consignment_price numeric(15,2) not null check (consignment_price >= 0), -- giá ký gửi thoả thuận
  batch_id         uuid references stock_batches(id)
);
create index idx_cr_items_receipt on consignment_receipt_items (receipt_id);

-- ---------------------------------------------------------------------
-- PHIẾU GỬI KÝ GỬI / GIAO HÀNG CHO ĐỐI TÁC (GK)
-- Mỗi dòng có điều kiện: CONSIGNMENT (ký gửi) hoặc PURCHASE (mua đứt, xuất HĐ sau)
-- ---------------------------------------------------------------------
create table consignment_out_slips (
  id                  uuid primary key default gen_random_uuid(),
  doc_code            text not null unique,
  partner_id          uuid not null references partners(id),
  slip_date           date not null default current_date,
  settlement_due_date date,
  return_by_date      date,
  status              doc_status not null default 'DRAFT',
  note                text,
  created_by          uuid references profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_co_code before insert on consignment_out_slips
  for each row execute function assign_doc_code('GK');
create trigger trg_co_updated before update on consignment_out_slips
  for each row execute function set_updated_at();

create table consignment_out_items (
  id               uuid primary key default gen_random_uuid(),
  slip_id          uuid not null references consignment_out_slips(id) on delete cascade,
  batch_id         uuid not null references stock_batches(id),
  from_location_id uuid not null references locations(id),
  qty              integer not null check (qty > 0),
  term             delivery_term not null default 'CONSIGNMENT',
  transfer_price   numeric(15,2) not null check (transfer_price >= 0) -- giá ký gửi chuyển giao / giá bán thoả thuận
);
create index idx_co_items_slip on consignment_out_items (slip_id);
create index idx_co_items_batch on consignment_out_items (batch_id);

-- ---------------------------------------------------------------------
-- BÁO CÁO TIÊU THỤ CỦA ĐỐI TÁC (BT)
-- ---------------------------------------------------------------------
create table consumption_reports (
  id          uuid primary key default gen_random_uuid(),
  doc_code    text not null unique,
  partner_id  uuid not null references partners(id),
  period_from date not null,
  period_to   date not null,
  report_date date not null default current_date,
  status      doc_status not null default 'DRAFT',
  note        text,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_bt_code before insert on consumption_reports
  for each row execute function assign_doc_code('BT');
create trigger trg_bt_updated before update on consumption_reports
  for each row execute function set_updated_at();

create table consumption_report_items (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references consumption_reports(id) on delete cascade,
  product_id uuid not null references products(id),
  qty_consumed integer not null check (qty_consumed >= 0),
  unique (report_id, product_id)
);

-- ---------------------------------------------------------------------
-- PHIẾU PHÂN BỔ (PB) — chốt nguồn cho từng số lượng tiêu thụ.
-- Đây là căn cứ DUY NHẤT để xuất hoá đơn.
-- ---------------------------------------------------------------------
create table allocation_slips (
  id          uuid primary key default gen_random_uuid(),
  doc_code    text not null unique,
  report_id   uuid references consumption_reports(id),   -- báo cáo tiêu thụ gốc
  partner_id  uuid not null references partners(id),
  alloc_date  date not null default current_date,
  status      doc_status not null default 'DRAFT',
  note        text,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_pb_code before insert on allocation_slips
  for each row execute function assign_doc_code('PB');
create trigger trg_pb_updated before update on allocation_slips
  for each row execute function set_updated_at();

create table allocation_lines (
  id             uuid primary key default gen_random_uuid(),
  allocation_id  uuid not null references allocation_slips(id) on delete cascade,
  product_id     uuid not null references products(id),
  batch_id       uuid not null references stock_batches(id), -- lô đang nằm tại kho đối tác
  nature         source_nature not null,                     -- PURCHASED | CONSIGNED
  qty            integer not null check (qty > 0),
  unit_price     numeric(15,2) not null check (unit_price >= 0),
  invoice_status invoice_line_status not null default 'NOT_INVOICED'
);
create index idx_alloc_lines_slip on allocation_lines (allocation_id);
create index idx_alloc_lines_batch on allocation_lines (batch_id);

-- ---------------------------------------------------------------------
-- ĐƠN BÁN TẠI QUẦY (DH) + CHỨNG TỪ QUẢN LÝ BH / KG
-- BH = phần bán trực tiếp (được chiết khấu). KG = phần hàng ký gửi.
-- ---------------------------------------------------------------------
create table sales_orders (
  id            uuid primary key default gen_random_uuid(),
  doc_code      text not null unique,
  partner_id    uuid references partners(id),       -- null = khách lẻ
  customer_name text,
  order_date    date not null default current_date,
  total_amount  numeric(15,2) not null default 0,
  status        doc_status not null default 'DRAFT',
  note          text,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_so_code before insert on sales_orders
  for each row execute function assign_doc_code('DH');
create trigger trg_so_updated before update on sales_orders
  for each row execute function set_updated_at();

create table sales_documents (
  id               uuid primary key default gen_random_uuid(),
  doc_code         text not null unique,            -- BH-… hoặc KG-… theo doc_kind
  doc_kind         sales_doc_type not null,
  sales_order_id   uuid references sales_orders(id),     -- nguồn 1: bán tại quầy
  allocation_id    uuid references allocation_slips(id), -- nguồn 2: phân bổ tiêu thụ của đối tác
  partner_id       uuid references partners(id),
  customer_name    text,
  doc_date         date not null default current_date,
  subtotal         numeric(15,2) not null default 0,
  discount_amount  numeric(15,2) not null default 0,     -- CHỈ BH mới được có chiết khấu
  total_amount     numeric(15,2) not null default 0,
  is_credit        boolean not null default false,        -- true = bán chịu, sinh phải thu
  status           doc_status not null default 'DRAFT',
  note             text,
  created_by       uuid references profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint chk_sales_doc_source check (
    (sales_order_id is not null and allocation_id is null) or
    (sales_order_id is null and allocation_id is not null)
  ),
  constraint chk_discount_only_bh check (doc_kind = 'BH' or discount_amount = 0)
);
create trigger trg_sd_updated before update on sales_documents
  for each row execute function set_updated_at();

-- Sinh mã đúng tiền tố theo doc_kind (BH / KG)
create or replace function assign_sales_doc_code() returns trigger
language plpgsql as $$
begin
  if new.doc_code is null then
    new.doc_code := next_doc_code(new.doc_kind::text);
  end if;
  return new;
end $$;
create trigger trg_sd_code before insert on sales_documents
  for each row execute function assign_sales_doc_code();

create table sales_document_lines (
  id                uuid primary key default gen_random_uuid(),
  document_id       uuid not null references sales_documents(id) on delete cascade,
  product_id        uuid not null references products(id),
  batch_id          uuid references stock_batches(id),      -- lô xuất (bán tại quầy / tại kho đối tác)
  allocation_line_id uuid references allocation_lines(id),  -- dòng phân bổ gốc (luồng đối tác)
  from_location_id  uuid references locations(id),          -- kho xuất thực tế
  qty               integer not null check (qty > 0),
  unit_price        numeric(15,2) not null check (unit_price >= 0),
  line_total        numeric(15,2) generated always as (qty * unit_price) stored
);
create index idx_sd_lines_doc on sales_document_lines (document_id);
create index idx_sd_lines_batch on sales_document_lines (batch_id);
-- Một dòng phân bổ chỉ được đưa vào chứng từ đúng một lần
create unique index uq_sd_lines_allocation
  on sales_document_lines (allocation_line_id) where allocation_line_id is not null;

-- ---------------------------------------------------------------------
-- HOÁ ĐƠN GTGT — lớp pháp lý. Liên kết ở cấp DÒNG với chứng từ quản lý.
-- ---------------------------------------------------------------------
create table vat_invoices (
  id           uuid primary key default gen_random_uuid(),
  invoice_no   text not null,
  symbol       text not null,               -- ký hiệu hoá đơn
  invoice_date date not null,
  provider     text,                        -- nhà cung cấp hoá đơn điện tử
  partner_id   uuid references partners(id),
  total_amount numeric(15,2) not null default 0,
  status       vat_invoice_status not null default 'ISSUED',
  file_url     text,
  note         text,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  unique (invoice_no, symbol)
);

create table vat_invoice_lines (
  id                     uuid primary key default gen_random_uuid(),
  vat_invoice_id         uuid not null references vat_invoices(id) on delete cascade,
  sales_document_line_id uuid not null references sales_document_lines(id),
  line_no                integer not null,
  amount                 numeric(15,2) not null,
  is_active              boolean not null default true   -- false khi hoá đơn bị huỷ
);
-- Một dòng chứng từ quản lý chỉ nằm trên tối đa một hoá đơn GTGT đang hiệu lực
create unique index uq_vat_line_active
  on vat_invoice_lines (sales_document_line_id) where is_active;

-- ---------------------------------------------------------------------
-- CÔNG NỢ PHẢI TRẢ NCC / PHẢI THU ĐỐI TÁC
-- ---------------------------------------------------------------------
create table supplier_payables (
  id                 uuid primary key default gen_random_uuid(),
  supplier_id        uuid not null references suppliers(id),
  source_document_id uuid not null references sales_documents(id),  -- chứng từ KG gốc
  source_line_id     uuid not null unique references sales_document_lines(id),
  batch_id           uuid not null references stock_batches(id),
  qty                integer not null check (qty > 0),
  unit_price         numeric(15,2) not null,   -- giá ký gửi của lô, KHÔNG bị chiết khấu ảnh hưởng
  amount             numeric(15,2) not null,
  amount_paid        numeric(15,2) not null default 0,
  due_date           date,
  status             balance_status not null default 'UNPAID',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index idx_payables_supplier on supplier_payables (supplier_id, status);
create trigger trg_payables_updated before update on supplier_payables
  for each row execute function set_updated_at();

create table partner_receivables (
  id                 uuid primary key default gen_random_uuid(),
  partner_id         uuid not null references partners(id),
  source_document_id uuid not null unique references sales_documents(id), -- 1 chứng từ = 1 khoản phải thu
  amount             numeric(15,2) not null,   -- BH: sau chiết khấu; KG: theo giá chuyển giao
  amount_paid        numeric(15,2) not null default 0,
  due_date           date,
  status             balance_status not null default 'UNPAID',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index idx_receivables_partner on partner_receivables (partner_id, status);
create trigger trg_receivables_updated before update on partner_receivables
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- PHIẾU TRẢ HÀNG (TH)
-- ---------------------------------------------------------------------
create table return_documents (
  id          uuid primary key default gen_random_uuid(),
  doc_code    text not null unique,
  return_kind return_type not null,
  partner_id  uuid references partners(id),
  supplier_id uuid references suppliers(id),
  return_date date not null default current_date,
  status      doc_status not null default 'DRAFT',
  note        text,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_th_code before insert on return_documents
  for each row execute function assign_doc_code('TH');
create trigger trg_th_updated before update on return_documents
  for each row execute function set_updated_at();

create table return_items (
  id               uuid primary key default gen_random_uuid(),
  return_id        uuid not null references return_documents(id) on delete cascade,
  batch_id         uuid not null references stock_batches(id),
  from_location_id uuid references locations(id),
  to_location_id   uuid references locations(id),
  qty              integer not null check (qty > 0),
  reason           return_reason not null default 'OTHER',
  note             text
);
create index idx_return_items_doc on return_items (return_id);

-- ---------------------------------------------------------------------
-- ĐỢT ĐỐI SOÁT (DS) + PHIẾU THU / CHI (PT / PC)
-- ---------------------------------------------------------------------
create table settlements (
  id          uuid primary key default gen_random_uuid(),
  doc_code    text not null unique,
  party_kind  party_type not null,
  supplier_id uuid references suppliers(id),
  partner_id  uuid references partners(id),
  period_from date,
  period_to   date,
  settle_date date not null default current_date,
  total_amount numeric(15,2) not null default 0,
  status      doc_status not null default 'DRAFT',
  note        text,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint chk_settlement_party check (
    (party_kind = 'SUPPLIER' and supplier_id is not null and partner_id is null) or
    (party_kind = 'PARTNER'  and partner_id  is not null and supplier_id is null)
  )
);
create trigger trg_ds_code before insert on settlements
  for each row execute function assign_doc_code('DS');
create trigger trg_ds_updated before update on settlements
  for each row execute function set_updated_at();

create table settlement_lines (
  id            uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references settlements(id) on delete cascade,
  payable_id    uuid references supplier_payables(id),
  receivable_id uuid references partner_receivables(id),
  amount        numeric(15,2) not null check (amount > 0),
  constraint chk_settlement_line_ref check (
    (payable_id is not null and receivable_id is null) or
    (payable_id is null and receivable_id is not null)
  )
);

create table payments (
  id            uuid primary key default gen_random_uuid(),
  doc_code      text not null unique,        -- PT-… (thu) / PC-… (chi)
  payment_kind  payment_type not null,
  payment_date  date not null default current_date,
  amount        numeric(15,2) not null check (amount > 0),
  method        text not null default 'BANK',  -- CASH | BANK
  settlement_id uuid references settlements(id),
  payable_id    uuid references supplier_payables(id),
  receivable_id uuid references partner_receivables(id),
  note          text,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
);
create or replace function assign_payment_code() returns trigger
language plpgsql as $$
begin
  if new.doc_code is null then
    new.doc_code := next_doc_code(case when new.payment_kind = 'IN' then 'PT' else 'PC' end);
  end if;
  return new;
end $$;
create trigger trg_payments_code before insert on payments
  for each row execute function assign_payment_code();

-- Thanh toán gắn trực tiếp công nợ -> cập nhật số đã trả + trạng thái
create or replace function apply_payment_to_balance() returns trigger
language plpgsql as $$
begin
  if new.payable_id is not null then
    update supplier_payables
       set amount_paid = amount_paid + new.amount,
           status = case
             when amount_paid + new.amount >= amount then 'PAID'::balance_status
             when amount_paid + new.amount > 0     then 'PARTIAL'::balance_status
             else status end
     where id = new.payable_id;
  end if;
  if new.receivable_id is not null then
    update partner_receivables
       set amount_paid = amount_paid + new.amount,
           status = case
             when amount_paid + new.amount >= amount then 'PAID'::balance_status
             when amount_paid + new.amount > 0     then 'PARTIAL'::balance_status
             else status end
     where id = new.receivable_id;
  end if;
  return new;
end $$;
create trigger trg_payments_apply after insert on payments
  for each row execute function apply_payment_to_balance();

-- ---------------------------------------------------------------------
-- VIEW BÁO CÁO
-- ---------------------------------------------------------------------

-- Tồn theo lô × kho (chi tiết nhất)
create or replace view v_batch_stock as
select b.id as batch_id, b.batch_code, b.product_id, p.sku, p.name as product_name,
       b.ownership, b.supplier_id, s.name as supplier_name, b.unit_cost,
       bl.location_id, l.name as location_name, l.location_kind, l.partner_id,
       bl.qty, b.received_date, b.return_by_date, b.status
from stock_batches b
join products p on p.id = b.product_id
left join suppliers s on s.id = b.supplier_id
join batch_locations bl on bl.batch_id = b.id
join locations l on l.id = bl.location_id;

-- Tồn theo sản phẩm: tách Của mình / Ký gửi, tách kho mình / kho đối tác
create or replace view v_product_stock as
select p.id as product_id, p.sku, p.name,
       coalesce(sum(bl.qty) filter (where b.ownership = 'OWNED'     and l.location_kind = 'OWN_WAREHOUSE'), 0) as owned_at_own_wh,
       coalesce(sum(bl.qty) filter (where b.ownership = 'CONSIGNED' and l.location_kind = 'OWN_WAREHOUSE'), 0) as consigned_at_own_wh,
       coalesce(sum(bl.qty) filter (where b.ownership = 'OWNED'     and l.location_kind = 'PARTNER_VIRTUAL'), 0) as owned_at_partners,
       coalesce(sum(bl.qty) filter (where b.ownership = 'CONSIGNED' and l.location_kind = 'PARTNER_VIRTUAL'), 0) as consigned_at_partners,
       coalesce(sum(bl.qty), 0) as total_qty
from products p
left join stock_batches b on b.product_id = p.id
left join batch_locations bl on bl.batch_id = b.id
left join locations l on l.id = bl.location_id
group by p.id, p.sku, p.name;

-- Đối soát NCC: nhận ký gửi – đã bán – đã trả – còn tồn – còn phải trả
create or replace view v_supplier_consignment as
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

-- Đối soát đối tác: đã gửi – đã tiêu thụ – đã trả – còn giữ – còn phải thu
-- Công thức kiểm soát: gửi = tiêu thụ + trả + còn giữ
create or replace view v_partner_consignment as
select pt.id as partner_id, pt.name as partner_name,
       coalesce((select sum(m.qty) from stock_movements m
                  join locations l on l.id = m.to_location_id
                  where l.partner_id = pt.id and m.movement_kind = 'OUT_CONSIGNMENT'), 0) as qty_sent,
       coalesce((select sum(m.qty) from stock_movements m
                  join locations l on l.id = m.from_location_id
                  where l.partner_id = pt.id and m.movement_kind = 'OUT_SALE'), 0) as qty_consumed,
       coalesce((select sum(m.qty) from stock_movements m
                  join locations lf on lf.id = m.from_location_id
                  join locations lt on lt.id = m.to_location_id
                  where lf.partner_id = pt.id and lt.location_kind = 'OWN_WAREHOUSE'
                    and m.movement_kind in ('TRANSFER','IN_RETURN')), 0) as qty_returned,
       coalesce((select sum(bl.qty) from batch_locations bl
                  join locations l on l.id = bl.location_id
                  where l.partner_id = pt.id), 0) as qty_still_at_partner,
       coalesce((select sum(amount - amount_paid) from partner_receivables pr
                  where pr.partner_id = pt.id and pr.status in ('UNPAID','PARTIAL')), 0) as receivable_outstanding
from partners pt;

-- Hạn mức theo bản chất cho từng đối tác + sản phẩm:
-- đã giao (theo điều kiện PURCHASE / CONSIGNMENT) – đã phân bổ = còn được phân bổ
create or replace view v_partner_term_balance as
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

-- Tiến độ phân bổ / xuất hoá đơn của từng báo cáo tiêu thụ
create or replace view v_consumption_progress as
select cri.report_id, cri.product_id,
       cri.qty_consumed,
       coalesce(sum(al.qty), 0) as qty_allocated,
       coalesce(sum(al.qty) filter (where al.invoice_status = 'INVOICED'), 0) as qty_invoiced,
       cri.qty_consumed - coalesce(sum(al.qty), 0) as qty_not_yet_allocated
from consumption_report_items cri
left join allocation_slips a on a.report_id = cri.report_id and a.status = 'CONFIRMED'
left join allocation_lines al on al.allocation_id = a.id and al.product_id = cri.product_id
group by cri.report_id, cri.product_id, cri.qty_consumed;
