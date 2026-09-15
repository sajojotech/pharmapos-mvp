import Link from "next/link";
import { can, requirePermission } from "@/lib/rbac";

type ReportLink = { href: string; label: string; description: string };

const SALES_REPORTS: ReportLink[] = [
  {
    href: "/reports/sales-by-branch",
    label: "Penjualan per Cabang (Harian)",
    description: "Omzet & jumlah transaksi harian, dipecah per cabang.",
  },
  {
    href: "/reports/sales-by-cashier",
    label: "Penjualan per Kasir",
    description: "Omzet & jumlah transaksi yang dibuat tiap kasir.",
  },
  {
    href: "/reports/sales-by-payment-method",
    label: "Penjualan per Metode Pembayaran",
    description: "Total pembayaran per metode (Tunai, QRIS, dst.).",
  },
  {
    href: "/reports/sales-by-product",
    label: "Penjualan per Produk & Kategori",
    description: "Qty terjual & omzet per produk, bisa difilter kategori.",
  },
  {
    href: "/reports/top-products",
    label: "Produk Terlaris",
    description: "Peringkat produk berdasarkan qty terjual.",
  },
];

const CORRECTION_REPORTS: ReportLink[] = [
  {
    href: "/reports/void-return-discount",
    label: "Void, Retur, & Diskon",
    description: "Transaksi yang di-void, retur penjualan, dan ringkasan diskon.",
  },
  {
    href: "/reports/shift-recap",
    label: "Rekap Shift & Variance Kas",
    description: "Riwayat shift kasir beserta selisih kas saat tutup.",
  },
];

const STOCK_REPORTS: ReportLink[] = [
  {
    href: "/reports/stock-available",
    label: "Stok Tersedia per Cabang",
    description: "Saldo stok teragregasi per cabang & produk.",
  },
  {
    href: "/reports/stock-by-batch",
    label: "Stok per Batch",
    description: "Rincian tiap batch/lot beserta status & ED.",
  },
  {
    href: "/reports/stock-minimum",
    label: "Stok Minimum",
    description: "Produk yang saldonya di bawah/sama dengan stok minimum.",
  },
  {
    href: "/reports/near-expiry",
    label: "Produk Mendekati ED",
    description: "Batch yang ED-nya jatuh dalam window (default 90 hari).",
  },
  {
    href: "/reports/expired",
    label: "Produk Kedaluwarsa",
    description: "Batch yang sudah lewat tanggal ED.",
  },
  {
    href: "/reports/stock-card",
    label: "Kartu Stok",
    description: "Ledger mutasi stok — append-only, urut dari yang terbaru.",
  },
];

const OPERATIONAL_REPORTS: ReportLink[] = [
  {
    href: "/reports/transfers",
    label: "Transfer Antar-Cabang",
    description: "Riwayat & status transfer stok antar-cabang.",
  },
];

function ReportGroup({ title, items }: { title: string; items: ReportLink[] }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-lg border border-slate-200 bg-white p-3 hover:border-emerald-300 hover:bg-emerald-50"
          >
            <p className="text-sm font-medium text-slate-900">{item.label}</p>
            <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default async function ReportsIndexPage() {
  const user = await requirePermission("report.read.branch");
  const canSeeConsolidated = can(user, "report.read.all");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Laporan</h1>
        <p className="mt-1 text-sm text-slate-600">
          Seluruh query di halaman ini branch-scoped &amp; server-side —
          lihat docs/REPORTS.md untuk penjelasan filter &amp; access scope
          tiap laporan.
        </p>
      </div>

      {canSeeConsolidated && (
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Konsolidasi</h2>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              href="/reports/consolidated"
              className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 hover:border-emerald-400"
            >
              <p className="text-sm font-medium text-emerald-900">Dashboard Konsolidasi</p>
              <p className="mt-0.5 text-xs text-emerald-700">
                Ringkasan lintas-cabang dengan filter periode bebas.
              </p>
            </Link>
          </div>
        </div>
      )}

      <ReportGroup title="Penjualan" items={SALES_REPORTS} />
      <ReportGroup title="Void, Retur, Diskon & Shift" items={CORRECTION_REPORTS} />
      <ReportGroup title="Stok" items={STOCK_REPORTS} />
      <ReportGroup title="Operasional" items={OPERATIONAL_REPORTS} />
    </div>
  );
}
