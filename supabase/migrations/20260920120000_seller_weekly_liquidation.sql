-- ===========================================================================
-- SMILE MOTORS · PANEL DEL VENDEDOR + "MIS LIQUIDACIONES" SEMANAL.
--
-- Solo LECTURA nueva (más dos tipos de bono): no se reescribe ninguna venta,
-- comisión ni liquidación existente, ni cambia cuándo una comisión se paga.
--
-- Reglas (las VIGENTES, documentadas — no se cambian):
--   * La comisión DEFINITIVA se crea al marcar la venta VENDIDA (snapshot en
--     sale_commissions, status PENDING) y pasa a ELIGIBLE cuando la venta queda
--     PAGADA (eligible_at). SOLO las ELIGIBLE entran en el "Total a liquidar".
--   * Semana = lunes–domingo en la hora del concesionario (America/New_York).
--     El dinero de una semana = comisiones ELIGIBLE con eligible_at dentro de
--     la semana (misma ventana que admin_liquidation_create_draft/refresh).
--     sale_commissions.liquidation_id es única → una comisión nunca entra en
--     dos liquidaciones.
--   * La TABLA semanal agrupa las ventas por su fecha de negocio
--     (sale_date; borradores sin fecha: fecha de creación) — la misma regla
--     de "actividad de la semana" de la liquidación del admin — más las ventas
--     cuya comisión se liquida en esa semana (sin duplicar filas).
--   * BORRADOR / PENDIENTE: comisión ESTIMADA (precio de la venta + precio fijo
--     y comisión fija VIGENTES del producto), solo para mostrar: nunca se
--     guarda, nunca suma, no cuenta como unidad ni genera bonos.
--   * VENDIDA / PAGADA: solo la comisión CONGELADA (nunca se recalcula).
--   * CANCELADA: visible en el historial, sin comisión, fuera de pendientes y
--     de cualquier total.
--   * "Pendientes de semanas anteriores": ventas PENDIENTES cuya fecha de
--     negocio es anterior al lunes de la semana vista.
--
-- Seguridad: las funciones públicas son SECURITY DEFINER pero fijan el
-- vendedor a auth.uid(); solo un admin puede pedir otro vendedor. El helper
-- interno no se expone a authenticated. RLS no se toca.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Bonos separados: marketing y ventas (BONO genérico se conserva).
-- ---------------------------------------------------------------------------
alter table public.weekly_liquidation_adjustments
  drop constraint if exists weekly_liquidation_adjustments_adjustment_type_check;
