/**
 * Persistencia de sesión ("Mantener sesión iniciada").
 *
 * No inventa almacenamiento de tokens propio: las cookies de sesión las sigue
 * gestionando `@supabase/ssr`. Lo único que hacemos es, cuando el usuario NO
 * marca la casilla, quitar `maxAge`/`expires` de esas cookies para que sean
 * cookies de sesión del navegador (se borran al cerrarlo).
 */
export const PERSIST_COOKIE = "motods-persist";

/** Valor de PERSIST_COOKIE que significa "no persistir". */
export const PERSIST_OFF = "0";

export function withSessionPersistence<T extends object | undefined>(
  options: T,
  persistent: boolean,
): T {
  if (persistent || !options) return options;
  const next: Record<string, unknown> = { ...(options as object) };
  delete next.maxAge;
  delete next.expires;
  return next as T;
}
