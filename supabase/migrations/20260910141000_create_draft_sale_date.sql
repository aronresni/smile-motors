-- create_sale_draft: fija sale_date = fecha actual al crear el borrador.
create or replace function public.create_sale_draft(p_operation_type text default 'CUBA')
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_operation_type not in ('CUBA', 'USA', 'LOCAL') then
    raise exception 'operación inválida';
  end if;

  insert into public.sales (seller_id, operation_type, status, sale_date)
  values (auth.uid(), p_operation_type, 'DRAFT', current_date)
  returning id into v_id;

  return v_id;
end;
$$;
