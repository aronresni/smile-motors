-- ===========================================================================
-- LIQUIDACIÓN SEMANAL — endurecimiento: no se puede aprobar (ni por lo tanto
-- pagar) la liquidación de una semana que todavía está en curso.
--
-- Regla: una semana lunes-domingo se considera CERRADA solo a partir de su
-- domingo 23:59:59 inclusive — es decir, desde la medianoche UTC del lunes
-- siguiente (`(week_end_date + 1)::timestamptz`). Este es el MISMO límite
-- superior ya usado en `admin_liquidation_create_draft`/`_refresh`/
-- `admin_liquidation_week_list` para decidir si una comisión ELIGIBLE
-- pertenece a esta semana — se reutiliza el mismo cálculo, no uno nuevo.
--
-- Zona horaria: el proyecto NO tiene hoy un concepto de "zona horaria del
-- concesionario" (confirmado por inspección: no existe ninguna constante de
-- timezone en `src/config`/`src/lib`). La arquitectura de fechas YA
-- existente (`src/lib/seller/period.ts`, `sale_date` como `date` puro, y
-- cada límite de semana en este mismo módulo) trata las fechas como UTC de
-- forma deliberada y consistente en todo el proyecto — se sigue exactamente
-- ese mismo criterio aquí (`now()` del servidor Postgres, NUNCA la hora del
-- navegador). Si en el futuro se define una zona horaria de negocio
-- explícita, este es el único punto que habría que ajustar.
--
-- El cierre se verifica DENTRO de la RPC de aprobación (confiable) — el
-- deshabilitado del botón en el frontend es solo cortesía de UX, nunca la
-- única barrera.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. admin_liquidation_approve — agrega el gate WEEK_NOT_CLOSED antes de
--    cualquier otra cosa (después de los checks de auth/rol/existencia).
-- ---------------------------------------------------------------------------
create or replace function public.admin_liquidation_approve(p_liquidation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_liq public.weekly_liquidations;
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
  if now() < (v_liq.week_end_date + 1)::timestamptz then
    return jsonb_build_object(
      'ok', false, 'code', 'WEEK_NOT_CLOSED',
      'weekEnd', v_liq.week_end_date,
      'closesAt', (v_liq.week_end_date + 1)::timestamptz
    );
  end if;

  update public.weekly_liquidations
  set status = 'APPROVED', approved_at = now(), approved_by = v_uid, updated_at = now()
  where id = p_liquidation_id;

  insert into public.weekly_liquidation_events (liquidation_id, event_type, actor_id)
  values (p_liquidation_id, 'APPROVED', v_uid);

  return jsonb_build_object('ok', true, 'status', 'APPROVED');
end;
$$;
revoke all on function public.admin_liquidation_approve(uuid) from public, anon;
grant execute on function public.admin_liquidation_approve(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. admin_liquidation_mark_paid — mismo gate como defensa en profundidad.
--    Redundante en la práctica (PAID exige APPROVED, y aprobar ya exige la
--    semana cerrada; el tiempo nunca retrocede), pero se agrega por el mismo
--    criterio de doble verificación usado en el resto del proyecto.
-- ---------------------------------------------------------------------------
create or replace function public.admin_liquidation_mark_paid(p_liquidation_id uuid, p_payment_reference text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_liq public.weekly_liquidations;
  v_ref text := nullif(btrim(coalesce(p_payment_reference, '')), '');
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
  if v_liq.status <> 'APPROVED' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;
  if now() < (v_liq.week_end_date + 1)::timestamptz then
    return jsonb_build_object(
      'ok', false, 'code', 'WEEK_NOT_CLOSED',
      'weekEnd', v_liq.week_end_date,
      'closesAt', (v_liq.week_end_date + 1)::timestamptz
    );
  end if;

  update public.weekly_liquidations
  set status = 'PAID', paid_at = now(), paid_by = v_uid, payment_reference = v_ref, updated_at = now()
  where id = p_liquidation_id;

  insert into public.weekly_liquidation_events (liquidation_id, event_type, actor_id, detail)
  values (p_liquidation_id, 'PAID', v_uid, jsonb_build_object('paymentReference', v_ref));

  return jsonb_build_object('ok', true, 'status', 'PAID');
end;
$$;
revoke all on function public.admin_liquidation_mark_paid(uuid, text) from public, anon;
grant execute on function public.admin_liquidation_mark_paid(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. admin_liquidation_detail — expone weekClosed/closesAt para que la UI
--    muestre el motivo exacto sin adivinar (nunca confiar en el reloj del
--    navegador para la decisión, solo para mostrar el texto).
-- ---------------------------------------------------------------------------
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
      'weekClosed', now() >= (v_liq.week_end_date + 1)::timestamptz,
      'closesAt', (v_liq.week_end_date + 1)::timestamptz
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
          and coalesce(s.sale_date, s.created_at::date) between v_liq.week_start_date and v_liq.week_end_date
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
          and coalesce(s.sale_date, s.created_at::date) between v_liq.week_start_date and v_liq.week_end_date
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
        'eligibleAt', sc.eligible_at
      ) order by sc.eligible_at)
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
revoke all on function public.admin_liquidation_detail(uuid) from public, anon;
grant execute on function public.admin_liquidation_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. admin_liquidation_week_list — agrega weekClosed a nivel de semana (una
--    sola vez, no por fila: es el mismo valor para todas las filas listadas).
-- ---------------------------------------------------------------------------
create or replace function public.admin_liquidation_week_list(p_week_start date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_week_start date := public._liquidation_week_start(coalesce(p_week_start, current_date));
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
    'weekClosed', now() >= (v_week_end + 1)::timestamptz,
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
          select
            count(*) filter (where s.status = 'PENDING') as pending_count,
            count(*) filter (where s.status = 'SOLD') as sold_count,
            count(*) filter (where s.status = 'PAID') as paid_count
          from public.sales s
          where s.seller_id = p.id
            and s.operation_type = 'CUBA'
            and coalesce(s.sale_date, s.created_at::date) between v_week_start and v_week_end
        ) act on true
        left join lateral (
          select count(*) as cnt, coalesce(sum(sc.final_commission_cents), 0) as sum_cents
          from public.sale_commissions sc
          where sc.liquidation_id = wl.id
        ) claimed on wl.id is not null
        left join lateral (
          select count(*) as cnt, coalesce(sum(sc.final_commission_cents), 0) as sum_cents
          from public.sale_commissions sc
          where sc.seller_id = p.id
            and sc.status = 'ELIGIBLE'
            and sc.liquidation_id is null
            and sc.eligible_at >= v_week_start::timestamptz
            and sc.eligible_at < (v_week_end + 1)::timestamptz
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
revoke all on function public.admin_liquidation_week_list(date) from public, anon;
grant execute on function public.admin_liquidation_week_list(date) to authenticated;
