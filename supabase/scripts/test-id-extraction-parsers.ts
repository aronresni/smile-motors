/**
 * TEMP — pruebas unitarias LOCALES de los parsers puros de extracción de
 * documentos (AAMVA, MRZ-like cubano, OCR de respaldo US/CU, fechas).
 *
 * IMPORTANTE: todos los payloads de aquí son SINTÉTICOS e INVENTADOS — NO
 * son los datos de las fotos reales adjuntadas a la tarea. Esto prueba que
 * el CÓDIGO de parseo es correcto (funciona con cualquier documento válido),
 * no que "reconoce" una imagen concreta. No hay ninguna comparación por hash
 * de imagen ni valores fijos de un cliente real en ninguna parte del pipeline.
 *
 * Estas funciones son puras (sin `canvas`/`Image`/`window`), así que corren
 * en Node sin navegador. El resto del pipeline (rasterizado, ZXing, Tesseract)
 * SÍ requiere navegador — para esa parte ver `dev/ocr-fixtures` (página de
 * desarrollo) con las 4 fotos reales.
 *
 *   npm run test:ocr-parsers
 */
import { parseAamva } from "@/lib/sales/extraction/aamva";
import { parseUsLicenseText } from "@/lib/sales/extraction/buyer-ocr-parse";
import { parseCubanIdentityText } from "@/lib/sales/extraction/cuban-id-parse";
import { parseCubanMrzText } from "@/lib/sales/extraction/cuban-mrz";
import {
  normalizeAamvaDate,
  normalizeLooseDate,
  normalizeMrzYyMmDd,
} from "@/lib/sales/extraction/date-normalize";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}  ${extra != null ? JSON.stringify(extra) : ""}`);
  }
}

// =============================================================== AAMVA ====
console.log("AAMVA (payload sintético, formato real del subfile DL)");
{
  const payload = [
    "@",
    "ANSI 636054090002DL00410278ZN02290032DL",
    "DAQZ99887766",
    "DCSMORALES",
    "DACPATRICIA",
    "DADANN",
    "DBB03121985",
    "DBA08272031",
    "DAG742 ELM ST",
    "DAICOLUMBUS",
    "DAJNE",
    "DAK68601-1234",
  ].join("\n");

  const result = parseAamva(payload);
  check("parseAamva reconoce el payload (ANSI + campos)", result !== null, result);
  check("DAC+DAD -> firstName 'Patricia Ann' (DAD no duplicado)", result?.data.firstName === "Patricia Ann", result?.data.firstName);
  check("DCS -> lastName 'Morales'", result?.data.lastName === "Morales", result?.data.lastName);
  check("DAQ -> documentNumber sin espacios", result?.data.documentNumber === "Z99887766", result?.data.documentNumber);
  check("DBB (MMDDCCYY) -> dateOfBirth 1985-03-12", result?.data.dateOfBirth === "1985-03-12", result?.data.dateOfBirth);
  check("DBA (MMDDCCYY) -> expirationDate 2031-08-27", result?.data.expirationDate === "2031-08-27", result?.data.expirationDate);
  check("DAG -> addressLine1", result?.data.addressLine1 === "742 Elm St", result?.data.addressLine1);
  check("DAI -> city", result?.data.city === "Columbus", result?.data.city);
  check("DAJ -> state = NE", result?.data.state === "NE", result?.data.state);
  check("DAK -> postalCode recorta a 5 dígitos", result?.data.postalCode === "68601", result?.data.postalCode);
  check("fieldSources todos 'pdf417'", Object.values(result?.fieldSources ?? {}).every((s) => s === "pdf417"), result?.fieldSources);

  // DAD ya incluido en DAC: no debe duplicarse.
  const noDupPayload = payload.replace("DACPATRICIA\nDADANN", "DACPATRICIA ANN\nDADANN");
  const noDup = parseAamva(noDupPayload);
  check("DAD ya contenido en DAC no se duplica", noDup?.data.firstName === "Patricia Ann", noDup?.data.firstName);

  // Payload inválido (sin marcador ANSI/@): se rechaza, no se inventa nada.
  const invalid = parseAamva("random text with no aamva markers at all");
  check("payload sin marcador AAMVA -> null (no inventa datos)", invalid === null, invalid);

  const empty = parseAamva("");
  check("payload vacío -> null", empty === null, empty);
}

// ======================================================= AAMVA date edge ==
console.log("\nFechas AAMVA (8 dígitos)");
{
  check("MMDDCCYY válido", normalizeAamvaDate("08272030") === "2030-08-27", normalizeAamvaDate("08272030"));
  check("longitud inválida -> ''", normalizeAamvaDate("123") === "", normalizeAamvaDate("123"));
  check("fecha imposible -> ''", normalizeAamvaDate("13322030") === "", normalizeAamvaDate("13322030"));
}

// =========================================== fechas sueltas por país ======
console.log("\nnormalizeLooseDate — MM/DD vs DD/MM según el país (bug corregido)");
{
  // "03/04/2020": en EE. UU. es 4 de marzo; en Cuba es 3 de abril. Mismo
  // string de entrada, resultado distinto según el documento — antes del
  // arreglo, Cuba usaba la misma convención que EE. UU. por error.
  check("US: 03/04/2020 -> 2020-03-04 (4 de marzo)", normalizeLooseDate("03/04/2020", "US") === "2020-03-04", normalizeLooseDate("03/04/2020", "US"));
  check("CU: 03/04/2020 -> 2020-04-03 (3 de abril)", normalizeLooseDate("03/04/2020", "CU") === "2020-04-03", normalizeLooseDate("03/04/2020", "CU"));
  // Día > 12: solo puede ser día, sin importar el país.
  check("US: 25/03/1990 -> 1990-03-25 (25 no puede ser mes)", normalizeLooseDate("25/03/1990", "US") === "1990-03-25", normalizeLooseDate("25/03/1990", "US"));
  check("CU: 25/03/1990 -> 1990-03-25", normalizeLooseDate("25/03/1990", "CU") === "1990-03-25", normalizeLooseDate("25/03/1990", "CU"));
  check("ISO YYYY-MM-DD pasa directo", normalizeLooseDate("2030-08-27") === "2030-08-27", normalizeLooseDate("2030-08-27"));
  check("fecha inválida -> ''", normalizeLooseDate("02/30/2020", "US") === "", normalizeLooseDate("02/30/2020", "US"));
}

console.log("\nnormalizeMrzYyMmDd — YYMMDD con inferencia de siglo");
{
  const ref = new Date(Date.UTC(2026, 8, 10)); // fecha de referencia estable para el test
  check("881104 -> 1988-11-04 (siglo pasado)", normalizeMrzYyMmDd("881104", ref) === "1988-11-04", normalizeMrzYyMmDd("881104", ref));
  check("321222 -> 2032-12-22 (siglo actual)", normalizeMrzYyMmDd("321222", ref) === "2032-12-22", normalizeMrzYyMmDd("321222", ref));
  check("longitud inválida -> ''", normalizeMrzYyMmDd("123") === "", normalizeMrzYyMmDd("123"));
}

// ============================================== MRZ-like cubano (reverso) =
console.log("\nparseCubanMrzText — zona legible por máquina (payload sintético)");
{
  // Estructura observada (cada línea ~30 caracteres, como en el carné real):
  //   I<CUBA + doc + dígito de control + NI(11) + relleno
  //   YYMMDD + sexo + YYMMDD + relleno
  //   APELLIDO(S)<<NOMBRE(S) + relleno
  const lines = [
    "I<CUBAFX112233699010512345<<<<", // doc "FX112233" + check "6" + NI "99010512345"
    "650320F301115<<<<<<<<<<<<<<<<<", // DOB 650320 + sexo F + venc 301115
    "PEREZ<SUAREZ<<YANELIS<<<<<<<<<", // apellidos << nombres
  ];
  const parsed = parseCubanMrzText(lines.join("\n"));
  check("identityNumber = 11 dígitos consecutivos", parsed.data.identityNumber === "99010512345", parsed.data.identityNumber);
  check("dateOfBirth 650320 -> 1965-03-20", parsed.data.dateOfBirth === "1965-03-20", parsed.data.dateOfBirth);
  check("sex = F", parsed.data.sex === "F", parsed.data.sex);
  check("expirationDate 301115 -> 2030-11-15", parsed.data.expirationDate === "2030-11-15", parsed.data.expirationDate);
  check("fullName reconstruido 'Yanelis Perez Suarez'", parsed.data.fullName === "Yanelis Perez Suarez", parsed.data.fullName);
  check("nunca copia el hash/checksum como si fuera nombre", !parsed.data.fullName?.match(/\d/), parsed.data.fullName);

  // Reconstrucción de línea cuando el OCR fusiona todo en un solo string.
  const flat = lines.join("").toLowerCase(); // sin saltos de línea, minúsculas (peor caso de OCR)
  const parsedFlat = parseCubanMrzText(flat);
  check("reconstrucción funciona incluso sin saltos de línea (fallback por chunks)", parsedFlat.data.identityNumber === "99010512345", parsedFlat.data.identityNumber);

  const garbage = parseCubanMrzText("texto sin relación alguna con un documento");
  check("texto no-MRZ -> sin campos inventados", Object.keys(garbage.data).length === 0, garbage.data);
}

// ============================================ OCR de respaldo — licencia US
console.log("\nparseUsLicenseText — OCR de respaldo (payload sintético)");
{
  const text = [
    "NEBRASKA",
    "DRIVER'S LICENSE",
    "4d DL Z9988776",
    "DOB 03/12/1985",
    "EXP 08/27/2031",
    "742 ELM ST",
    "COLUMBUS NE 68601",
  ].join("\n");
  const parsed = parseUsLicenseText(text, 0.8);
  check("dateOfBirth (US) 03/12/1985 -> 1985-03-12", parsed.data.dateOfBirth === "1985-03-12", parsed.data.dateOfBirth);
  check("expirationDate (US) 08/27/2031 -> 2031-08-27", parsed.data.expirationDate === "2031-08-27", parsed.data.expirationDate);
  check("city/state/zip por línea con patrón 'CITY ST ZIP'", parsed.data.city === "Columbus" && parsed.data.state === "NE" && parsed.data.postalCode === "68601", parsed.data);
  check("addressLine1 tomado de la línea anterior a city/state/zip", parsed.data.addressLine1 === "742 Elm St", parsed.data.addressLine1);
  check("sin etiqueta LN/FN ni líneas numeradas -> no inventa nombre (evita 'Nebraska'/'Driver's License')", parsed.data.lastName === undefined && parsed.data.firstName === undefined, parsed.data);
}

console.log("\nparseUsLicenseText — nombre por campos numerados AAMVA (sin etiqueta LN/FN explícita)");
{
  // Layout genérico (no exclusivo de un estado): "1 <apellido>" / "2 <nombre(s)>".
  const text = [
    "FLORIDA",
    "DRIVER LICENSE",
    "1 MORALES",
    "2 PATRICIA ANN",
    "3 DOB 03/12/1985",
    "4b EXP 08/27/2031",
    "4d DL Z9988776",
  ].join("\n");
  const parsed = parseUsLicenseText(text, 0.8);
  check("apellido desde línea '1 <valor>'", parsed.data.lastName === "Morales", parsed.data.lastName);
  check("nombre desde línea '2 <valor>' (multi-palabra intacto)", parsed.data.firstName === "Patricia Ann", parsed.data.firstName);
}

console.log("\nparseUsLicenseText — nombre, último recurso (líneas simples, confianza baja)");
{
  // Sin etiquetas ni números — dos líneas de solo letras cerca del encabezado.
  const text = ["FLORIDA", "DRIVER LICENSE", "GOMEZ", "YANELIS", "4d DL Z9988776"].join("\n");
  const parsed = parseUsLicenseText(text, 0.8);
  check("último recurso: primera línea plausible = apellido", parsed.data.lastName === "Gomez", parsed.data.lastName);
  check("último recurso: segunda línea plausible = nombre", parsed.data.firstName === "Yanelis", parsed.data.firstName);
  check("confianza del último recurso es baja (<= 0.3*base)", (parsed.fieldConfidence.lastName ?? 1) <= 0.8 * 0.3 + 1e-9, parsed.fieldConfidence.lastName);
}

// ======================================== OCR de respaldo — carné cubano ==
console.log("\nparseCubanIdentityText — OCR etiquetado (payload sintético, frente)");
{
  const text = [
    "REPÚBLICA DE CUBA",
    "CARNÉ DE IDENTIDAD",
    "NI: 99010512345",
    "NOMBRE / FIRST NAME",
    "YANELIS",
    "APELLIDOS / LAST NAME",
    "PEREZ SUAREZ",
    "SEXO F",
    "FECHA DE VENCIMIENTO 15/11/2030",
    "REGISTRO CIVIL",
    "HOLGUIN",
  ].join("\n");
  const parsed = parseCubanIdentityText(text, 0.8);
  check("identityNumber etiquetado (NI:)", parsed.data.identityNumber === "99010512345", parsed.data.identityNumber);
  check("fullName = nombres + apellidos", parsed.data.fullName === "Yanelis Perez Suarez", parsed.data.fullName);
  check("sex etiquetado", parsed.data.sex === "F", parsed.data.sex);
  check("expirationDate (CU, DD/MM/YYYY) 15/11/2030 -> 2030-11-15", parsed.data.expirationDate === "2030-11-15", parsed.data.expirationDate);
  check("registryProvince etiquetado", parsed.data.registryProvince === "Holguin", parsed.data.registryProvince);
  check("NO propone deliveryAddress/dirección de entrega (campo operativo aparte)", !("deliveryAddress" in parsed.data), parsed.data);
}

console.log(`\n=== ${pass} OK / ${fail} FALLOS ===`);
process.exit(fail === 0 ? 0 : 1);
