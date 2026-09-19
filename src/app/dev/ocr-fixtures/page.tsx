import { notFound } from "next/navigation";
import { OcrFixtureHarness } from "@/app/dev/ocr-fixtures/fixture-harness";

export const metadata = { title: "OCR fixtures (dev) · MotoDS" };

/**
 * Arnés de pruebas LOCAL para la extracción de documentos (PDF417/AAMVA/MRZ
 * cubano). Solo desarrollo: no se sirve en producción. Las imágenes que el
 * desarrollador elige aquí NUNCA salen del navegador (se procesan igual que
 * en el formulario real) ni se suben a ningún sitio — ver README en
 * `supabase/dev-fixtures/`.
 */
export default function OcrFixturesDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <OcrFixtureHarness />;
}
