import Link from "next/link";
import {
  buildAdminSalesListHref,
  type AdminSalesListQuery,
} from "@/lib/admin/sales-list-params";

export function AdminSalesListPagination({
  basePath,
  query,
  page,
  totalPages,
  totalCount,
  pageSize,
  shownCount,
}: {
  basePath: string;
  query: AdminSalesListQuery;
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  shownCount: number;
}) {
  if (totalCount === 0) return null;
  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  const firstOnPage = (page - 1) * pageSize + 1;
  const lastOnPage = (page - 1) * pageSize + shownCount;
  const linkClass = "inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium border-border";

  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <p className="text-xs tabular-nums text-muted-foreground">{firstOnPage}–{lastOnPage} de {totalCount}</p>
      <div className="flex items-center gap-2">
        {hasPrev ? (
          <Link href={buildAdminSalesListHref(basePath, { ...query, page: page - 1 })} scroll={false} className={`${linkClass} hover:bg-surface-elevated`}>
            Anterior
          </Link>
        ) : (
          <span className={`${linkClass} cursor-not-allowed text-text-secondary`} aria-disabled>Anterior</span>
        )}
        <span className="text-xs tabular-nums text-muted-foreground">{page} / {totalPages}</span>
        {hasNext ? (
          <Link href={buildAdminSalesListHref(basePath, { ...query, page: page + 1 })} scroll={false} className={`${linkClass} hover:bg-surface-elevated`}>
            Siguiente
          </Link>
        ) : (
          <span className={`${linkClass} cursor-not-allowed text-text-secondary`} aria-disabled>Siguiente</span>
        )}
      </div>
    </div>
  );
}
