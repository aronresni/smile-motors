-- Corrige `admin_payment_provider_list`: el filtro "Pago directo" del
-- listado admin usa el valor "DIRECT", que no es un `method_type` real
-- (los reales son CARD/ZELLE/FINANCING/INTERNAL) — se traduce explícitamente
-- a CARD/ZELLE/INTERNAL en vez de compararse literalmente.
create or replace function public.admin_payment_provider_list(
  p_search   text default null,
  p_type     text default 'ALL',
  p_status   text default 'ALL',
  p_contract text default 'ALL'
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_type   text := coalesce(nullif(upper(btrim(p_type)), ''), 'ALL');
  v_status text := coalesce(nullif(upper(btrim(p_status)), ''), 'ALL');
  v_contract text := coalesce(nullif(upper(btrim(p_contract)), ''), 'ALL');
  v_result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  with base as (
    select m.*
    from public.payment_methods m
    where (
        v_type = 'ALL'
        or (v_type = 'FINANCING' and m.method_type = 'FINANCING')
        or (v_type = 'DIRECT' and m.method_type in ('CARD', 'ZELLE', 'INTERNAL'))
        or m.method_type = v_type
      )
      and (v_status = 'ALL' or (v_status = 'ACTIVE' and m.is_active) or (v_status = 'INACTIVE' and not m.is_active))
      and (v_contract = 'ALL' or (v_contract = 'REQUIRED' and m.requires_signed_contract) or (v_contract = 'NOT_REQUIRED' and not m.requires_signed_contract))
      and (
        v_search is null
        or m.name ilike '%' || v_search || '%'
        or m.legacy_id ilike '%' || v_search || '%'
        or coalesce(m.subtext, '') ilike '%' || v_search || '%'
      )
  )
  select jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'providerId', b.id,
        'legacyId', b.legacy_id,
        'name', b.name,
        'methodType', b.method_type,
        'isActive', b.is_active,
        'feeStrategy', b.fee_strategy,
        'flatFeeBps', b.flat_fee_bps,
        'flatFeeCents', b.flat_fee_cents,
        'requiresSignedContract', b.requires_signed_contract,
        'onlyFlorida', b.only_florida,
        'planCount', (select count(*) from public.payment_method_plans p where p.payment_method_id = b.id and p.is_active),
        'salesUsingCount', (select count(*) from public.sale_payment_allocations a where a.payment_method_id = b.id)
      ) order by b.position, b.name)
      from base b
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_payment_provider_list(text, text, text, text) from public, anon;
grant execute on function public.admin_payment_provider_list(text, text, text, text) to authenticated;
