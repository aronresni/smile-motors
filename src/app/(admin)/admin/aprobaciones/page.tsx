import type { Metadata } from "next";
import {
  getApprovalsCounts,
  getApprovalsTodo,
  getEditRequestsList,
  getContractsInbox,
  getCollectionsInbox,
  getReadyToPayInbox,
} from "@/lib/admin/approvals";
import { parseApprovalsSearch, parseApprovalsTab } from "@/lib/admin/approvals-list-params";
import { ApprovalsSummary } from "@/components/admin/approvals/approvals-summary";
import { ApprovalsTabs } from "@/components/admin/approvals/approvals-tabs";
import { ApprovalsSearchBox } from "@/components/admin/approvals/approvals-search-box";
import { TodoList } from "@/components/admin/approvals/todo-list";
import { EdicionesList } from "@/components/admin/approvals/ediciones-list";
import { ContratosList } from "@/components/admin/approvals/contratos-list";
import { CobrosList } from "@/components/admin/approvals/cobros-list";
import { ListasParaPagarList } from "@/components/admin/approvals/listas-para-pagar-list";

export const metadata: Metadata = { title: "Aprobaciones · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminAprobacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const tab = parseApprovalsTab(sp);
  const search = parseApprovalsSearch(sp);
  const statusRaw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const edicionesStatus = (["PENDING", "APPROVED", "REJECTED", "ALL"].includes(statusRaw ?? "")
    ? statusRaw
    : "PENDING") as "PENDING" | "APPROVED" | "REJECTED" | "ALL";

  const counts = await getApprovalsCounts();
  const tabCounts = {
    todo: counts.totalPending,
    ediciones: counts.edicionesSolicitadas,
    contratos: counts.contratosRequierenAccion,
    cobros: counts.pendientesACobrar,
    listas: counts.listasParaPagar,
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Aprobaciones</h1>
        <p className="text-sm text-muted-foreground">¿Qué necesita atención del administrador ahora?</p>
      </div>

      <ApprovalsSummary counts={counts} />
      <ApprovalsTabs counts={tabCounts} />

      {tab !== "todo" && (
        <ApprovalsSearchBox
          tab={tab}
          defaultValue={search}
          statusValue={edicionesStatus}
          placeholder={
            tab === "ediciones"
              ? "Buscar por N° de venta o vendedor…"
              : tab === "contratos"
                ? "Buscar por N° de venta, cliente o financiera…"
                : "Buscar por N° de venta o cliente…"
          }
        />
      )}

      {tab === "todo" && <TodoTabContent />}
      {tab === "ediciones" && <EdicionesTabContent search={search} status={edicionesStatus} />}
      {tab === "contratos" && <ContratosTabContent search={search} />}
      {tab === "cobros" && <CobrosTabContent search={search} />}
      {tab === "listas" && <ListasTabContent search={search} />}
    </div>
  );
}

async function TodoTabContent() {
  const { items } = await getApprovalsTodo(30, 0);
  return <TodoList items={items} />;
}

async function EdicionesTabContent({
  search,
  status,
}: {
  search: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "ALL";
}) {
  const { items } = await getEditRequestsList(search, status, 30, 0);
  return <EdicionesList items={items} />;
}

async function ContratosTabContent({ search }: { search: string }) {
  const { items } = await getContractsInbox("ALL", null, search, 30, 0);
  return <ContratosList items={items} />;
}

async function CobrosTabContent({ search }: { search: string }) {
  const { items } = await getCollectionsInbox(null, search, 30, 0);
  return <CobrosList items={items} />;
}

async function ListasTabContent({ search }: { search: string }) {
  const { items } = await getReadyToPayInbox(null, search, 30, 0);
  return <ListasParaPagarList items={items} />;
}
