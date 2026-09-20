import { DEALER } from "@/config/dealer";

/**
 * Horas de notificaciones en la zona horaria del concesionario
 * (`DEALER.timezone`, America/New_York): la base guarda `timestamptz`.
 */
const dayKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: DEALER.timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat("es-US", {
  timeZone: DEALER.timezone,
  hour: "numeric",
  minute: "2-digit",
});
const dateFmt = new Intl.DateTimeFormat("es-US", {
  timeZone: DEALER.timezone,
  day: "numeric",
  month: "short",
});
const fullFmt = new Intl.DateTimeFormat("es-US", {
  timeZone: DEALER.timezone,
  dateStyle: "medium",
  timeStyle: "short",
});

/** "Hace un momento", "Hace 3 min", "Hace 2 h", "Ayer, 3:45 p. m.", "12 sep". */
export function relativeNotificationTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffSec = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (diffSec < 60) return "Hace un momento";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const today = dayKey.format(now);
  const day = dayKey.format(date);
  if (day === today) return `Hace ${Math.round(diffMin / 60)} h`;
  const yesterday = dayKey.format(new Date(now.getTime() - 24 * 3600 * 1000));
  if (day === yesterday) return `Ayer, ${timeFmt.format(date)}`;
  return dateFmt.format(date);
}

/** Fecha y hora completas (título/tooltip), en la zona del concesionario. */
export function fullNotificationTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : fullFmt.format(date);
}
