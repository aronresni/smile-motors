import "server-only";

/** Utilidades de exportación CSV — encabezados legibles, dinero en decimal
 * (la base sigue en centavos enteros), fechas consistentes. Sin dependencia
 * externa: un CSV es texto plano, no justifica una librería. */
export function centsToDecimal(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toFixed(2);
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(","));
  }
  // BOM UTF-8 para que Excel abra tildes/ñ correctamente.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function csvFileName(reportSlug: string, start: string | null, end: string | null): string {
  const range = start && end ? `${start}-a-${end}` : "todos";
  return `reporte-${reportSlug}-${range}.csv`;
}

export function csvResponse(filename: string, csv: string): Response {
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
