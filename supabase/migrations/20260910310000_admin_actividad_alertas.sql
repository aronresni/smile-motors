-- ===========================================================================
-- ADMIN · ACTIVIDAD + ALERTAS — proyecciones server-side sobre lo que ya
-- existe. NO se crea ninguna tabla genérica de auditoría ni se copian
-- eventos: ambos módulos son UNION/derivación en vivo sobre las 9 tablas de
-- eventos por dominio y los registros autoritativos ya existentes
-- (sales, sale_financing_contracts, weekly_liquidations, sale_commissions,
-- inventory_units, products, seller_invitations).
--
-- ACTIVIDAD: feed cronológico. Cada rama del UNION proyecta la MISMA forma
-- (category, eventType, occurredAt, actor*, entity*, saleId, sellerId,
-- title, description, metadata, destinationUrl, searchText) directamente
-- desde su tabla de origen — nunca se materializa ni se duplica.
--
-- ALERTAS: condiciones DERIVADAS del estado actual (nunca filas persistidas
-- que haya que "resolver" a mano) — reutiliza tal cual `admin_sold_sales_
-- settlement()` y `admin_actionable_financing_contracts()` (ya existentes,
-- ya revocadas de authenticated, pensadas para componerse) y agrega 3
-- helpers internos nuevos con el mismo patrón para las condiciones que no
-- tenían una función reusable: inventario, configuración de comisión
-- faltante, y liquidaciones pendientes.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Índices — ninguna de las 9 tablas de eventos tenía un índice para
--    barrer TODO el concesionario ordenado por fecha (todas estaban
--    indexadas solo por su FK de entidad, ver inspección previa). Se agregan
--    solo donde realmente faltan.
-- ---------------------------------------------------------------------------
create index if not exists sale_status_history_created_idx on public.sale_status_history (created_at desc);
create index if not exists financing_contract_events_created_idx on public.financing_contract_events (created_at desc);
create index if not exists commission_events_created_idx on public.commission_events (created_at desc);
create index if not exists weekly_liquidation_events_created_idx on public.weekly_liquidation_events (created_at desc);
create index if not exists product_catalog_events_created_idx on public.product_catalog_events (created_at desc);
create index if not exists inventory_unit_events_created_idx on public.inventory_unit_events (created_at desc);
create index if not exists seller_account_events_created_idx on public.seller_account_events (created_at desc);
create index if not exists sale_edit_requests_created_idx on public.sale_edit_requests (created_at desc);
create index if not exists sale_payment_allocations_settled_idx on public.sale_payment_allocations (settled_at desc) where settlement_status = 'SETTLED';

-- ---------------------------------------------------------------------------
-- 1. _dealer_day_start_at — generaliza `_liquidation_week_open_at` (mismo
--    cálculo: medianoche de una fecha, en la zona horaria del concesionario)
--    para reusarlo también en el filtro de período de Actividad. Única
--    fuente de verdad de "fecha calendario del concesionario -> instante".
-- ---------------------------------------------------------------------------
create or replace function public._dealer_day_start_at(p_date date)
returns timestamptz
language sql
stable
as $$
  select (p_date::timestamp) at time zone public._dealer_timezone();
$$;
revoke all on function public._dealer_day_start_at(date) from public, anon;

create or replace function public._liquidation_week_open_at(p_week_start date)
returns timestamptz
language sql
stable
as $$
  select public._dealer_day_start_at(p_week_start);
$$;
revoke all on function public._liquidation_week_open_at(date) from public, anon;

