import type { CubaSaleDraftDto } from "@/lib/sales/draft-transport";
import type { EditableAllocation } from "@/components/sales/financing-editor";

/**
 * Asignaciones de pago de la venta, listas para el editor.
 *
 * El "candado" de cada una sale de la misma verdad que usa la base
 * (`_allocation_money_lock`): contrato ACREDITADO o pago LIQUIDADO = dinero
 * dentro; contrato ENVIADO/FIRMADO = emitido. Aquí solo sirve para pintar el
 * estado y avisar antes de intentarlo — quien decide sigue siendo la base.
 */
export function editableAllocations(dto: CubaSaleDraftDto): EditableAllocation[] {
  const contractByAllocation = new Map(
    (dto.financingContracts ?? []).map((c) => [c.paymentAllocationId, c.status]),
  );

  return (dto.paymentAllocations ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((a) => {
      const contract = contractByAllocation.get(a.id);
      const lock: EditableAllocation["lock"] =
        contract === "ACCREDITED"
          ? "ACCREDITED"
          : a.settlementStatus === "SETTLED"
            ? "SETTLED"
            : contract === "SIGNED"
              ? "SIGNED"
              : contract === "SENT"
                ? "SENT"
                : null;

      return {
        id: a.id,
        paymentMethodId: a.paymentMethodId,
        planId: a.paymentMethodPlanId,
        inputMode: a.inputMode,
        // Se edita en el mismo modo en que se cargó: el importe que se ve es
        // el que la persona escribió, no el recalculado.
        amountCents: a.inputMode === "NET" ? a.netAmountCents : a.grossAmountCents,
        reference: a.reference ?? "",
        notes: a.notes ?? "",
        lock,
      };
    });
}
