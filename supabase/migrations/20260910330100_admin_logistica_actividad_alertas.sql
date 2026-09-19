-- ===========================================================================
-- LOGÍSTICA — integración en Actividad (categoría LOGISTICA) y Alertas
-- (3 condiciones derivadas nuevas). Ningún cambio a la lógica de logística
-- en sí (ver 20260910330000); solo se extienden las 3 RPC de agregación ya
-- existentes con el mismo patrón UNION ALL usado en todo lo demás.
--
-- Deliberadamente excluido del feed: el evento 'CREATED' de
-- sale_unit_logistics_events (mecánico, uno por unidad, ya implícito en el
-- evento "marcó SOLD" de VENTAS — mismo criterio ya aplicado a
-- COMMISSION_CALCULATED). Solo se muestran acciones reales del admin:
-- TRANSITIONED, ON_HOLD, CORRECTED.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Helper privado — única fuente de la etiqueta en español de cada estado
--    logístico, reusada en Actividad (nunca repetida por rama).
-- ---------------------------------------------------------------------------
create or replace function public._logistics_status_label(p_status text)
returns text
language sql
immutable
as $$
  select case p_status
    when 'PENDING_PREPARATION' then 'PENDIENTE DE PREPARAR'
    when 'READY' then 'LISTA'
    when 'DISPATCHED' then 'DESPACHADA'
    when 'IN_TRANSIT' then 'EN TRÁNSITO'
    when 'IN_CUBA' then 'EN CUBA'
    when 'READY_FOR_DELIVERY' then 'LISTA PARA ENTREGA'
    when 'DELIVERED' then 'ENTREGADA'
    when 'ON_HOLD' then 'EN ESPERA'
    else coalesce(p_status, '')
  end;
$$;
revoke all on function public._logistics_status_label(text) from public, anon;

