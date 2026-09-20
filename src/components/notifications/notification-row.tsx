"use client";

import { cn } from "@/lib/utils";
import { fullNotificationTime, relativeNotificationTime } from "@/lib/notifications/format";
import type { NotificationItem } from "@/lib/notifications/types";

/**
 * Una notificación (campana y página completa). No leída: punto amarillo y
 * título en blanco; leída: tono apagado. Nunca toda la tarjeta en amarillo.
 */
export function NotificationRow({
  item,
  onOpen,
  compact = false,
}: {
  item: NotificationItem;
  onOpen: (item: NotificationItem) => void;
  compact?: boolean;
}) {
  const unread = !item.readAt;
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      data-testid="notification-row"
      data-unread={unread ? "true" : "false"}
      className={cn(
        "flex w-full items-start gap-3 text-left transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none",
        compact ? "px-4 py-3" : "rounded-xl border border-border px-4 py-3.5",
        !compact && unread && "border-border-strong bg-surface-elevated",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
          unread ? "bg-brand" : "bg-transparent",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span
            className={cn(
              "truncate text-sm",
              unread ? "font-semibold text-foreground" : "font-medium text-text-secondary",
            )}
          >
            {item.title}
            {unread && <span className="sr-only"> (sin leer)</span>}
          </span>
          <time
            dateTime={item.createdAt}
            title={fullNotificationTime(item.createdAt)}
            suppressHydrationWarning
            className="shrink-0 text-[11px] text-muted-foreground"
          >
            {relativeNotificationTime(item.createdAt)}
          </time>
        </span>
        <span
          className={cn(
            "mt-0.5 block text-xs leading-relaxed",
            compact && "line-clamp-2",
            unread ? "text-text-secondary" : "text-muted-foreground",
          )}
        >
          {item.message}
        </span>
      </span>
    </button>
  );
}