alter table public.weekly_liquidation_adjustments
  add constraint weekly_liquidation_adjustments_adjustment_type_check
  check (adjustment_type in ('BONO', 'BONO_MARKETING', 'BONO_VENTAS', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO'));
comment on column public.weekly_liquidation_adjustments.adjustment_type is
  'BONO_MARKETING / BONO_VENTAS (desde 20260920) · BONO = bono genérico previo (se muestra como bono de ventas) · AJUSTE_POSITIVO / AJUSTE_NEGATIVO.';

create or replace function public.admin_liquidation_add_adjustment(
  p_liquidation_id uuid, p_type text, p_amount_cents bigint, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_liq    public.weekly_liquidations;
  v_type   text := upper(btrim(coalesce(p_type, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if v_type not in ('BONO', 'BONO_MARKETING', 'BONO_VENTAS', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_TYPE');
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_AMOUNT');
  end if;
  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  select * into v_liq from public.weekly_liquidations where id = p_liquidation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_liq.status = 'PAID' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_PAID');
  end if;

  insert into public.weekly_liquidation_adjustments (liquidation_id, adjustment_type, amount_cents, reason, created_by)
  values (p_liquidation_id, v_type, p_amount_cents, v_reason, v_uid);

  update public.weekly_liquidations
  set adjustments_total_cents = (
        select coalesce(sum(case when adjustment_type = 'AJUSTE_NEGATIVO' then -amount_cents else amount_cents end), 0)
        from public.weekly_liquidation_adjustments where liquidation_id = p_liquidation_id
      ),
      updated_at = now()
  where id = p_liquidation_id;

  update public.weekly_liquidations
  set total_to_pay_cents = commissions_subtotal_cents + adjustments_total_cents
  where id = p_liquidation_id
  returning * into v_liq;

  insert into public.weekly_liquidation_events (liquidation_id, event_type, actor_id, detail)
  values (p_liquidation_id, 'ADJUSTMENT_ADDED', v_uid, jsonb_build_object('type', v_type, 'amountCents', p_amount_cents, 'reason', v_reason));

  return jsonb_build_object('ok', true, 'adjustmentsCents', v_liq.adjustments_total_cents, 'totalCents', v_liq.total_to_pay_cents);
end;
$$;


-- ---------------------------------------------------------------------------
-- 2. Comisión de una venta para MOSTRAR (interno): congelada o estimada.
-- ---------------------------------------------------------------------------
create or replace function public._sale_commission_preview(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
  u record;
  v_units jsonb := '[]'::jsonb;
  v_kind text;
  v_cents bigint;
  v_reason text;
  v_frozen_total bigint := 0;
  v_frozen_count int := 0;
  v_est_total bigint := 0;
  v_est_ok boolean := true;
  v_first_reason text;
  v_count int := 0;
begin
  select s.status into v_status from public.sales s where s.id = p_sale_id;
  if not found then
    return null;
  end if;

  for u in
    select su.id, su.position, su.product_name_snapshot, su.variant_snapshot,
      coalesce(su.agreed_price_cents, 0) as price, su.product_id,
      p.default_reference_price_cents as fixed_price,
      p.default_base_commission_cents as fixed_commission,
      sc.id as commission_id, sc.status as commission_status, sc.final_commission_cents,
      sc.eligible_at, sc.liquidation_id
    from public.sale_units su
    left join public.products p on p.id = su.product_id
    left join public.sale_commissions sc on sc.sale_unit_id = su.id and sc.status <> 'VOID'
    where su.sale_id = p_sale_id
    order by su.position
  loop
    v_count := v_count + 1;
    v_cents := null;
    v_reason := null;
    if v_status = 'CANCELLED' then
      v_kind := 'NONE';
      v_reason := 'CANCELLED';
    elsif u.commission_id is not null then
      v_kind := 'FROZEN';
      v_cents := u.final_commission_cents;
      v_frozen_total := v_frozen_total + u.final_commission_cents;
      v_frozen_count := v_frozen_count + 1;
    elsif v_status in ('DRAFT', 'PENDING') then
      if u.product_id is null then
        v_kind := 'UNAVAILABLE';
        v_reason := 'NO_PRODUCT';
      elsif not public._product_pricing_configured(u.fixed_price, u.fixed_commission) then
        v_kind := 'UNAVAILABLE';
        v_reason := 'CONFIG_MISSING';
      elsif u.price < u.fixed_price then
        v_kind := 'UNAVAILABLE';
        v_reason := 'BELOW_FIXED_PRICE';
      else
        -- Misma fórmula que mark_sale_sold (solo para mostrar).
        v_kind := 'ESTIMATED';
        v_cents := u.fixed_commission + floor(greatest(0, u.price - u.fixed_price) / 2.0)::bigint;
        v_est_total := v_est_total + v_cents;
      end if;
      if v_kind <> 'ESTIMATED' then
        v_est_ok := false;
        v_first_reason := coalesce(v_first_reason, v_reason);
      end if;
    else
      -- VENDIDA/PAGADA sin comisión registrada (vendida antes del motor de comisiones).
      v_kind := 'NONE';
      v_reason := 'NOT_RECORDED';
    end if;

    v_units := v_units || jsonb_build_array(jsonb_build_object(
      'saleUnitId', u.id, 'productName', u.product_name_snapshot, 'variant', u.variant_snapshot,
      'priceCents', u.price, 'kind', v_kind, 'cents', v_cents, 'reason', v_reason,
      'commissionStatus', u.commission_status, 'eligibleAt', u.eligible_at, 'liquidationId', u.liquidation_id));
  end loop;

  if v_status = 'CANCELLED' then
    v_kind := 'NONE'; v_cents := null; v_reason := 'CANCELLED';
  elsif v_status in ('SOLD', 'PAID') then
    if v_frozen_count > 0 then
      v_kind := 'FROZEN'; v_cents := v_frozen_total; v_reason := null;
    else
      v_kind := 'NONE'; v_cents := null; v_reason := 'NOT_RECORDED';
    end if;
  elsif v_count = 0 then
    v_kind := 'UNAVAILABLE'; v_cents := null; v_reason := 'NO_UNITS';
  elsif v_est_ok then
    v_kind := 'ESTIMATED'; v_cents := v_est_total; v_reason := null;
  else
    v_kind := 'UNAVAILABLE'; v_cents := null; v_reason := v_first_reason;
  end if;

  return jsonb_build_object('kind', v_kind, 'totalCents', v_cents, 'reason', v_reason, 'units', v_units);
end;
$$;
revoke all on function public._sale_commission_preview(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Comisión de varias ventas ("Mis ventas"): solo las propias (o admin).
-- ---------------------------------------------------------------------------
create or replace function public.seller_sale_commission_previews(p_sale_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if coalesce(array_length(p_sale_ids, 1), 0) > 200 then
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY');
  end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_object_agg(s.id::text, public._sale_commission_preview(s.id))
    from public.sales s
    where s.id = any(coalesce(p_sale_ids, array[]::uuid[]))
      and (s.seller_id = v_uid or public.is_admin())
  ), '{}'::jsonb));
end;
$$;
revoke all on function public.seller_sale_commission_previews(uuid[]) from public, anon;
grant execute on function public.seller_sale_commission_previews(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. "Mis liquidaciones" — semana del vendedor (o de un vendedor, si admin).
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
  v_confirmed bigint;
  v_units   int;
  v_bonus_marketing bigint := 0;
  v_bonus_sales     bigint := 0;
  v_other_adj       bigint := 0;
  v_total   bigint;
  v_week_sales jsonb;
  v_prev_pending jsonb;
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

  -- Liquidación de la semana: el vendedor solo ve APROBADA/PAGADA (el
  -- borrador es trabajo interno del admin).
  select * into v_liq from public.weekly_liquidations
  where seller_id = v_target and week_start_date = v_week
    and (status in ('APPROVED', 'PAID') or public.is_admin());
  v_has_liq := found;
  v_final := v_has_liq and v_liq.status in ('APPROVED', 'PAID');

  -- Comisiones que forman el dinero de ESTA semana (cada una en una sola).
  if v_final then
    select coalesce(array_agg(sc.id), array[]::uuid[]) into v_counted
    from public.sale_commissions sc where sc.liquidation_id = v_liq.id;
  else
    select coalesce(array_agg(sc.id), array[]::uuid[]) into v_counted
    from public.sale_commissions sc
    join public.sales s on s.id = sc.sale_id
    where sc.seller_id = v_target
      and sc.status = 'ELIGIBLE'
      and sc.eligible_at >= v_open and sc.eligible_at < v_close
      and s.status <> 'CANCELLED'
      and (sc.liquidation_id is null
           or sc.liquidation_id in (select id from public.weekly_liquidations
                                    where seller_id = v_target and week_start_date = v_week));
  end if;

  select coalesce(sum(final_commission_cents), 0), count(*) into v_confirmed, v_units
  from public.sale_commissions where id = any(v_counted);

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

  -- Ventas de la semana: por fecha de negocio + las que se liquidan esta semana.
  select coalesce(jsonb_agg(row_data order by bdate, created_at), '[]'::jsonb) into v_week_sales
  from (
    select coalesce(s.sale_date, s.created_at::date) as bdate, s.created_at,
      jsonb_build_object(
        'saleId', s.id, 'saleNumber', s.sale_number, 'status', s.status,
        'operationType', s.operation_type,
        'businessDate', coalesce(s.sale_date, s.created_at::date),
        'hasExplicitDate', s.sale_date is not null,
        'buyerName', (select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
                      from public.sale_parties sp where sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'),
        'saleTotalCents', coalesce(s.sale_total_cents,
          (select coalesce(sum(su.agreed_price_cents), 0) from public.sale_units su where su.sale_id = s.id)
          + (select coalesce(sum(greatest(1, se.quantity) * greatest(0, se.unit_price_cents)), 0)
             from public.sale_extras se where se.sale_id = s.id)),
        'inWeek', coalesce(s.sale_date, s.created_at::date) between v_week and v_week + 6,
        'countedThisWeekCents', (select coalesce(sum(sc.final_commission_cents), 0)
                                 from public.sale_commissions sc where sc.sale_id = s.id and sc.id = any(v_counted)),
        'commission', public._sale_commission_preview(s.id)
      ) as row_data
    from public.sales s
    where s.seller_id = v_target
      and (coalesce(s.sale_date, s.created_at::date) between v_week and v_week + 6
           or exists (select 1 from public.sale_commissions sc where sc.sale_id = s.id and sc.id = any(v_counted)))
  ) w;

  -- PENDIENTES de semanas anteriores (siguen apareciendo hasta cambiar de estado).
  select coalesce(jsonb_agg(row_data order by bdate, created_at), '[]'::jsonb) into v_prev_pending
  from (
    select coalesce(s.sale_date, s.created_at::date) as bdate, s.created_at,
      jsonb_build_object(
        'saleId', s.id, 'saleNumber', s.sale_number, 'status', s.status,
        'operationType', s.operation_type,
        'businessDate', coalesce(s.sale_date, s.created_at::date),
        'hasExplicitDate', s.sale_date is not null,
        'buyerName', (select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
                      from public.sale_parties sp where sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'),
        'saleTotalCents', coalesce(s.sale_total_cents,
          (select coalesce(sum(su.agreed_price_cents), 0) from public.sale_units su where su.sale_id = s.id)
          + (select coalesce(sum(greatest(1, se.quantity) * greatest(0, se.unit_price_cents)), 0)
             from public.sale_extras se where se.sale_id = s.id)),
        'inWeek', false,
        'countedThisWeekCents', 0,
        'commission', public._sale_commission_preview(s.id)
      ) as row_data
    from public.sales s
    where s.seller_id = v_target
      and s.status = 'PENDING'
      and coalesce(s.sale_date, s.created_at::date) < v_week
  ) p;

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
      'isFinal', v_final),
    'weekSales', v_week_sales,
    'previousPending', v_prev_pending);
end;
$$;
revoke all on function public.seller_weekly_liquidation(date, uuid) from public, anon;
grant execute on function public.seller_weekly_liquidation(date, uuid) to authenticated;
