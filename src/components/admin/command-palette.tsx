"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { adminGlobalSearch, type GlobalSearchResult } from "@/app/(admin)/admin/search-actions";
import { ADMIN_NAV } from "@/components/admin/admin-nav";
import { ROUTES } from "@/lib/constants";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import { Spinner } from "@/components/ui/spinner";
import {
  ArrowRightIcon,
  PackageIcon,
  ReceiptIcon,
  SearchIcon,
  UserIcon,
  UserPlusIcon,
  type IconProps,
} from "@/components/ui/icons";

interface PaletteItem {
  key: string;
  group: string;
  title: string;
  subtitle?: string;
  href: string;
  Icon: (p: IconProps) => ReactNode;
  badge?: ReactNode;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Atajos reales (solo destinos implementados). */
const SHORTCUTS: PaletteItem[] = [
  ...ADMIN_NAV.flatMap((g) =>
    g.items.map((it) => ({
      key: `nav:${it.href}`,
      group: "Ir a",
      title: it.label,
      href: it.href,
      Icon: it.Icon,
    })),
  ),
  { key: "act:invite", group: "Acciones", title: "Invitar vendedor", href: `${ROUTES.adminVendedores}?nuevo=1`, Icon: UserPlusIcon },
  { key: "act:product", group: "Acciones", title: "Agregar producto", href: `${ROUTES.adminProductos}?nuevo=1`, Icon: PackageIcon },
];

function toItems(r: GlobalSearchResult): PaletteItem[] {
  return [
    ...r.sales.map((s) => ({
      key: `sale:${s.id}`,
      group: "Ventas",
      title: `${s.saleNumber ?? "Venta sin número"} · ${s.buyerName}`,
      subtitle: [s.sellerName, s.provider ? `Financiera: ${s.provider}` : s.unitsText, s.saleTotalCents != null ? formatCents(s.saleTotalCents) : null]
        .filter(Boolean)
        .join(" · "),
      href: `${ROUTES.adminVentas}/${s.id}`,
      Icon: ReceiptIcon,
      badge: <StatusBadge domain="sale" status={s.status} size="xs" />,
    })),
    ...r.sellers.map((s) => ({
      key: `seller:${s.id}`,
      group: "Vendedores",
      title: s.fullName ?? s.email ?? "Vendedor",
      subtitle: s.email ?? undefined,
      href: `${ROUTES.adminVendedores}/${s.id}`,
      Icon: UserIcon,
      badge: s.accountStatus ? <StatusBadge domain="account" status={s.accountStatus} size="xs" /> : undefined,
    })),
    ...r.products.map((p) => ({
      key: `product:${p.id}`,
      group: "Productos",
      title: p.name,
      subtitle: [p.brand, p.isActive ? null : "Inactivo"].filter(Boolean).join(" · ") || undefined,
      href: `${ROUTES.adminProductos}/${p.id}`,
      Icon: PackageIcon,
    })),
  ];
}

/**
 * Búsqueda global / comandos del Admin (Ctrl/Cmd + K). Sin dependencias: un
 * `<dialog>` nativo, búsqueda server-side con debounce y navegación completa
 * por teclado (↑ ↓ Enter, Esc cierra).
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<GlobalSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const reqId = useRef(0);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    if (!open && d.open) d.close();
  }, [open]);

  // Búsqueda server-side con debounce; descarta respuestas viejas.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const id = ++reqId.current;
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const r = await adminGlobalSearch(q);
        if (id !== reqId.current) return;
        setResult(r);
        setFailed(!r.ok);
      } catch {
        if (id === reqId.current) setFailed(true);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 220);
    return () => window.clearTimeout(t);
  }, [query]);

  const q = query.trim();
  const items = useMemo(() => {
    const nq = norm(q);
    const shortcuts = SHORTCUTS.filter((s) => !nq || norm(s.title).includes(nq));
    const found = q.length >= 2 && result ? toItems(result) : [];
    return [...found, ...shortcuts];
  }, [q, result]);

  const reset = () => {
    setQuery("");
    setResult(null);
    setActive(0);
    setFailed(false);
    setLoading(false);
    reqId.current++;
  };

  const close = () => {
    reset();
    onClose();
  };

  const go = (item: PaletteItem | undefined) => {
    if (!item) return;
    close();
    router.push(item.href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(items[active]);
    }
  };

  // Agrupa preservando el orden de `items` (el índice global sigue siendo el de navegación).
  const groups: { name: string; entries: { item: PaletteItem; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const g = groups.find((x) => x.name === item.group);
    if (g) g.entries.push({ item, index });
    else groups.push({ name: item.group, entries: [{ item, index }] });
  });

  const noResults = q.length >= 2 && !loading && result && toItems(result).length === 0;

  return (
    <dialog
      ref={ref}
      onClose={close}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-label="Búsqueda global"
      className="theme-dark fixed inset-x-0 top-0 mx-auto mt-[max(1rem,8vh)] w-[calc(100vw-1.5rem)] max-w-2xl rounded-2xl border border-border-strong bg-surface p-0 text-foreground shadow-2xl shadow-black/70 backdrop:backdrop-blur-[2px]"
    >
      {open && (
        <div className="flex max-h-[min(640px,80dvh)] flex-col">
          <div className="flex items-center gap-3 border-b border-border px-4 transition-colors focus-within:border-brand/60">
            <SearchIcon size={18} className="shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
                if (e.target.value.trim().length < 2) setResult(null);
              }}
              onKeyDown={onKeyDown}
              placeholder="Buscar venta, seguimiento, cliente, vendedor, producto o financiera…"
              aria-label="Buscar"
              aria-controls={listId}
              aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
              role="combobox"
              aria-expanded="true"
              autoComplete="off"
              spellCheck={false}
              className="h-14 w-full bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground/70"
            />
            {loading && <Spinner className="h-4 w-4 text-brand" />}
            <kbd className="hidden rounded-md border border-border-strong px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground sm:inline">
              ESC
            </kbd>
          </div>

          <div id={listId} role="listbox" aria-label="Resultados" className="overflow-y-auto overscroll-contain p-2">
            {failed && (
              <p className="px-3 py-3 text-sm text-danger">No pudimos buscar en este momento. Intenta de nuevo.</p>
            )}
            {noResults && (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                Sin coincidencias para “{q}”. Prueba con el número de venta, el código de seguimiento, el cliente o la financiera.
              </p>
            )}
            {groups.map((g) => (
              <div key={g.name} className="mb-1">
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {g.name}
                </p>
                <ul>
                  {g.entries.map(({ item, index }) => {
                    const { Icon } = item;
                    const isActive = index === active;
                    return (
                      <li
                        key={item.key}
                        id={`${listId}-${index}`}
                        role="option"
                        aria-selected={isActive}
                        onMouseMove={() => setActive(index)}
                        onClick={() => go(item)}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5",
                          isActive ? "bg-brand-soft" : "hover:bg-surface-elevated",
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-8 w-8 shrink-0 place-items-center rounded-lg border",
                            isActive ? "border-brand/40 text-brand" : "border-border text-muted-foreground",
                          )}
                        >
                          <Icon size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
                          {item.subtitle && (
                            <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
                          )}
                        </span>
                        {item.badge}
                        {isActive && <ArrowRightIcon size={15} className="shrink-0 text-brand" />}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="hidden items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground sm:flex">
            <span><kbd className="font-semibold">↑ ↓</kbd> navegar</span>
            <span><kbd className="font-semibold">Enter</kbd> abrir</span>
            <span><kbd className="font-semibold">Esc</kbd> cerrar</span>
          </div>
        </div>
      )}
    </dialog>
  );
}
