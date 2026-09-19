-- ===========================================================================
-- SMILE MOTORS · LA COMISIÓN SE LIQUIDA AL QUEDAR LA VENTA **VENDIDA**.
--
-- Decisión del negocio (2026-09-19): la comisión congelada al marcar la venta
-- VENDIDA suma al "Total a liquidar" en la semana (lunes–domingo, hora del
-- Este) en que la venta se marcó VENDIDA (sales.sold_at), sin esperar a que el
-- cliente termine de pagar. Misma regla para el vendedor y para el admin.
--
-- Significados que NO cambian (documentados):
--   * sales.status = 'PAID' (PAGADA) = el CLIENTE terminó de pagar (cobro
--     completo, saldo 0; admin_mark_sale_paid). NO es el pago al vendedor.
--   * sale_commissions.status: PENDING = venta aún sin cobrar al cliente;
--     ELIGIBLE = venta cobrada (eligible_at = momento del cobro); VOID = anulada.
--     Ya no condiciona la liquidación: ambas (PENDING y ELIGIBLE) se liquidan.
--   * El pago al VENDEDOR lo registra la liquidación semanal (weekly_liquidations
--     PAID). sale_commissions.liquidation_id es única: una comisión nunca entra
--     en dos liquidaciones.
--
-- Cambios:
--   * admin_liquidation_create_draft / refresh / approve: reclaman comisiones
--     por semana de CONFIRMACIÓN (sold_at). approve reclama lo pendiente de la
--     semana justo antes de congelar (nada queda fuera).
--   * admin_liquidation_week_list / admin_liquidation_detail /
--     seller_liquidation_detail: mismos criterios (confirmadas por sold_at).
--   * seller_weekly_liquidation: "Ventas confirmadas" (VENDIDA/PAGADA de la
--     semana) + "Próximas a confirmar" (PENDIENTES; estimadas, fuera del total)
--     + "Próximas a confirmar de semanas anteriores".
--   * Candado: una unidad cuya comisión ya está en una liquidación no puede
--     cambiar de precio (COMMISSION_LOCKED) — ni por edición del admin ni por
--     solicitud/aprobación del vendedor.
--
-- Datos: no se reescribe ninguna venta ni comisión. Al aplicar esta migración
-- no existe ninguna liquidación ni comisión (verificado), así que ninguna
-- liquidación histórica cambia de composición.
-- ===========================================================================