-- ---------------------------------------------------------------------------
-- 2. admin_alerts_summary — +1 categoría (LOGISTICA).
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
  v_log_preparar int;
  v_log_espera   int;
  v_log_entrega  int;
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

  select count(*) into v_log_preparar
    from public.sale_unit_logistics l join public.sale_units su on su.id = l.sale_unit_id join public.sales s on s.id = su.sale_id
    where l.status = 'PENDING_PREPARATION' and s.operation_type = 'CUBA' and s.status in ('SOLD', 'PAID');
  select count(*) into v_log_espera from public.sale_unit_logistics where status = 'ON_HOLD';
  select count(*) into v_log_entrega from public.sale_unit_logistics where status = 'READY_FOR_DELIVERY';

  return jsonb_build_object(
    'ok', true,
    'total', v_ediciones + v_contratos + v_cobros + v_pagos + v_inventario + v_comisiones
             + v_liquid_crear + v_liquid_aprobar + v_liquid_pagar + v_vendedores
             + v_log_preparar + v_log_espera + v_log_entrega,
    'categories', jsonb_build_object(
      'APROBACIONES', v_ediciones,
      'CONTRATOS', v_contratos,
      'COBROS', v_cobros,
      'PAGOS', v_pagos,
      'INVENTARIO', v_inventario,
      'COMISIONES', v_comisiones,
      'LIQUIDACIONES', v_liquid_crear + v_liquid_aprobar + v_liquid_pagar,
      'VENDEDORES', v_vendedores,
      'LOGISTICA', v_log_preparar + v_log_espera + v_log_entrega
    ),
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
-- 3. admin_alerts_list — +3 condiciones LOGISTICA.
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

    -- COBROS · pendiente a cobrar
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

    union all

    -- LOGISTICA · vendida/pagada pero sin empezar a preparar
    select
      'LOGISTICA', 'LOGISTICA_PENDIENTE_PREPARAR', 'MEDIUM',
      l.last_event_at,
      'PENDIENTE DE PREPARAR',
      coalesce(s.sale_number, 'sin número') || ' · ' || su.product_name_snapshot,
      s.seller_id, pr.full_name,
      'sale_unit'::text, su.id, s.id,
      null::bigint,
      '/admin/ventas/' || s.id::text, 'VER VENTA'
    from public.sale_unit_logistics l
    join public.sale_units su on su.id = l.sale_unit_id
    join public.sales s on s.id = su.sale_id
    join public.profiles pr on pr.id = s.seller_id
    where l.status = 'PENDING_PREPARATION' and s.operation_type = 'CUBA' and s.status in ('SOLD', 'PAID')

    union all

    -- LOGISTICA · en espera (motivo obligatorio ya validado al entrar aquí)
    select
      'LOGISTICA', 'LOGISTICA_EN_ESPERA', 'HIGH',
      l.last_event_at,
      'EN ESPERA',
      coalesce(s.sale_number, 'sin número') || ' · ' || su.product_name_snapshot || ' · ' || coalesce(l.hold_reason, 'sin motivo'),
      s.seller_id, pr.full_name,
      'sale_unit'::text, su.id, s.id,
      null::bigint,
      '/admin/ventas/' || s.id::text, 'VER VENTA'
    from public.sale_unit_logistics l
    join public.sale_units su on su.id = l.sale_unit_id
    join public.sales s on s.id = su.sale_id
    join public.profiles pr on pr.id = s.seller_id
    where l.status = 'ON_HOLD'

    union all

    -- LOGISTICA · lista para entrega
    select
      'LOGISTICA', 'LOGISTICA_LISTA_ENTREGA', 'MEDIUM',
      l.last_event_at,
      'LISTA PARA ENTREGA',
      coalesce(s.sale_number, 'sin número') || ' · ' || su.product_name_snapshot,
      s.seller_id, pr.full_name,
      'sale_unit'::text, su.id, s.id,
      null::bigint,
      '/admin/ventas/' || s.id::text, 'CONFIRMAR ENTREGA'
    from public.sale_unit_logistics l
    join public.sale_units su on su.id = l.sale_unit_id
    join public.sales s on s.id = su.sale_id
    join public.profiles pr on pr.id = s.seller_id
    where l.status = 'READY_FOR_DELIVERY'
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
-- 4. admin_activity_feed — +1 rama LOGISTICA (solo TRANSITIONED/ON_HOLD/
--    CORRECTED — CREATED excluido, ver comentario superior). Mismo orden
--    determinista (occurred_at desc, category, entity_id, event_type) ya
--    endurecido en la tarea de Reportes.
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

    union all

    -- LOGISTICA (solo acciones reales del admin — ver comentario superior)
    select
      'LOGISTICA', e.event_type, e.occurred_at,
      e.actor_id, pr.full_name, pr.role,
      'sale_unit_logistics', su.id, su.sale_id, s.seller_id,
      case e.event_type
        when 'TRANSITIONED' then 'Marcó ' || coalesce(s.sale_number, 'sin número') || ' / ' || su.product_name_snapshot
          || ' como ' || public._logistics_status_label(e.to_status)
        when 'ON_HOLD' then 'Puso en espera ' || coalesce(s.sale_number, 'sin número') || ' / ' || su.product_name_snapshot
        when 'CORRECTED' then 'Corrigió el estado logístico de ' || coalesce(s.sale_number, 'sin número') || ' / ' || su.product_name_snapshot
          || ' a ' || public._logistics_status_label(e.to_status)
        else 'Actualizó la logística de ' || coalesce(s.sale_number, 'sin número')
      end,
      e.note, jsonb_build_object('fromStatus', e.from_status, 'toStatus', e.to_status),
      '/admin/ventas/' || su.sale_id::text,
      coalesce(s.sale_number, '') || ' ' || su.product_name_snapshot || ' ' || coalesce(su.tracking_code, '')
    from public.sale_unit_logistics_events e
    join public.sale_units su on su.id = e.sale_unit_id
    join public.sales s on s.id = su.sale_id
    left join public.profiles pr on pr.id = e.actor_id
    where e.event_type in ('TRANSITIONED', 'ON_HOLD', 'CORRECTED')
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
