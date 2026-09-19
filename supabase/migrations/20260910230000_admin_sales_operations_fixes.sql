-- ===========================================================================
-- Ajustes menores sobre 20260910220000:
--
--   1. `admin_sales_list` con estado "Todos" no debía incluir DRAFT — un
--      borrador todavía en edición por el vendedor no es una "venta" desde
--      la perspectiva de administración (el propio filtro de UI solo ofrece
--      Pendiente/Vendida/Pagada, nunca Borrador).
--   2. `seller_sales_list` calculaba `amountOutstandingCents` a partir de la
--      FOTO guardada (`sales.amount_outstanding_cents`, que solo se
--      actualiza cuando un admin revisa el cierre) — el vendedor podía ver
--      "pendiente a cobrar" desactualizado aunque el cobro ya estuviera
--      completo en vivo. Ahora se calcula EN VIVO (mismo patrón que
--      `get_cuba_sale_draft`/`admin_sales_list`) y se agrega
--      `collectionStatus` (PENDING_COLLECTION | READY_TO_PAY | PAID | null)
--      para que la lista del vendedor pueda mostrar "Cobro completo" de
--      verdad, no solo "pendiente a cobrar" / "en revisión".
-- ===========================================================================

create or replace function public.admin_sales_list(
  p_search            text default null,
  p_start_date        date default null,
  p_end_date          date default null,
  p_sale_status       text default 'ALL',
  p_collection_status text default 'ALL',
  p_seller_id         uuid default null,
  p_financing_status  text default 'ALL',
  p_limit             int  default 20,
  p_offset            int  default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_search      text := nullif(btrim(coalesce(p_search, '')), '');
  v_sale_status text := coalesce(nullif(upper(btrim(p_sale_status)), ''), 'ALL');
  v_collection  text := coalesce(nullif(upper(btrim(p_collection_status)), ''), 'ALL');
  v_financing   text := coalesce(nullif(upper(btrim(p_financing_status)), ''), 'ALL');
  v_limit       int  := greatest(1, least(coalesce(p_limit, 20), 100));
  v_offset      int  := greatest(0, coalesce(p_offset, 0));
  v_result      jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  with base as (
    select
      s.id, s.sale_number, s.status, s.operation_type, s.sale_date, s.created_at,
      s.seller_id, s.sold_at, s.paid_at, s.review_requested_at, s.sale_total_cents,
      s.settlement_status, s.closing_reviewed_at,
      coalesce(s.sale_date, s.created_at::date) as effective_date,
      (select p.full_name from public.profiles p where p.id = s.seller_id) as seller_name
    from public.sales s
    where s.operation_type = 'CUBA'
      -- "Todos" = Pendiente/Vendida/Pagada — nunca borradores (el filtro de
      -- estado en la UI ni siquiera ofrece "Borrador" como opción).
      and (case when v_sale_status = 'ALL' then s.status <> 'DRAFT' else s.status = v_sale_status end)
      and (p_seller_id is null or s.seller_id = p_seller_id)
      and (p_start_date is null or coalesce(s.sale_date, s.created_at::date) >= p_start_date)
      and (p_end_date   is null or coalesce(s.sale_date, s.created_at::date) <= p_end_date)
  ),
  settlement as (
    select
      b.id as sale_id,
      coalesce(sum(case
        when m.method_type = 'FINANCING' then
          case when c.status = 'ACCREDITED' then a.net_amount_cents else 0 end
        else
          case when a.settlement_status = 'SETTLED' then a.net_amount_cents else 0 end
      end), 0) as collected_cents,
      count(*) filter (where m.method_type = 'FINANCING') as fin_providers,
      count(*) filter (where m.method_type = 'FINANCING' and c.id is null) as fin_pending_contract,
      count(*) filter (where c.status = 'SENT') as fin_sent,
      count(*) filter (where c.status = 'SIGNED') as fin_signed,
      count(*) filter (where c.status = 'ACCREDITED') as fin_accredited
    from base b
    left join public.sale_payment_allocations a on a.sale_id = b.id
    left join public.payment_methods m on m.id = a.payment_method_id
    left join public.sale_financing_contracts c on c.payment_allocation_id = a.id
    group by b.id
  ),
  matched as (
    select
      b.*,
      coalesce(st.collected_cents, 0) as collected_cents,
      greatest(0, coalesce(b.sale_total_cents, 0) - coalesce(st.collected_cents, 0)) as outstanding_cents,
      coalesce(st.fin_providers, 0) as fin_providers,
      coalesce(st.fin_pending_contract, 0) as fin_pending_contract,
      coalesce(st.fin_sent, 0) as fin_sent,
      coalesce(st.fin_signed, 0) as fin_signed,
      coalesce(st.fin_accredited, 0) as fin_accredited,
      case
        when b.status = 'PAID' then 'PAID'
        when b.status = 'SOLD' and greatest(0, coalesce(b.sale_total_cents, 0) - coalesce(st.collected_cents, 0)) = 0 then 'READY_TO_PAY'
        when b.status = 'SOLD' then 'PENDING_COLLECTION'
        else null
      end as collection_status
    from base b
    left join settlement st on st.sale_id = b.id
    where (
      v_search is null
      or b.sale_number ilike '%' || v_search || '%'
      or coalesce(b.seller_name, '') ilike '%' || v_search || '%'
      or exists (
           select 1 from public.sale_parties sp
           where sp.sale_id = b.id and sp.party_role = 'PRIMARY_BUYER'
             and (
               coalesce(sp.first_name, '') ilike '%' || v_search || '%'
               or coalesce(sp.last_name, '') ilike '%' || v_search || '%'
               or btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, ''))
                    ilike '%' || v_search || '%'
             )
         )
      or exists (
           select 1 from public.sale_units su
           where su.sale_id = b.id
             and (
               coalesce(su.product_name_snapshot, '') ilike '%' || v_search || '%'
               or coalesce(su.tracking_code, '') ilike '%' || v_search || '%'
             )
         )
      or exists (
           select 1 from public.sale_payment_allocations al
           where al.sale_id = b.id
             and coalesce(al.provider_name_snapshot, '') ilike '%' || v_search || '%'
         )
    )
    and (
      v_collection = 'ALL'
      or (v_collection = 'PENDING_COLLECTION' and (
            select case
              when b.status = 'PAID' then 'PAID'
              when b.status = 'SOLD' and greatest(0, coalesce(b.sale_total_cents, 0) - coalesce(st.collected_cents, 0)) = 0 then 'READY_TO_PAY'
              when b.status = 'SOLD' then 'PENDING_COLLECTION'
              else null
            end
          ) = 'PENDING_COLLECTION')
      or (v_collection = 'READY_TO_PAY' and (
            select case
              when b.status = 'PAID' then 'PAID'
              when b.status = 'SOLD' and greatest(0, coalesce(b.sale_total_cents, 0) - coalesce(st.collected_cents, 0)) = 0 then 'READY_TO_PAY'
              when b.status = 'SOLD' then 'PENDING_COLLECTION'
              else null
            end
          ) = 'READY_TO_PAY')
      or (v_collection = 'PAID' and b.status = 'PAID')
    )
    and (
      v_financing = 'ALL'
      or (v_financing = 'UNSIGNED' and coalesce(st.fin_providers, 0) > 0
          and coalesce(st.fin_signed, 0) = 0 and coalesce(st.fin_accredited, 0) = 0)
      or (v_financing in ('SIGNED', 'PENDING_ACCREDITATION') and coalesce(st.fin_signed, 0) > 0)
      or (v_financing = 'ACCREDITED' and coalesce(st.fin_providers, 0) > 0
          and st.fin_accredited = st.fin_providers)
    )
  ),
  page_rows as (
    select m.*
    from matched m
    order by m.effective_date desc, m.created_at desc
    limit v_limit offset v_offset
  ),
  items as (
    select
      m.effective_date,
      m.created_at,
      jsonb_build_object(
        'saleId', m.id,
        'saleNumber', m.sale_number,
        'status', m.status,
        'operationType', m.operation_type,
        'saleDate', to_char(m.effective_date, 'YYYY-MM-DD'),
        'hasExplicitDate', (m.sale_date is not null),
        'sellerId', m.seller_id,
        'sellerName', m.seller_name,
        'soldAt', m.sold_at,
        'paidAt', m.paid_at,
        'reviewRequestedAt', m.review_requested_at,
        'settlementStatus', m.settlement_status,
        'collectionStatus', m.collection_status,
        'closingReviewedAt', m.closing_reviewed_at,
        'buyerName', (
          select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
          from public.sale_parties sp
          where sp.sale_id = m.id and sp.party_role = 'PRIMARY_BUYER'
        ),
        'unitCount', (select count(*) from public.sale_units su where su.sale_id = m.id),
        'units', coalesce((
          select jsonb_agg(
                   jsonb_build_object(
                     'productName', su.product_name_snapshot,
                     'variant', su.variant_snapshot,
                     'trackingCode', su.tracking_code)
                   order by su.position)
          from (
            select su2.* from public.sale_units su2
            where su2.sale_id = m.id order by su2.position limit 6
          ) su
        ), '[]'::jsonb),
        'saleTotalCents', coalesce(
          m.sale_total_cents,
          (select coalesce(sum(su.agreed_price_cents), 0) from public.sale_units su where su.sale_id = m.id)
        ),
        'collectedCents', m.collected_cents,
        'outstandingCents', m.outstanding_cents,
        'financing', jsonb_build_object(
          'providers', m.fin_providers,
          'pendingContract', m.fin_pending_contract,
          'sent', m.fin_sent,
          'signed', m.fin_signed,
          'accredited', m.fin_accredited
        ),
        'financingProviders', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'providerName', c.provider_name_snapshot,
                   'status', c.status)
                   order by c.sent_at)
          from public.sale_financing_contracts c
          where c.sale_id = m.id
        ), '[]'::jsonb)
      ) as item
    from page_rows m
  )
  select jsonb_build_object(
    'ok', true,
    'items', coalesce((select jsonb_agg(item order by effective_date desc, created_at desc) from items), '[]'::jsonb),
    'page', (v_offset / v_limit)::int + 1,
    'pageSize', v_limit,
    'totalCount', (select count(*) from matched)
  )
  into v_result;

  return v_result;
