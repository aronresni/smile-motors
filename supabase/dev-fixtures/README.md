# Fixtures de identidad (solo desarrollo — NUNCA se versionan)

Esta carpeta es el lugar sugerido para guardar, en tu máquina, las fotos
reales de documentos de identidad que quieras usar para probar la extracción
local (PDF417/AAMVA en licencias de EE. UU., zona legible por máquina en
carnés cubanos).

**Todo lo que pongas aquí está en `.gitignore` (`supabase/dev-fixtures/*`) —
nunca se sube al repositorio, ni siquiera por accidente.** Si este repo
llega a ser público en algún momento, estas imágenes NUNCA deben commitearse.

## Cómo correr las pruebas contra estas imágenes

El pipeline de extracción usa `canvas`, `Image` y WebAssembly (ZXing +
Tesseract.js): necesita un navegador real, no se puede ejercitar desde Node.
Para eso existe una página de desarrollo que corre el mismo código que el
formulario real:

1. `npm run dev`
2. Abre <http://localhost:3000/dev/ocr-fixtures> (la ruta no existe en
   producción — devuelve 404 fuera de `next dev`/`npm run build` local).
3. En cada sección ("Licencia de EE. UU." / "Carné de identidad cubano"),
   elige el frente y el reverso con los selectores de archivo (puedes
   arrastrar los archivos guardados aquí, o cualquier otra imagen — la
   página no lee esta carpeta por sí sola, elegís el archivo a mano).
4. Pulsa **Extraer** y compara los campos mostrados contra la foto física.
   El panel "Debug" muestra dimensiones, intentos de PDF417 (con éxito/fallo
   de cada pase), si se detectó una región de código/MRZ, confianza OCR y el
   origen de cada campo — nada de esto se imprime en producción.

## Pruebas puras (sin navegador)

Los parsers (`AAMVA`, MRZ cubano, OCR de respaldo, normalización de fechas)
son funciones puras y SÍ corren en Node con datos sintéticos (no las fotos
reales) para probar que la lógica de parseo es correcta:

```
npm run test:ocr-parsers
```

(equivale a `node --experimental-strip-types --import ./supabase/scripts/ts-alias-loader.mjs
supabase/scripts/test-id-extraction-parsers.ts` — requiere Node 22.6+/24 por
`--experimental-strip-types`).

## Qué NO hacer

- No subir estas imágenes a ningún servicio externo (este proyecto no usa
  OCR/reconocimiento de terceros — todo es local).
- No pegar el contenido de estas fotos en logs, commits, PRs ni capturas
  compartidas.
- No construir lógica de extracción que compare contra el hash/contenido de
  una imagen concreta — las pruebas deben pasar con CUALQUIER documento
  válido, no con "esta" foto.
