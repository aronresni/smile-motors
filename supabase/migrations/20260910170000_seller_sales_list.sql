-- ===========================================================================
-- "MIS VENTAS" del vendedor: listado paginado + búsqueda + filtros + KPIs.
--
-- - RPC `seller_sales_list` (SECURITY INVOKER): toda la agregación y el
--   filtrado ocurren en la base; el navegador solo recibe la página pedida.
--   La RLS de `sales` (`seller_id = auth.uid()`) sigue siendo el aislamiento
--   real; además la RPC filtra de forma explícita por `auth.uid()`.
-- - NUNCA se acepta un `seller_id` del cliente.
--
-- FECHA EFECTIVA: `coalesce(sale_date, created_at::date)`. Los borradores
-- pueden no tener `sale_date`; se usa la fecha de creación para ubicarlos en
-- los filtros de período. En ventas CONFIRMADAS `sale_date` siempre existe.
--
-- ESTADOS EXPUESTOS: solo 'DRAFT' y 'CONFIRMED' tienen registros/uso real.
-- El resto del check de `sales.status` no se ofrece como filtro.
--
-- ÍNDICES: se reutiliza `sales_seller_status_date_idx (seller_id, status,
-- sale_date)` y los índices de FK de las tablas hijas
-- (`sale_units_sale_idx`, `sale_parties_sale_idx`). El texto de búsqueda usa
-- ILIKE '%...%' sobre un conjunto ya reducido a un vendedor: no se añade
-- índice de trigramas todavía (volumen por vendedor es bajo).
-- ===========================================================================

create or replace function public.seller_sales_list(
  p_search         text default null,
  p_start_date     date default null,
  p_end_date       date default null,
  p_status         text default 'ALL',
  p_operation_type text default 'ALL',
  p_limit          int  default 20,
  p_offset         int  default 0
)
returns jsonb
language sql
security invoker
set search_path = public
stable
as $$
  with args as (
    select
      nullif(btrim(coalesce(p_search, '')), '')            as search,
      coalesce(nullif(upper(btrim(p_status)), ''), 'ALL')  as status,
      coalesce(nullif(upper(btrim(p_operation_type)), ''), 'ALL') as operation_type,
      greatest(1, least(coalesce(p_limit, 20), 100))       as page_size,
      greatest(0, coalesce(p_offset, 0))                   as row_offset
  ),
  base as (
    select
      s.id,
      s.sale_number,
      s.status,
      s.operation_type,
      s.sale_date,
      s.created_at,
      s.confirmed_at,
      s.sale_total_cents,
      coalesce(s.sale_date, s.created_at::date) as effective_date
    from public.sales s, args a
    where s.seller_id = auth.uid()
      and (a.status = 'ALL' or s.status = a.status)
      and (a.operation_type = 'ALL' or s.operation_type = a.operation_type)
      and (p_start_date is null or coalesce(s.sale_date, s.created_at::date) >= p_start_date)
      and (p_end_date   is null or coalesce(s.sale_date, s.created_at::date) <= p_end_date)
  ),
  matched as (
    select b.*
    from base b, args a
    where a.search is null
       or b.sale_number ilike '%' || a.search || '%'
       or exists (
            select 1 from public.sale_parties sp
            where sp.sale_id = b.id
              and sp.party_role = 'PRIMARY_BUYER'
              and (
                coalesce(sp.first_name, '') ilike '%' || a.search || '%'
                or coalesce(sp.last_name, '') ilike '%' || a.search || '%'
                or btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, ''))
                     ilike '%' || a.search || '%'
              )
          )
       or exists (
            select 1 from public.sale_units su
            where su.sale_id = b.id
              and (
                coalesce(su.product_name_snapshot, '') ilike '%' || a.search || '%'
                or coalesce(su.tracking_code, '') ilike '%' || a.search || '%'
              )
          )
  ),
  page_rows as (
    select m.*
    from matched m, args a
    order by m.effective_date desc, m.created_at desc
    limit  (select page_size from args)
    offset (select row_offset from args)
  ),
  items as (
    select
      m.effective_date,
      m.created_at,
      jsonb_build_object(
        'saleId',         m.id,
        'saleNumber',     m.sale_number,
        'status',         m.status,
        'operationType',  m.operation_type,
        'saleDate',       to_char(m.effective_date, 'YYYY-MM-DD'),
        'hasExplicitDate', (m.sale_date is not null),
        'confirmedAt',    m.confirmed_at,
        'buyerName', (
          select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
          from public.sale_parties sp
          where sp.sale_id = m.id and sp.party_role = 'PRIMARY_BUYER'
        ),
        'unitCount', (select count(*) from public.sale_units su where su.sale_id = m.id),
        'units', coalesce((
          select jsonb_agg(
                   jsonb_build_object(
                     'productName',  su.product_name_snapshot,
                     'variant',      su.variant_snapshot,
                     'trackingCode', su.tracking_code)
                   order by su.position)
          from (
            select su2.*
            from public.sale_units su2
            where su2.sale_id = m.id
            order by su2.position
            limit 6
          ) su
        ), '[]'::jsonb),
        'saleTotalCents', coalesce(
          m.sale_total_cents,
          (select coalesce(sum(su.agreed_price_cents), 0)
             from public.sale_units su where su.sale_id = m.id)
          + (select coalesce(sum(greatest(1, se.quantity) * greatest(0, se.unit_price_cents)), 0)
             from public.sale_extras se where se.sale_id = m.id)
        )
      ) as item
    from page_rows m
  )
  select jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(item order by effective_date desc, created_at desc) from items),
      '[]'::jsonb),
    'page', (
      (select row_offset from args) / (select page_size from args)
    )::int + 1,
    'pageSize', (select page_size from args),
    'totalCount', (select count(*) from matched),
    'summary', jsonb_build_object(
      'operations',     (select count(*) from matched),
      'confirmedCount', (select count(*) from matched where status = 'CONFIRMED'),
      'draftCount',     (select count(*) from matched where status = 'DRAFT'),
      'confirmedRevenueCents',
        coalesce((select sum(sale_total_cents) from matched where status = 'CONFIRMED'), 0),
      'confirmedUnits', (
        select count(*)
        from public.sale_units su
        join matched mm on mm.id = su.sale_id and mm.status = 'CONFIRMED'
      )
    )
  );
$$;

revoke all on function public.seller_sales_list(text, date, date, text, text, int, int)
  from public, anon;
grant execute on function public.seller_sales_list(text, date, date, text, text, int, int)
  to authenticated;
