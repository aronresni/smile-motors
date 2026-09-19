import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminProductDetail } from "@/lib/admin/products";
import { formatCents } from "@/lib/money";
import { ROUTES } from "@/lib/constants";
import { EditProductModal } from "@/components/admin/products/product-form";
import { ProductActiveToggle } from "@/components/admin/products/product-active-toggle";
import { DuplicateProductButton } from "@/components/admin/products/duplicate-product-button";
import { VariantManager } from "@/components/admin/products/variant-manager";
import { ImageManager } from "@/components/admin/products/image-manager";
import { ProductCommissionDefaults } from "@/components/admin/products/product-commission-defaults";

export const metadata: Metadata = { title: "Producto · Admin" };
export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, string> = {
  PRODUCT_CREATED: "Producto creado",
  PRODUCT_UPDATED: "Producto actualizado",
  PRODUCT_ACTIVATED: "Producto activado",
  PRODUCT_DEACTIVATED: "Producto desactivado",
  PRODUCT_DUPLICATED: "Producto duplicado desde otro",
  PRICE_CHANGED: "Precio modificado",
  VARIANT_CREATED: "Variante creada",
  VARIANT_UPDATED: "Variante actualizada",
  VARIANT_ACTIVATED: "Variante activada",
  VARIANT_DEACTIVATED: "Variante desactivada",
  IMAGE_ADDED: "Imagen agregada",
  IMAGE_REMOVED: "Imagen quitada",
  PRIMARY_IMAGE_CHANGED: "Imagen principal cambiada",
  COMMISSION_DEFAULTS_UPDATED: "Precio fijo / comisión fija actualizados",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short" }).format(d);
}
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium" }).format(d);
}
function centsOrDash(v: string | number | null): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number.parseInt(v, 10) : v;
  return Number.isFinite(n) ? formatCents(n) : "—";
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-4 border-border bg-surface">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{value || "—"}</p>
    </div>
  );
}

export default async function AdminProductoDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const detail = await getAdminProductDetail(productId);
  if (!detail) notFound();

  const { product, variants, images, salesUsingCount, priceHistory, recentEvents } = detail;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link href={ROUTES.adminProductos} className="text-xs text-muted-foreground hover:text-foreground">
          ← Productos
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{product.name}</h1>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
              product.is_active
                ? "border-success/30 bg-success/10 text-success"
                : "border-border bg-surface-muted text-muted-foreground"
            }`}
          >
            {product.is_active ? "Activo" : "Inactivo"}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {product.brand || "Sin marca"} · {product.category || "Sin categoría"}
          {product.legacy_id ? ` · ID legado: ${product.legacy_id}` : ""}
        </p>
      </div>

      <Section title="General" action={<EditProductModal product={product} />}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Fact label="Cilindrada" value={product.displacement ?? "—"} />
          <Fact label="Potencia" value={product.power ?? "—"} />
          <Fact label="Motor" value={product.engine ?? "—"} />
          <Fact label="Peso" value={product.weight ?? "—"} />
          <Fact label="Estado legado" value={product.status ?? "—"} />
          <Fact label="Ventas que lo usan" value={String(salesUsingCount)} />
        </div>
      </Section>

      <Section title="Precios">
        <div className="grid grid-cols-3 gap-3">
          <Fact label="Precio base" value={centsOrDash(product.base_price_cents)} />
          <Fact label="Total Cuba" value={centsOrDash(product.cuba_total_cents)} />
          <Fact label="Envío" value={centsOrDash(product.shipping_cents)} />
        </div>
        {product.legacy_commission_cents != null && (
          <div className="mt-3 border-t pt-3 border-border">
            <p className="text-[11px] text-muted-foreground">Comisión histórica/importada</p>
            <p className="mt-0.5 text-sm font-medium text-muted-foreground">{formatCents(product.legacy_commission_cents)}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Referencia del sistema anterior — no es el motor de comisiones autoritativo.
            </p>
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          Esto aplica a ventas NUEVAS. Las ventas ya registradas conservan el precio vigente al momento de
          agregarse, aunque este precio cambie después.
        </p>
      </Section>

      <Section title="Disponibilidad">
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-secondary">
            {product.is_active
              ? "Disponible para ventas nuevas."
              : "No seleccionable en ventas nuevas. Las ventas históricas que ya lo usan se muestran sin cambios."}
          </p>
          <ProductActiveToggle productId={product.id} productName={product.name} isActive={product.is_active} />
        </div>
        <div className="mt-3 border-t pt-3 border-border">
          <DuplicateProductButton productId={product.id} productName={product.name} />
        </div>
      </Section>

      <Section title="Precio fijo y comisión">
        <ProductCommissionDefaults
          productId={product.id}
          defaultReferencePriceCents={product.default_reference_price_cents}
          defaultBaseCommissionCents={product.default_base_commission_cents}
        />
      </Section>

      <Section title="Variantes">
        <VariantManager productId={product.id} variants={variants} />
      </Section>

      <Section title="Imágenes">
        <ImageManager productId={product.id} images={images} />
      </Section>

      {priceHistory.length > 0 && (
        <Section title="Historial de precio">
          <ul className="space-y-2">
            {priceHistory.map((h, i) => (
              <li key={i} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{formatDate(h.changedAt)}{h.actorName ? ` · ${h.actorName}` : ""}</span>
                <span className="tabular-nums text-foreground">
                  {centsOrDash(h.cubaTotalCents ?? h.basePriceCents)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Historial de catálogo">
        {recentEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin cambios registrados todavía.</p>
        ) : (
          <ul className="space-y-2">
            {recentEvents.map((e, i) => (
              <li key={i} className="flex items-start justify-between gap-2 text-xs">
                <span>
                  <span className="font-medium text-text-secondary">
                    {EVENT_LABEL[e.eventType] ?? e.eventType}
                  </span>
                  {e.variantLabel && <span className="text-muted-foreground"> · {e.variantLabel}</span>}
                  {e.actorName && <span className="text-muted-foreground"> · {e.actorName}</span>}
                </span>
                <span className="shrink-0 text-muted-foreground">{formatDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
