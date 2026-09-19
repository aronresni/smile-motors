import Link from "next/link";
import { cn } from "@/lib/utils";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/seller/icons";
import {
  buildSalesListHref,
  type SellerSalesListQuery,
} from "@/lib/seller/sales-list-params";

interface Props {
  basePath: string;
  query: SellerSalesListQuery;
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  shownCount: number;
}

/** Paginación servidor: enlaces reales que preservan búsqueda + filtros. */
export function SalesListPagination({
  basePath,
  query,
  page,
  totalPages,
  totalCount,
  pageSize,
  shownCount,
}: Props) {
  if (totalCount === 0) return null;

  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  const firstOnPage = (page - 1) * pageSize + 1;
  const lastOnPage = (page - 1) * pageSize + shownCount;

  const linkClass =
    "inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors";

  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <p className="text-xs tabular-nums text-muted-foreground">
        {firstOnPage}–{lastOnPage} de {totalCount}
      </p>

      <div className="flex items-center gap-2">
        {hasPrev ? (
          <Link
            href={buildSalesListHref(basePath, { ...query, page: page - 1 })}
            prefetch={false}
            scroll={false}
            className={cn(
              linkClass,
              "text-text-secondary hover:text-foreground",
            )}
          >
            <ChevronLeftIcon size={14} />
            Anterior
          </Link>
        ) : (
          <span
            className={cn(linkClass, "cursor-not-allowed text-muted-foreground/50")}
            aria-disabled
          >
            <ChevronLeftIcon size={14} />
            Anterior
          </span>
        )}

        <span className="text-xs tabular-nums text-muted-foreground">
          {page} / {totalPages}
        </span>

        {hasNext ? (
          <Link
            href={buildSalesListHref(basePath, { ...query, page: page + 1 })}
            prefetch={false}
            scroll={false}
            className={cn(
              linkClass,
              "text-text-secondary hover:text-foreground",
            )}
          >
            Siguiente
            <ChevronRightIcon size={14} />
          </Link>
        ) : (
          <span
            className={cn(linkClass, "cursor-not-allowed text-muted-foreground/50")}
            aria-disabled
          >
            Siguiente
            <ChevronRightIcon size={14} />
          </span>
        )}
      </div>
    </div>
  );
}
