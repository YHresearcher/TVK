# TVK — Auto Parts Inventory

Inventory management web app for an auto parts store whose core model is
**two-way consignment**:

- The store carries both **owned stock** (bought outright) and **consigned
  stock** (received from suppliers, paid only after it is sold) — distinguished
  per **batch/lot**, never just per product.
- The store also **sends its own goods out on consignment** to partners
  (garages, transport companies, other shops). Ownership and physical custody
  are tracked as two independent dimensions.
- Partner consumption is invoiced in multiple rounds with exact mixes of
  purchased vs consigned quantities. **Allocation comes before invoicing**;
  the direct-sale part (document `BH`, the only place discounts live) and the
  consignment part (document `KG`) are always separate management documents
  with unique, never-reused codes, linked to the VAT (GTGT) invoice at line
  level.

Full specification: [`SPEC.md`](./SPEC.md) (Vietnamese, v1.0).

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · Supabase (PostgreSQL,
Auth, RLS) · Vercel.

## Setup

1. Create a Supabase project.
2. Run the SQL migrations in order — see [`supabase/README.md`](./supabase/README.md):
   `supabase/migrations/0001_schema.sql`, `0002_business_functions.sql`,
   `0003_rls_and_roles.sql`.
3. Create the first user in Supabase Auth and insert its OWNER profile
   (instructions in `supabase/README.md`).
4. Copy `.env.example` to `.env.local` and fill in
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
5. Install and run:

```bash
npm install
npm run dev
```

Without Supabase env vars the app still runs and shows a setup notice on every
page, so the UI can be reviewed before the database exists.

## Business rules enforced in the database

- Stock changes only through the immutable `stock_movements` ledger; batch and
  per-location quantities are maintained by triggers.
- Document codes (`PN, NK, GK, BT, PB, BH, KG, TH, DS, PT, PC, DH`) and batch
  codes (`OWN-…`, `CONS-…`) are system-generated, unique, never reused.
- Discounts exist only on `BH` documents (CHECK constraint); supplier payables
  are always computed at the batch's agreed consignment price.
- An allocation line can enter at most one management document and one active
  VAT invoice (partial unique indexes). Cancelling a VAT invoice re-opens only
  its own allocation lines.
- Sub-consignment (a supplier's goods sent onward to a partner, "cell D") is
  blocked unless that supplier explicitly allows it.
- Row Level Security splits the 4 roles: Owner / Sales / Warehouse /
  Accounting. Sales never sees consignment prices or profit.

## Deploy

Import the repo into Vercel, set the two `NEXT_PUBLIC_SUPABASE_*` env vars,
and deploy. No server cron is required for the MVP.