-- ---------------------------------------------------------------------------
-- 2. _inventory_reconciliation_rows — misma consulta que ya tenía
--    `admin_inventory_reconciliation` (Inventario), extraída para poder
--    componerla también en Alertas sin reimplementarla. El RPC existente se
--    reescribe para llamarla (mismo contrato público, sin cambios para el
--    frontend ya existente).
-- ---------------------------------------------------------------------------
create or replace function public._inventory_reconciliation_rows()
returns table (
  product_id uuid, product_name text, reported_quantity bigint, vin_count bigint, difference bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id, p.name, reported.total, vin.total, vin.total - reported.total
  from public.products p
  join lateral (
    select coalesce(sum(quantity_reported), 0) as total
    from public.product_variants where product_id = p.id
  ) reported on true
  join lateral (
    select count(*) as total from public.inventory_units where product_id = p.id
  ) vin on true
  where reported.total <> vin.total;
$$;
revoke all on function public._inventory_reconciliation_rows() from public, anon, authenticated;

create or replace function public.admin_inventory_reconciliation()
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
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'productId', r.product_id, 'productName', r.product_name,
        'reportedQuantity', r.reported_quantity, 'vinCount', r.vin_count, 'difference', r.difference
      ) order by abs(r.difference) desc)
      from public._inventory_reconciliation_rows() r
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_inventory_reconciliation() from public, anon;
grant execute on function public.admin_inventory_reconciliation() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. _commission_config_missing_rows — unidades STOCKED actualmente
--    vendibles (AVAILABLE/RESERVED — nunca SOLD/UNAVAILABLE, para no avisar
--    sobre stock ya resuelto o inactivo) y productos ON_DEMAND ACTIVOS sin
--    configuración de comisión. Nunca productos inactivos/legacy sin uso.
-- ---------------------------------------------------------------------------
create or replace function public._commission_config_missing_rows()
returns table (
  kind text, entity_id uuid, entity_label text, product_id uuid, product_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select 'INVENTORY_UNIT'::text, iu.id, coalesce(iu.vin, 'sin VIN'), p.id, p.name
  from public.inventory_units iu
  join public.products p on p.id = iu.product_id
  where iu.status in ('AVAILABLE', 'RESERVED')
    and (p.stock_mode is distinct from 'on_demand')
    and (iu.reference_price_cents is null or iu.base_commission_cents is null)

  union all

  select 'PRODUCT'::text, p.id, p.name, p.id, p.name
  from public.products p
  where p.stock_mode = 'on_demand'
    and p.is_active
    and (p.default_reference_price_cents is null or p.default_base_commission_cents is null);
$$;
revoke all on function public._commission_config_missing_rows() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. _liquidation_alert_rows — para cada (vendedor, semana YA CERRADA) con
--    al menos una comisión ELIGIBLE: sin liquidación creada, en DRAFT, o
--    APPROVED sin pagar. La semana en curso NUNCA aparece (a propósito).
-- ---------------------------------------------------------------------------
create or replace function public._liquidation_alert_rows()
returns table (
  seller_id uuid, seller_name text, week_start date, week_end date,
  liquidation_id uuid, liquidation_status text, amount_cents bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with commission_weeks as (
    select
      sc.seller_id,
      public._liquidation_week_of_instant(sc.eligible_at) as week_start,
      sum(sc.final_commission_cents) as amount_cents
    from public.sale_commissions sc
    where sc.status = 'ELIGIBLE'
    group by sc.seller_id, public._liquidation_week_of_instant(sc.eligible_at)
  ),
  closed_weeks as (
    select cw.* from commission_weeks cw
    where now() >= public._liquidation_week_close_at(cw.week_start)
  )
  select
    cw.seller_id, pr.full_name, cw.week_start, cw.week_start + 6,
    wl.id, wl.status,
    coalesce(wl.total_to_pay_cents, cw.amount_cents)
  from closed_weeks cw
  join public.profiles pr on pr.id = cw.seller_id
  left join public.weekly_liquidations wl
    on wl.seller_id = cw.seller_id and wl.week_start_date = cw.week_start
  where wl.id is null or wl.status in ('DRAFT', 'APPROVED');
$$;
revoke all on function public._liquidation_alert_rows() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. admin_alerts_summary — conteos autoritativos por categoría. Incluye
--    (y lo deja explícito por separado) los mismos 4 conteos que ya expone
--    `admin_approvals_counts` — Aprobaciones sigue siendo su propio badge,
--    Alertas simplemente también los incluye en su total.
-- ---------------------------------------------------------------------------
create or replace function public.admin_alerts_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ediciones  int;
  v_contratos  int;
  v_cobros     int;
  v_pagos      int;
  v_inventario int;
  v_comisiones int;
  v_liquid_crear   int;
  v_liquid_aprobar int;
  v_liquid_pagar   int;
  v_vendedores int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select count(*) into v_ediciones  from public.sale_edit_requests where status = 'PENDING';
  select count(*) into v_contratos  from public.admin_actionable_financing_contracts();
  select count(*) into v_cobros     from public.admin_sold_sales_settlement() where outstanding_cents > 0;
  select count(*) into v_pagos      from public.admin_sold_sales_settlement() where ready_for_paid;
  select count(*) into v_inventario from public._inventory_reconciliation_rows();
  select count(*) into v_comisiones from public._commission_config_missing_rows();
  select count(*) into v_liquid_crear   from public._liquidation_alert_rows() where liquidation_id is null;
  select count(*) into v_liquid_aprobar from public._liquidation_alert_rows() where liquidation_status = 'DRAFT';
  select count(*) into v_liquid_pagar   from public._liquidation_alert_rows() where liquidation_status = 'APPROVED';
  select count(*) into v_vendedores from public.seller_invitations where status = 'PENDING';

  return jsonb_build_object(
    'ok', true,
    'total', v_ediciones + v_contratos + v_cobros + v_pagos + v_inventario + v_comisiones
             + v_liquid_crear + v_liquid_aprobar + v_liquid_pagar + v_vendedores,
    'categories', jsonb_build_object(
      'APROBACIONES', v_ediciones,
      'CONTRATOS', v_contratos,
      'COBROS', v_cobros,
      'PAGOS', v_pagos,
      'INVENTARIO', v_inventario,
      'COMISIONES', v_comisiones,
      'LIQUIDACIONES', v_liquid_crear + v_liquid_aprobar + v_liquid_pagar,
      'VENDEDORES', v_vendedores
    ),
    -- Mismos 4 conteos que admin_approvals_counts(), para dejar explícito
    -- que Alertas incluye (no duplica engañosamente) al Centro de Aprobaciones.
    'includesApprovalCenter', jsonb_build_object(
      'edicionesSolicitadas', v_ediciones,
      'contratosRequierenAccion', v_contratos,
      'pendientesACobrar', v_cobros,
      'listasParaPagar', v_pagos
    )
  );
end;
$$;
revoke all on function public.admin_alerts_summary() from public, anon;
grant execute on function public.admin_alerts_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. admin_alerts_list — bandeja unificada de condiciones derivadas.
-- ---------------------------------------------------------------------------
create or replace function public.admin_alerts_list(
  p_category text default 'ALL', p_priority text default 'ALL', p_seller_id uuid default null,
  p_limit int default 50, p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_category text := coalesce(nullif(upper(btrim(p_category)), ''), 'ALL');
  v_priority text := coalesce(nullif(upper(btrim(p_priority)), ''), 'ALL');
  v_limit    int  := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset   int  := greatest(0, coalesce(p_offset, 0));
  v_result   jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  with merged as (
    -- APROBACIONES · edición pendiente
    select
      'APROBACIONES'::text as category, 'EDICION_PENDIENTE'::text as type, 'MEDIUM'::text as priority,
      r.created_at as age_at,
      'EDICIÓN PENDIENTE'::text as title,
      'Solicitud de edición · ' || coalesce(s.sale_number, 'sin número') as detail,
      s.seller_id, pr.full_name as seller_name,
      'sale_edit_request'::text as entity_type, r.id as entity_id, s.id as sale_id,
      null::bigint as amount_cents,
      '/admin/aprobaciones/ediciones/' || r.id::text as action_url, 'REVISAR'::text as action_label
    from public.sale_edit_requests r
    join public.sales s on s.id = r.sale_id
    join public.profiles pr on pr.id = s.seller_id
    where r.status = 'PENDING'

    union all

    -- CONTRATOS · requieren acción
    select
      'CONTRATOS', 'CONTRATO_' || c.contract_status, 'MEDIUM',
      c.last_update,
      'CONTRATO · ' || c.provider_name,
      coalesce(c.sale_number, 'sin número') || ' · ' ||
        case c.contract_status
          when 'NOT_SENT' then 'sin enviar'
          when 'SENT' then 'esperando firma'
          when 'SIGNED' then 'esperando acreditación'
          else c.contract_status
        end,
      c.seller_id, c.seller_name,
      'financing_contract', coalesce(c.contract_id, c.allocation_id), c.sale_id,
      c.net_cents,
      '/admin/ventas/' || c.sale_id::text, 'VER VENTA'
    from public.admin_actionable_financing_contracts() c

    union all

    -- COBROS · pendiente a cobrar (el monto va en amountCents, aparte; el
    -- formateo de moneda se hace SIEMPRE en el frontend con formatCents,
    -- nunca como texto armado en SQL)
    select
      'COBROS', 'PENDIENTE_A_COBRAR', 'MEDIUM',
      coalesce(x.sold_at, now()),
      'PENDIENTE A COBRAR',
      coalesce(x.sale_number, 'sin número') || ' · cobro parcial',
      x.seller_id, x.seller_name,
      'sale', x.sale_id, x.sale_id,
      x.outstanding_cents,
      '/admin/ventas/' || x.sale_id::text, 'VER COBRO'
    from public.admin_sold_sales_settlement() x
    where x.outstanding_cents > 0

    union all

    -- PAGOS · lista para marcar pagada
    select
      'PAGOS', 'LISTA_PARA_PAGAR', 'HIGH',
      coalesce(x.sold_at, now()),
      'LISTA PARA MARCAR PAGADA',
      coalesce(x.sale_number, 'sin número') || ' · cobro completo',
      x.seller_id, x.seller_name,
      'sale', x.sale_id, x.sale_id,
      x.sale_total_cents,
      '/admin/ventas/' || x.sale_id::text, 'VER VENTA'
    from public.admin_sold_sales_settlement() x
    where x.ready_for_paid

    union all

    -- INVENTARIO · discrepancia de reconciliación
    select
      'INVENTARIO', 'DISCREPANCIA_INVENTARIO', 'LOW',
      now(),
      'DISCREPANCIA DE INVENTARIO',
      r.product_name || ' · reportado ' || r.reported_quantity || ' / VIN ' || r.vin_count
        || ' (dif. ' || r.difference || ')',
      null::uuid, null::text,
      'product', r.product_id, null::uuid,
      null::bigint,
      '/admin/inventario?product=' || r.product_id::text, 'VER INVENTARIO'
    from public._inventory_reconciliation_rows() r

    union all

    -- COMISIONES · configuración faltante
    select
      'COMISIONES', 'CONFIG_COMISION_FALTANTE', 'HIGH',
      now(),
      'CONFIGURACIÓN DE COMISIÓN FALTANTE',
      case cm.kind
        when 'INVENTORY_UNIT' then 'VIN ' || cm.entity_label || ' · ' || cm.product_name
        else 'Producto bajo pedido · ' || cm.product_name
      end,
      null::uuid, null::text,
      case cm.kind when 'INVENTORY_UNIT' then 'inventory_unit' else 'product' end, cm.entity_id, null::uuid,
      null::bigint,
      case cm.kind
        when 'INVENTORY_UNIT' then '/admin/inventario/' || cm.entity_id::text
        else '/admin/productos/' || cm.entity_id::text
      end,
      'VER INVENTARIO'
    from public._commission_config_missing_rows() cm

    union all

    -- LIQUIDACIONES · pendiente de crear / aprobar / pagar (nunca la semana en curso)
    select
      'LIQUIDACIONES',
      case when la.liquidation_id is null then 'LIQUIDACION_PENDIENTE_CREAR'
           when la.liquidation_status = 'DRAFT' then 'LIQUIDACION_PENDIENTE_APROBAR'
           else 'LIQUIDACION_PENDIENTE_PAGO' end,
      case when la.liquidation_id is not null and la.liquidation_status = 'APPROVED' then 'HIGH' else 'MEDIUM' end,
      public._liquidation_week_close_at(la.week_start),
      case when la.liquidation_id is null then 'LIQUIDACIÓN PENDIENTE DE CREAR'
           when la.liquidation_status = 'DRAFT' then 'LIQUIDACIÓN PENDIENTE DE APROBAR'
           else 'LIQUIDACIÓN APROBADA — PENDIENTE DE PAGO' end,
      la.seller_name || ' · semana ' || la.week_start || ' – ' || la.week_end,
      la.seller_id, la.seller_name,
      'weekly_liquidation', coalesce(la.liquidation_id, la.seller_id), null::uuid,
      la.amount_cents,
      coalesce('/admin/liquidaciones/' || la.liquidation_id::text, '/admin/liquidaciones?week=' || la.week_start::text),
      case when la.liquidation_id is null then 'CREAR LIQUIDACIÓN' else 'VER LIQUIDACIÓN' end
    from public._liquidation_alert_rows() la

    union all

    -- VENDEDORES · invitación pendiente
    select
      'VENDEDORES', 'INVITACION_PENDIENTE', 'LOW',
      i.invited_at,
      'INVITACIÓN PENDIENTE',
      i.email,
      null::uuid, null::text,
      'seller_invitation', i.id, null::uuid,
      null::bigint,
      '/admin/vendedores', 'VER VENDEDORES'
    from public.seller_invitations i
    where i.status = 'PENDING'
  ),
  filtered as (
    select * from merged m
    where (v_category = 'ALL' or m.category = v_category)
      and (v_priority = 'ALL' or m.priority = v_priority)
      and (p_seller_id is null or m.seller_id = p_seller_id)
  ),
  paged as (
    select * from filtered order by priority = 'HIGH' desc, priority = 'MEDIUM' desc, age_at desc
    limit v_limit offset v_offset
  ),
  total as (
    select count(*) as n from filtered
  )
  select jsonb_build_object(
    'ok', true,
    'total', (select n from total),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', p.category, 'type', p.type, 'priority', p.priority, 'occurredAt', p.age_at,
        'title', p.title, 'detail', p.detail,
        'sellerId', p.seller_id, 'sellerName', p.seller_name,
        'entityType', p.entity_type, 'entityId', p.entity_id, 'saleId', p.sale_id,
        'amountCents', p.amount_cents, 'actionUrl', p.action_url, 'actionLabel', p.action_label
      ) order by p.priority = 'HIGH' desc, p.priority = 'MEDIUM' desc, p.age_at desc)
      from paged p
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_alerts_list(text, text, uuid, int, int) from public, anon;
grant execute on function public.admin_alerts_list(text, text, uuid, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. admin_activity_feed — feed cronológico dealer-wide. UNION ALL en vivo,
--    nunca copia de eventos. `searchText` concatena los identificadores
--    útiles de cada rama para el filtro de búsqueda.
--
--    Deliberadamente NO se incluyen `COMMISSION_CALCULATED`/`COMMISSION_
--    ELIGIBLE` de `commission_events`: son consecuencias mecánicas, una por
--    cada unidad, del mismo instante ya representado por el evento de
--    cambio de estado de la venta (SOLD/PAID) — incluirlas duplicaría el
--    feed con ruido sin una acción nueva del admin. Sí se incluye
--    `COMMISSION_ADJUSTED_BY_APPROVED_SALE_EDIT` (una acción real y
--    distinta: recalcular por una edición aprobada).
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
    -- VENTAS · cambios de estado (se excluye el alta NULL->DRAFT: sin actor real)
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

    -- VENTAS · solicitud de edición (creada)
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

    -- VENTAS · solicitud de edición (resuelta)
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

    -- CONTRATOS
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

    -- COBROS · settlement directo (sin tabla de eventos: se deriva del estado actual)
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

    -- PRODUCTOS
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

    -- INVENTARIO
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

    -- COMISIONES · solo el recálculo por edición aprobada (ver comentario arriba)
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

    -- LIQUIDACIONES
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

    -- VENDEDORES
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
    select * from filtered order by occurred_at desc limit v_limit offset v_offset
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
      ) order by p.occurred_at desc)
      from paged p
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_activity_feed(text, uuid, uuid, date, date, text, int, int) from public, anon;
grant execute on function public.admin_activity_feed(text, uuid, uuid, date, date, text, int, int) to authenticated;
