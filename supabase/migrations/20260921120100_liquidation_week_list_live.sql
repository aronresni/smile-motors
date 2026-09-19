-- ===========================================================================
-- Liquidación semanal (admin): el listado muestra, mientras la liquidación no
-- esté aprobada, lo ya reclamado + lo aún libre de la semana — así coincide en
-- todo momento con "Mis liquidaciones" del vendedor (misma regla: comisiones
-- de ventas confirmadas VENDIDAS en la semana). APROBADA/PAGADA: lo congelado.
-- Solo lectura; no cambia ningún dato.
-- ===========================================================================
create or replace function public.admin_liquidation_week_list(p_week_start date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_week_start date := public._liquidation_week_start(coalesce(p_week_start, public._liquidation_week_of_instant(now())));
  v_week_end   date := v_week_start + 6;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  return jsonb_build_object(
    'ok', true,
    'weekStart', v_week_start,
    'weekEnd', v_week_end,
    'weekClosed', now() >= public._liquidation_week_close_at(v_week_start),
    'rows', coalesce((
      select jsonb_agg(row_data order by row_data->>'sellerName')
      from (
        select jsonb_build_object(
          'sellerId', p.id,
          'sellerName', p.full_name,
          'liquidationId', wl.id,
          'status', coalesce(wl.status, 'NONE'),
          'pendingSalesCount', coalesce(act.pending_count, 0),
          'soldSalesCount', coalesce(act.sold_count, 0),
          'paidSalesCount', coalesce(act.paid_count, 0),
          -- Sin liquidación o en BORRADOR: reclamado + aún libre de la semana
          -- (el mismo total que ve el vendedor). APROBADA/PAGADA: lo congelado.
          'eligibleCommissionsCount', case when wl.status in ('APPROVED', 'PAID') then coalesce(claimed.cnt, 0)
                                           else coalesce(claimed.cnt, 0) + coalesce(unclaimed.cnt, 0) end,
          'subtotalCents', case when wl.status in ('APPROVED', 'PAID') then wl.commissions_subtotal_cents
                                else coalesce(claimed.sum_cents, 0) + coalesce(unclaimed.sum_cents, 0) end,
          'adjustmentsCents', coalesce(wl.adjustments_total_cents, 0),
          'totalCents', case when wl.status in ('APPROVED', 'PAID') then wl.total_to_pay_cents
                             else coalesce(claimed.sum_cents, 0) + coalesce(unclaimed.sum_cents, 0) + coalesce(wl.adjustments_total_cents, 0) end
        ) as row_data,
        wl.id as wl_id, act.pending_count, act.sold_count, act.paid_count, unclaimed.cnt as unclaimed_cnt
        from public.profiles p
        left join public.weekly_liquidations wl
          on wl.seller_id = p.id and wl.week_start_date = v_week_start
        left join lateral (
          -- Próximas a confirmar: PENDIENTES por fecha de negocio. Confirmadas:
          -- VENDIDAS/PAGADAS por la semana en que se marcaron VENDIDA.
          select
            count(*) filter (where s.status = 'PENDING'
              and coalesce(s.sale_date, s.created_at::date) between v_week_start and v_week_end) as pending_count,
            count(*) filter (where s.status = 'SOLD'
              and s.sold_at >= public._liquidation_week_open_at(v_week_start)
              and s.sold_at < public._liquidation_week_close_at(v_week_start)) as sold_count,
            count(*) filter (where s.status = 'PAID'
              and s.sold_at >= public._liquidation_week_open_at(v_week_start)
              and s.sold_at < public._liquidation_week_close_at(v_week_start)) as paid_count
          from public.sales s
          where s.seller_id = p.id
            and s.operation_type = 'CUBA'
        ) act on true
        left join lateral (
          select count(*) as cnt, coalesce(sum(sc.final_commission_cents), 0) as sum_cents
          from public.sale_commissions sc
          where sc.liquidation_id = wl.id
        ) claimed on wl.id is not null
        left join lateral (
          select count(*) as cnt, coalesce(sum(sc.final_commission_cents), 0) as sum_cents
          from public.sale_commissions sc
          join public.sales s on s.id = sc.sale_id
          where sc.seller_id = p.id
            and sc.status <> 'VOID'
            and sc.liquidation_id is null
            and s.status in ('SOLD', 'PAID')
            and s.sold_at >= public._liquidation_week_open_at(v_week_start)
            and s.sold_at < public._liquidation_week_close_at(v_week_start)
        ) unclaimed on true
        where p.role = 'seller'
      ) x
      where x.wl_id is not null
        or coalesce(x.pending_count, 0) > 0
        or coalesce(x.sold_count, 0) > 0
        or coalesce(x.paid_count, 0) > 0
        or coalesce(x.unclaimed_cnt, 0) > 0
    ), '[]'::jsonb)
  );
end;
$$;

