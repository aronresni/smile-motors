"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireZone } from "@/lib/auth/session";
import { ROUTES } from "@/lib/constants";
import type { Json } from "@/types/database.types";
import type {
  CubaSaleDraftDto,
  SaleDraftPayload,
} from "@/lib/sales/draft-transport";

/** Crea un borrador CUBA. La propiedad (seller_id) la fija el servidor. */
export async function createCubaSaleDraft(): Promise<
  { saleId: string } | { error: string }
> {
  await requireZone("seller");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_sale_draft", {
    p_operation_type: "CUBA",
  });
  if (error || !data) return { error: "No se pudo crear el borrador." };
  return { saleId: data };
}

/** Sincroniza el borrador. Snapshots de producto derivados en el servidor. */
export async function saveCubaSaleDraft(
  saleId: string,
  payload: SaleDraftPayload,
): Promise<{ ok: true } | { error: string }> {
  await requireZone("seller");
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_cuba_sale_draft", {
    p_sale_id: saleId,
    p_payload: payload as unknown as Json,
  });
  if (error) {
    const m = error.message ?? "";
    if (/no autorizado/i.test(m)) return { error: "No autorizado para esta venta." };
    if (/no encontrada/i.test(m)) return { error: "La venta no existe." };
    if (/producto inválido|variante/i.test(m)) {
      return { error: "Un producto o variante seleccionado ya no es válido." };
    }
    return { error: "No se pudo guardar el borrador." };
  }
  return { ok: true };
}

/** Carga el borrador completo (RLS restringe a ventas propias / admin). */
export async function getCubaSaleDraft(
  saleId: string,
): Promise<CubaSaleDraftDto | null> {
  await requireZone("seller");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_cuba_sale_draft", {
    p_sale_id: saleId,
  });
  if (error || !data) return null;

  const dto = data as unknown as CubaSaleDraftDto;
  if (!dto?.sale?.id) return null;

  for (const doc of dto.documents ?? []) {
    const { data: signed } = await supabase.storage
      .from("sale-documents")
      .createSignedUrl(doc.storagePath, 3600);
    doc.signedUrl = signed?.signedUrl ?? null;
  }

  for (const contract of dto.financingContracts ?? []) {
    if (!contract.contractStoragePath) continue;
    const { data: signed } = await supabase.storage
      .from("sale-financing-contracts")
      .createSignedUrl(contract.contractStoragePath, 3600);
    contract.contractSignedUrl = signed?.signedUrl ?? null;
  }

  return dto;
}

export type DocSubject = "BUYER" | "CO_BUYER" | "CUBA_RECIPIENT";
export type DocSide = "FRONT" | "BACK";

/** Registra el metadato de un documento tras subirlo a Storage privado. */
export async function recordSaleDocumentMeta(
  saleId: string,
  subjectType: DocSubject,
  side: DocSide,
  storagePath: string,
  mimeType: string | null,
  fileSizeBytes: number | null,
): Promise<{ ok: true } | { error: string }> {
  await requireZone("seller");
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_sale_document", {
    p_sale_id: saleId,
    p_subject_type: subjectType,
    p_side: side,
    p_storage_path: storagePath,
    p_mime_type: mimeType ?? undefined,
    p_file_size_bytes: fileSizeBytes ?? undefined,
  });
  return error ? { error: "No se pudo registrar el documento." } : { ok: true };
}

export interface ReviewRequestOk {
  ok: true;
  saleId: string;
  status: "PENDING";
  alreadyPending?: boolean;
}
export interface ReviewRequestFail {
  ok: false;
  code: string;
  errors?: string[];
}

/**
 * Solicita revisión de una venta CUBA (DRAFT -> PENDING). La RPC valida
 * propiedad, perfil activo, completitud de datos y liquidación de pagos
 * (neto == total) de forma autoritativa y atómica. NO confirma la venta:
 * un ADMIN debe aprobarla (PENDING -> SOLD) por separado. NO usa service_role.
 */
export async function requestSaleReview(
  saleId: string,
): Promise<ReviewRequestOk | ReviewRequestFail> {
  await requireZone("seller");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_sale_review", {
    p_sale_id: saleId,
  });
  if (error || !data) {
    return { ok: false, code: "UNEXPECTED" };
  }
  const res = data as {
    ok: boolean;
    code?: string;
    errors?: string[];
    saleId?: string;
    alreadyPending?: boolean;
  };
  if (res.ok) {
    // El panel y la lista "Mis ventas" agregan por estado: invalidar.
    revalidatePath(ROUTES.seller);
    revalidatePath(ROUTES.sellerVentas);
    return {
      ok: true,
      saleId: res.saleId ?? saleId,
      status: "PENDING",
      alreadyPending: res.alreadyPending,
    };
  }
  return { ok: false, code: res.code ?? "UNEXPECTED", errors: res.errors };
}

/** Elimina el metadato de un documento (el archivo se borra en el cliente). */
export async function removeSaleDocumentMeta(
  saleId: string,
  subjectType: DocSubject,
  side: DocSide,
): Promise<{ ok: true } | { error: string }> {
  await requireZone("seller");
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_sale_document", {
    p_sale_id: saleId,
    p_subject_type: subjectType,
    p_side: side,
  });
  return error ? { error: "No se pudo quitar el documento." } : { ok: true };
}
