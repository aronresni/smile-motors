-- ===========================================================================
-- Catálogo de productos e inventario físico (relacional, tipado).
--
-- NO se copia la arquitectura anterior (products.data jsonb). Los datos de
-- negocio viven en columnas tipadas; `metadata jsonb` solo para atributos
-- flexibles del sistema anterior.
--
-- Dinero SIEMPRE en centavos (bigint).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
create table public.products (
  id                      uuid primary key default gen_random_uuid(),
  legacy_id               text unique,
  name                    text not null,
  brand                   text,
  category                text,
  displacement            text,
  power                   text,
  engine                  text,
  weight                  text,
  status                  text,                          -- valor del sistema anterior ("En Stock")
  is_active               boolean not null default true,
  stock_mode              text,                          -- 'on_demand' | null
  base_price_cents        bigint,                        -- legado: total
  shipping_cents          bigint,                        -- legado: shipping
  cuba_total_cents        bigint,                        -- legado: totalHabana
  legacy_commission_cents bigint,                        -- legado: commission (SOLO referencia)
  legacy_timestamp        bigint,                        -- legado: timestamp
  metadata                jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on column public.products.legacy_commission_cents is
  'Comisión del sistema anterior. SOLO referencia/trazabilidad. NO es la comisión autoritativa; el motor de comisiones se diseña aparte.';
comment on column public.products.base_price_cents is 'Legado `total`. Precio base/lista.';
comment on column public.products.cuba_total_cents is 'Legado `totalHabana`. Total para operación con destino a Cuba.';

create index products_active_idx     on public.products (is_active) where is_active;
create index products_brand_idx      on public.products (lower(brand));
create index products_category_idx   on public.products (lower(category));
create index products_name_idx       on public.products (lower(name));

-- ---------------------------------------------------------------------------
-- product_variants (colores / acabados)
-- ---------------------------------------------------------------------------
create table public.product_variants (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references public.products (id) on delete cascade,
  color_name        text not null,                       -- valor de visualización, ORIGINAL del legado
  color_normalized  text not null,                       -- lower(trim(color_name)) — solo para unicidad/búsqueda
  quantity_reported integer not null default 0,          -- cantidad EXACTA del legado (no recalculada)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (product_id, color_normalized)
);

comment on column public.product_variants.color_name is
  'Etiqueta original del legado (BLACK, NEGRO, Blue, AZUL...). NO se fusionan colores traducidos.';
comment on column public.product_variants.quantity_reported is
  'Cantidad reportada por el legado. Puede NO coincidir con el número de VIN. No se reescribe automáticamente.';

create index product_variants_product_idx on public.product_variants (product_id);

-- ---------------------------------------------------------------------------
-- inventory_units (unidades físicas a nivel VIN)
-- ---------------------------------------------------------------------------
create table public.inventory_units (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products (id) on delete cascade,
  variant_id    uuid references public.product_variants (id) on delete set null,
  vin           text,
  status        text not null default 'AVAILABLE'
                check (status in ('AVAILABLE', 'SOLD', 'RESERVED', 'UNAVAILABLE')),
  legacy_status text,                                    -- 'available' | 'sold_out'
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.inventory_units is
  'Solo se crean registros para VIN NO vacíos. Los VIN en blanco del legado no se materializan como unidad física.';

create unique index inventory_units_vin_key on public.inventory_units (vin) where vin is not null;
create index inventory_units_product_idx on public.inventory_units (product_id);
create index inventory_units_variant_idx on public.inventory_units (variant_id);

-- ---------------------------------------------------------------------------
-- product_images (se preservan rutas legadas; migración de archivos aparte)
-- ---------------------------------------------------------------------------
create table public.product_images (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products (id) on delete cascade,
  legacy_path  text,
  storage_path text,                                     -- null hasta migrar el archivo real
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (product_id, legacy_path)
);

create index product_images_product_idx on public.product_images (product_id);

-- ---------------------------------------------------------------------------
-- updated_at (reutiliza public.set_updated_at del init de auth)
-- ---------------------------------------------------------------------------
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();
create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();
create trigger inventory_units_set_updated_at
  before update on public.inventory_units
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: los vendedores LEEN el catálogo activo; solo admin escribe.
-- ---------------------------------------------------------------------------
alter table public.products         enable row level security;
alter table public.product_variants enable row level security;
alter table public.inventory_units  enable row level security;
alter table public.product_images   enable row level security;

grant select on public.products, public.product_variants,
                public.inventory_units, public.product_images
  to authenticated;

-- products: leer si está activo y el usuario tiene perfil activo; admin ve todo
create policy products_read_active on public.products
  for select to authenticated
  using ((is_active and public.user_role() is not null) or public.is_admin());

create policy products_admin_write on public.products
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- variants / inventory_units / images: legibles si su producto es legible
create policy product_variants_read on public.product_variants
  for select to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_id
        and ((p.is_active and public.user_role() is not null) or public.is_admin())
    )
  );
create policy product_variants_admin_write on public.product_variants
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy inventory_units_read on public.inventory_units
  for select to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_id
        and ((p.is_active and public.user_role() is not null) or public.is_admin())
    )
  );
create policy inventory_units_admin_write on public.inventory_units
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy product_images_read on public.product_images
  for select to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_id
        and ((p.is_active and public.user_role() is not null) or public.is_admin())
    )
  );
create policy product_images_admin_write on public.product_images
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
