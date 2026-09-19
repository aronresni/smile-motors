# Respaldo — módulo Inventario / VIN retirado (2026-09-18)

Copia de la interfaz retirada al eliminar la gestión de VIN y de stock físico
(el proyecto no está bajo control de versiones). Extensión `.txt` para que
TypeScript/ESLint/Next no los compilen. La base de datos NO se tocó: las
tablas y funciones de inventario siguen existiendo como legado inactivo
(ver `supabase/migrations/20260918120000_remove_vin_stock.sql`).

Se puede borrar esta carpeta cuando ya no haga falta.
