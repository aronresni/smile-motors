import { DEALER } from "@/config/dealer";

/**
 * Formateo de fechas/horas para Actividad/Alertas — SIEMPRE en la zona
 * horaria del concesionario (`DEALER.timezone`), nunca la del navegador. Los
 * timestamps en la base siguen siendo `timestamptz` absolutos — esto es solo
 * presentación, nunca se reinterpreta lo guardado.
 */
export function formatDealerTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-DO", { timeStyle: "short", timeZone: DEALER.timezone }).format(d);
}

export function formatDealerDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short", timeZone: DEALER.timezone }).format(d);
}

export function formatDealerDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: DEALER.timezone }).format(d);
}

/** Antigüedad neutral ("Hace 3 horas" / "Hace 2 días") — nunca "vencido"
 * salvo que exista un plazo de negocio real (no lo hay aquí). */
export function formatAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "Hace un momento";
  if (minutes < 60) return `Hace ${minutes} minuto${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Hace ${hours} hora${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `Hace ${days} día${days === 1 ? "" : "s"}`;
}
