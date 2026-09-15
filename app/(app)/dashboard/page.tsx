import Link from "next/link";
import type { Role } from "@prisma/client";
import { can, getActiveBranchContext } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import {
  getBranchDashboardSnapshot,
  getGlobalDashboardSnapshot,
} from "@/services/reports/dashboard-service";
import { formatDate, formatDateTime, formatDecimalQty, formatRupiah } from "@/lib/format";

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function WidgetCard({
  title,
  href,
  children,
}: {
  title: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {href && (
          <Link href={href} className="text-xs text-emerald-700 hover:underline">
            Lihat semua →
          </Link>
        )}
      </div>
      <div className="mt-2 flex flex-col gap-1.5 text-sm">{children}</div>
    </div>
  );
}

export default async function DashboardPage() {
  const context = await getActiveBranchContext();
  const showConsolidated = can(context, "report.read.all");
  const showShiftWidget = can(context, "shift.manage");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Selamat datang, {context.name}. Ringkasan hari ini — {formatDate(new Date())}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard label="Role" value={context.role} />
        <InfoCard
          label="Cabang aktif"
          value={
            context.activeBranch
              ? `${context.activeBranch.code} — ${context.activeBranch.name}`
              : "Belum ada cabang yang dapat diakses"
          }
        />
        <InfoCard
          label="Jumlah cabang ditugaskan"
          value={String(context.assignedBranchIds.length)}
        />
        <InfoCard label="Waktu server" value={formatDateTime(new Date())} />
      </div>

      {showConsolidated ? (
        <GlobalDashboardWidgets companyId={context.companyId} role={context.role} />
      ) : context.activeBranchId ? (
        <BranchDashboardWidgets
          companyId={context.companyId}
          branchId={context.activeBranchId}
          userId={context.id}
          showShiftWidget={showShiftWidget}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
          Anda belum ditugaskan ke cabang mana pun — ringkasan operasional
          belum dapat ditampilkan.
        </div>
      )}
    </div>
  );
}

async function GlobalDashboardWidgets({ companyId, role }: { companyId: string; role: Role }) {
  const allowedBranchIds = await getAllowedBranchIds({ companyId, role, assignedBranchIds: [] });
  const snapshot = await getGlobalDashboardSnapshot({ companyId, allowedBranchIds });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <InfoCard label="Omzet hari ini (seluruh cabang)" value={formatRupiah(snapshot.todayRevenue.toString())} />
        <InfoCard label="Jumlah transaksi hari ini" value={String(snapshot.todayTransactionCount)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <WidgetCard title="Penjualan per Cabang (Hari Ini)" href="/reports/sales-by-branch">
          {snapshot.salesByBranchToday.length === 0 ? (
            <p className="text-xs text-slate-400">Belum ada penjualan hari ini.</p>
          ) : (
            snapshot.salesByBranchToday.map((row) => (
              <div key={row.branchId} className="flex justify-between">
                <span>
                  {row.branchCode} — {row.branchName}
                </span>
                <span className="font-medium">{formatRupiah(row.grossSales.toString())}</span>
              </div>
            ))
          )}
        </WidgetCard>

        <WidgetCard title="Produk Terlaris (Hari Ini)" href="/reports/top-products">
          {snapshot.topProducts.length === 0 ? (
            <p className="text-xs text-slate-400">Belum ada penjualan hari ini.</p>
          ) : (
            snapshot.topProducts.map((row) => (
              <div key={row.productId} className="flex justify-between">
                <span>{row.productName}</span>
                <span className="font-medium">{formatDecimalQty(row.qtySold.toString())}</span>
              </div>
            ))
          )}
        </WidgetCard>

        <WidgetCard title="Stok Kritis (Stok Minimum)" href="/reports/stock-minimum">
          <p className="text-xs text-slate-500">{snapshot.stockMinimumCount} produk di bawah stok minimum</p>
          {snapshot.stockMinimumSample.map((row) => (
            <div key={`${row.branchId}-${row.productId}`} className="flex justify-between text-xs">
              <span>
                {row.branchCode} — {row.productName}
              </span>
              <span>
                {formatDecimalQty(row.qtyOnHand.toString())} / min {formatDecimalQty(row.minStock.toString())}
              </span>
            </div>
          ))}
        </WidgetCard>

        <WidgetCard title="Produk Mendekati ED" href="/reports/near-expiry">
          <p className="text-xs text-slate-500">{snapshot.nearExpiryCount} batch mendekati ED</p>
          {snapshot.nearExpirySample.map((batch) => (
            <div key={batch.id} className="flex justify-between text-xs">
              <span>
                {batch.branch.code} — {batch.product.name}
              </span>
              <span>{formatDate(batch.expiryDate)}</span>
            </div>
          ))}
        </WidgetCard>

        <WidgetCard title="Transfer In-Transit / Pending" href="/reports/transfers">
          <p className="text-xs text-slate-500">{snapshot.pendingTransfers.length} transfer belum selesai</p>
          {snapshot.pendingTransfers.map((transfer) => (
            <div key={transfer.id} className="flex justify-between text-xs">
              <span>
                {transfer.sourceBranch.code} → {transfer.destinationBranch.code}
              </span>
              <span>{transfer.status}</span>
            </div>
          ))}
        </WidgetCard>
      </div>
    </div>
  );
}