end;
$$;

-- ===========================================================================
-- seller_sales_list — `amountOutstandingCents`/`collectionStatus` EN VIVO
-- (antes usaban la foto guardada, que puede estar desactualizada).
-- ===========================================================================
create or replace function public.seller_sales_list(
  p_search          text default null,
  p_start_date      date default null,
  p_end_date        date default null,
  p_status          text default 'ALL',
  p_operation_type  text default 'ALL',
  p_financing_status text default 'ALL',
  p_settlement      text default 'ALL',
  p_limit           int  default 20,
  p_offset          int  default 0
)
returns jsonb
language sql
security invoker
set search_path = public
stable
as $$
  with args as (
    select
      nullif(btrim(coalesce(p_search, '')), '')            as search,
      coalesce(nullif(upper(btrim(p_status)), ''), 'ALL')  as status,
      coalesce(nullif(upper(btrim(p_operation_type)), ''), 'ALL') as operation_type,
      coalesce(nullif(upper(btrim(p_financing_status)), ''), 'ALL') as financing_status,
      coalesce(nullif(upper(btrim(p_settlement)), ''), 'ALL') as settlement,
      greatest(1, least(coalesce(p_limit, 20), 100))       as page_size,
      greatest(0, coalesce(p_offset, 0))                   as row_offset
  ),
  base as (
    select
      s.id, s.sale_number, s.status, s.operation_type, s.sale_date, s.created_at,
      s.sold_at, s.paid_at, s.review_requested_at, s.sale_total_cents,
      s.settlement_status, s.closing_reviewed_at,
      coalesce(s.sale_date, s.created_at::date) as effective_date
    from public.sales s, args a
    where s.seller_id = auth.uid()
      and (a.status = 'ALL' or s.status = a.status)
      and (a.operation_type = 'ALL' or s.operation_type = a.operation_type)
      and (a.settlement = 'ALL' or coalesce(s.settlement_status, '') = a.settlement)
      and (p_start_date is null or coalesce(s.sale_date, s.created_at::date) >= p_start_date)
      and (p_end_date   is null or coalesce(s.sale_date, s.created_at::date) <= p_end_date)
  ),
  fin as (
    select
      b.id as sale_id,
      count(*) filter (where m.method_type = 'FINANCING')                as providers,
      count(*) filter (where m.method_type = 'FINANCING' and c.id is null) as pending_contract,
      count(*) filter (where c.status = 'SENT')                          as sent,
      count(*) filter (where c.status = 'SIGNED')                        as signed,
      count(*) filter (where c.status = 'ACCREDITED')                    as accredited,
      coalesce(sum(case
        when m.method_type = 'FINANCING' then
          case when c.status = 'ACCREDITED' then a.net_amount_cents else 0 end
        else
          case when a.settlement_status = 'SETTLED' then a.net_amount_cents else 0 end
      end), 0) as collected_cents
    from base b
    left join public.sale_payment_allocations a on a.sale_id = b.id
    left join public.payment_methods m on m.id = a.payment_method_id
    left join public.sale_financing_contracts c on c.payment_allocation_id = a.id
    group by b.id
  ),
  matched as (
    select b.*, coalesce(f.providers, 0) as fin_providers,
           coalesce(f.pending_contract, 0) as fin_pending, coalesce(f.sent, 0) as fin_sent,
           coalesce(f.signed, 0) as fin_signed, coalesce(f.accredited, 0) as fin_accredited,
           coalesce(f.collected_cents, 0) as collected_cents,
           greatest(0, coalesce(b.sale_total_cents, 0) - coalesce(f.collected_cents, 0)) as outstanding_cents,
           case
             when b.status = 'PAID' then 'PAID'
             when b.status = 'SOLD' and greatest(0, coalesce(b.sale_total_cents, 0) - coalesce(f.collected_cents, 0)) = 0 then 'READY_TO_PAY'
             when b.status = 'SOLD' then 'PENDING_COLLECTION'
             else null
           end as collection_status
    from base b
    left join fin f on f.sale_id = b.id, args a
    where (
      a.search is null
      or b.sale_number ilike '%' || a.search || '%'
      or exists (
           select 1 from public.sale_parties sp
           where sp.sale_id = b.id
             and sp.party_role = 'PRIMARY_BUYER'
             and (
               coalesce(sp.first_name, '') ilike '%' || a.search || '%'
               or coalesce(sp.last_name, '') ilike '%' || a.search || '%'
               or btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, ''))
                    ilike '%' || a.search || '%'
             )
         )
      or exists (
           select 1 from public.sale_units su
           where su.sale_id = b.id
             and (
               coalesce(su.product_name_snapshot, '') ilike '%' || a.search || '%'
               or coalesce(su.tracking_code, '') ilike '%' || a.search || '%'
             )
         )
      or exists (
           select 1 from public.sale_payment_allocations al
           where al.sale_id = b.id
             and coalesce(al.provider_name_snapshot, '') ilike '%' || a.search || '%'
         )
    )
    and (
      a.financing_status = 'ALL'
      or (a.financing_status = 'NONE' and coalesce(f.providers, 0) = 0)
      or (a.financing_status = 'PENDING_CONTRACT' and coalesce(f.pending_contract, 0) > 0)
      or (a.financing_status = 'SENT' and coalesce(f.sent, 0) > 0)
      or (a.financing_status = 'SIGNED' and coalesce(f.signed, 0) > 0)
      or (a.financing_status = 'ACCREDITED' and coalesce(f.accredited, 0) > 0)
    )
  ),
  page_rows as (
    select m.*
    from matched m, args a
    order by m.effective_date desc, m.created_at desc
    limit  (select page_size from args)
    offset (select row_offset from args)
  ),
  items as (
    select
      m.effective_date,
      m.created_at,
      jsonb_build_object(
        'saleId',          m.id,
        'saleNumber',      m.sale_number,
        'status',          m.status,
        'operationType',   m.operation_type,
        'saleDate',        to_char(m.effective_date, 'YYYY-MM-DD'),
        'hasExplicitDate', (m.sale_date is not null),
        'soldAt',          m.sold_at,
        'paidAt',          m.paid_at,
        'reviewRequestedAt', m.review_requested_at,
        'settlementStatus', m.settlement_status,
        'collectionStatus', m.collection_status,
        'closingReviewedAt', m.closing_reviewed_at,
        'amountOutstandingCents', m.outstanding_cents,
        'buyerName', (
          select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
          from public.sale_parties sp
          where sp.sale_id = m.id and sp.party_role = 'PRIMARY_BUYER'
        ),
        'unitCount', (select count(*) from public.sale_units su where su.sale_id = m.id),
        'units', coalesce((
          select jsonb_agg(
                   jsonb_build_object(
                     'productName',  su.product_name_snapshot,
                     'variant',      su.variant_snapshot,
                     'trackingCode', su.tracking_code)
                   order by su.position)
          from (
            select su2.*
            from public.sale_units su2
            where su2.sale_id = m.id
            order by su2.position
            limit 6
          ) su
        ), '[]'::jsonb),
        'saleTotalCents', coalesce(
          m.sale_total_cents,
          (select coalesce(sum(su.agreed_price_cents), 0)
             from public.sale_units su where su.sale_id = m.id)
          + (select coalesce(sum(greatest(1, se.quantity) * greatest(0, se.unit_price_cents)), 0)
             from public.sale_extras se where se.sale_id = m.id)
        ),
        'financing', jsonb_build_object(
          'providers', m.fin_providers,
          'pendingContract', m.fin_pending,
          'sent', m.fin_sent,
          'signed', m.fin_signed,
          'accredited', m.fin_accredited
        )
      ) as item
    from page_rows m
  )
  select jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(item order by effective_date desc, created_at desc) from items),
      '[]'::jsonb),
    'page', (
      (select row_offset from args) / (select page_size from args)
    )::int + 1,
    'pageSize', (select page_size from args),
    'totalCount', (select count(*) from matched),
    'summary', jsonb_build_object(
      'operations',   (select count(*) from matched),
      'draftCount',   (select count(*) from matched where status = 'DRAFT'),
      'pendingCount', (select count(*) from matched where status = 'PENDING'),
      'soldCount',    (select count(*) from matched where status = 'SOLD'),
      'paidCount',    (select count(*) from matched where status = 'PAID'),
      'volumeCents',
        coalesce((select sum(sale_total_cents) from matched where status in ('SOLD', 'PAID')), 0),
      'unitsSold', (
        select count(*)
        from public.sale_units su
        join matched mm on mm.id = su.sale_id and mm.status in ('SOLD', 'PAID')
      )
    )
  );
$$;
