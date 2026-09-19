"use client";

import { Button } from "@/components/ui/button";

interface SaleActionsProps {
  continuing: boolean;
  savingDraft: boolean;
  onDiscard: () => void;
  onSaveDraft: () => void;
}

export function SaleActions({
  continuing,
  savingDraft,
  onDiscard,
  onSaveDraft,
}: SaleActionsProps) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end">
      <Button variant="ghost" onClick={onDiscard} className="sm:mr-auto">
        Descartar
      </Button>

      <Button variant="secondary" onClick={onSaveDraft} disabled={savingDraft}>
        {savingDraft ? "Guardando…" : "Guardar borrador"}
      </Button>

      <Button variant="primary" type="submit" disabled={continuing}>
        {continuing ? "Validando…" : "Continuar a revisión"}
      </Button>
    </div>
  );
}
