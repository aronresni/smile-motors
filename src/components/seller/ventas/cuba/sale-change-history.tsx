import type { CubaSaleDraftDto } from "@/lib/sales/draft-transport";
import { HistoryIcon } from "@/components/ui/icons";
import {
  describeChangeField,
  formatAuditValue,
} from "@/lib/sales/confirmed-edit-transport";

type Entry = NonNullable<CubaSaleDraftDto["changeHistory"]>[number];

const CHANGE_VERB: Record<string, string> = {
  ADD: "Agregado",
  REMOVE: "Eliminado",
  REPLACE: "Reemplazado",
  UPDATE: "",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = new Intl.DateTimeFormat("es-DO", {
    day: "numeric",
    month: "short",
  }).format(d);
  const time = new Intl.DateTimeFormat("es-DO", {
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `${day} · ${time}`;
}

function groupByEdit(entries: Entry[]): Entry[][] {
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = groups.get(e.editGroup);
    if (list) list.push(e);
    else groups.set(e.editGroup, [e]);
  }
  return [...groups.values()];
}

function ChangeRow({ entry }: { entry: Entry }) {
  const label = describeChangeField(entry.fieldPath);
  const verb = CHANGE_VERB[entry.changeType] ?? "";

  if (entry.changeType === "ADD") {
    return (
      <li className="text-xs">
        <span className="font-medium text-text-secondary">{label}</span>{" "}
        <span className="text-success">Agregado</span>
        {entry.newValue ? (
          <span className="text-muted-foreground"> · {entry.newValue}</span>
        ) : null}
      </li>
    );
  }
  if (entry.changeType === "REMOVE") {
    return (
      <li className="text-xs">
        <span className="font-medium text-text-secondary">{label}</span>{" "}
        <span className="text-danger">Eliminado</span>
        {entry.oldValue ? (
          <span className="text-muted-foreground line-through"> {entry.oldValue}</span>
        ) : null}
      </li>
    );
  }
  if (entry.changeType === "REPLACE") {
    return (
      <li className="text-xs">
        <span className="font-medium text-text-secondary">{label}</span>{" "}
        <span className="text-muted-foreground">Reemplazado</span>
      </li>
    );
  }
  // UPDATE
  return (
    <li className="text-xs">
      <span className="font-medium text-text-secondary">{label}</span>
      {verb ? <span className="text-muted-foreground"> {verb}</span> : null}
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-muted-foreground">
        <span className="rounded bg-surface-muted px-1.5 py-0.5 line-through">
          {formatAuditValue(entry.fieldPath, entry.oldValue)}
        </span>
        <span aria-hidden>→</span>
        <span className="rounded bg-surface-muted px-1.5 py-0.5 text-foreground">
          {formatAuditValue(entry.fieldPath, entry.newValue)}
        </span>
      </div>
    </li>
  );
}

/** Origen de cada guardado (edit_group → edit_kind), cuando se conoce. */
const KIND_LABEL: Record<string, { label: string; className: string }> = {
  ADMIN_CORRECTION: { label: "Corrección administrativa", className: "border-danger/35 bg-danger-surface text-danger" },
  ADMIN_EDIT: { label: "Edición de administración", className: "border-brand/35 bg-brand-soft text-brand" },
  APPROVED_REQUEST: { label: "Solicitud aprobada", className: "border-info/30 bg-info-soft text-info" },
};

export function SaleChangeHistory({
  entries,
  editKinds,
  id,
}: {
  entries: Entry[] | null | undefined;
  editKinds?: Record<string, string | null>;
  id?: string;
}) {
  const rows = entries ?? [];
  const groups = groupByEdit(rows);

  return (
    <div id={id} className="scroll-mt-24 rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <HistoryIcon size={15} className="text-brand" /> Historial de cambios
      </h2>

      {groups.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Esta venta no tiene cambios registrados.
        </p>
      ) : (
        <ol className="space-y-4">
          {groups.map((group) => {
            const head = group[0];
            return (
              <li
                key={head.editGroup}
                className="border-b border-border/60 pb-4 last:border-0 last:pb-0"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-xs font-medium tabular-nums text-foreground">
                    {formatWhen(head.changedAt)}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    {editKinds?.[head.editGroup] && KIND_LABEL[editKinds[head.editGroup] ?? ""] && (
                      <span className={`rounded-full border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${KIND_LABEL[editKinds[head.editGroup] ?? ""].className}`}>
                        {KIND_LABEL[editKinds[head.editGroup] ?? ""].label}
                      </span>
                    )}
                    {head.changedByName ?? "Vendedor"}
                  </span>
                </div>
                {head.reason ? (
                  <p className="mt-0.5 text-xs italic text-text-secondary">
                    “{head.reason}”
                  </p>
                ) : null}
                <ul className="mt-2 space-y-1.5">
                  {group.map((entry) => (
                    <ChangeRow key={entry.id} entry={entry} />
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
