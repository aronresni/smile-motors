"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  APPROVALS_TABS,
  buildApprovalsTabHref,
  parseApprovalsTab,
} from "@/lib/admin/approvals-list-params";

export function ApprovalsTabs({ counts }: { counts: Record<string, number> }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = parseApprovalsTab(Object.fromEntries(searchParams.entries()));

  return (
    <div className="flex flex-wrap gap-1.5 border-b pb-px border-border">
      {APPROVALS_TABS.map((t) => {
        const isActive = t.value === active;
        const count = counts[t.value];
        return (
          <Link
            key={t.value}
            href={buildApprovalsTabHref(pathname, t.value)}
            className={`flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "border-brand text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {Boolean(count) && (
              <span className="inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none bg-surface-elevated text-foreground">
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
