# `zxing_reader.wasm` autohospedado

`zxing-wasm` (paquete `./reader`, decodificación únicamente) carga por
defecto su binario WASM desde `cdn.jsdelivr.net` la primera vez que se usa.
Aquí se sirve desde esta misma app para que la extracción de documentos siga
siendo 100% local — ver `src/lib/sales/extraction/pdf417-wasm.ts`
(`prepareZXingModule({ overrides: { locateFile: ... } })`).

Generado así (sin descargar nada si `node_modules` ya está instalado):

```sh
cp node_modules/zxing-wasm/dist/reader/zxing_reader.wasm public/zxing/zxing_reader.wasm
```

**Si se actualiza la versión de `zxing-wasm`**: repetir este `cp` (el nombre
de archivo no cambia entre versiones menores).

## `zxing_writer.wasm` — SOLO para las pruebas E2E, la app NUNCA lo usa

La app en producción/desarrollo solo lee códigos (`zxing_reader.wasm`,
arriba) — nunca los genera. `zxing_writer.wasm` está aquí únicamente porque
`e2e/lib/synthetic-fixtures.ts` lo usa para generar, dentro de un navegador
real, un PDF417 sintético válido con el que probar el decodificador de
extremo a extremo (sin depender de fotos reales). Ningún código de
`src/` lo importa ni lo referencia.

```sh
cp node_modules/zxing-wasm/dist/writer/zxing_writer.wasm public/zxing/zxing_writer.wasm
```
