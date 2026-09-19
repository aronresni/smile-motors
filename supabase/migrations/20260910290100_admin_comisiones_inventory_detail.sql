-- Extiende `admin_inventory_detail` (creada en 20260910270000) para incluir
-- la configuración de comisión de la unidad — necesaria para la nueva
-- sección "CONFIGURACIÓN DE COMISIÓN" en /admin/inventario/[id]. Único
-- cambio: 2 claves nuevas en el objeto `unit`; el resto de la función es
-- idéntico a la versión vigente.
create or replace function public.admin_inventory_detail(p_inventory_unit_id uuid)
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
  if not exists (select 1 from public.inventory_units where id = p_inventory_unit_id) then
    return jsonb_build_object('ok', false, 'code', 'UNIT_NOT_FOUND');
  end if;

  select jsonb_build_object(
    'ok', true,
    'unit', (
      select jsonb_build_object(
        'id', iu.id, 'vin', iu.vin, 'status', iu.status, 'legacyStatus', iu.legacy_status, 'note', iu.note,
        'createdAt', iu.created_at, 'updatedAt', iu.updated_at,
        'productId', iu.product_id, 'productName', p.name, 'productLegacyId', p.legacy_id,
        'stockMode', p.stock_mode,
        'variantId', iu.variant_id, 'variantName', pv.color_name,
        'referencePriceCents', iu.reference_price_cents, 'baseCommissionCents', iu.base_commission_cents
      )
      from public.inventory_units iu
      join public.products p on p.id = iu.product_id
      left join public.product_variants pv on pv.id = iu.variant_id
      where iu.id = p_inventory_unit_id
    ),
    'saleUnit', (
      select jsonb_build_object(
        'saleUnitId', su.id, 'saleId', su.sale_id, 'saleNumber', s.sale_number,
        'saleStatus', s.status, 'trackingCode', su.tracking_code
      )
      from public.sale_units su
      join public.sales s on s.id = su.sale_id
      where su.inventory_unit_id = p_inventory_unit_id
    ),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'eventType', e.event_type,
        'actorName', (select pr.full_name from public.profiles pr where pr.id = e.actor_id),
        'fromStatus', e.from_status, 'toStatus', e.to_status,
        'saleId', e.sale_id, 'reason', e.reason, 'changes', e.changes,
        'createdAt', e.created_at
      ) order by e.created_at desc)
      from public.inventory_unit_events e
      where e.inventory_unit_id = p_inventory_unit_id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_inventory_detail(uuid) from public, anon;
grant execute on function public.admin_inventory_detail(uuid) to authenticated;
