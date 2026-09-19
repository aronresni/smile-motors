import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Estado de la solicitud de edición de UNA venta — para el banner en la
 * ficha del vendedor ("EDICIÓN PENDIENTE DE APROBACIÓN" / "APROBADA" /
 * "RECHAZADA"). Lectura directa (RLS ya restringe a `requested_by =
 * auth.uid() or sale_is_own(sale_id) or is_admin()`), sin necesitar una RPC.
 */
export interface SaleEditRequestStatus {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  reason: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export async function getLatestSaleEditRequest(saleId: string): Promise<SaleEditRequestStatus | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sale_edit_requests")
    .select("id, status, reason, created_at, reviewed_at, review_note")
    .eq("sale_id", saleId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    status: data.status as SaleEditRequestStatus["status"],
    reason: data.reason,
    createdAt: data.created_at,
    reviewedAt: data.reviewed_at,
    reviewNote: data.review_note,
  };
}