create or replace function public.admin_liquidation_create_draft(p_seller_id uuid, p_week_start date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid := auth.uid();
  v_week_start    date := public._liquidation_week_start(p_week_start);
  v_week_end      date := v_week_start + 6;
  v_liq           public.weekly_liquidations;
  v_created       boolean := false;
  v_claimed_count int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if not exists (select 1 from public.profiles where id = p_seller_id and role = 'seller') then
    return jsonb_build_object('ok', false, 'code', 'SELLER_NOT_FOUND');
  end if;

  -- Upsert a prueba de carrera: si dos admins crean la misma (vendedor,
  -- semana) a la vez, exactamente uno inserta; el otro cae al select-for-update.
  insert into public.weekly_liquidations (seller_id, week_start_date, week_end_date, status)
  values (p_seller_id, v_week_start, v_week_end, 'DRAFT')
  on conflict (seller_id, week_start_date) do nothing
  returning * into v_liq;

  if found then
    v_created := true;
    insert into public.weekly_liquidation_events (liquidation_id, event_type, actor_id, detail)
    values (v_liq.id, 'CREATED', v_uid, jsonb_build_object('weekStart', v_week_start, 'weekEnd', v_week_end));
  else
    select * into v_liq from public.weekly_liquidations
    where seller_id = p_seller_id and week_start_date = v_week_start
    for update;
  end if;

  if v_liq.status <> 'DRAFT' then
    return jsonb_build_object('ok', true, 'liquidationId', v_liq.id, 'status', v_liq.status, 'created', v_created);
  end if;

  -- Liquidable = comisión (no anulada) de una venta VENDIDA/PAGADA cuya
  -- confirmación (sold_at) cae en la semana. No espera a que el cliente pague.
  with claim as (
    update public.sale_commissions sc
    set liquidation_id = v_liq.id, updated_at = now()
    from public.sales s
    where s.id = sc.sale_id
      and sc.seller_id = p_seller_id
      and sc.status <> 'VOID'
      and sc.liquidation_id is null
      and s.status in ('SOLD', 'PAID')
      and s.sold_at >= public._liquidation_week_open_at(v_week_start)
      and s.sold_at < public._liquidation_week_close_at(v_week_start)
    returning sc.id
  )
  select count(*) into v_claimed_count from claim;

  update public.weekly_liquidations
  set commissions_subtotal_cents = (select coalesce(sum(final_commission_cents), 0) from public.sale_commissions where liquidation_id = v_liq.id),
      total_to_pay_cents = (select coalesce(sum(final_commission_cents), 0) from public.sale_commissions where liquidation_id = v_liq.id) + adjustments_total_cents,
      updated_at = now()
  where id = v_liq.id
  returning * into v_liq;

  if v_claimed_count > 0 then
    insert into public.weekly_liquidation_events (liquidation_id, event_type, actor_id, detail)
    values (v_liq.id, 'ITEMS_CLAIMED', v_uid, jsonb_build_object('claimedCount', v_claimed_count));
  end if;

  return jsonb_build_object(
    'ok', true, 'liquidationId', v_liq.id, 'status', v_liq.status, 'created', v_created,
    'claimedCount', v_claimed_count, 'subtotalCents', v_liq.commissions_subtotal_cents, 'totalCents', v_liq.total_to_pay_cents
  );
end;
$$;

create or replace function public.admin_liquidation_refresh(p_liquidation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid := auth.uid();
  v_liq           public.weekly_liquidations;
  v_claimed_count int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_liq from public.weekly_liquidations where id = p_liquidation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_liq.status <> 'DRAFT' then
    return jsonb_build_object('ok', false, 'code', 'NOT_DRAFT');
  end if;

  -- Liquidable = comisión (no anulada) de una venta VENDIDA/PAGADA cuya
  -- confirmación (sold_at) cae en la semana. No espera a que el cliente pague.
  with claim as (
    update public.sale_commissions sc
    set liquidation_id = v_liq.id, updated_at = now()
    from public.sales s
    where s.id = sc.sale_id
      and sc.seller_id = v_liq.seller_id
      and sc.status <> 'VOID'
      and sc.liquidation_id is null
      and s.status in ('SOLD', 'PAID')
      and s.sold_at >= public._liquidation_week_open_at(v_liq.week_start_date)
      and s.sold_at < public._liquidation_week_close_at(v_liq.week_start_date)
    returning sc.id
  )
  select count(*) into v_claimed_count from claim;

  update public.weekly_liquidations
  set commissions_subtotal_cents = (select coalesce(sum(final_commission_cents), 0) from public.sale_commissions where liquidation_id = v_liq.id),
      total_to_pay_cents = (select coalesce(sum(final_commission_cents), 0) from public.sale_commissions where liquidation_id = v_liq.id) + adjustments_total_cents,
      updated_at = now()
  where id = v_liq.id
  returning * into v_liq;

  if v_claimed_count > 0 then
    insert into public.weekly_liquidation_events (liquidation_id, event_type, actor_id, detail)
    values (v_liq.id, 'ITEMS_CLAIMED', v_uid, jsonb_build_object('claimedCount', v_claimed_count));
  end if;

  return jsonb_build_object(
    'ok', true, 'claimedCount', v_claimed_count,
    'subtotalCents', v_liq.commissions_subtotal_cents, 'totalCents', v_liq.total_to_pay_cents
  );
end;
$$;

create or replace function public.admin_liquidation_approve(p_liquidation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_liq public.weekly_liquidations;
  v_claimed_count int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_liq from public.weekly_liquidations where id = p_liquidation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_liq.status <> 'DRAFT' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;
  if now() < public._liquidation_week_close_at(v_liq.week_start_date) then
    return jsonb_build_object(
      'ok', false, 'code', 'WEEK_NOT_CLOSED',
      'weekEnd', v_liq.week_end_date,
      'closesAt', public._liquidation_week_close_at(v_liq.week_start_date)
    );
  end if;

  -- Antes de congelar: reclama cualquier comisión de la semana aún libre (una
  -- venta confirmada después del último refresco nunca queda fuera).
  -- Liquidable = comisión (no anulada) de una venta VENDIDA/PAGADA cuya
  -- confirmación (sold_at) cae en la semana. No espera a que el cliente pague.
  with claim as (
    update public.sale_commissions sc
    set liquidation_id = v_liq.id, updated_at = now()
    from public.sales s
    where s.id = sc.sale_id
      and sc.seller_id = v_liq.seller_id
      and sc.status <> 'VOID'
      and sc.liquidation_id is null
      and s.status in ('SOLD', 'PAID')
      and s.sold_at >= public._liquidation_week_open_at(v_liq.week_start_date)
      and s.sold_at < public._liquidation_week_close_at(v_liq.week_start_date)
    returning sc.id
  )
  select count(*) into v_claimed_count from claim;
  if v_claimed_count > 0 then
    insert into public.weekly_liquidation_events (liquidation_id, event_type, actor_id, detail)
    values (p_liquidation_id, 'ITEMS_CLAIMED', v_uid, jsonb_build_object('claimedCount', v_claimed_count, 'atApproval', true));
  end if;

  update public.weekly_liquidations
  set commissions_subtotal_cents = (select coalesce(sum(final_commission_cents), 0) from public.sale_commissions where liquidation_id = p_liquidation_id),
      total_to_pay_cents = (select coalesce(sum(final_commission_cents), 0) from public.sale_commissions where liquidation_id = p_liquidation_id) + adjustments_total_cents,
      status = 'APPROVED', approved_at = now(), approved_by = v_uid, updated_at = now()
  where id = p_liquidation_id;

  insert into public.weekly_liquidation_events (liquidation_id, event_type, actor_id)
  values (p_liquidation_id, 'APPROVED', v_uid);

  return jsonb_build_object('ok', true, 'status', 'APPROVED');
end;
$$;

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
          'eligibleCommissionsCount', coalesce(claimed.cnt, unclaimed.cnt, 0),
          'subtotalCents', coalesce(wl.commissions_subtotal_cents, unclaimed.sum_cents, 0),
          'adjustmentsCents', coalesce(wl.adjustments_total_cents, 0),
          'totalCents', coalesce(wl.total_to_pay_cents, unclaimed.sum_cents, 0)
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
        ) unclaimed on wl.id is null
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

create or replace function public.admin_liquidation_detail(p_liquidation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_liq public.weekly_liquidations;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_liq from public.weekly_liquidations where id = p_liquidation_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'liquidation', jsonb_build_object(
      'id', v_liq.id, 'sellerId', v_liq.seller_id,
      'sellerName', (select full_name from public.profiles where id = v_liq.seller_id),
      'weekStart', v_liq.week_start_date, 'weekEnd', v_liq.week_end_date,
      'status', v_liq.status,
      'subtotalCents', v_liq.commissions_subtotal_cents,
      'adjustmentsCents', v_liq.adjustments_total_cents,
      'totalCents', v_liq.total_to_pay_cents,
      'approvedAt', v_liq.approved_at,
      'approvedByName', (select full_name from public.profiles where id = v_liq.approved_by),
      'paidAt', v_liq.paid_at,
      'paidByName', (select full_name from public.profiles where id = v_liq.paid_by),
      'paymentReference', v_liq.payment_reference,
      'createdAt', v_liq.created_at,
      'weekClosed', now() >= public._liquidation_week_close_at(v_liq.week_start_date),
      'closesAt', public._liquidation_week_close_at(v_liq.week_start_date)
    ),
    'activity', jsonb_build_object(
      'pending', coalesce((
        select jsonb_agg(jsonb_build_object(
          'saleId', s.id, 'saleNumber', s.sale_number,
          'saleDate', coalesce(s.sale_date, s.created_at::date),
          'buyerName', (select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
                        from public.sale_parties sp where sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'),
          'saleTotalCents', s.sale_total_cents
        ) order by s.created_at)
        from public.sales s
        where s.seller_id = v_liq.seller_id and s.operation_type = 'CUBA' and s.status = 'PENDING'
          and coalesce(s.sale_date, s.created_at::date) between v_liq.week_start_date and v_liq.week_end_date
      ), '[]'::jsonb),
      'sold', coalesce((
        select jsonb_agg(jsonb_build_object(
          'saleId', s.id, 'saleNumber', s.sale_number,
          'saleDate', coalesce(s.sale_date, s.created_at::date),
          'buyerName', (select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
                        from public.sale_parties sp where sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'),
          'saleTotalCents', s.sale_total_cents,
          'commissionPendingCents', (select coalesce(sum(sc.final_commission_cents), 0) from public.sale_commissions sc where sc.sale_id = s.id and sc.status = 'PENDING')
        ) order by s.created_at)
        from public.sales s
        where s.seller_id = v_liq.seller_id and s.operation_type = 'CUBA' and s.status = 'SOLD'
          and s.sold_at >= public._liquidation_week_open_at(v_liq.week_start_date)
          and s.sold_at < public._liquidation_week_close_at(v_liq.week_start_date)
      ), '[]'::jsonb),
      'paid', coalesce((
        select jsonb_agg(jsonb_build_object(
          'saleId', s.id, 'saleNumber', s.sale_number,
          'saleDate', coalesce(s.sale_date, s.created_at::date),
          'buyerName', (select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
                        from public.sale_parties sp where sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'),
          'saleTotalCents', s.sale_total_cents
        ) order by s.created_at)
        from public.sales s
        where s.seller_id = v_liq.seller_id and s.operation_type = 'CUBA' and s.status = 'PAID'
          and s.sold_at >= public._liquidation_week_open_at(v_liq.week_start_date)
          and s.sold_at < public._liquidation_week_close_at(v_liq.week_start_date)
      ), '[]'::jsonb)
    ),
    'commissionItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'saleCommissionId', sc.id, 'saleId', sc.sale_id, 'saleNumber', s.sale_number,
        'productName', su.product_name_snapshot, 'variantName', su.variant_snapshot,
        'referencePriceCents', sc.reference_price_cents, 'salePriceCents', sc.sale_price_cents,
        'priceDifferenceCents', sc.price_difference_cents,
        'baseCommissionCents', sc.base_commission_cents,
        'sellerDifferenceShareCents', sc.seller_difference_share_cents,
        'finalCommissionCents', sc.final_commission_cents,
        'eligibleAt', sc.eligible_at,
        'soldAt', s.sold_at
      ) order by s.sold_at)
      from public.sale_commissions sc
      join public.sales s on s.id = sc.sale_id
      join public.sale_units su on su.id = sc.sale_unit_id
      where sc.liquidation_id = v_liq.id
    ), '[]'::jsonb),
    'adjustments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'type', a.adjustment_type, 'amountCents', a.amount_cents,
        'reason', a.reason, 'createdByName', (select full_name from public.profiles where id = a.created_by),
        'createdAt', a.created_at
      ) order by a.created_at)
      from public.weekly_liquidation_adjustments a
      where a.liquidation_id = v_liq.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.seller_liquidation_detail(p_liquidation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_liq public.weekly_liquidations;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_liq from public.weekly_liquidations
  where id = p_liquidation_id and seller_id = v_uid and status in ('APPROVED', 'PAID');
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'liquidation', jsonb_build_object(
      'id', v_liq.id, 'weekStart', v_liq.week_start_date, 'weekEnd', v_liq.week_end_date,
      'status', v_liq.status,
      'subtotalCents', v_liq.commissions_subtotal_cents,
      'adjustmentsCents', v_liq.adjustments_total_cents,
      'totalCents', v_liq.total_to_pay_cents,
      'paidAt', v_liq.paid_at, 'paymentReference', v_liq.payment_reference
    ),
    'activity', jsonb_build_object(
      'pending', coalesce((
        select jsonb_agg(jsonb_build_object(
          'saleId', s.id, 'saleNumber', s.sale_number,
          'saleDate', coalesce(s.sale_date, s.created_at::date),
          'buyerName', (select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
                        from public.sale_parties sp where sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'),
          'saleTotalCents', s.sale_total_cents
        ) order by s.created_at)
        from public.sales s
        where s.seller_id = v_liq.seller_id and s.operation_type = 'CUBA' and s.status = 'PENDING'
          and coalesce(s.sale_date, s.created_at::date) between v_liq.week_start_date and v_liq.week_end_date
      ), '[]'::jsonb),
      'sold', coalesce((
        select jsonb_agg(jsonb_build_object(
          'saleId', s.id, 'saleNumber', s.sale_number,
          'saleDate', coalesce(s.sale_date, s.created_at::date),
          'buyerName', (select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
                        from public.sale_parties sp where sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'),
          'saleTotalCents', s.sale_total_cents,
          'commissionPendingCents', (select coalesce(sum(sc.final_commission_cents), 0) from public.sale_commissions sc where sc.sale_id = s.id and sc.status = 'PENDING')
        ) order by s.created_at)
        from public.sales s
        where s.seller_id = v_liq.seller_id and s.operation_type = 'CUBA' and s.status = 'SOLD'
          and s.sold_at >= public._liquidation_week_open_at(v_liq.week_start_date)
          and s.sold_at < public._liquidation_week_close_at(v_liq.week_start_date)
      ), '[]'::jsonb),
      'paid', coalesce((
        select jsonb_agg(jsonb_build_object(
          'saleId', s.id, 'saleNumber', s.sale_number,
          'saleDate', coalesce(s.sale_date, s.created_at::date),
          'buyerName', (select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
                        from public.sale_parties sp where sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'),
          'saleTotalCents', s.sale_total_cents
        ) order by s.created_at)
        from public.sales s
        where s.seller_id = v_liq.seller_id and s.operation_type = 'CUBA' and s.status = 'PAID'
          and s.sold_at >= public._liquidation_week_open_at(v_liq.week_start_date)
          and s.sold_at < public._liquidation_week_close_at(v_liq.week_start_date)
      ), '[]'::jsonb)
    ),
    'commissionItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'saleId', sc.sale_id, 'saleNumber', s.sale_number,
        'productName', su.product_name_snapshot, 'variantName', su.variant_snapshot,
        'referencePriceCents', sc.reference_price_cents, 'salePriceCents', sc.sale_price_cents,
        'priceDifferenceCents', sc.price_difference_cents,
        'baseCommissionCents', sc.base_commission_cents,
        'sellerDifferenceShareCents', sc.seller_difference_share_cents,
        'finalCommissionCents', sc.final_commission_cents,
        'eligibleAt', sc.eligible_at,
        'soldAt', s.sold_at
      ) order by s.sold_at)
      from public.sale_commissions sc
      join public.sales s on s.id = sc.sale_id
      join public.sale_units su on su.id = sc.sale_unit_id
      where sc.liquidation_id = v_liq.id
    ), '[]'::jsonb),
    'adjustments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', a.adjustment_type, 'amountCents', a.amount_cents, 'reason', a.reason, 'createdAt', a.created_at
      ) order by a.created_at)
      from public.weekly_liquidation_adjustments a
      where a.liquidation_id = v_liq.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.update_confirmed_cuba_sale(
  p_sale_id uuid, p_payload jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_sale   public.sales;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_group  uuid := gen_random_uuid();
  v_year   text := to_char(current_date, 'YYYY');
  v_errors text[] := array[]::text[];

  v_units_json  jsonb := case when jsonb_typeof(p_payload->'units')  = 'array' then p_payload->'units'  else '[]'::jsonb end;
  v_extras_json jsonb := case when jsonb_typeof(p_payload->'extras') = 'array' then p_payload->'extras' else '[]'::jsonb end;
  v_docs_json   jsonb := case when jsonb_typeof(p_payload->'documents') = 'array' then p_payload->'documents' else '[]'::jsonb end;

  v_old_buyer public.sale_parties;
  v_old_cb    public.sale_parties;
  v_old_rec   public.sale_cuba_recipients;
  v_old_del   public.sale_deliveries;

  v_u        jsonb;
  v_e        jsonb;
  v_d        jsonb;
  v_prod     record;
  v_variant_label text;
  v_variant_id uuid;
  v_agreed   bigint;
  v_pos      int;
  v_old_unit  public.sale_units;
  v_old_extra public.sale_extras;
  v_track    text;
  v_new_id   uuid;
  v_party_id uuid;
  v_recipient_id uuid;

  v_payload_unit_ids  uuid[];
  v_payload_extra_ids uuid[];

  v_units_total    bigint;
  v_extras_total   bigint;
  v_delivery_total bigint;
  v_sale_total     bigint;
  v_change_count   int;

  nb_first text; nb_last text; nb_dob text; nb_docnum text; nb_docexp text;
  nb_phone text; nb_email text; nb_a1 text; nb_a2 text; nb_city text; nb_state text; nb_zip text;
  ncb jsonb;
  ncb_first text; ncb_last text; ncb_dob text; ncb_docnum text; ncb_phone text; ncb_email text;
  nr_name text; nr_ci text; nr_addr text; nr_muni text; nr_prov text; nr_p1 text; nr_p2 text;
  nd_method text; nd_ref text;
  nn_notes text;
  ne_desc text; ne_qty int; ne_price bigint;

  v_acting_as_seller uuid := nullif(current_setting('motods.acting_as_seller', true), '')::uuid;
  -- Edición administrativa DIRECTA (solo `admin_update_cuba_sale` fija este
  -- GUC transaccional): habilita además DRAFT y PAID (corrección).
  v_admin_direct boolean := coalesce(current_setting('motods.admin_direct_edit', true), '') = 'on';
  -- precio fijo / comisión fija de unidades nuevas o modificadas
  v_pr_unit_id uuid;
  v_pr_old_product uuid;
  v_pr_old_price bigint;
  v_pr_frozen bigint;
  v_pr_fixed bigint;
  v_pr_commission bigint;
  v_pr_new bigint;
  v_pr_found boolean;
begin
  ----------------------------------------------------------------- FASE 1 ---
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and is_active) then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_INACTIVE');
  end if;
  if length(v_reason) < 4 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SALE_NOT_FOUND');
  end if;
  if v_sale.seller_id <> v_uid
     and not (public.is_admin() and v_acting_as_seller is not null and v_acting_as_seller = v_sale.seller_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNER');
  end if;
  if v_sale.operation_type <> 'CUBA' then
    return jsonb_build_object('ok', false, 'code', 'NOT_CUBA');
  end if;
  if v_sale.status not in ('PENDING', 'SOLD')
     and not (v_admin_direct and public.is_admin() and v_sale.status in ('DRAFT', 'PAID')) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  nb_first  := btrim(coalesce(p_payload#>>'{buyer,firstName}', ''));
  nb_last   := btrim(coalesce(p_payload#>>'{buyer,lastName}', ''));
  nb_dob    := nullif(p_payload#>>'{buyer,dateOfBirth}', '');
  nb_docnum := btrim(coalesce(p_payload#>>'{buyer,documentNumber}', ''));
  nb_docexp := nullif(p_payload#>>'{buyer,documentExpiration}', '');
  nb_phone  := btrim(coalesce(p_payload#>>'{buyer,phone}', ''));
  nb_email  := btrim(coalesce(p_payload#>>'{buyer,email}', ''));
  nb_a1     := btrim(coalesce(p_payload#>>'{buyer,addressLine1}', ''));
  nb_a2     := btrim(coalesce(p_payload#>>'{buyer,addressLine2}', ''));
  nb_city   := btrim(coalesce(p_payload#>>'{buyer,city}', ''));
  nb_state  := btrim(coalesce(p_payload#>>'{buyer,state}', ''));
  nb_zip    := btrim(coalesce(p_payload#>>'{buyer,postalCode}', ''));
  if nb_first  = '' then v_errors := array_append(v_errors, 'BUYER_FIRST_NAME_MISSING'); end if;
  if nb_last   = '' then v_errors := array_append(v_errors, 'BUYER_LAST_NAME_MISSING'); end if;
  if nb_docnum = '' then v_errors := array_append(v_errors, 'BUYER_DOCUMENT_NUMBER_MISSING'); end if;
  if nb_phone  = '' then v_errors := array_append(v_errors, 'BUYER_PHONE_MISSING'); end if;

  nr_name := btrim(coalesce(p_payload#>>'{cubaRecipient,fullName}', ''));
  nr_ci   := btrim(coalesce(p_payload#>>'{cubaRecipient,identityNumber}', ''));
  nr_addr := btrim(coalesce(p_payload#>>'{cubaRecipient,deliveryAddress}', ''));
  nr_muni := btrim(coalesce(p_payload#>>'{cubaRecipient,municipality}', ''));
  nr_prov := btrim(coalesce(p_payload#>>'{cubaRecipient,province}', ''));
  nr_p1   := btrim(coalesce(p_payload#>>'{cubaRecipient,phonePrimary}', ''));
  nr_p2   := btrim(coalesce(p_payload#>>'{cubaRecipient,phoneSecondary}', ''));
  if nr_name = '' then v_errors := array_append(v_errors, 'RECIPIENT_FULL_NAME_MISSING'); end if;
  if nr_ci   = '' then v_errors := array_append(v_errors, 'RECIPIENT_IDENTITY_NUMBER_MISSING'); end if;
  if nr_addr = '' then v_errors := array_append(v_errors, 'RECIPIENT_DELIVERY_ADDRESS_MISSING'); end if;
  if nr_prov = '' then v_errors := array_append(v_errors, 'RECIPIENT_PROVINCE_MISSING'); end if;
  if nr_p1   = '' then v_errors := array_append(v_errors, 'RECIPIENT_PRIMARY_PHONE_MISSING'); end if;

  nd_method := nullif(btrim(coalesce(p_payload#>>'{delivery,method}', '')), '');
  nd_ref    := btrim(coalesce(p_payload#>>'{delivery,reference}', ''));
  if nd_method is null then
    v_errors := array_append(v_errors, 'DELIVERY_METHOD_MISSING');
  elsif nd_method not in ('HOME_DELIVERY', 'PICKUP_POINT') then
    v_errors := array_append(v_errors, 'DELIVERY_METHOD_INVALID');
  end if;

  if jsonb_array_length(v_units_json) = 0 then
    v_errors := array_append(v_errors, 'NO_UNITS');
  else
    for v_u in select * from jsonb_array_elements(v_units_json) loop
      select p.id, p.name, p.brand, p.base_price_cents, p.cuba_total_cents
        into v_prod
        from public.products p
        where p.id = nullif(v_u->>'productId', '')::uuid
          and (p.is_active or exists (
            select 1 from public.sale_units su0
            where su0.id = nullif(v_u->>'id', '')::uuid and su0.sale_id = p_sale_id and su0.product_id = p.id));
      if not found then
        v_errors := array_append(v_errors, 'UNIT_PRODUCT_INVALID');
      elsif nullif(v_u->>'variantId', '') is not null
        and not exists (
          select 1 from public.product_variants pv
          where pv.id = (v_u->>'variantId')::uuid and pv.product_id = v_prod.id) then
        v_errors := array_append(v_errors, 'UNIT_VARIANT_MISMATCH');
      end if;
      if coalesce((v_u->>'agreedPriceCents')::bigint, 0) <= 0 then
        v_errors := array_append(v_errors, 'UNIT_AGREED_PRICE_INVALID');
      end if;
      if nullif(v_u->>'id', '') is not null
        and not exists (
          select 1 from public.sale_units su
          where su.id = (v_u->>'id')::uuid and su.sale_id = p_sale_id) then
        v_errors := array_append(v_errors, 'UNIT_ID_UNKNOWN');
      end if;
    end loop;
  end if;

  -- Precio fijo (mínimo oficial) y comisión fija: SOLO unidades nuevas o cuyo
  -- producto/precio cambia (una edición no relacionada nunca se bloquea).
  -- Con comisión ya congelada (VENDIDA) el mínimo es el precio fijo CONGELADO;
  -- si no, el vigente del producto, que además debe estar configurado (salvo
  -- en BORRADOR, que se valida al enviarlo a revisión).
  for v_u in select * from jsonb_array_elements(v_units_json) loop
    v_pr_new := coalesce((v_u->>'agreedPriceCents')::bigint, 0);
    v_pr_unit_id := null;
    v_pr_old_product := null;
    v_pr_old_price := null;
    v_pr_frozen := null;
    if nullif(v_u->>'id', '') is not null then
      select su.id, su.product_id, su.agreed_price_cents
        into v_pr_unit_id, v_pr_old_product, v_pr_old_price
        from public.sale_units su
        where su.id = (v_u->>'id')::uuid and su.sale_id = p_sale_id;
    end if;
    continue when v_pr_new <= 0;
    continue when v_pr_unit_id is not null
      and v_pr_old_product is not distinct from nullif(v_u->>'productId', '')::uuid
      and v_pr_old_price is not distinct from v_pr_new;
    -- Comisión ya incluida en una liquidación: su importe está cerrado.
    if v_pr_unit_id is not null and v_pr_old_price is distinct from v_pr_new
       and exists (select 1 from public.sale_commissions sc
                   where sc.sale_unit_id = v_pr_unit_id and sc.liquidation_id is not null)
       and not ('COMMISSION_LOCKED' = any(v_errors)) then
      v_errors := array_append(v_errors, 'COMMISSION_LOCKED');
    end if;
    if v_pr_unit_id is not null then
      select sc.reference_price_cents into v_pr_frozen
        from public.sale_commissions sc where sc.sale_unit_id = v_pr_unit_id;
    end if;
    if v_pr_frozen is not null then
      if v_pr_new < v_pr_frozen and not ('UNIT_PRICE_BELOW_FIXED_PRICE' = any(v_errors)) then
        v_errors := array_append(v_errors, 'UNIT_PRICE_BELOW_FIXED_PRICE');
      end if;
      continue;
    end if;
    select p.default_reference_price_cents, p.default_base_commission_cents, true
      into v_pr_fixed, v_pr_commission, v_pr_found
      from public.products p where p.id = nullif(v_u->>'productId', '')::uuid;
    if not coalesce(v_pr_found, false) then
      null; -- producto inválido: ya informado como UNIT_PRODUCT_INVALID
    elsif not public._product_pricing_configured(v_pr_fixed, v_pr_commission) then
      if v_sale.status <> 'DRAFT' and not ('UNIT_COMMISSION_CONFIG_MISSING' = any(v_errors)) then
        v_errors := array_append(v_errors, 'UNIT_COMMISSION_CONFIG_MISSING');
      end if;
    elsif v_pr_new < v_pr_fixed and not ('UNIT_PRICE_BELOW_FIXED_PRICE' = any(v_errors)) then
      v_errors := array_append(v_errors, 'UNIT_PRICE_BELOW_FIXED_PRICE');
    end if;
    v_pr_found := false;
  end loop;

  for v_d in select * from jsonb_array_elements(v_docs_json) loop
    if v_d->>'action' = 'remove'
      and (v_d->>'subjectType') in ('BUYER', 'CUBA_RECIPIENT')
      and not exists (
        select 1 from jsonb_array_elements(v_docs_json) x
        where x->>'subjectType' = v_d->>'subjectType'
          and x->>'side' = v_d->>'side'
          and x->>'action' = 'replace') then
      v_errors := array_append(v_errors, 'REQUIRED_DOCUMENT_REMOVAL');
    end if;
  end loop;

  if array_length(v_errors, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED',
      'errors', to_jsonb(v_errors));
  end if;

  ----------------------------------------------------------------- FASE 2 ---
  select * into v_old_buyer from public.sale_parties
    where sale_id = p_sale_id and party_role = 'PRIMARY_BUYER';

  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.first_name',          'UPDATE', v_old_buyer.first_name,               nb_first);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.last_name',           'UPDATE', v_old_buyer.last_name,                nb_last);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.date_of_birth',       'UPDATE', v_old_buyer.date_of_birth::text,      nb_dob);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.document_number',     'UPDATE', v_old_buyer.document_number,          nb_docnum);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.document_expiration', 'UPDATE', v_old_buyer.document_expiration::text, nb_docexp);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.phone',               'UPDATE', v_old_buyer.phone,                    nb_phone);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.email',               'UPDATE', v_old_buyer.email,                    nullif(nb_email, ''));
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.address_line1',       'UPDATE', v_old_buyer.address_line1,            nullif(nb_a1, ''));
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.address_line2',       'UPDATE', v_old_buyer.address_line2,            nullif(nb_a2, ''));
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.city',                'UPDATE', v_old_buyer.city,                     nullif(nb_city, ''));
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.state',               'UPDATE', v_old_buyer.state,                    nullif(nb_state, ''));
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.postal_code',         'UPDATE', v_old_buyer.postal_code,              nullif(nb_zip, ''));

  update public.sale_parties set
    first_name = nb_first, last_name = nb_last,
    date_of_birth = nb_dob::date, document_number = nb_docnum,
    document_expiration = nb_docexp::date, phone = nb_phone,
    email = nullif(nb_email, ''), address_line1 = nullif(nb_a1, ''),
    address_line2 = nullif(nb_a2, ''), city = nullif(nb_city, ''),
    state = nullif(nb_state, ''), postal_code = nullif(nb_zip, '')
  where sale_id = p_sale_id and party_role = 'PRIMARY_BUYER';

  select * into v_old_cb from public.sale_parties
    where sale_id = p_sale_id and party_role = 'CO_BUYER';
  ncb := p_payload->'coBuyer';
  if ncb is not null and jsonb_typeof(ncb) = 'object' then
    ncb_first  := btrim(coalesce(ncb->>'firstName', ''));
    ncb_last   := btrim(coalesce(ncb->>'lastName', ''));
    ncb_dob    := nullif(ncb->>'dateOfBirth', '');
    ncb_docnum := btrim(coalesce(ncb->>'documentNumber', ''));
    ncb_phone  := btrim(coalesce(ncb->>'phone', ''));
    ncb_email  := btrim(coalesce(ncb->>'email', ''));
    if v_old_cb.id is null then
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'co_buyer', 'ADD', null, nullif(btrim(ncb_first || ' ' || ncb_last), ''));
    else
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'co_buyer.first_name',      'UPDATE', v_old_cb.first_name,           nullif(ncb_first, ''));
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'co_buyer.last_name',       'UPDATE', v_old_cb.last_name,            nullif(ncb_last, ''));
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'co_buyer.date_of_birth',   'UPDATE', v_old_cb.date_of_birth::text,  ncb_dob);
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'co_buyer.document_number', 'UPDATE', v_old_cb.document_number,      nullif(ncb_docnum, ''));
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'co_buyer.phone',          'UPDATE', v_old_cb.phone,               nullif(ncb_phone, ''));
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'co_buyer.email',          'UPDATE', v_old_cb.email,               nullif(ncb_email, ''));
    end if;
    insert into public.sale_parties (
      sale_id, party_role, first_name, last_name, date_of_birth, document_number, phone, email)
    values (
      p_sale_id, 'CO_BUYER', nullif(ncb_first, ''), nullif(ncb_last, ''), ncb_dob::date,
      nullif(ncb_docnum, ''), nullif(ncb_phone, ''), nullif(ncb_email, ''))
    on conflict (sale_id, party_role) do update set
      first_name = excluded.first_name, last_name = excluded.last_name,
      date_of_birth = excluded.date_of_birth, document_number = excluded.document_number,
      phone = excluded.phone, email = excluded.email;
  elsif v_old_cb.id is not null then
    perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
      'co_buyer', 'REMOVE',
      nullif(btrim(coalesce(v_old_cb.first_name, '') || ' ' || coalesce(v_old_cb.last_name, '')), ''),
      null);
    delete from public.sale_parties where sale_id = p_sale_id and party_role = 'CO_BUYER';
  end if;

  select * into v_old_rec from public.sale_cuba_recipients where sale_id = p_sale_id;
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'recipient.full_name',        'UPDATE', v_old_rec.full_name,        nr_name);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'recipient.identity_number',  'UPDATE', v_old_rec.identity_number,  nr_ci);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'recipient.delivery_address', 'UPDATE', v_old_rec.delivery_address, nr_addr);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'recipient.municipality',     'UPDATE', v_old_rec.municipality,     nullif(nr_muni, ''));
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'recipient.province',         'UPDATE', v_old_rec.province,         nr_prov);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'recipient.primary_phone',    'UPDATE', v_old_rec.primary_phone,    nr_p1);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'recipient.secondary_phone',  'UPDATE', v_old_rec.secondary_phone,  nullif(nr_p2, ''));

  insert into public.sale_cuba_recipients (
    sale_id, full_name, identity_number, delivery_address, municipality,
    province, primary_phone, secondary_phone)
  values (
    p_sale_id, nr_name, nr_ci, nr_addr, nullif(nr_muni, ''),
    nr_prov, nr_p1, nullif(nr_p2, ''))
  on conflict (sale_id) do update set
    full_name = excluded.full_name, identity_number = excluded.identity_number,
    delivery_address = excluded.delivery_address, municipality = excluded.municipality,
    province = excluded.province, primary_phone = excluded.primary_phone,
    secondary_phone = excluded.secondary_phone;

  select * into v_old_del from public.sale_deliveries where sale_id = p_sale_id;
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'delivery.method',           'UPDATE', v_old_del.method,           nd_method);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'delivery.pickup_reference', 'UPDATE', v_old_del.pickup_reference, nullif(nd_ref, ''));
  insert into public.sale_deliveries (sale_id, method, pickup_reference)
  values (p_sale_id, nd_method, nullif(nd_ref, ''))
  on conflict (sale_id) do update set
    method = excluded.method, pickup_reference = excluded.pickup_reference;

  select coalesce(array_agg((u->>'id')::uuid) filter (where nullif(u->>'id', '') is not null),
                  array[]::uuid[])
    into v_payload_unit_ids
    from jsonb_array_elements(v_units_json) u;

  for v_old_unit in select * from public.sale_units where sale_id = p_sale_id loop
    if not (v_old_unit.id = any(v_payload_unit_ids)) then
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'units.' || v_old_unit.id::text, 'REMOVE',
        coalesce(v_old_unit.product_name_snapshot, '')
          || case when coalesce(v_old_unit.variant_snapshot, '') <> ''
                  then ' / ' || v_old_unit.variant_snapshot else '' end
          || ' @ ' || coalesce(v_old_unit.agreed_price_cents, 0)::text
          || case when v_old_unit.tracking_code is not null
                  then ' (' || v_old_unit.tracking_code || ')' else '' end,
        null);
      delete from public.sale_units where id = v_old_unit.id;
    end if;
  end loop;

  v_pos := 0;
  for v_u in select * from jsonb_array_elements(v_units_json) loop
    select p.id, p.name, p.brand, p.base_price_cents, p.cuba_total_cents
      into v_prod
      from public.products p
      where p.id = (v_u->>'productId')::uuid
        and (p.is_active or exists (
          select 1 from public.sale_units su0
          where su0.id = nullif(v_u->>'id', '')::uuid and su0.sale_id = p_sale_id and su0.product_id = p.id));

    v_variant_id := nullif(v_u->>'variantId', '')::uuid;
    v_variant_label := null;
    if v_variant_id is not null then
      select pv.color_name into v_variant_label
        from public.product_variants pv
        where pv.id = v_variant_id and pv.product_id = v_prod.id;
    end if;
    v_agreed := greatest(0, coalesce((v_u->>'agreedPriceCents')::bigint, 0));

    if nullif(v_u->>'id', '') is not null then
      select * into v_old_unit from public.sale_units where id = (v_u->>'id')::uuid;

      if v_old_unit.product_id is distinct from v_prod.id then
        perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
          'units.' || v_old_unit.id::text || '.product', 'UPDATE',
          v_old_unit.product_name_snapshot, v_prod.name);
      end if;
      if coalesce(v_old_unit.variant_snapshot, '') is distinct from coalesce(v_variant_label, '') then
        perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
          'units.' || v_old_unit.id::text || '.variant', 'UPDATE',
          v_old_unit.variant_snapshot, v_variant_label);
      end if;
      if v_old_unit.agreed_price_cents is distinct from v_agreed then
        perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
          'units.' || v_old_unit.id::text || '.agreed_price_cents', 'UPDATE',
          v_old_unit.agreed_price_cents::text, v_agreed::text);
      end if;

      update public.sale_units set
        position = v_pos,
        product_id = v_prod.id,
        product_variant_id = v_variant_id,
        product_name_snapshot = v_prod.name,
        brand_snapshot = v_prod.brand,
        variant_snapshot = v_variant_label,
        list_price_cents_snapshot = v_prod.base_price_cents,
        cuba_total_cents_snapshot = v_prod.cuba_total_cents,
        agreed_price_cents = v_agreed
      where id = v_old_unit.id;
    else
      v_track := case when v_sale.status in ('SOLD', 'PAID') then
        'CU-' || v_year || '-' || lpad(nextval('public.sale_unit_tracking_seq')::text, 6, '0')
        else null end;
      insert into public.sale_units (
        sale_id, position, product_id, product_variant_id,
        product_name_snapshot, brand_snapshot, variant_snapshot,
        list_price_cents_snapshot, cuba_total_cents_snapshot, agreed_price_cents, tracking_code)
      values (
        p_sale_id, v_pos, v_prod.id, v_variant_id,
        v_prod.name, v_prod.brand, v_variant_label,
        v_prod.base_price_cents, v_prod.cuba_total_cents, v_agreed, v_track)
      returning id into v_new_id;
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'units.' || v_new_id::text, 'ADD', null,
        v_prod.name
          || case when v_variant_label is not null then ' / ' || v_variant_label else '' end
          || ' @ ' || v_agreed::text
          || case when v_track is not null then ' (' || v_track || ')' else '' end);
    end if;
    v_pos := v_pos + 1;
  end loop;

  select coalesce(array_agg((e->>'id')::uuid) filter (where nullif(e->>'id', '') is not null),
                  array[]::uuid[])
    into v_payload_extra_ids
    from jsonb_array_elements(v_extras_json) e;

  for v_old_extra in select * from public.sale_extras where sale_id = p_sale_id loop
    if not (v_old_extra.id = any(v_payload_extra_ids)) then
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'extras.' || v_old_extra.id::text, 'REMOVE',
        coalesce(nullif(v_old_extra.description, ''), 'Extra')
          || ' x' || coalesce(v_old_extra.quantity, 1)::text
          || ' @ ' || coalesce(v_old_extra.unit_price_cents, 0)::text,
        null);
      delete from public.sale_extras where id = v_old_extra.id;
    end if;
  end loop;

  v_pos := 0;
  for v_e in select * from jsonb_array_elements(v_extras_json) loop
    ne_desc  := nullif(btrim(coalesce(v_e->>'description', '')), '');
    ne_qty   := greatest(1, coalesce((v_e->>'quantity')::int, 1));
    ne_price := greatest(0, coalesce((v_e->>'unitAmountCents')::bigint, 0));

    if nullif(v_e->>'id', '') is not null
      and exists (select 1 from public.sale_extras
                  where id = (v_e->>'id')::uuid and sale_id = p_sale_id) then
      select * into v_old_extra from public.sale_extras where id = (v_e->>'id')::uuid;
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'extras.' || v_old_extra.id::text || '.description', 'UPDATE', v_old_extra.description, ne_desc);
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'extras.' || v_old_extra.id::text || '.quantity', 'UPDATE', v_old_extra.quantity::text, ne_qty::text);
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'extras.' || v_old_extra.id::text || '.unit_price_cents', 'UPDATE', v_old_extra.unit_price_cents::text, ne_price::text);
      update public.sale_extras set
        description = ne_desc, quantity = ne_qty, unit_price_cents = ne_price, position = v_pos
      where id = v_old_extra.id;
    else
      insert into public.sale_extras (sale_id, description, quantity, unit_price_cents, position)
      values (p_sale_id, ne_desc, ne_qty, ne_price, v_pos)
      returning id into v_new_id;
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'extras.' || v_new_id::text, 'ADD', null,
        coalesce(ne_desc, 'Extra') || ' x' || ne_qty::text || ' @ ' || ne_price::text);
    end if;
    v_pos := v_pos + 1;
  end loop;

  for v_d in select * from jsonb_array_elements(v_docs_json) loop
    if v_d->>'action' = 'remove' then
      delete from public.sale_documents
        where sale_id = p_sale_id
          and subject_type = v_d->>'subjectType'
          and side = v_d->>'side';
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'documents.' || lower(v_d->>'subjectType') || '.' || lower(v_d->>'side'),
        'REMOVE', 'documento', null);
    elsif v_d->>'action' = 'replace' then
      v_party_id := null;
      v_recipient_id := null;
      if v_d->>'subjectType' = 'BUYER' then
        select id into v_party_id from public.sale_parties
          where sale_id = p_sale_id and party_role = 'PRIMARY_BUYER';
      elsif v_d->>'subjectType' = 'CO_BUYER' then
        select id into v_party_id from public.sale_parties
          where sale_id = p_sale_id and party_role = 'CO_BUYER';
      elsif v_d->>'subjectType' = 'CUBA_RECIPIENT' then
        select id into v_recipient_id from public.sale_cuba_recipients
          where sale_id = p_sale_id;
      end if;
      insert into public.sale_documents (
        sale_id, subject_type, side, party_id, recipient_id, storage_path,
        mime_type, file_size_bytes, uploaded_by)
      values (
        p_sale_id, v_d->>'subjectType', v_d->>'side', v_party_id, v_recipient_id,
        v_d->>'storagePath', nullif(v_d->>'mimeType', ''),
        nullif(v_d->>'fileSizeBytes', '')::bigint, v_uid)
      on conflict (sale_id, subject_type, side) do update set
        party_id = excluded.party_id, recipient_id = excluded.recipient_id,
        storage_path = excluded.storage_path, mime_type = excluded.mime_type,
        file_size_bytes = excluded.file_size_bytes, uploaded_by = excluded.uploaded_by;
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'documents.' || lower(v_d->>'subjectType') || '.' || lower(v_d->>'side'),
        'REPLACE', 'documento anterior', 'documento actualizado');
    end if;
  end loop;

  select coalesce(sum(agreed_price_cents), 0) into v_units_total
    from public.sale_units where sale_id = p_sale_id;
  select coalesce(sum(greatest(1, quantity) * greatest(0, unit_price_cents)), 0) into v_extras_total
    from public.sale_extras where sale_id = p_sale_id;
  v_delivery_total := coalesce(v_sale.delivery_total_cents, 0);
  v_sale_total := v_units_total + v_extras_total + v_delivery_total;

  nn_notes := nullif(btrim(coalesce(p_payload->>'internalNotes', '')), '');

  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
    'internal_notes', 'UPDATE', v_sale.internal_notes, nn_notes);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
    'totals.units_total_cents', 'UPDATE', v_sale.units_total_cents::text, v_units_total::text);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
    'totals.extras_total_cents', 'UPDATE', v_sale.extras_total_cents::text, v_extras_total::text);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
    'totals.sale_total_cents', 'UPDATE', v_sale.sale_total_cents::text, v_sale_total::text);

  update public.sales set
    internal_notes       = nn_notes,
    units_total_cents    = v_units_total,
    extras_total_cents   = v_extras_total,
    delivery_total_cents = v_delivery_total,
    sale_total_cents     = v_sale_total,
    updated_at           = now()
  where id = p_sale_id;
  -- status / sale_number / seller_id / sold_at / sold_by / paid_at / paid_by /
  -- tracking_code de unidades sin cambios: INTACTOS.

  select count(*) into v_change_count
    from public.sale_change_history where edit_group = v_group;

  return jsonb_build_object(
    'ok', true,
    'saleId', p_sale_id,
    'saleNumber', v_sale.sale_number,
    'status', v_sale.status,
    'unitsTotalCents', v_units_total,
    'extrasTotalCents', v_extras_total,
    'deliveryTotalCents', v_delivery_total,
    'saleTotalCents', v_sale_total,
    'changeCount', v_change_count,
    'editGroup', v_group);
end;
$$;

create or replace function public.request_sale_edit(p_sale_id uuid, p_reason text, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_sale   public.sales;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_snapshot jsonb;
  v_flat     jsonb;
  v_entry    jsonb;
  v_path     text;
  v_id_part  text;
  v_field    text;
  v_id       uuid;
  v_current  text;
  v_request_id uuid;
  v_min_price bigint;
  v_min_commission bigint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and is_active) then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_INACTIVE');
  end if;
  if length(v_reason) < 4 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    return jsonb_build_object('ok', false, 'code', 'NO_CHANGES');
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SALE_NOT_FOUND');
  end if;
  if v_sale.seller_id <> v_uid then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNER');
  end if;
  if v_sale.operation_type <> 'CUBA' then
    return jsonb_build_object('ok', false, 'code', 'NOT_CUBA');
  end if;
  if v_sale.status = 'PAID' then
    return jsonb_build_object('ok', false, 'code', 'SALE_PAID_REQUIRES_ADMIN_CORRECTION');
  end if;
  if v_sale.status not in ('PENDING', 'SOLD') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;
  if exists (select 1 from public.sale_edit_requests where sale_id = p_sale_id and status = 'PENDING') then
    return jsonb_build_object('ok', false, 'code', 'REQUEST_ALREADY_PENDING');
  end if;

  v_snapshot := public.sale_edit_snapshot(p_sale_id);
  v_flat := v_snapshot->'flat';

  for v_entry in select * from jsonb_array_elements(p_changes) loop
    v_path := v_entry->>'path';
    if v_path is null or v_path = '' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_CHANGE_PATH');
    end if;

    if v_path in (
      'buyer.first_name', 'buyer.last_name', 'buyer.phone', 'buyer.email',
      'buyer.address_line1', 'buyer.address_line2', 'buyer.city', 'buyer.state',
      'buyer.postal_code', 'buyer.document_number',
      'recipient.full_name', 'recipient.identity_number', 'recipient.delivery_address',
      'recipient.municipality', 'recipient.province', 'recipient.primary_phone', 'recipient.secondary_phone',
      'delivery.method', 'delivery.pickup_reference', 'internal_notes'
    ) then
      null;
    elsif v_path like 'units.%' then
      v_id_part := split_part(v_path, '.', 2);
      v_field := split_part(v_path, '.', 3);
      if v_field not in ('variant_id', 'agreed_price_cents') then
        return jsonb_build_object('ok', false, 'code', 'INVALID_CHANGE_PATH', 'path', v_path);
      end if;
      begin
        v_id := v_id_part::uuid;
      exception when others then
        return jsonb_build_object('ok', false, 'code', 'INVALID_CHANGE_PATH', 'path', v_path);
      end;
      if not exists (select 1 from public.sale_units where id = v_id and sale_id = p_sale_id) then
        return jsonb_build_object('ok', false, 'code', 'UNIT_NOT_IN_SALE', 'path', v_path);
      end if;
      -- Nuevo precio: nunca por debajo del precio fijo (el CONGELADO si la
      -- unidad ya tiene comisión; si no, el vigente del producto).
      if v_field = 'agreed_price_cents' then
        if exists (select 1 from public.sale_commissions sc where sc.sale_unit_id = v_id and sc.liquidation_id is not null) then
          return jsonb_build_object('ok', false, 'code', 'COMMISSION_LOCKED', 'path', v_path);
        end if;
        if coalesce(v_entry->>'newValue', '') !~ '^[0-9]+$' or (v_entry->>'newValue')::bigint <= 0 then
          return jsonb_build_object('ok', false, 'code', 'UNIT_AGREED_PRICE_INVALID', 'path', v_path);
        end if;
        v_min_price := null;
        v_min_commission := null;
        select sc.reference_price_cents into v_min_price
          from public.sale_commissions sc where sc.sale_unit_id = v_id;
        if v_min_price is null then
          select p.default_reference_price_cents, p.default_base_commission_cents
            into v_min_price, v_min_commission
            from public.sale_units su join public.products p on p.id = su.product_id
            where su.id = v_id;
          if not public._product_pricing_configured(v_min_price, v_min_commission) then
            return jsonb_build_object('ok', false, 'code', 'UNIT_COMMISSION_CONFIG_MISSING', 'path', v_path);
          end if;
        end if;
        if (v_entry->>'newValue')::bigint < v_min_price then
          return jsonb_build_object('ok', false, 'code', 'UNIT_PRICE_BELOW_FIXED_PRICE', 'path', v_path,
            'fixedPriceCents', v_min_price);
        end if;
      end if;
    elsif v_path like 'extras.%' then
      v_id_part := split_part(v_path, '.', 2);
      v_field := split_part(v_path, '.', 3);
      if v_field not in ('description', 'quantity', 'unit_price_cents') then
        return jsonb_build_object('ok', false, 'code', 'INVALID_CHANGE_PATH', 'path', v_path);
      end if;
      begin
        v_id := v_id_part::uuid;
      exception when others then
        return jsonb_build_object('ok', false, 'code', 'INVALID_CHANGE_PATH', 'path', v_path);
      end;
      if not exists (select 1 from public.sale_extras where id = v_id and sale_id = p_sale_id) then
        return jsonb_build_object('ok', false, 'code', 'EXTRA_NOT_IN_SALE', 'path', v_path);
      end if;
    else
      return jsonb_build_object('ok', false, 'code', 'INVALID_CHANGE_PATH', 'path', v_path);
    end if;

    v_current := v_flat->>v_path;
    if coalesce(v_entry->>'oldValue', '') is distinct from coalesce(v_current, '') then
      return jsonb_build_object('ok', false, 'code', 'REQUEST_CONFLICT', 'path', v_path,
        'currentValue', v_current, 'declaredOldValue', v_entry->>'oldValue');
    end if;
  end loop;

  insert into public.sale_edit_requests (sale_id, requested_by, reason, requested_changes, sale_status_at_request)
  values (p_sale_id, v_uid, v_reason, p_changes, v_sale.status)
  returning id into v_request_id;

  return jsonb_build_object('ok', true, 'requestId', v_request_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Fila de venta para "Mis liquidaciones" (interno).
-- ---------------------------------------------------------------------------
create or replace function public._weekly_sale_row(p_sale_id uuid, p_counted uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'saleId', s.id, 'saleNumber', s.sale_number, 'status', s.status,
    'operationType', s.operation_type,
    'businessDate', coalesce(s.sale_date, s.created_at::date),
    'hasExplicitDate', s.sale_date is not null,
    'soldAt', s.sold_at, 'paidAt', s.paid_at,
    'buyerName', (select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
                  from public.sale_parties sp where sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'),
    'saleTotalCents', coalesce(s.sale_total_cents,
      (select coalesce(sum(su.agreed_price_cents), 0) from public.sale_units su where su.sale_id = s.id)
      + (select coalesce(sum(greatest(1, se.quantity) * greatest(0, se.unit_price_cents)), 0)
         from public.sale_extras se where se.sale_id = s.id)),
    'countedThisWeekCents', (select coalesce(sum(sc.final_commission_cents), 0)
                             from public.sale_commissions sc
                             where sc.sale_id = s.id and sc.id = any(coalesce(p_counted, array[]::uuid[]))),
    'commission', public._sale_commission_preview(s.id))
  from public.sales s
  where s.id = p_sale_id;
$$;
revoke all on function public._weekly_sale_row(uuid, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- "Mis liquidaciones" — semana del vendedor (o de un vendedor, si admin).
--   * confirmedSales: VENDIDAS/PAGADAS confirmadas (sold_at) en la semana
--     (+ las que reclamó la liquidación aprobada de la semana).
--   * upcoming: PENDIENTES con fecha de negocio en la semana.
--   * upcomingPrevious: PENDIENTES con fecha de negocio anterior al lunes.
--   Solo confirmedSales suma; las pendientes son una estimación informativa.
-- ---------------------------------------------------------------------------
create or replace function public.seller_weekly_liquidation(p_week_start date default null, p_seller_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_target  uuid;
  v_seller  public.profiles;
  v_current date;
  v_week    date;
  v_open    timestamptz;
  v_close   timestamptz;
  v_liq     public.weekly_liquidations;
  v_has_liq boolean := false;
  v_final   boolean := false;
  v_counted uuid[];
  v_confirmed_sales uuid[];
  v_confirmed bigint;
  v_units   int;
  v_bonus_marketing bigint := 0;
  v_bonus_sales     bigint := 0;
  v_other_adj       bigint := 0;
  v_total   bigint;
  v_confirmed_rows jsonb;
  v_upcoming jsonb;
  v_upcoming_prev jsonb;
  v_upcoming_count int;
  v_upcoming_est bigint;
  v_upcoming_unest int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and is_active) then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_INACTIVE');
  end if;
  v_target := coalesce(p_seller_id, v_uid);
  if v_target <> v_uid and not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED');
  end if;
  select * into v_seller from public.profiles where id = v_target;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SELLER_NOT_FOUND');
  end if;

  v_current := public._liquidation_week_of_instant(now());
  v_week    := public._liquidation_week_start(coalesce(p_week_start, v_current));
  v_open    := public._liquidation_week_open_at(v_week);
  v_close   := public._liquidation_week_close_at(v_week);

  -- El vendedor solo ve la liquidación APROBADA/PAGADA (el borrador es interno).
  select * into v_liq from public.weekly_liquidations
  where seller_id = v_target and week_start_date = v_week
    and (status in ('APPROVED', 'PAID') or public.is_admin());
  v_has_liq := found;
  v_final := v_has_liq and v_liq.status in ('APPROVED', 'PAID');

  -- Comisiones que forman el dinero de ESTA semana (misma regla que el admin).
  if v_final then
    select coalesce(array_agg(sc.id), array[]::uuid[]) into v_counted
    from public.sale_commissions sc where sc.liquidation_id = v_liq.id;
  else
    select coalesce(array_agg(sc.id), array[]::uuid[]) into v_counted
    from public.sale_commissions sc
    join public.sales s on s.id = sc.sale_id
    where sc.seller_id = v_target
      and sc.status <> 'VOID'
      and s.status in ('SOLD', 'PAID')
      and s.sold_at >= v_open and s.sold_at < v_close
      and (sc.liquidation_id is null
           or sc.liquidation_id in (select id from public.weekly_liquidations
                                    where seller_id = v_target and week_start_date = v_week));
  end if;

  -- Ventas confirmadas de la semana (una fila por venta).
  select coalesce(array_agg(s.id order by s.sold_at, s.created_at), array[]::uuid[]) into v_confirmed_sales
  from public.sales s
  where s.seller_id = v_target
    and s.status in ('SOLD', 'PAID')
    and ((s.sold_at >= v_open and s.sold_at < v_close)
         or exists (select 1 from public.sale_commissions sc where sc.sale_id = s.id and sc.id = any(v_counted)));

  select coalesce(sum(final_commission_cents), 0) into v_confirmed
  from public.sale_commissions where id = any(v_counted);
  select count(*) into v_units from public.sale_units where sale_id = any(v_confirmed_sales);

  if v_final then
    select
      coalesce(sum(amount_cents) filter (where adjustment_type = 'BONO_MARKETING'), 0),
      coalesce(sum(amount_cents) filter (where adjustment_type in ('BONO_VENTAS', 'BONO')), 0),
      coalesce(sum(case when adjustment_type = 'AJUSTE_POSITIVO' then amount_cents
                        when adjustment_type = 'AJUSTE_NEGATIVO' then -amount_cents else 0 end), 0)
      into v_bonus_marketing, v_bonus_sales, v_other_adj
    from public.weekly_liquidation_adjustments where liquidation_id = v_liq.id;
    v_total := v_liq.total_to_pay_cents;
  else
    v_total := v_confirmed;
  end if;

  select coalesce(jsonb_agg(public._weekly_sale_row(x.id, v_counted) order by x.ord), '[]'::jsonb) into v_confirmed_rows
  from unnest(v_confirmed_sales) with ordinality as x(id, ord);

  select coalesce(jsonb_agg(public._weekly_sale_row(s.id, v_counted)
                            order by coalesce(s.sale_date, s.created_at::date), s.created_at), '[]'::jsonb)
    into v_upcoming
  from public.sales s
  where s.seller_id = v_target and s.status = 'PENDING'
    and coalesce(s.sale_date, s.created_at::date) between v_week and v_week + 6;

  select coalesce(jsonb_agg(public._weekly_sale_row(s.id, v_counted)
                            order by coalesce(s.sale_date, s.created_at::date), s.created_at), '[]'::jsonb)
    into v_upcoming_prev
  from public.sales s
  where s.seller_id = v_target and s.status = 'PENDING'
    and coalesce(s.sale_date, s.created_at::date) < v_week;

  select count(*),
         coalesce(sum((r->'commission'->>'totalCents')::bigint) filter (where r->'commission'->>'kind' = 'ESTIMATED'), 0),
         count(*) filter (where r->'commission'->>'kind' <> 'ESTIMATED')
    into v_upcoming_count, v_upcoming_est, v_upcoming_unest
  from jsonb_array_elements(v_upcoming || v_upcoming_prev) r;

  return jsonb_build_object(
    'ok', true,
    'seller', jsonb_build_object('id', v_seller.id, 'fullName', v_seller.full_name),
    'weekStart', v_week, 'weekEnd', v_week + 6, 'currentWeekStart', v_current,
    'liquidation', case when v_has_liq then jsonb_build_object(
        'id', v_liq.id, 'status', v_liq.status, 'totalCents', v_liq.total_to_pay_cents,
        'paidAt', v_liq.paid_at, 'approvedAt', v_liq.approved_at) else null end,
    'summary', jsonb_build_object(
      'confirmedCommissionsCents', v_confirmed,
      'unitsSold', v_units,
      'bonusMarketingCents', v_bonus_marketing,
      'bonusSalesCents', v_bonus_sales,
      'otherAdjustmentsCents', v_other_adj,
      'totalToPayCents', v_total,
      'isFinal', v_final,
      'upcomingCount', v_upcoming_count,
      'upcomingEstimatedCents', v_upcoming_est,
      'upcomingUnestimatedCount', v_upcoming_unest),
    'confirmedSales', v_confirmed_rows,
    'upcoming', v_upcoming,
    'upcomingPrevious', v_upcoming_prev);
end;
$$;
revoke all on function public.seller_weekly_liquidation(date, uuid) from public, anon;
grant execute on function public.seller_weekly_liquidation(date, uuid) to authenticated;