async function BranchDashboardWidgets({
  companyId,
  branchId,
  userId,
  showShiftWidget,
}: {
  companyId: string;
  branchId: string;
  userId: string;
  showShiftWidget: boolean;
}) {
  const snapshot = await getBranchDashboardSnapshot({ companyId, branchId, userId });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <InfoCard label="Omzet hari ini" value={formatRupiah(snapshot.todayRevenue.toString())} />
        <InfoCard label="Jumlah transaksi hari ini" value={String(snapshot.todayTransactionCount)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {showShiftWidget && (
          <WidgetCard title="Status Shift Aktif" href="/cashier/shifts">
            {snapshot.openShift ? (
              <div className="flex flex-col gap-0.5 text-xs">
                <p>
                  Shift OPEN di {snapshot.openShift.branch.code} — {snapshot.openShift.branch.name}
                </p>
                <p className="text-slate-500">Dibuka {formatDateTime(snapshot.openShift.openedAt)}</p>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Tidak ada shift yang sedang terbuka.</p>
            )}
          </WidgetCard>
        )}

        <WidgetCard title="Stok Minimum" href="/reports/stock-minimum">
          <p className="text-xs text-slate-500">{snapshot.stockMinimumCount} produk di bawah stok minimum</p>
          {snapshot.stockMinimumSample.map((row) => (
            <div key={row.productId} className="flex justify-between text-xs">
              <span>{row.productName}</span>
              <span>
                {formatDecimalQty(row.qtyOnHand.toString())} / min {formatDecimalQty(row.minStock.toString())}
              </span>
            </div>
          ))}
        </WidgetCard>

        <WidgetCard title="Produk Mendekati ED" href="/reports/near-expiry">
          <p className="text-xs text-slate-500">{snapshot.nearExpiryCount} batch mendekati ED</p>
          {snapshot.nearExpirySample.map((batch) => (
            <div key={batch.id} className="flex justify-between text-xs">
              <span>{batch.product.name}</span>
              <span>{formatDate(batch.expiryDate)}</span>
            </div>
          ))}
        </WidgetCard>

        <WidgetCard title="Transfer Pending (Cabang Ini)" href="/reports/transfers">
          <p className="text-xs text-slate-500">{snapshot.pendingTransfers.length} transfer belum selesai</p>
          {snapshot.pendingTransfers.map((transfer) => (
            <div key={transfer.id} className="flex justify-between text-xs">
              <span>
                {transfer.sourceBranch.code} → {transfer.destinationBranch.code}
              </span>
              <span>{transfer.status}</span>
            </div>
          ))}
        </WidgetCard>
      </div>
    </div>
  );
}
