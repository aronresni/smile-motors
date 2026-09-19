# MotoDS

Sistema de gestión para concesionarios (dealer management system).

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · React Hook Form · Zod · Supabase.

> Este proyecto usa Next.js 16, que renombra `middleware.ts` a `proxy.ts` y trae
> otros cambios respecto a versiones anteriores. Consulta `AGENTS.md` y los docs
> en `node_modules/next/dist/docs/` antes de tocar código de framework.

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # y rellena las claves de Supabase
npm run dev
```

Abre http://localhost:3000

## Variables de entorno

Ver `.env.example` — cada variable está documentada ahí. Resumen:

| Variable | Ámbito | Descripción |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | público | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | público | Clave anon; el acceso lo controla RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | servidor | Clave service_role; ignora RLS. Solo scripts/seeds |
| `NEXT_PUBLIC_SITE_URL` | público | URL base para redirects de auth |
| `DATABASE_URL` | servidor | (opcional) conexión directa a Postgres para migraciones |

## Estructura

```
src/
  app/
    (auth)/            login · register · forgot-password · reset-password
    (seller)/seller/   zona vendedor (layout con guard de sesión)
    (admin)/admin/     zona admin (layout con guard de sesión)
    auth/callback/      intercambio de code -> sesión
    api/health/         route handler de ejemplo
  components/           ui/ · forms/ · layout/
  config/               navegación por rol
  hooks/                useUser, ...
  lib/
    supabase/           client (browser) · server · admin (service_role) · proxy
    env.ts              validación de env con Zod (fail-fast)
    constants.ts  utils.ts
  services/             capa de acceso a datos (auth.service.ts, ...)
  validations/          esquemas Zod (auth.schema.ts, ...)
  types/                database.types.ts (generado) · auth.ts
  proxy.ts             ex-"middleware": refresh de sesión + guards de ruta
```

## Supabase CLI

```bash
npx supabase login
npx supabase link --project-ref cubjavutpooievkhxdhp
npm run db:types      # regenera src/types/database.types.ts desde el esquema
```
