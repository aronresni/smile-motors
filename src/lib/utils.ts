/**
 * Une clases condicionalmente. Versión mínima sin dependencias.
 * Si más adelante se necesita merge de clases Tailwind en conflicto,
 * cambiar por `clsx` + `tailwind-merge`.
 */
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(' ')
}

export function formatDate(
  value: string | number | Date,
  locale = 'es-DO',
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
  }).format(new Date(value))
}

export function formatCurrency(
  amount: number,
  currency = 'DOP',
  locale = 'es-DO',
): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    amount,
  )
}

/** Importe corto, sin decimales: 0 → "$0", 12500 → "$12,500". */
export function formatMoney(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

/** Número compacto: 0 → "0", 1500 → "1.5K", 2_000_000 → "2M". */
export function formatCompact(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

/** Porcentaje con signo: 0 → "+0.0%", -3.2 → "-3.2%". */
export function formatSignedPct(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '' : '+'
  return `${sign}${value.toFixed(1)}%`
}
