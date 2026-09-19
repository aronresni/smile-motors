import Link from "next/link";
import { buildActivityListHref, type ActivityListQuery, ACTIVITY_PAGE_SIZE } from "@/lib/admin/activity-list-params";

export function ActivityPagination({
  basePath,
  query,
  total,
  shownCount,
}: {
  basePath: string;
  query: ActivityListQuery;
  total: number;
  shownCount: number;
}) {
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE));
  const firstOnPage = (query.page - 1) * ACTIVITY_PAGE_SIZE + 1;
  const lastOnPage = (query.page - 1) * ACTIVITY_PAGE_SIZE + shownCount;

  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      <p className="text-xs tabular-nums text-muted-foreground">
        {firstOnPage}–{lastOnPage} de {total}
      </p>
      <div className="flex items-center gap-2">
        {query.page > 1 ? (
          <Link href={buildActivityListHref(basePath, { ...query, page: query.page - 1 })} className="rounded-md border px-3 py-1.5 text-xs font-medium border-border hover:bg-surface-elevated">
            ← Anterior
          </Link>
        ) : (
          <span className="rounded-md border border-transparent px-3 py-1.5 text-xs text-text-secondary">← Anterior</span>
        )}
        {query.page < totalPages ? (
          <Link href={buildActivityListHref(basePath, { ...query, page: query.page + 1 })} className="rounded-md border px-3 py-1.5 text-xs font-medium border-border hover:bg-surface-elevated">
            Siguiente →
          </Link>
        ) : (
          <span className="rounded-md border border-transparent px-3 py-1.5 text-xs text-text-secondary">Siguiente →</span>
        )}
      </div>
    </div>
  );
}
