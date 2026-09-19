# Pruebas E2E

Verificación de extremo a extremo, en un **navegador real** (Playwright +
Chromium) — la parte que no puede probarse desde Node (WASM, Canvas, Web
Workers reales, cookies de sesión, redirecciones del servidor).

## Cómo correrlas

```sh
npx playwright install chromium   # una sola vez
npm run test:e2e
```

Arranca (o reutiliza, si ya está corriendo) `next dev` en el puerto 3000.

## Qué prueban

- **`ocr-extraction.spec.ts`** — contra `/dev/ocr-fixtures`. Genera, dentro
  del propio navegador, un PDF417 real (ZXing-C++/WASM, vía el botón
  "Generar fixture sintética") y verifica que:
  - el decodificador PRIMARIO (ZXing-C++/WASM) decodifica correctamente,
  - **ninguna** petición sale a un CDN externo (ni para el WASM del
    decodificador ni para los activos de Tesseract — todo autohospedado),
  - sin reverso, el OCR del frente (Tesseract, 100% local) puebla los campos
    y el resultado NUNCA es "error" con el formulario vacío,
  - el carné cubano (MRZ sintético + OCR del frente) puebla nombre completo y
    NI.
- **`new-sale-form.spec.ts`** — el formulario REAL de "Nueva venta" (no solo
  el arnés de depuración): siembra un vendedor de prueba
  (`e2e-seller@motods.test`, vía `supabase/scripts/create-user.mjs`), inicia
  sesión, sube las mismas imágenes sintéticas a través del flujo real de
  recorte (`ImageEditorModal`) y comprueba que los campos de **React Hook
  Form** —tanto del comprador como del destinatario en Cuba— se
  autocompletan de verdad, y que `deliveryAddress`/`municipality` NUNCA se
  tocan desde el documento.
- **`seller-management.spec.ts`** — invitación/activación/suspensión de
  vendedores, contra el shell real de `/admin`: el modal "Invitar vendedor"
  (con su validación), la navegación "Vendedores" del shell de admin, y el
  caso crítico de seguridad: un admin SUSPENDE a un vendedor real por la UI
  → el vendedor NO puede iniciar sesión (mensaje "cuenta no habilitada") NI
  navegar directamente a `/seller` aunque su sesión de Supabase siga siendo
  válida (bloqueo SERVER-SIDE, no un botón deshabilitado) → REACTIVAR le
  devuelve el acceso. Siembra `e2e-sm-admin@motods.test` /
  `e2e-sm-seller@motods.test` vía `supabase/scripts/create-user.mjs`.

- **`smile-app.spec.ts`** — identidad SMILE MOTORS y acceso único: `/login`
  con el logo oficial real (se verifica que carga, que es el archivo
  `/brand/smile-motors-logo.png` y que se muestra cuadrado, sin estirar),
  error de credenciales amigable, `/register` y `/forgot-password` → login,
  vendedor → `/seller` (y `/admin` vedado), admin → `/admin` con rol visible
  (y la política explícita `ADMIN_CAN_ACCESS_SELLER`), vendedor SUSPENDIDO
  bloqueado aunque su sesión siga viva, búsqueda global Ctrl+K, drawer móvil
  del admin y ausencia de overflow horizontal a 375/768/1440 px en las
  pantallas de admin y vendedor. Siembra `e2e-smile-admin@motods.test` /
  `e2e-smile-seller@motods.test`.
- **`no-vin-stock.spec.ts`** — sin VIN ni stock físico: ficha de producto sin
  cantidades, fichas de venta Admin/Vendedor con seguimiento, logística y
  comisión, y ausencia de VIN/stock en navegación, alertas, reportes,
  actividad y búsqueda. Crea y elimina su propia venta VENDIDA.
- **`commission-test-fixtures.spec.ts`** — precio fijo de venta + comisión
  fija con los VALORES DE PRUEBA TEMPORALES: el panel muestra ambos valores
  de los productos de prueba; el simulador de la ficha y las fichas de venta
  (congelada y estimada) muestran el desglose completo; el admin los valida y
  guarda desde la ficha (vacío, $0, formato inválido o comisión >= precio dan
  un error claro); una venta con un producto sin configurar queda bloqueada
  hasta que se configura; el formulario de venta completa el precio fijo, no
  deja bajar de él, recalcula la comisión al instante y avisa (con enlace a
  la ficha) si el producto no está configurado; el vendedor no accede a la
  ficha del producto. Al final comprueba que no queda ningún producto ni
  valor de prueba y que los productos reales siguen idénticos.

