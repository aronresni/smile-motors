import type { Metadata } from "next";
import { OperationSelector } from "@/components/seller/ventas/operation-selector";

export const metadata: Metadata = { title: "Nueva operación · Vendedor" };

export default function NuevaOperacionPage() {
  return <OperationSelector />;
}
