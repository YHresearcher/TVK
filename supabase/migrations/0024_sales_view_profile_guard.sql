-- 0024: P0 fail-closed row access for the cost-free stock view.
-- Fixes regression verified on local: an authenticated JWT without a TVK
-- profile received all rows from v_batches_for_sales (92 in test).
-- Must run after 0020; main's 0021-0023 do not touch this view.
-- Only read privileges for active TVK users.
BEGIN;

CREATE OR REPLACE VIEW public.v_batches_for_sales
WITH (security_invoker = false, security_barrier = true) AS
SELECT b.id AS batch_id,
       b.batch_code,
       b.product_id,
       p.sku,
       p.name AS product_name,
       b.ownership,
       s.name AS supplier_name,
       bl.location_id,
       l.name AS location_name,
       l.location_kind,
       l.partner_id,
       bl.qty,
       b.received_date,
       b.status,
       b.supplier_id,
       b.return_by_date,
       b.expiry_date
FROM public.stock_batches AS b
JOIN public.products AS p ON p.id = b.product_id
LEFT JOIN public.suppliers AS s ON s.id = b.supplier_id
JOIN public.batch_locations AS bl ON bl.batch_id = b.id
JOIN public.locations AS l ON l.id = bl.location_id
WHERE EXISTS (
  SELECT 1
  FROM public.profiles AS actor
  WHERE actor.id = (SELECT auth.uid())
    AND actor.is_active = true
    AND actor.role IN ('OWNER', 'SALES', 'WAREHOUSE', 'ACCOUNTING', 'CEO')
);

-- SECURITY DEFINER-style views execute as view owner; the explicit predicate
-- above is mandatory because base-table RLS is NOT enforced for the caller.
REVOKE ALL ON public.v_batches_for_sales FROM PUBLIC, anon;
GRANT SELECT ON public.v_batches_for_sales TO authenticated;

COMMIT;
