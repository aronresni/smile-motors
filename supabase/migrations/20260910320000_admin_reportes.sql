-- ===========================================================================
-- ADMIN · REPORTES & ANALYTICS — agregación server-side pura sobre datos ya
-- autoritativos. NINGUNA fórmula de comisión/liquidación/settlement se
-- toca ni se reimplementa: cada reporte LEE `sale_commissions`/
-- `weekly_liquidations`/`sale_settlement_amounts()` tal cual existen.
--
-- SEMÁNTICA DE FECHAS (nunca se mezclan, ver cada RPC):
--   - Actividad comercial (ventas, unidades, ingresos):  sales.sale_date
--     (fecha de negocio, ya establecida en todo el proyecto).
--   - Pagado (ventas pagadas, monto pagado):             sales.paid_at.
--   - Elegibilidad de comisión:                          sale_commissions.eligible_at.
--   - Pago de liquidación semanal:                       weekly_liquidations.paid_at.
--   - Eventos de contrato (SENT/SIGNED/ACCREDITED):      sus columnas *_at reales.
--
-- ESTADO ACTUAL vs. ACTIVIDAD DEL PERÍODO (documentado explícitamente en
-- cada RPC): "pendiente a cobrar", "comisiones elegibles" (monto) y "ventas
-- pendientes" son SIEMPRE el estado ACTUAL (una foto de ahora mismo, igual
-- que ya lo trata `admin_dashboard_data`/Alertas) — el filtro de período NO
-- los afecta. Todo lo demás SÍ respeta el período seleccionado.
--
-- Zona horaria: TODA fecha límite de período se resuelve con
-- `_dealer_timezone()`/`_dealer_day_start_at()` (ya creados en Liquidaciones/
-- Actividad) — nunca con el reloj del navegador ni con un cast UTC crudo.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Índices — ninguno de estos existía; son exactamente los que necesitan
--    las agregaciones por producto/proveedor/fecha de este módulo.
-- ---------------------------------------------------------------------------
create index if not exists sale_units_product_idx on public.sale_units (product_id);
create index if not exists sale_payment_allocations_method_idx on public.sale_payment_allocations (payment_method_id);
create index if not exists sale_financing_contracts_method_idx on public.sale_financing_contracts (payment_method_id);
create index if not exists sales_sale_date_idx on public.sales (sale_date) where operation_type = 'CUBA';

