-- ===========================================================================
-- MÓDULO DE OPERACIONES DE VENTA — ADMINISTRACIÓN.
--
-- No introduce ninguna máquina de estados nueva: reutiliza exactamente
-- `sales.status` (DRAFT/PENDING/SOLD/PAID), `sales.settlement_status`
-- (PENDING_COLLECTION/PAID, ver 20260910210000), `sale_financing_contracts`
-- (SENT/SIGNED/ACCREDITED) y `sale_payment_allocations.settlement_status`
-- (PENDING/SETTLED) tal como ya existen. Solo agrega:
--   - `admin_dashboard_data`   — KPIs operativos reales para /admin.
--   - `admin_sales_list`       — listado paginado/buscable de TODAS las
--     ventas (todas las vendedoras), con filtros de estado comercial, cobro,
--     financiación, vendedor y período — análogo a `seller_sales_list` pero
--     sin el aislamiento por `seller_id = auth.uid()` (solo admin).
--   - 2 índices nuevos, justificados por los filtros de esta lista
--     (no duplican ninguno de los ya existentes — ver inspección previa).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Índices — filtros nuevos del listado de administración.
--    `sales_status_idx` (status) y `sales_seller_status_date_idx`
--    (seller_id, status, sale_date) ya existen; ninguno cubre bien un
--    filtro POR ESTADO A TRAVÉS DE TODOS LOS VENDEDORES ordenado por fecha,
--    ni una búsqueda/orden por `paid_at`.
-- ---------------------------------------------------------------------------
create index if not exists sales_status_date_idx on public.sales (status, sale_date);
create index if not exists sales_paid_at_idx on public.sales (paid_at) where paid_at is not null;

