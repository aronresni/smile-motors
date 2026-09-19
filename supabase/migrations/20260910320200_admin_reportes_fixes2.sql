-- ===========================================================================
-- REPORTES — segundo fix del mismo bug: `percentile_cont()` SIEMPRE devuelve
-- double precision (sin importar el tipo de la expresión de entrada) — el
-- fix anterior casteó `secs` a numeric, lo cual arregló `avg()` pero no
-- `percentile_cont()`. Se castea el resultado completo de la división antes
-- de `round()`. Detectado por el mismo test real, ejecutado de nuevo tras el
-- primer fix (nunca se asumió que compilaba solo porque el primer intento
-- pareció razonable).
-- ===========================================================================
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
        select extract(epoch from (ts.sold_at - tp.pending_at))::numeric as secs
        from to_sold ts join to_pending tp on tp.sale_id = ts.sale_id
        where ts.sold_at > tp.pending_at
      ),
      sold_to_paid as (
        select extract(epoch from (tp2.paid_at - h.created_at))::numeric as secs
        from to_paid tp2
        join public.sale_status_history h on h.sale_id = tp2.sale_id and h.to_status = 'SOLD'
        where tp2.paid_at > h.created_at
      )
      select jsonb_build_object(
        'pendingToSold', case when (select count(*) from pending_to_sold) = 0 then null else jsonb_build_object(
          'sampleSize', (select count(*) from pending_to_sold),
          'avgHours', round((select avg(secs) from pending_to_sold) / 3600.0, 1),
          'medianHours', round((((select percentile_cont(0.5) within group (order by secs) from pending_to_sold))::numeric) / 3600.0, 1)
        ) end,
        'soldToPaid', case when (select count(*) from sold_to_paid) = 0 then null else jsonb_build_object(
          'sampleSize', (select count(*) from sold_to_paid),
          'avgHours', round((select avg(secs) from sold_to_paid) / 3600.0, 1),
          'medianHours', round((((select percentile_cont(0.5) within group (order by secs) from sold_to_paid))::numeric) / 3600.0, 1)
        ) end
      )
    )
  );
end;
$$;
revoke all on function public.admin_reports_funnel(date, date) from public, anon;
grant execute on function public.admin_reports_funnel(date, date) to authenticated;