-- ---------------------------------------------------------------------------
-- 1. admin_dealer_today — "hoy" del concesionario para sembrar los presets
--    de período (Hoy/Esta semana/Mes actual/…) SIN usar el reloj del
--    navegador ni el del proceso Node. Mismo helper de zona horaria de
--    Liquidaciones/Actividad, expuesto para este uso.
-- ---------------------------------------------------------------------------
create or replace function public.admin_dealer_today()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  return jsonb_build_object('ok', true, 'today', (now() at time zone public._dealer_timezone())::date);
end;
$$;
revoke all on function public.admin_dealer_today() from public, anon;
grant execute on function public.admin_dealer_today() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. admin_reports_overview — RESUMEN. Dos bloques, nunca mezclados.
-- ---------------------------------------------------------------------------
create or replace function public.admin_reports_overview(p_start date default null, p_end date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_paid_start timestamptz := case when p_start is null then null else public._dealer_day_start_at(p_start) end;
  v_paid_end   timestamptz := case when p_end   is null then null else public._dealer_day_start_at(p_end + 1) end;
  v_liq_start  timestamptz := v_paid_start;
  v_liq_end    timestamptz := v_paid_end;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  return jsonb_build_object(
    'ok', true,
    -- Actividad del período seleccionado (sale_date / paid_at / liquidations.paid_at).
    'period', jsonb_build_object(
      'commercialSalesCount', (
        select count(*) from public.sales
        where operation_type = 'CUBA' and status in ('SOLD', 'PAID')
          and (p_start is null or sale_date >= p_start) and (p_end is null or sale_date <= p_end)
      ),
      'unitsSold', (
        select count(*) from public.sale_units su join public.sales s on s.id = su.sale_id
        where s.operation_type = 'CUBA' and s.status in ('SOLD', 'PAID')
          and (p_start is null or s.sale_date >= p_start) and (p_end is null or s.sale_date <= p_end)
      ),
      'commercialRevenueCents', coalesce((
        select sum(sale_total_cents) from public.sales
        where operation_type = 'CUBA' and status in ('SOLD', 'PAID')
          and (p_start is null or sale_date >= p_start) and (p_end is null or sale_date <= p_end)
      ), 0),
      'paidSalesCount', (
        select count(*) from public.sales
        where operation_type = 'CUBA' and status = 'PAID'
          and (v_paid_start is null or paid_at >= v_paid_start) and (v_paid_end is null or paid_at < v_paid_end)
      ),
      'paidAmountCents', coalesce((
        select sum(sale_total_cents) from public.sales
        where operation_type = 'CUBA' and status = 'PAID'
          and (v_paid_start is null or paid_at >= v_paid_start) and (v_paid_end is null or paid_at < v_paid_end)
      ), 0),
      'liquidationsPaidAmountCents', coalesce((
        select sum(total_to_pay_cents) from public.weekly_liquidations
        where status = 'PAID'
          and (v_liq_start is null or paid_at >= v_liq_start) and (v_liq_end is null or paid_at < v_liq_end)
      ), 0)
    ),
    -- Estado ACTUAL — no depende del período elegido (misma semántica que
    -- admin_dashboard_data / Alertas).
    'current', jsonb_build_object(
      'pendingSalesCount', (select count(*) from public.sales where operation_type = 'CUBA' and status = 'PENDING'),
      'outstandingCollectionCents', coalesce((
        select sum(greatest(0, coalesce(s.sale_total_cents, 0) - st.collected_cents))
        from public.sales s cross join lateral public.sale_settlement_amounts(s.id) st
        where s.operation_type = 'CUBA' and s.status = 'SOLD'
      ), 0),
      'eligibleCommissionCents', coalesce((select sum(final_commission_cents) from public.sale_commissions where status = 'ELIGIBLE'), 0)
    )
  );
end;
$$;
revoke all on function public.admin_reports_overview(date, date) from public, anon;
grant execute on function public.admin_reports_overview(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. admin_reports_sales_trend — serie de tiempo (día/semana/mes según
--    rango, o forzado por p_granularity). Agregado en SQL, nunca filas
--    crudas devueltas para graficar en React.
-- ---------------------------------------------------------------------------
create or replace function public.admin_reports_sales_trend(
  p_start date default null, p_end date default null, p_granularity text default 'auto'
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_start date := coalesce(p_start, (select min(sale_date) from public.sales where operation_type = 'CUBA'), current_date);
  v_end   date := coalesce(p_end, current_date);
  v_days  int := greatest(1, v_end - v_start);
  v_gran  text := lower(coalesce(nullif(p_granularity, ''), 'auto'));
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  if v_gran = 'auto' then
    v_gran := case when v_days <= 31 then 'day' when v_days <= 180 then 'week' else 'month' end;
  end if;

  return jsonb_build_object(
    'ok', true, 'granularity', v_gran,
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bucketStart', b.bucket_start, 'salesCount', b.sales_count, 'units', b.units, 'revenueCents', b.revenue_cents
      ) order by b.bucket_start)
      from (
        select
          case v_gran
            when 'day' then s.sale_date
            when 'week' then public._liquidation_week_start(s.sale_date)
            else date_trunc('month', s.sale_date)::date
          end as bucket_start,
          count(distinct s.id) as sales_count,
          count(su.id) as units,
          coalesce(sum(su.agreed_price_cents), 0) as revenue_cents
        from public.sales s
        join public.sale_units su on su.sale_id = s.id
        where s.operation_type = 'CUBA' and s.status in ('SOLD', 'PAID')
          and s.sale_date between v_start and v_end
        group by 1
      ) b
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_reports_sales_trend(date, date, text) from public, anon;
grant execute on function public.admin_reports_sales_trend(date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. admin_reports_funnel — conteos operativos ACTUALES por estado, más
--    tiempo de conversión PENDING->SOLD / SOLD->PAID para transiciones
--    reales ocurridas en el período (sale_status_history, nunca inventado).
-- ---------------------------------------------------------------------------
create or replace function public.admin_reports_funnel(p_start date default null, p_end date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_start_at timestamptz := case when p_start is null then null else public._dealer_day_start_at(p_start) end;
  v_end_at   timestamptz := case when p_end   is null then null else public._dealer_day_start_at(p_end + 1) end;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  return jsonb_build_object(
    'ok', true,
    'counts', jsonb_build_object(
      'pending', (select count(*) from public.sales where operation_type = 'CUBA' and status = 'PENDING'),
      'sold', (select count(*) from public.sales where operation_type = 'CUBA' and status = 'SOLD'),
      'paid', (select count(*) from public.sales where operation_type = 'CUBA' and status = 'PAID')
    ),
    'conversion', (
      with to_sold as (
        select h.sale_id, h.created_at as sold_at
        from public.sale_status_history h
        where h.to_status = 'SOLD' and (v_start_at is null or h.created_at >= v_start_at) and (v_end_at is null or h.created_at < v_end_at)
      ),
      to_pending as (
        select sale_id, min(created_at) as pending_at from public.sale_status_history where to_status = 'PENDING' group by sale_id
      ),
      to_paid as (
        select h.sale_id, h.created_at as paid_at
        from public.sale_status_history h
        where h.to_status = 'PAID' and (v_start_at is null or h.created_at >= v_start_at) and (v_end_at is null or h.created_at < v_end_at)
      ),
      pending_to_sold as (
        select extract(epoch from (ts.sold_at - tp.pending_at)) as secs
        from to_sold ts join to_pending tp on tp.sale_id = ts.sale_id
        where ts.sold_at > tp.pending_at
      ),
      sold_to_paid as (
        select extract(epoch from (tp2.paid_at - h.created_at)) as secs
        from to_paid tp2
        join public.sale_status_history h on h.sale_id = tp2.sale_id and h.to_status = 'SOLD'
        where tp2.paid_at > h.created_at
      )
      select jsonb_build_object(
        'pendingToSold', case when (select count(*) from pending_to_sold) = 0 then null else jsonb_build_object(
          'sampleSize', (select count(*) from pending_to_sold),
          'avgHours', round((select avg(secs) from pending_to_sold) / 3600.0, 1),
          'medianHours', round((select percentile_cont(0.5) within group (order by secs) from pending_to_sold) / 3600.0, 1)
        ) end,
        'soldToPaid', case when (select count(*) from sold_to_paid) = 0 then null else jsonb_build_object(
          'sampleSize', (select count(*) from sold_to_paid),
          'avgHours', round((select avg(secs) from sold_to_paid) / 3600.0, 1),
          'medianHours', round((select percentile_cont(0.5) within group (order by secs) from sold_to_paid) / 3600.0, 1)
        ) end
      )
    )
  );
end;
$$;
revoke all on function public.admin_reports_funnel(date, date) from public, anon;
grant execute on function public.admin_reports_funnel(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. admin_reports_sellers — tabla por vendedor.
-- ---------------------------------------------------------------------------
create or replace function public.admin_reports_sellers(
  p_start date default null, p_end date default null, p_sort text default 'revenue', p_order text default 'desc'
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_liq_start timestamptz := case when p_start is null then null else public._dealer_day_start_at(p_start) end;
  v_liq_end   timestamptz := case when p_end   is null then null else public._dealer_day_start_at(p_end + 1) end;
  v_sort text := lower(coalesce(nullif(p_sort, ''), 'revenue'));
  v_order text := case when lower(coalesce(p_order, 'desc')) = 'asc' then 'asc' else 'desc' end;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  return jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sellerId', row.seller_id, 'sellerName', row.seller_name,
        'salesCount', row.sales_count, 'units', row.units, 'revenueCents', row.revenue_cents,
        'pendingCount', row.pending_count, 'soldCount', row.sold_count, 'paidCount', row.paid_count,
        'commissionPendingCents', row.commission_pending_cents, 'commissionEligibleCents', row.commission_eligible_cents,
        'liquidationPaidCents', row.liquidation_paid_cents
      ) order by
        case when v_sort = 'revenue' and v_order = 'desc' then row.revenue_cents end desc,
        case when v_sort = 'revenue' and v_order = 'asc' then row.revenue_cents end asc,
        case when v_sort = 'units' and v_order = 'desc' then row.units end desc,
        case when v_sort = 'units' and v_order = 'asc' then row.units end asc,
        case when v_sort = 'sales' and v_order = 'desc' then row.sales_count end desc,
        case when v_sort = 'sales' and v_order = 'asc' then row.sales_count end asc,
        row.seller_name
      )
      from (
        select
          p.id as seller_id, p.full_name as seller_name,
          coalesce(period_sales.sales_count, 0) as sales_count,
          coalesce(period_sales.units, 0) as units,
          coalesce(period_sales.revenue_cents, 0) as revenue_cents,
          coalesce(status_split.pending_count, 0) as pending_count,
          coalesce(status_split.sold_count, 0) as sold_count,
          coalesce(status_split.paid_count, 0) as paid_count,
          coalesce(comm.pending_cents, 0) as commission_pending_cents,
          coalesce(comm.eligible_cents, 0) as commission_eligible_cents,
          coalesce(liq.paid_cents, 0) as liquidation_paid_cents
        from public.profiles p
        left join lateral (
          select count(distinct s.id) as sales_count, count(su.id) as units, coalesce(sum(su.agreed_price_cents), 0) as revenue_cents
          from public.sales s
          join public.sale_units su on su.sale_id = s.id
          where s.seller_id = p.id and s.operation_type = 'CUBA' and s.status in ('SOLD', 'PAID')
            and (p_start is null or s.sale_date >= p_start) and (p_end is null or s.sale_date <= p_end)
        ) period_sales on true
        left join lateral (
          select
            count(*) filter (where status = 'PENDING') as pending_count,
            count(*) filter (where status = 'SOLD') as sold_count,
            count(*) filter (where status = 'PAID') as paid_count
          from public.sales s
          where s.seller_id = p.id and s.operation_type = 'CUBA'
            and (p_start is null or s.sale_date >= p_start) and (p_end is null or s.sale_date <= p_end)
        ) status_split on true
        left join lateral (
          select
            sum(final_commission_cents) filter (where status = 'PENDING') as pending_cents,
            sum(final_commission_cents) filter (where status = 'ELIGIBLE') as eligible_cents
          from public.sale_commissions where seller_id = p.id
        ) comm on true
        left join lateral (
          select sum(total_to_pay_cents) as paid_cents
          from public.weekly_liquidations
          where seller_id = p.id and status = 'PAID'
            and (v_liq_start is null or paid_at >= v_liq_start) and (v_liq_end is null or paid_at < v_liq_end)
        ) liq on true
        where p.role = 'seller'
      ) row
      where row.sales_count > 0 or row.pending_count > 0 or row.commission_pending_cents > 0
        or row.commission_eligible_cents > 0 or row.liquidation_paid_cents > 0
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_reports_sellers(date, date, text, text) from public, anon;
grant execute on function public.admin_reports_sellers(date, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. admin_reports_products — tabla por producto + admin_reports_top_products.
-- ---------------------------------------------------------------------------
create or replace function public.admin_reports_products(
  p_start date default null, p_end date default null, p_category text default null, p_stock_mode text default 'ALL'
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_stock_mode text := coalesce(nullif(upper(btrim(p_stock_mode)), ''), 'ALL');
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  return jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'productId', p.id, 'productName', p.name, 'category', p.category,
        'isOnDemand', p.stock_mode = 'on_demand',
        'unitsSold', coalesce(u.units_sold, 0), 'salesCount', coalesce(u.sales_count, 0),
        'revenueCents', coalesce(u.revenue_cents, 0),
        'avgSalePriceCents', case when coalesce(u.units_sold, 0) = 0 then null else round(u.revenue_cents::numeric / u.units_sold) end,
        'pendingUnits', coalesce(u.pending_units, 0), 'soldUnits', coalesce(u.sold_units, 0), 'paidUnits', coalesce(u.paid_units, 0),
        'currentAvailableStock', case when p.stock_mode = 'on_demand' then null else coalesce(inv.available, 0) end,
        'commissionGeneratedCents', coalesce(c.commission_cents, 0)
      ) order by coalesce(u.revenue_cents, 0) desc, p.name)
      from public.products p
      left join lateral (
        select
          count(su.id) filter (where s.status in ('SOLD', 'PAID')) as units_sold,
          count(distinct s.id) filter (where s.status in ('SOLD', 'PAID')) as sales_count,
          coalesce(sum(su.agreed_price_cents) filter (where s.status in ('SOLD', 'PAID')), 0) as revenue_cents,
          count(su.id) filter (where s.status = 'PENDING') as pending_units,
          count(su.id) filter (where s.status = 'SOLD') as sold_units,
          count(su.id) filter (where s.status = 'PAID') as paid_units
        from public.sale_units su
        join public.sales s on s.id = su.sale_id
        where su.product_id = p.id and s.operation_type = 'CUBA'
          and (p_start is null or s.sale_date >= p_start) and (p_end is null or s.sale_date <= p_end)
      ) u on true
      left join lateral (
        select count(*) as available from public.inventory_units where product_id = p.id and status = 'AVAILABLE'
      ) inv on true
      left join lateral (
        select sum(sc.final_commission_cents) as commission_cents
        from public.sale_commissions sc
        join public.sale_units su2 on su2.id = sc.sale_unit_id
        where su2.product_id = p.id
      ) c on true
      where (p_category is null or p.category = p_category)
        and (v_stock_mode = 'ALL' or (v_stock_mode = 'ON_DEMAND' and p.stock_mode = 'on_demand')
             or (v_stock_mode = 'STOCKED' and p.stock_mode is distinct from 'on_demand'))
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_reports_products(date, date, text, text) from public, anon;
grant execute on function public.admin_reports_products(date, date, text, text) to authenticated;

create or replace function public.admin_reports_top_products(
  p_start date default null, p_end date default null, p_metric text default 'units', p_limit int default 8
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_metric text := lower(coalesce(nullif(p_metric, ''), 'units'));
  v_limit  int  := greatest(1, least(coalesce(p_limit, 8), 20));
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  return jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('productId', t.product_id, 'productName', t.product_name, 'units', t.units, 'revenueCents', t.revenue_cents))
      from (
        select su.product_id, coalesce(nullif(btrim(su.product_name_snapshot), ''), 'Sin nombre') as product_name,
          count(su.id) as units, coalesce(sum(su.agreed_price_cents), 0) as revenue_cents
        from public.sale_units su
        join public.sales s on s.id = su.sale_id
        where s.operation_type = 'CUBA' and s.status in ('SOLD', 'PAID')
          and (p_start is null or s.sale_date >= p_start) and (p_end is null or s.sale_date <= p_end)
        group by su.product_id, coalesce(nullif(btrim(su.product_name_snapshot), ''), 'Sin nombre')
        order by case when v_metric = 'revenue' then sum(su.agreed_price_cents) else count(su.id) end desc
        limit v_limit
      ) t
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_reports_top_products(date, date, text, int) from public, anon;
grant execute on function public.admin_reports_top_products(date, date, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. admin_reports_financing — por proveedor (allocation-based, nunca el
--    total de la venta atribuido a más de un proveedor) + pagos directos.
-- ---------------------------------------------------------------------------
create or replace function public.admin_reports_financing(p_start date default null, p_end date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  return jsonb_build_object(
    'ok', true,
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'providerName', t.provider_name,
        'salesCount', t.sales_count, 'allocationsCount', t.allocations_count,
        'grossAllocatedCents', t.gross_cents, 'feesCents', t.fee_cents, 'netAllocatedCents', t.net_cents,
        'netAccreditedCents', t.net_accredited_cents,
        'contractsSent', t.contracts_sent, 'contractsSigned', t.contracts_signed, 'contractsAccredited', t.contracts_accredited
      ) order by t.gross_cents desc)
      from (
        select
          a.provider_name_snapshot as provider_name,
          count(distinct a.sale_id) as sales_count, count(a.id) as allocations_count,
          coalesce(sum(a.gross_amount_cents), 0) as gross_cents, coalesce(sum(a.fee_amount_cents), 0) as fee_cents,
          coalesce(sum(a.net_amount_cents), 0) as net_cents,
          coalesce(sum(a.net_amount_cents) filter (where c.status = 'ACCREDITED'), 0) as net_accredited_cents,
          count(c.id) filter (where c.status = 'SENT' and (p_start is null or c.sent_at::date >= p_start) and (p_end is null or c.sent_at::date <= p_end)) as contracts_sent,
          count(c.id) filter (where c.status in ('SIGNED', 'ACCREDITED') and c.signed_at is not null and (p_start is null or c.signed_at::date >= p_start) and (p_end is null or c.signed_at::date <= p_end)) as contracts_signed,
          count(c.id) filter (where c.status = 'ACCREDITED' and (p_start is null or c.accredited_at::date >= p_start) and (p_end is null or c.accredited_at::date <= p_end)) as contracts_accredited
        from public.sale_payment_allocations a
        join public.payment_methods m on m.id = a.payment_method_id
        join public.sales s on s.id = a.sale_id
        left join public.sale_financing_contracts c on c.payment_allocation_id = a.id
        where m.method_type = 'FINANCING' and s.operation_type = 'CUBA'
          and (p_start is null or s.sale_date >= p_start) and (p_end is null or s.sale_date <= p_end)
        group by a.provider_name_snapshot
      ) t
    ), '[]'::jsonb),
    'directPayments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'methodType', t.method_type,
        'allocatedCents', t.allocated_cents, 'settledCents', t.settled_cents, 'pendingCents', t.pending_cents
      ) order by t.allocated_cents desc)
      from (
        select
          m.method_type,
          coalesce(sum(a.net_amount_cents), 0) as allocated_cents,
          coalesce(sum(a.net_amount_cents) filter (where a.settlement_status = 'SETTLED'), 0) as settled_cents,
          coalesce(sum(a.net_amount_cents) filter (where a.settlement_status <> 'SETTLED'), 0) as pending_cents
        from public.sale_payment_allocations a
        join public.payment_methods m on m.id = a.payment_method_id
        join public.sales s on s.id = a.sale_id
        where m.method_type <> 'FINANCING' and s.operation_type = 'CUBA'
          and (p_start is null or s.sale_date >= p_start) and (p_end is null or s.sale_date <= p_end)
        group by m.method_type
      ) t
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_reports_financing(date, date) from public, anon;
grant execute on function public.admin_reports_financing(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. admin_reports_collection — cobros. Outstanding/settled/pending/ready
--    son ACTUALES (no dependen del período); "pagadas en el período" sí.
-- ---------------------------------------------------------------------------
create or replace function public.admin_reports_collection(p_start date default null, p_end date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_paid_start timestamptz := case when p_start is null then null else public._dealer_day_start_at(p_start) end;
  v_paid_end   timestamptz := case when p_end   is null then null else public._dealer_day_start_at(p_end + 1) end;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  return jsonb_build_object(
    'ok', true,
    'current', (
      with sold as (
        select s.id, s.sold_at, coalesce(s.sale_total_cents, 0) as total_cents, st.collected_cents,
          greatest(0, coalesce(s.sale_total_cents, 0) - st.collected_cents) as outstanding_cents
        from public.sales s cross join lateral public.sale_settlement_amounts(s.id) st
        where s.operation_type = 'CUBA' and s.status = 'SOLD'
      )
      select jsonb_build_object(
        'totalOutstandingCents', coalesce((select sum(outstanding_cents) from sold), 0),
        'totalSettledCents', coalesce((select sum(collected_cents) from sold), 0),
        'pendingCollectionCount', (select count(*) from sold where outstanding_cents > 0),
        'readyToPayCount', (select count(*) from sold where outstanding_cents = 0 and total_cents > 0),
        'agingBuckets', jsonb_build_object(
          'd0to2', (select count(*) from sold where outstanding_cents > 0 and now() - sold_at < interval '3 days'),
          'd3to7', (select count(*) from sold where outstanding_cents > 0 and now() - sold_at >= interval '3 days' and now() - sold_at < interval '8 days'),
          'd8to14', (select count(*) from sold where outstanding_cents > 0 and now() - sold_at >= interval '8 days' and now() - sold_at < interval '15 days'),
          'd15plus', (select count(*) from sold where outstanding_cents > 0 and now() - sold_at >= interval '15 days')
        )
      )
    ),
    'period', jsonb_build_object(
      'paidSalesCount', (
        select count(*) from public.sales
        where operation_type = 'CUBA' and status = 'PAID'
          and (v_paid_start is null or paid_at >= v_paid_start) and (v_paid_end is null or paid_at < v_paid_end)
      ),
      'paidAmountCents', coalesce((
        select sum(sale_total_cents) from public.sales
        where operation_type = 'CUBA' and status = 'PAID'
          and (v_paid_start is null or paid_at >= v_paid_start) and (v_paid_end is null or paid_at < v_paid_end)
      ), 0)
    )
  );
end;
$$;
revoke all on function public.admin_reports_collection(date, date) from public, anon;
grant execute on function public.admin_reports_collection(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. admin_reports_commissions — sale_commissions es la ÚNICA fuente; nunca
--    se recalcula desde config de VIN/producto/precio de venta.
-- ---------------------------------------------------------------------------
create or replace function public.admin_reports_commissions(p_start date default null, p_end date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  return jsonb_build_object(
    'ok', true,
    -- Estado ACTUAL (igual que /admin/comisiones y el resumen de Reportes).
    'current', jsonb_build_object(
      'pendingCount', (select count(*) from public.sale_commissions where status = 'PENDING'),
      'pendingCents', coalesce((select sum(final_commission_cents) from public.sale_commissions where status = 'PENDING'), 0),
      'eligibleCount', (select count(*) from public.sale_commissions where status = 'ELIGIBLE'),
      'eligibleCents', coalesce((select sum(final_commission_cents) from public.sale_commissions where status = 'ELIGIBLE'), 0)
    ),
    'bySeller', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sellerId', t.seller_id, 'sellerName', t.seller_name,
        'pendingCents', t.pending_cents, 'eligibleCents', t.eligible_cents
      ) order by (t.pending_cents + t.eligible_cents) desc)
      from (
        select sc.seller_id, pr.full_name as seller_name,
          sum(sc.final_commission_cents) filter (where sc.status = 'PENDING') as pending_cents,
          sum(sc.final_commission_cents) filter (where sc.status = 'ELIGIBLE') as eligible_cents
        from public.sale_commissions sc
        join public.profiles pr on pr.id = sc.seller_id
        group by sc.seller_id, pr.full_name
      ) t
      where coalesce(t.pending_cents, 0) > 0 or coalesce(t.eligible_cents, 0) > 0
    ), '[]'::jsonb),
    'byProduct', coalesce((
      select jsonb_agg(jsonb_build_object('productId', t.product_id, 'productName', t.product_name, 'commissionCents', t.commission_cents))
      from (
        select su.product_id, p.name as product_name, sum(sc.final_commission_cents) as commission_cents
        from public.sale_commissions sc
        join public.sale_units su on su.id = sc.sale_unit_id
        join public.products p on p.id = su.product_id
        group by su.product_id, p.name
        order by sum(sc.final_commission_cents) desc
        limit 10
      ) t
    ), '[]'::jsonb),
    -- Tendencia: cuánto se volvió ELIGIBLE por día, DENTRO del período (esto
    -- sí es period-scoped a propósito — es una serie de tiempo, no un estado).
    'eligibleTrend', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.day, 'eligibleCents', d.cents) order by d.day)
      from (
        select eligible_at::date as day, sum(final_commission_cents) as cents
        from public.sale_commissions
        where status = 'ELIGIBLE'
          and (p_start is null or eligible_at::date >= p_start) and (p_end is null or eligible_at::date <= p_end)
        group by eligible_at::date
      ) d
    ), '[]'::jsonb),
    'avgCommissionPerUnitCents', (
      select case when count(*) = 0 then null else round(avg(final_commission_cents)) end
      from public.sale_commissions
      where (p_start is null or calculated_at::date >= p_start) and (p_end is null or calculated_at::date <= p_end)
    )
  );