-- ===========================================================================
-- 2. admin_dashboard_data — KPIs operativos reales (ADMIN)
-- ===========================================================================
create or replace function public.admin_dashboard_data(p_start date, p_end date)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  with sold_or_paid as (
    select
      s.id, s.status, s.paid_at, s.sale_total_cents,
      coalesce(live.collected_cents, 0) as collected_cents,
      greatest(0, coalesce(s.sale_total_cents, 0) - coalesce(live.collected_cents, 0)) as outstanding_cents
    from public.sales s
    left join lateral (
      select
        sum(case
              when m.method_type = 'FINANCING' then
                case when exists (
                  select 1 from public.sale_financing_contracts c
                  where c.payment_allocation_id = a.id and c.status = 'ACCREDITED'
                ) then a.net_amount_cents else 0 end
              else
                case when a.settlement_status = 'SETTLED' then a.net_amount_cents else 0 end
            end) as collected_cents
      from public.sale_payment_allocations a
      join public.payment_methods m on m.id = a.payment_method_id
      where a.sale_id = s.id
    ) live on true
    where s.operation_type = 'CUBA' and s.status in ('SOLD', 'PAID')
  )
  select jsonb_build_object(
    'ok', true,
    'pendingCount', (select count(*) from public.sales where operation_type = 'CUBA' and status = 'PENDING'),
    'soldCount', (select count(*) from sold_or_paid where status = 'SOLD'),
    'pendingCollectionCount', (select count(*) from sold_or_paid where status = 'SOLD' and outstanding_cents > 0),
    'readyToPayCount', (select count(*) from sold_or_paid where status = 'SOLD' and outstanding_cents = 0),
    'paidCount', (select count(*) from sold_or_paid where status = 'PAID'),
    'outstandingAmountCents', coalesce((select sum(outstanding_cents) from sold_or_paid where status = 'SOLD'), 0),
    'paidAmountCentsPeriod', coalesce((
      select sum(sale_total_cents) from sold_or_paid
      where status = 'PAID' and paid_at is not null and paid_at::date between p_start and p_end
    ), 0)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_dashboard_data(date, date) from public, anon;
grant execute on function public.admin_dashboard_data(date, date) to authenticated;

-- ===========================================================================
-- 3. admin_sales_list — TODAS las ventas, cualquier vendedor (ADMIN)
--    Mismo patrón de búsqueda/filtros/paginación que `seller_sales_list`
--    (ver 20260910210000) pero sin aislamiento por vendedor, + filtro de
--    vendedor explícito, + estado de cobro derivado, + resumen de
--    financiación por proveedor (para la columna "Financiación").
-- ===========================================================================
create or replace function public.admin_sales_list(
  p_search            text default null,
  p_start_date        date default null,
  p_end_date          date default null,
  p_sale_status       text default 'ALL',
  p_collection_status text default 'ALL',
  p_seller_id         uuid default null,
  p_financing_status  text default 'ALL',
  p_limit             int  default 20,
  p_offset            int  default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_search      text := nullif(btrim(coalesce(p_search, '')), '');
  v_sale_status text := coalesce(nullif(upper(btrim(p_sale_status)), ''), 'ALL');
  v_collection  text := coalesce(nullif(upper(btrim(p_collection_status)), ''), 'ALL');
  v_financing   text := coalesce(nullif(upper(btrim(p_financing_status)), ''), 'ALL');
  v_limit       int  := greatest(1, least(coalesce(p_limit, 20), 100));
  v_offset      int  := greatest(0, coalesce(p_offset, 0));
  v_result      jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  with base as (
    select
      s.id, s.sale_number, s.status, s.operation_type, s.sale_date, s.created_at,
      s.seller_id, s.sold_at, s.paid_at, s.review_requested_at, s.sale_total_cents,
      s.settlement_status, s.closing_reviewed_at,
      coalesce(s.sale_date, s.created_at::date) as effective_date,
      (select p.full_name from public.profiles p where p.id = s.seller_id) as seller_name
    from public.sales s
    where s.operation_type = 'CUBA'
      and (v_sale_status = 'ALL' or s.status = v_sale_status)
      and (p_seller_id is null or s.seller_id = p_seller_id)
      and (p_start_date is null or coalesce(s.sale_date, s.created_at::date) >= p_start_date)
      and (p_end_date   is null or coalesce(s.sale_date, s.created_at::date) <= p_end_date)
  ),
  settlement as (
    select
      b.id as sale_id,
      coalesce(sum(case
        when m.method_type = 'FINANCING' then
          case when c.status = 'ACCREDITED' then a.net_amount_cents else 0 end
        else
          case when a.settlement_status = 'SETTLED' then a.net_amount_cents else 0 end
      end), 0) as collected_cents,
      count(*) filter (where m.method_type = 'FINANCING') as fin_providers,
      count(*) filter (where m.method_type = 'FINANCING' and c.id is null) as fin_pending_contract,
      count(*) filter (where c.status = 'SENT') as fin_sent,
      count(*) filter (where c.status = 'SIGNED') as fin_signed,
      count(*) filter (where c.status = 'ACCREDITED') as fin_accredited
    from base b
    left join public.sale_payment_allocations a on a.sale_id = b.id
    left join public.payment_methods m on m.id = a.payment_method_id
    left join public.sale_financing_contracts c on c.payment_allocation_id = a.id
    group by b.id
  ),
  matched as (
    select
      b.*,
      coalesce(st.collected_cents, 0) as collected_cents,
      greatest(0, coalesce(b.sale_total_cents, 0) - coalesce(st.collected_cents, 0)) as outstanding_cents,
      coalesce(st.fin_providers, 0) as fin_providers,
      coalesce(st.fin_pending_contract, 0) as fin_pending_contract,
      coalesce(st.fin_sent, 0) as fin_sent,
      coalesce(st.fin_signed, 0) as fin_signed,
      coalesce(st.fin_accredited, 0) as fin_accredited,
      case
        when b.status = 'PAID' then 'PAID'
        when b.status = 'SOLD' and greatest(0, coalesce(b.sale_total_cents, 0) - coalesce(st.collected_cents, 0)) = 0 then 'READY_TO_PAY'
        when b.status = 'SOLD' then 'PENDING_COLLECTION'
        else null
      end as collection_status
    from base b
    left join settlement st on st.sale_id = b.id
    where (
      v_search is null
      or b.sale_number ilike '%' || v_search || '%'
      or coalesce(b.seller_name, '') ilike '%' || v_search || '%'
      or exists (
           select 1 from public.sale_parties sp
           where sp.sale_id = b.id and sp.party_role = 'PRIMARY_BUYER'
             and (
               coalesce(sp.first_name, '') ilike '%' || v_search || '%'
               or coalesce(sp.last_name, '') ilike '%' || v_search || '%'
               or btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, ''))
                    ilike '%' || v_search || '%'
             )
         )
      or exists (
           select 1 from public.sale_units su
           where su.sale_id = b.id
             and (
               coalesce(su.product_name_snapshot, '') ilike '%' || v_search || '%'
               or coalesce(su.tracking_code, '') ilike '%' || v_search || '%'
             )
         )
      or exists (
           select 1 from public.sale_payment_allocations al
           where al.sale_id = b.id
             and coalesce(al.provider_name_snapshot, '') ilike '%' || v_search || '%'
         )
    )
    and (
      v_collection = 'ALL'
      or (v_collection = 'PENDING_COLLECTION' and (
            select case
              when b.status = 'PAID' then 'PAID'
              when b.status = 'SOLD' and greatest(0, coalesce(b.sale_total_cents, 0) - coalesce(st.collected_cents, 0)) = 0 then 'READY_TO_PAY'
              when b.status = 'SOLD' then 'PENDING_COLLECTION'
              else null
            end
          ) = 'PENDING_COLLECTION')
      or (v_collection = 'READY_TO_PAY' and (
            select case
              when b.status = 'PAID' then 'PAID'
              when b.status = 'SOLD' and greatest(0, coalesce(b.sale_total_cents, 0) - coalesce(st.collected_cents, 0)) = 0 then 'READY_TO_PAY'
              when b.status = 'SOLD' then 'PENDING_COLLECTION'
              else null
            end
          ) = 'READY_TO_PAY')
      or (v_collection = 'PAID' and b.status = 'PAID')
    )
    and (
      v_financing = 'ALL'
      -- "sin firmar": tiene financiación pero ninguna alcanzó SIGNED/ACREDITADO.
      or (v_financing = 'UNSIGNED' and coalesce(st.fin_providers, 0) > 0
          and coalesce(st.fin_signed, 0) = 0 and coalesce(st.fin_accredited, 0) = 0)
      -- "firmado" / "pendiente de acreditar": equivalentes en este esquema —
      -- al menos un contrato está actualmente en SIGNED (ya no es SENT, aún
      -- no es ACCREDITED).
      or (v_financing in ('SIGNED', 'PENDING_ACCREDITATION') and coalesce(st.fin_signed, 0) > 0)
      -- "totalmente acreditado": TODOS los contratos de financiación llegaron
      -- a ACCREDITED.
      or (v_financing = 'ACCREDITED' and coalesce(st.fin_providers, 0) > 0
          and st.fin_accredited = st.fin_providers)
    )
  ),
  page_rows as (
    select m.*
    from matched m
    order by m.effective_date desc, m.created_at desc
    limit v_limit offset v_offset
  ),
  items as (
    select
      m.effective_date,
      m.created_at,
      jsonb_build_object(
        'saleId', m.id,
        'saleNumber', m.sale_number,
        'status', m.status,
        'operationType', m.operation_type,
        'saleDate', to_char(m.effective_date, 'YYYY-MM-DD'),
        'hasExplicitDate', (m.sale_date is not null),
        'sellerId', m.seller_id,
        'sellerName', m.seller_name,
        'soldAt', m.sold_at,
        'paidAt', m.paid_at,
        'reviewRequestedAt', m.review_requested_at,
        'settlementStatus', m.settlement_status,
        'collectionStatus', m.collection_status,
        'closingReviewedAt', m.closing_reviewed_at,
        'buyerName', (
          select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
          from public.sale_parties sp
          where sp.sale_id = m.id and sp.party_role = 'PRIMARY_BUYER'
        ),
        'unitCount', (select count(*) from public.sale_units su where su.sale_id = m.id),
        'units', coalesce((
          select jsonb_agg(
                   jsonb_build_object(
                     'productName', su.product_name_snapshot,
                     'variant', su.variant_snapshot,
                     'trackingCode', su.tracking_code)
                   order by su.position)
          from (
            select su2.* from public.sale_units su2
            where su2.sale_id = m.id order by su2.position limit 6
          ) su
        ), '[]'::jsonb),
        'saleTotalCents', coalesce(
          m.sale_total_cents,
          (select coalesce(sum(su.agreed_price_cents), 0) from public.sale_units su where su.sale_id = m.id)
        ),
        'collectedCents', m.collected_cents,
        'outstandingCents', m.outstanding_cents,
        'financing', jsonb_build_object(
          'providers', m.fin_providers,
          'pendingContract', m.fin_pending_contract,
          'sent', m.fin_sent,
          'signed', m.fin_signed,
          'accredited', m.fin_accredited
        ),
        'financingProviders', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'providerName', c.provider_name_snapshot,
                   'status', c.status)
                   order by c.sent_at)
          from public.sale_financing_contracts c
          where c.sale_id = m.id
        ), '[]'::jsonb)
      ) as item
    from page_rows m
  )
  select jsonb_build_object(
    'ok', true,
    'items', coalesce((select jsonb_agg(item order by effective_date desc, created_at desc) from items), '[]'::jsonb),
    'page', (v_offset / v_limit)::int + 1,
    'pageSize', v_limit,
    'totalCount', (select count(*) from matched)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_sales_list(text, date, date, text, text, uuid, text, int, int) from public, anon;
grant execute on function public.admin_sales_list(text, date, date, text, text, uuid, text, int, int) to authenticated;
