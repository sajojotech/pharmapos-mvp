import type { StockBatchStatus } from "@prisma/client";

const STYLES: Record<StockBatchStatus, string> = {
  AVAILABLE: "bg-emerald-50 text-emerald-700",
  QUARANTINED: "bg-amber-50 text-amber-700",
  BLOCKED: "bg-red-50 text-red-700",
  EXPIRED: "bg-slate-200 text-slate-600",
  DAMAGED: "bg-red-50 text-red-700",
};

const LABELS: Record<StockBatchStatus, string> = {
  AVAILABLE: "Tersedia",
  QUARANTINED: "Karantina",
  BLOCKED: "Diblokir",
  EXPIRED: "Kedaluwarsa",
  DAMAGED: "Rusak",
};

export function BatchStatusBadge({ status }: { status: StockBatchStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