end;
$$;
revoke all on function public.admin_reports_commissions(date, date) from public, anon;
grant execute on function public.admin_reports_commissions(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. admin_reports_liquidations — conteos por estado ACTUALES; monto/
--     desglose PAGADO en el período (paid_at). Ajustes SIEMPRE separados.
-- ---------------------------------------------------------------------------
create or replace function public.admin_reports_liquidations(p_start date default null, p_end date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_start_at timestamptz := case when p_start is null then null else public._dealer_day_start_at(p_start) end;
  v_end_at   timestamptz := case when p_end   is null then null else public._dealer_day_start_at(p_end + 1) end;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  return jsonb_build_object(
    'ok', true,
    'counts', jsonb_build_object(
      'draft', (select count(*) from public.weekly_liquidations where status = 'DRAFT'),
      'approved', (select count(*) from public.weekly_liquidations where status = 'APPROVED'),
      'paid', (select count(*) from public.weekly_liquidations where status = 'PAID')
    ),
    'paidInPeriod', (
      with paid as (
        select * from public.weekly_liquidations
        where status = 'PAID' and (v_start_at is null or paid_at >= v_start_at) and (v_end_at is null or paid_at < v_end_at)
      ),
      adj as (
        select wl.id as liquidation_id, a.adjustment_type, a.amount_cents
        from paid wl join public.weekly_liquidation_adjustments a on a.liquidation_id = wl.id
      )
      select jsonb_build_object(
        'commissionSubtotalCents', coalesce((select sum(commissions_subtotal_cents) from paid), 0),
        'bonusesCents', coalesce((select sum(amount_cents) from adj where adjustment_type = 'BONO'), 0),
        'positiveAdjustmentsCents', coalesce((select sum(amount_cents) from adj where adjustment_type = 'AJUSTE_POSITIVO'), 0),
        'negativeAdjustmentsCents', coalesce((select sum(amount_cents) from adj where adjustment_type = 'AJUSTE_NEGATIVO'), 0),
        'finalPayoutCents', coalesce((select sum(total_to_pay_cents) from paid), 0),
        'liquidationsCount', (select count(*) from paid)
      )
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'liquidationId', wl.id, 'sellerId', wl.seller_id, 'sellerName', pr.full_name,
        'weekStart', wl.week_start_date, 'weekEnd', wl.week_end_date,
        'commissionSubtotalCents', wl.commissions_subtotal_cents, 'adjustmentsCents', wl.adjustments_total_cents,
        'totalToPayCents', wl.total_to_pay_cents, 'paidAt', wl.paid_at
      ) order by wl.paid_at desc)
      from public.weekly_liquidations wl
      join public.profiles pr on pr.id = wl.seller_id
      where wl.status = 'PAID' and (v_start_at is null or wl.paid_at >= v_start_at) and (v_end_at is null or wl.paid_at < v_end_at)
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_reports_liquidations(date, date) from public, anon;
grant execute on function public.admin_reports_liquidations(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Endurecimiento de paginación de Actividad — orden ahora determinista
--     (occurred_at desc, category, entity_id, event_type) para que dos
--     eventos con el mismo timestamp nunca se salteen ni se dupliquen entre
--     páginas. Sin ningún otro cambio a Actividad.
-- ---------------------------------------------------------------------------
create or replace function public.admin_activity_feed(
  p_category   text default 'ALL',
  p_actor_id   uuid default null,
  p_seller_id  uuid default null,
  p_start_date date default null,
  p_end_date   date default null,
  p_search     text default null,
  p_limit      int default 50,
  p_offset     int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_category text := coalesce(nullif(upper(btrim(p_category)), ''), 'ALL');
  v_search   text := nullif(btrim(coalesce(p_search, '')), '');
  v_start_at timestamptz := case when p_start_date is null then null else public._dealer_day_start_at(p_start_date) end;
  v_end_at   timestamptz := case when p_end_date is null then null else public._dealer_day_start_at(p_end_date + 1) end;
  v_limit    int := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset   int := greatest(0, coalesce(p_offset, 0));
  v_result   jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  with merged as (
    select
      'VENTAS'::text as category, h.event_type as event_type, h.created_at as occurred_at,
      h.actor_id, h.actor_name, h.actor_role,
      'sale'::text as entity_type, h.sale_id as entity_id, h.sale_id, s.seller_id,
      h.title, h.description, h.metadata, ('/admin/ventas/' || h.sale_id::text) as destination_url,
      h.search_text
    from (
      select
        hs.sale_id, 'SALE_' || hs.to_status as event_type, hs.created_at,
        hs.changed_by as actor_id, pr.full_name as actor_name, pr.role as actor_role,
        case hs.to_status
          when 'PENDING'   then 'Solicitó revisión de la venta ' || coalesce(sl.sale_number, 'sin número')
          when 'SOLD'      then 'Marcó la venta ' || coalesce(sl.sale_number, 'sin número') || ' como VENDIDA'
          when 'PAID'      then 'Marcó la venta ' || coalesce(sl.sale_number, 'sin número') || ' como PAGADA'
          when 'DRAFT'     then 'Devolvió la venta ' || coalesce(sl.sale_number, 'sin número') || ' a borrador'
          when 'CANCELLED' then 'Canceló la venta ' || coalesce(sl.sale_number, 'sin número')
          else 'Cambió el estado de la venta ' || coalesce(sl.sale_number, 'sin número')
        end as title,
        hs.reason as description,
        jsonb_build_object('fromStatus', hs.from_status, 'toStatus', hs.to_status) as metadata,
        coalesce(sl.sale_number, '') || ' ' || coalesce(pr2.full_name, '') as search_text
      from public.sale_status_history hs
      join public.sales sl on sl.id = hs.sale_id
      left join public.profiles pr on pr.id = hs.changed_by
      left join public.profiles pr2 on pr2.id = sl.seller_id
      where sl.operation_type = 'CUBA' and hs.from_status is not null
    ) h
    join public.sales s on s.id = h.sale_id

    union all

    select
      'VENTAS', 'EDIT_REQUESTED', r.created_at,
      r.requested_by, pr.full_name, pr.role,
      'sale_edit_request', r.id, r.sale_id, s.seller_id,
      'Solicitó editar la venta ' || coalesce(s.sale_number, 'sin número'),
      r.reason, jsonb_build_object('status', r.status),
      '/admin/aprobaciones/ediciones/' || r.id::text,
      coalesce(s.sale_number, '') || ' ' || coalesce(pr.full_name, '')
    from public.sale_edit_requests r
    join public.sales s on s.id = r.sale_id
    left join public.profiles pr on pr.id = r.requested_by

    union all

    select
      'VENTAS', 'EDIT_' || r.status, r.reviewed_at,
      r.reviewed_by, pr.full_name, pr.role,
      'sale_edit_request', r.id, r.sale_id, s.seller_id,
      case r.status
        when 'APPROVED' then 'Aprobó una modificación de ' || coalesce(s.sale_number, 'sin número')
        when 'REJECTED' then 'Rechazó una modificación de ' || coalesce(s.sale_number, 'sin número')
        else 'Canceló una solicitud de edición de ' || coalesce(s.sale_number, 'sin número')
      end,
      r.review_note, jsonb_build_object('status', r.status),
      '/admin/aprobaciones/ediciones/' || r.id::text,
      coalesce(s.sale_number, '')
    from public.sale_edit_requests r
    join public.sales s on s.id = r.sale_id
    left join public.profiles pr on pr.id = r.reviewed_by
    where r.status <> 'PENDING' and r.reviewed_at is not null

    union all

    select
      'CONTRATOS', 'CONTRACT_' || e.to_status, e.created_at,
      e.changed_by, pr.full_name, pr.role,
      'financing_contract', e.contract_id, c.sale_id, s.seller_id,
      case e.to_status
        when 'SENT' then 'Envió el contrato de ' || c.provider_name_snapshot || ' · ' || coalesce(s.sale_number, 'sin número')
        when 'SIGNED' then 'Marcó firmado el contrato de ' || c.provider_name_snapshot || ' · ' || coalesce(s.sale_number, 'sin número')
        when 'ACCREDITED' then 'Acreditó el contrato de ' || c.provider_name_snapshot || ' · ' || coalesce(s.sale_number, 'sin número')
        else 'Actualizó el contrato de ' || c.provider_name_snapshot
      end,
      e.note, jsonb_build_object('fromStatus', e.from_status, 'toStatus', e.to_status, 'providerName', c.provider_name_snapshot),
      '/admin/ventas/' || c.sale_id::text,
      coalesce(s.sale_number, '') || ' ' || c.provider_name_snapshot
    from public.financing_contract_events e
    join public.sale_financing_contracts c on c.id = e.contract_id
    join public.sales s on s.id = c.sale_id
    left join public.profiles pr on pr.id = e.changed_by

    union all

    select
      'COBROS', 'PAYMENT_SETTLED', a.settled_at,
      a.settled_by, pr.full_name, pr.role,
      'sale_payment_allocation', a.id, a.sale_id, s.seller_id,
      'Registró el cobro de ' || a.provider_name_snapshot || ' · ' || coalesce(s.sale_number, 'sin número'),
      null::text, jsonb_build_object('netCents', a.net_amount_cents),
      '/admin/ventas/' || a.sale_id::text,
      coalesce(s.sale_number, '') || ' ' || a.provider_name_snapshot
    from public.sale_payment_allocations a
    join public.sales s on s.id = a.sale_id
    left join public.profiles pr on pr.id = a.settled_by
    where a.settlement_status = 'SETTLED' and a.settled_at is not null

    union all

    select
      'PRODUCTOS', e.event_type, e.created_at,
      e.actor_id, pr.full_name, pr.role,
      'product', e.product_id, null::uuid, null::uuid,
      case e.event_type
        when 'PRODUCT_CREATED' then 'Creó el producto ' || p.name
        when 'PRODUCT_UPDATED' then 'Actualizó el producto ' || p.name
        when 'PRODUCT_ACTIVATED' then 'Activó el producto ' || p.name
        when 'PRODUCT_DEACTIVATED' then 'Desactivó el producto ' || p.name
        when 'PRODUCT_DUPLICATED' then 'Duplicó el producto ' || p.name
        when 'PRICE_CHANGED' then 'Cambió el precio de ' || p.name
        when 'VARIANT_CREATED' then 'Agregó una variante a ' || p.name
        when 'VARIANT_UPDATED' then 'Actualizó una variante de ' || p.name
        when 'VARIANT_ACTIVATED' then 'Activó una variante de ' || p.name
        when 'VARIANT_DEACTIVATED' then 'Desactivó una variante de ' || p.name
        when 'IMAGE_ADDED' then 'Agregó una imagen a ' || p.name
        when 'IMAGE_REMOVED' then 'Quitó una imagen de ' || p.name
        when 'PRIMARY_IMAGE_CHANGED' then 'Cambió la imagen principal de ' || p.name
        when 'COMMISSION_DEFAULTS_UPDATED' then 'Actualizó la comisión por defecto de ' || p.name
        else 'Actualizó ' || p.name
      end,
      null::text, e.changes,
      '/admin/productos/' || e.product_id::text,
      p.name
    from public.product_catalog_events e
    join public.products p on p.id = e.product_id
    left join public.profiles pr on pr.id = e.actor_id

    union all

    select
      'INVENTARIO', e.event_type, e.created_at,
      e.actor_id, pr.full_name, pr.role,
      'inventory_unit', e.inventory_unit_id, e.sale_id, s.seller_id,
      case e.event_type
        when 'UNIT_CREATED' then 'Creó la unidad ' || coalesce(iu.vin, 'sin VIN') || ' de ' || p.name
        when 'UNIT_IMPORTED' then 'Importó la unidad ' || coalesce(iu.vin, 'sin VIN') || ' de ' || p.name
        when 'VIN_UPDATED' then 'Actualizó el VIN de una unidad de ' || p.name
        when 'UNIT_RESERVED' then 'Asignó el VIN ' || coalesce(iu.vin, 'sin VIN') || ' a la venta ' || coalesce(s.sale_number, 'sin número')
        when 'RESERVATION_RELEASED' then 'Liberó la reserva del VIN ' || coalesce(iu.vin, 'sin VIN')
        when 'UNIT_SOLD' then 'Marcó vendida la unidad ' || coalesce(iu.vin, 'sin VIN')
        when 'COMMISSION_CONFIG_UPDATED' then 'Configuró la comisión del VIN ' || coalesce(iu.vin, 'sin VIN')
        else 'Actualizó la unidad ' || coalesce(iu.vin, 'sin VIN')
      end,
      e.reason, e.changes,
      '/admin/inventario/' || e.inventory_unit_id::text,
      coalesce(iu.vin, '') || ' ' || p.name || ' ' || coalesce(s.sale_number, '')
    from public.inventory_unit_events e
    join public.inventory_units iu on iu.id = e.inventory_unit_id
    join public.products p on p.id = iu.product_id
    left join public.profiles pr on pr.id = e.actor_id
    left join public.sales s on s.id = e.sale_id

    union all

    select
      'COMISIONES', e.event_type, e.created_at,
      e.actor_id, pr.full_name, pr.role,
      'sale_commission', e.commission_id, e.sale_id, s.seller_id,
      'Recalculó la comisión de ' || coalesce(s.sale_number, 'sin número') || ' por una edición aprobada',
      e.reason, jsonb_build_object('before', e.before, 'after', e.after),
      '/admin/ventas/' || e.sale_id::text,
      coalesce(s.sale_number, '')
    from public.commission_events e
    join public.sales s on s.id = e.sale_id
    left join public.profiles pr on pr.id = e.actor_id
    where e.event_type = 'COMMISSION_ADJUSTED_BY_APPROVED_SALE_EDIT'

    union all

    select
      'LIQUIDACIONES', e.event_type, e.created_at,
      e.actor_id, pr.full_name, pr.role,
      'weekly_liquidation', e.liquidation_id, null::uuid, wl.seller_id,
      case e.event_type
        when 'CREATED' then 'Creó la liquidación de ' || pr2.full_name || ' (semana del ' || wl.week_start_date || ')'
        when 'ITEMS_CLAIMED' then 'Actualizó las comisiones reclamadas de ' || pr2.full_name
        when 'ADJUSTMENT_ADDED' then 'Agregó un ajuste a la liquidación de ' || pr2.full_name
        when 'APPROVED' then 'Aprobó la liquidación de ' || pr2.full_name
        when 'PAID' then 'Marcó como PAGADA la liquidación de ' || pr2.full_name
        else 'Actualizó la liquidación de ' || pr2.full_name
      end,
      null::text, e.detail,
      '/admin/liquidaciones/' || e.liquidation_id::text,
      pr2.full_name || ' ' || wl.week_start_date::text || ' ' || coalesce(wl.payment_reference, '')
    from public.weekly_liquidation_events e
    join public.weekly_liquidations wl on wl.id = e.liquidation_id
    join public.profiles pr2 on pr2.id = wl.seller_id
    left join public.profiles pr on pr.id = e.actor_id

    union all

    select
      'VENDEDORES', e.event_type, e.created_at,
      e.actor_id, pr.full_name, pr.role,
      'seller', e.seller_id, null::uuid, e.seller_id,
      case e.event_type
        when 'SELLER_INVITED' then 'Invitó a ' || pr2.full_name
        when 'INVITATION_RESENT' then 'Reenvió la invitación a ' || pr2.full_name
        when 'INVITATION_CANCELLED' then 'Canceló la invitación a ' || pr2.full_name
        when 'SELLER_SUSPENDED' then 'Suspendió a ' || pr2.full_name
        when 'SELLER_REACTIVATED' then 'Reactivó a ' || pr2.full_name
        when 'SELLER_DISABLED' then 'Deshabilitó a ' || pr2.full_name
        else 'Actualizó la cuenta de ' || pr2.full_name
      end,
      e.reason, null::jsonb,
      '/admin/vendedores/' || e.seller_id::text,
      pr2.full_name
    from public.seller_account_events e
    join public.profiles pr2 on pr2.id = e.seller_id
    left join public.profiles pr on pr.id = e.actor_id
  ),
  filtered as (
    select * from merged m
    where (v_category = 'ALL' or m.category = v_category)
      and (p_actor_id is null or m.actor_id = p_actor_id)
      and (p_seller_id is null or m.seller_id = p_seller_id)
      and (v_start_at is null or m.occurred_at >= v_start_at)
      and (v_end_at is null or m.occurred_at < v_end_at)
      and (v_search is null or m.search_text ilike '%' || v_search || '%')
  ),
  paged as (
    -- Orden determinista: occurred_at por sí solo no alcanza si dos eventos
    -- de ramas distintas comparten el mismo instante exacto — se agregan
    -- category/entity_id/event_type como desempate estable.
    select * from filtered order by occurred_at desc, category, entity_id, event_type limit v_limit offset v_offset
  ),
  total as (
    select count(*) as n from filtered
  )
  select jsonb_build_object(
    'ok', true,
    'total', (select n from total),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', p.category, 'eventType', p.event_type, 'occurredAt', p.occurred_at,
        'actorId', p.actor_id, 'actorName', p.actor_name, 'actorRole', p.actor_role,
        'entityType', p.entity_type, 'entityId', p.entity_id, 'saleId', p.sale_id, 'sellerId', p.seller_id,
        'title', p.title, 'description', p.description, 'metadata', p.metadata,
        'destinationUrl', p.destination_url
      ) order by p.occurred_at desc, p.category, p.entity_id, p.event_type)
      from paged p
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_activity_feed(text, uuid, uuid, date, date, text, int, int) from public, anon;
grant execute on function public.admin_activity_feed(text, uuid, uuid, date, date, text, int, int) to authenticated;
