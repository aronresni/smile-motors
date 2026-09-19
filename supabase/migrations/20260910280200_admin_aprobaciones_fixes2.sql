-- Corrige `admin_contracts_inbox`: el JSON de salida no incluía
-- `allocationId`/`contractId`, que la UI necesita para las acciones
-- "Enviar" (mark_financing_sent, exige el ID de la asignación) y "Marcar
-- acreditado" (mark_financing_accredited, exige el ID del contrato).
create or replace function public.admin_contracts_inbox(
  p_status text default 'ALL', p_seller_id uuid default null, p_search text default null,
  p_limit int default 30, p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_status text := coalesce(nullif(upper(btrim(p_status)), ''), 'ALL');
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit int := greatest(1, least(coalesce(p_limit, 30), 100));
  v_offset int := greatest(0, coalesce(p_offset, 0));
  v_total int;
  v_result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  with base as (
    select * from public.admin_actionable_financing_contracts() c
    where (v_status = 'ALL' or c.contract_status = v_status)
      and (p_seller_id is null or c.seller_id = p_seller_id)
      and (v_search is null or c.sale_number ilike '%' || v_search || '%'
           or c.buyer_name ilike '%' || v_search || '%' or c.provider_name ilike '%' || v_search || '%')
  )
  select count(*) into v_total from base;

  with base as (
    select * from public.admin_actionable_financing_contracts() c
    where (v_status = 'ALL' or c.contract_status = v_status)
      and (p_seller_id is null or c.seller_id = p_seller_id)
      and (v_search is null or c.sale_number ilike '%' || v_search || '%'
           or c.buyer_name ilike '%' || v_search || '%' or c.provider_name ilike '%' || v_search || '%')
    order by c.last_update desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'ok', true, 'total', v_total,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'allocationId', b.allocation_id, 'contractId', b.contract_id,
        'saleId', b.sale_id, 'saleNumber', b.sale_number, 'sellerName', b.seller_name, 'buyerName', b.buyer_name,
        'providerName', b.provider_name, 'planLabel', b.plan_label,
        'grossCents', b.gross_cents, 'netCents', b.net_cents,
        'contractStatus', b.contract_status, 'lastUpdate', b.last_update
      ) order by b.last_update desc)
      from base b
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_contracts_inbox(text, uuid, text, int, int) from public, anon;
grant execute on function public.admin_contracts_inbox(text, uuid, text, int, int) to authenticated;