## Valores de comisión de prueba

`supabase/scripts/fixtures/commission-test-products.mjs` define el ejemplo
obligatorio (precio fijo $4,500 · comisión fija $500) y 8 niveles de prueba
(precio fijo $3,500–$5,999 y comisión fija ≈ 10 %: $3,500/$350 ·
$3,799/$400 · $3,999/$400 · $4,299/$450 · $4,599/$450 · $4,899/$500 ·
$5,299/$550 · $5,999/$600). Son SOLO para pruebas: cada prueba los aplica a
sus propios productos "E2E …" (con la misma RPC que usa el panel) y los
borra al terminar; el único helper que escribe directo en `products` se
niega a tocar un producto que no sea "E2E …". No hay migración ni seed que
cargue precios fijos o comisiones fijas: en una instalación real o limpia
los productos quedan sin configurar hasta que un administrador los completa
en `/admin/productos/[id]`, y mientras tanto sus ventas no pueden enviarse
ni pasar a VENDIDA y aparece la alerta "Comisión faltante".

> Integración de base de datos del control administrativo de ventas (no es
> Playwright): `npm run test:admin-sales -- --admin e2e-smile-admin@motods.test
> --seller e2e-smile-seller@motods.test --password <contraseña>` — casos 1-10
> de la tarea + regresión de los flujos del vendedor; crea y elimina sus
> propios datos. Con los mismos argumentos:
> `npm run test:commissions -- …` (precio fijo + comisión fija: $4,500/$500
> vendido en $4,500/$4,700/$5,000, redondeo al centavo, bloqueo por debajo
> del precio fijo o sin configuración, comisiones históricas intactas,
> permisos vendedor/admin, desglose y verificación de que no queda nada
> cargado ni se tocó ningún producto real) y
> `node --env-file=.env.local supabase/scripts/test-no-vin-stock.mjs …`
> (ventas sin VIN ni stock físico).
>
> En equipos donde una política de control de aplicaciones bloquea el binario
> nativo de SWC, Turbopack no arranca: `playwright.config.ts` usa
> `next dev --webpack` y el build de producción se ejecuta con
> `npx next build --webpack`.

## Sintéticas vs. fotos reales

- **`ocr-extraction.spec.ts` / `new-sale-form.spec.ts`** — sintéticas (un
  PDF417 real generado con `zxing-wasm/writer`, texto renderizado en un
  `<canvas>`). Prueban que el MECANISMO funciona de extremo a extremo con
  datos verificables (los valores esperados están declarados en
  `src/lib/sales/extraction/dev-fixture-generator.ts` y se comparan contra lo
  que el decodificador/OCR realmente devuelve) — corren siempre, sin
  depender de archivos externos.
- **`real-fixtures.spec.ts`** — las 4 fotos REALES de la tarea (compresión,
  iluminación, perspectiva de verdad). Se ejecuta automáticamente SOLO si
  existen en `supabase/dev-fixtures/` con estos nombres exactos:
  `us-license-front-real.jpg`, `us-license-back-real.jpg`,
  `cuba-id-front-real.jpg`, `cuba-id-back-real.jpg` — si no están, esas
  pruebas se SALTAN (no fallan) para no romper `npm run test:e2e` en una
  máquina sin esas fotos. No hay ningún valor esperado codificado — solo se
  verifica que el pipeline real produzca autocompletado útil, y la consola
  nunca imprime los valores extraídos (solo si cada campo quedó "poblado" o
  "vacío").

## Notas

- `zxing-wasm`'s escritor (`zxing_writer.wasm`, en `public/zxing/`) es
  SOLO para generar estas fixtures sintéticas — la app en sí nunca lo
  importa ni lo usa (solo lee códigos, nunca los genera).
- Cada corrida de `new-sale-form.spec.ts` crea una venta CUBA en estado
  DRAFT bajo el vendedor de prueba (nunca llega a SOLD/PAID, no afecta datos
  reales ni RLS de otros vendedores). No se borran automáticamente entre
  corridas — si se acumulan muchas, se pueden limpiar a mano con el
  `service_role` filtrando por `seller_id` del usuario de prueba.
