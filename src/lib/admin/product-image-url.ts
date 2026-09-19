/**
 * URL pública estable de una imagen de catálogo (bucket `product-images`,
 * público, sin firma). Módulo puro (sin `server-only`) — lo usa tanto el
 * detalle de servidor como el gestor de imágenes de cliente.
 */
export function productImagePublicUrl(supabaseUrl: string, storagePath: string): string {
  return `${supabaseUrl}/storage/v1/object/public/product-images/${storagePath}`;
}
