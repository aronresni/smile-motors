-- ===========================================================================
-- Agregación del panel del vendedor a partir de ventas CONFIRMADAS.
--
-- - Índice compuesto para el filtro típico del panel.
-- - RPC `seller_dashboard_data` (SECURITY INVOKER): toda la agregación ocurre
--   en la base; el navegador solo recibe el dataset final. La RLS de `sales`
--   (`seller_id = auth.uid()`) sigue siendo la que aísla al vendedor.
--
-- FECHA DE NEGOCIO: se usa `sales.sale_date` (fecha comercial que fija el
-- vendedor). `confirmed_at` es un timestamp operativo (cuándo se pulsó
-- "Confirmar"), no la fecha del negocio. `sale_date` siempre está poblada en
-- ventas confirmadas (se fija al crear el borrador).
--
-- SOLO cuentan las ventas con `status = 'CONFIRMED'`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------
-- El compuesto cubre también las búsquedas por `seller_id` solo (prefijo),
-- así que el índice antiguo de una sola columna queda redundante.
drop index if exists public.sales_seller_idx;
create index if not exists sales_seller_status_date_idx
  on public.sales (seller_id, status, sale_date);
-- sale_units(sale_id) ya existe: sale_units_sale_idx.

-- ---------------------------------------------------------------------------
-- RPC de datos del panel
-- ---------------------------------------------------------------------------
create or replace function public.seller_dashboard_data(
  p_start      date,
  p_end        date,
  p_prev_start date,
  p_prev_end   date
)
returns jsonb
language sql
security invoker
set search_path = public
stable
as $$
  with confirmed as (
    select s.id, s.sale_date, s.operation_type, s.sale_total_cents
    from public.sales s
    where s.seller_id = auth.uid()
      and s.status = 'CONFIRMED'
      and s.operation_type in ('CUBA', 'USA', 'LOCAL')
  ),
  cur as (
    select * from confirmed where sale_date between p_start and p_end
  ),
  prev as (
    select * from confirmed where sale_date between p_prev_start and p_prev_end
  ),
  cur_units as (
    select su.id, c.sale_date, c.operation_type,
           coalesce(nullif(btrim(su.product_name_snapshot), ''), 'Sin modelo') as model
    from public.sale_units su
    join cur c on c.id = su.sale_id
  ),
  prev_units as (
    select su.id from public.sale_units su join prev p on p.id = su.sale_id
  )
  select jsonb_build_object(
    'revenue', jsonb_build_object(
      'currentCents',  coalesce((select sum(sale_total_cents) from cur), 0),
      'previousCents', coalesce((select sum(sale_total_cents) from prev), 0)
    ),
    'units', jsonb_build_object(
      'current',  (select count(*) from cur_units),
      'previous', (select count(*) from prev_units)
    ),
    'unitsByType', jsonb_build_object(
      'cuba',  (select count(*) from cur_units where operation_type = 'CUBA'),
      'usa',   (select count(*) from cur_units where operation_type = 'USA'),
      'local', (select count(*) from cur_units where operation_type = 'LOCAL')
    ),
    'telemetry', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date',  to_char(d.sale_date, 'YYYY-MM-DD'),
          'cuba',  d.cuba, 'usa', d.usa, 'local', d.local)
        order by d.sale_date)
      from (
        select cu.sale_date,
          count(*) filter (where cu.operation_type = 'CUBA')  as cuba,
          count(*) filter (where cu.operation_type = 'USA')   as usa,
          count(*) filter (where cu.operation_type = 'LOCAL') as local
        from cur_units cu
        group by cu.sale_date
      ) d
    ), '[]'::jsonb),
    'topModels', coalesce((
      select jsonb_agg(
        jsonb_build_object('modelName', t.model, 'units', t.units)
        order by t.units desc, t.model)
      from (
        select model, count(*) as units
        from cur_units
        group by model
        order by units desc, model
        limit 6
      ) t
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.seller_dashboard_data(date, date, date, date)
  from public, anon;
grant execute on function public.seller_dashboard_data(date, date, date, date)
  to authenticated;
