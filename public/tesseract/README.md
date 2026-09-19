# Activos de Tesseract.js autohospedados

Estos archivos existen para que la extracción OCR sea **100% local**: por
defecto, Tesseract.js descarga el script del worker, el núcleo WASM y los
datos de idioma desde `cdn.jsdelivr.net` la primera vez que corre. Aquí se
sirven desde esta misma app (`/tesseract/...`), sin ninguna llamada a un CDN
de terceros en tiempo de ejecución. Ver `src/lib/sales/extraction/ocr-worker.ts`.

Generados así (Tesseract.js 7.0.0 / tesseract.js-core 7.0.0), sin volver a
descargar nada si `node_modules` ya está instalado:

```sh
cp node_modules/tesseract.js/dist/worker.min.js public/tesseract/worker.min.js
cp node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js            public/tesseract/core/
cp node_modules/tesseract.js-core/tesseract-core-lstm.wasm               public/tesseract/core/
cp node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js       public/tesseract/core/
cp node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm          public/tesseract/core/
cp node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js public/tesseract/core/
cp node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm    public/tesseract/core/
```

Solo se copian las variantes `-lstm` (motor LSTM, el que usa esta app —
`oem` por defecto de Tesseract.js) en sus 3 sabores de SIMD (`relaxedsimd` /
`simd` / sin SIMD): `getCore.js` detecta en tiempo de ejecución cuál soporta
el navegador y pide ese archivo por nombre exacto, así que los 3 deben estar
presentes.

Los `.traineddata` (datos de idioma) NO vienen en npm — se descargaron una
vez desde el paquete público `@tesseract.js-data` (mismo proyecto de
Tesseract.js, solo datos de idioma, sin servicio de por medio) y quedan
committeados aquí:

```sh
curl -o public/tesseract/lang-data/eng.traineddata.gz \
  https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz
curl -o public/tesseract/lang-data/spa.traineddata.gz \
  https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz
```

La variante `4.0.0_best_int` es la que corresponde a `lstmOnly: true`
(el valor por defecto de Tesseract.js) — ver `worker-script/index.js`.

**Si se actualiza la versión de `tesseract.js`/`tesseract.js-core`**: repetir
este proceso con los archivos de la nueva versión (los nombres de archivo no
cambian entre versiones menores).
