import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { getPrescriptionById } from "@/services/prescription-service";
import { formatDate, formatDateTime, formatDecimalQty, formatRupiah } from "@/lib/format";
import { ReviewForm } from "./review-form";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Menunggu Review",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  COMPLETED: "Selesai",
};

export default async function PrescriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("prescription.review");
  const { id } = await params;
  const allowedBranchIds = await getAllowedBranchIds(user);

  const prescription = await getPrescriptionById(allowedBranchIds, id);
  if (!prescription) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Resep {prescription.prescriptionNumber}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {prescription.branch.code} — {prescription.branch.name} · Invoice{" "}
          <Link
            href={`/pos/transactions/${prescription.posTransaction.id}`}
            className="font-mono text-emerald-700 hover:underline"
          >
            {prescription.posTransaction.documentNumber}
          </Link>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <h2 className="text-sm font-semibold text-slate-900">Detail Resep</h2>
          <dl className="mt-2 flex flex-col gap-1">
            <div className="flex justify-between">
              <dt className="text-slate-500">Status</dt>
              <dd className="font-medium">{STATUS_LABELS[prescription.status]}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Nama Pasien</dt>
              <dd>{prescription.patientName}</dd>
            </div>
            {prescription.patientPhone && (
              <div className="flex justify-between">
                <dt className="text-slate-500">No. HP Pasien</dt>
                <dd>{prescription.patientPhone}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-slate-500">Nama Dokter</dt>
              <dd>{prescription.doctorName}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Tanggal Resep</dt>
              <dd>{formatDate(prescription.prescriptionDate)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Diajukan</dt>
              <dd>{formatDateTime(prescription.createdAt)}</dd>
            </div>
            {prescription.reviewedBy && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Ditinjau oleh</dt>
                <dd>
                  {prescription.reviewedBy.name}
                  {prescription.reviewedAt ? ` — ${formatDateTime(prescription.reviewedAt)}` : ""}
                </dd>
              </div>
            )}
            {prescription.pharmacistNotes && (
              <div className="mt-1 border-t border-slate-100 pt-1">
                <dt className="text-slate-500">Catatan</dt>
                <dd className="mt-0.5">{prescription.pharmacistNotes}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <h2 className="text-sm font-semibold text-slate-900">Item Transaksi</h2>
          <table className="mt-2 w-full text-left text-sm">
            <tbody>
              {prescription.posTransaction.items.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 align-top">
                  <td className="py-1 pr-2">
                    <p className="font-medium text-slate-900">{item.product.name}</p>
                    <p className="text-xs text-slate-500">
                      {formatDecimalQty(item.qty.toString())} x{" "}
                      {formatRupiah(item.unitPrice.toString())}
                    </p>
                  </td>
                  <td className="py-1 text-right font-medium whitespace-nowrap">
                    {formatRupiah(item.lineTotal.toString())}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-sm font-semibold text-slate-900">
            <span>Total</span>
            <span>{formatRupiah(prescription.posTransaction.totalAmount.toString())}</span>
          </div>
        </div>
      </div>

      {prescription.status === "PENDING_REVIEW" && (
        <ReviewForm prescriptionId={prescription.id} />
      )}
    </div>
  );
}
