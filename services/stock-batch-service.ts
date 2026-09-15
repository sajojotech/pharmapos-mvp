import { Prisma, StockBatchStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { syncExpiredBatchStatus } from "./stock-ledger";

/**
 * Menghitung branchId efektif untuk sebuah query: bila `branchId` diminta
 * tapi TIDAK ada di `allowedBranchIds`, kembalikan array kosong (bukan
 * mengabaikan filter) — ini pertahanan server-side utama terhadap user yang
 * memanipulasi query param branchId di luar cabang yang diizinkan.
 */
function resolveEffectiveBranchIds(
  allowedBranchIds: string[],
  requestedBranchId?: string,
): string[] {
  if (!requestedBranchId) return allowedBranchIds;
  return allowedBranchIds.includes(requestedBranchId) ? [requestedBranchId] : [];
}

export type BatchListQuery = {
  companyId: string;
  allowedBranchIds: string[];
  branchId?: string;
  productId?: string;
  status?: StockBatchStatus;
  expiryFrom?: Date;
  expiryTo?: Date;
  page: number;
  pageSize?: number;
};

export async function listBatchesPaginated(query: BatchListQuery) {
  await syncExpiredBatchStatus(query.companyId);

  const pageSize = query.pageSize || DEFAULT_PAGE_SIZE;
  const branchIds = resolveEffectiveBranchIds(query.allowedBranchIds, query.branchId);

  const where: Prisma.StockBatchWhereInput = {
    companyId: query.companyId,
    branchId: { in: branchIds },
    productId: query.productId,
    status: query.status,
    expiryDate:
      query.expiryFrom || query.expiryTo
        ? { gte: query.expiryFrom, lte: query.expiryTo }
        : undefined,
  };

  const [data, totalCount] = await Promise.all([
    prisma.stockBatch.findMany({
      where,
      include: {
        product: { select: { id: true, sku: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        warehouse: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ expiryDate: "asc" }, { batchNumber: "asc" }],
      skip: (query.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.stockBatch.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getBatchById(
  allowedBranchIds: string[],
  id: string,
) {
  return prisma.stockBatch.findFirst({
    where: { id, branchId: { in: allowedBranchIds } },
    include: {
      product: { select: { id: true, sku: true, name: true } },
      branch: { select: { id: true, code: true, name: true } },
      warehouse: { select: { id: true, code: true, name: true } },
    },
  });
}

/**
 * Daftar batch AVAILABLE (belum lewat ED, qty > 0) untuk satu produk di
 * satu cabang — dipakai memilih batch tujuan pada form Adjustment/Opname.
 * Diurutkan FEFO (expiryDate ASC) walau fase ini belum ada alokasi
 * otomatis; urutan ini tetap berguna secara operasional bagi user memilih.
 */
export async function listSelectableBatches(params: {
  branchId: string;
  productId: string;
}) {
  return prisma.stockBatch.findMany({
    where: {
      branchId: params.branchId,
      productId: params.productId,
      status: StockBatchStatus.AVAILABLE,
      qtyOnHand: { gt: 0 },
    },
    orderBy: [{ expiryDate: "asc" }, { receivedDate: "asc" }],
  });
}

/**
 * Semua batch AVAILABLE (qty > 0) di satu cabang, lintas produk — dipakai
 * mengisi pilihan batch pada form Adjustment/Opname (difilter per produk di
 * client tanpa round-trip tambahan, cukup untuk skala MVP).
 *
 * `companyId` WAJIB diisi (Fase 11 hardening) — tanpanya, fungsi ini murni
 * memfilter `branchId` tanpa verifikasi kepemilikan company, yang berarti
 * pemanggil yang lupa memvalidasi `branchId` terhadap `allowedBranchIds`nya
 * sendiri di lapisan atas bisa membaca stok cabang company LAIN. Pemanggil
 * TETAP wajib memvalidasi `branchId` ada di `allowedBranchIds` user di
 * lapisan Server Action/Page — parameter ini adalah pertahanan berlapis
 * (defense in depth), bukan pengganti validasi itu.
 */
export async function listAvailableBatchesForBranch(companyId: string, branchId: string) {
  return prisma.stockBatch.findMany({
    where: { companyId, branchId, status: StockBatchStatus.AVAILABLE, qtyOnHand: { gt: 0 } },
    include: { product: { select: { id: true, sku: true, name: true } } },
    orderBy: [{ product: { name: "asc" } }, { expiryDate: "asc" }],
  });
}

export type FefoAllocationPlanLine = {
  batchId: string;
  batchNumber: string;
  expiryDate: Date;
  unitCost: Prisma.Decimal;
  qty: Prisma.Decimal;
};

/**
 * Rencanakan alokasi FEFO (First-Expired-First-Out) untuk satu produk di
 * satu cabang: pilih batch AVAILABLE, qtyOnHand > 0, belum lewat ED
 * (`expiryDate >= asOf`), diurutkan `expiryDate ASC, receivedDate ASC,
 * createdAt ASC`, lalu ambil qty berurutan dari batch teratas sampai
 * `qtyNeeded` terpenuhi — bisa menghasilkan BANYAK baris rencana bila satu
 * batch tidak cukup (lihat docs/POS.md).
 *
 * Fungsi ini HANYA membaca (read-only) — tidak memotong `qtyOnHand` atau
 * membuat `StockMovement` sama sekali. Pemanggil (Fase 07:
 * services/pos-transaction-service.ts::createPaidTransaction) yang
 * mengeksekusi tiap baris rencana lewat `deductStockFromBatch` (atomic,
 * concurrency-safe — lihat services/stock-ledger.ts & docs/INVENTORY.md)
 * di dalam `$transaction` yang sama, sehingga rencana yang "basi" akibat
 * race concurrent (batch keburu diambil transaction lain) akan gagal
 * bersih di titik itu, bukan menghasilkan alokasi/stok yang salah.
 *
 * Melempar error eksplisit bila total qty batch eligible tidak mencukupi
 * `qtyNeeded` — pemanggil TIDAK boleh mengeksekusi rencana parsial.
 */
export async function planFefoAllocation(
  tx: Prisma.TransactionClient,
  params: {
    companyId: string;
    branchId: string;
    productId: string;
    qtyNeeded: Prisma.Decimal;
    asOf: Date;
  },
): Promise<FefoAllocationPlanLine[]> {
  const batches = await tx.stockBatch.findMany({
    where: {
      companyId: params.companyId,
      branchId: params.branchId,
      productId: params.productId,
      status: StockBatchStatus.AVAILABLE,
      qtyOnHand: { gt: 0 },
      expiryDate: { gte: params.asOf },
    },
    orderBy: [{ expiryDate: "asc" }, { receivedDate: "asc" }, { createdAt: "asc" }],
  });

  const plan: FefoAllocationPlanLine[] = [];
  let remaining = params.qtyNeeded;

  for (const batch of batches) {
    if (remaining.lessThanOrEqualTo(0)) break;

    const takeQty = batch.qtyOnHand.lessThan(remaining) ? batch.qtyOnHand : remaining;
    plan.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      unitCost: batch.unitCost,
      qty: takeQty,
    });
    remaining = remaining.minus(takeQty);
  }

  if (remaining.greaterThan(0)) {
    throw new Error(
      `Stok tidak mencukupi (kurang ${remaining.toString()} dari yang diminta).`,
    );
  }

  return plan;
}

export type StockBalanceRow = {
  branchId: string;
  branchCode: string;
  branchName: string;
  productId: string;
  productSku: string;
  productName: string;
  qtyOnHand: Prisma.Decimal;
};

/**
 * Saldo stok teragregasi per (branch, product) — dijumlahkan dari SELURUH
 * batch apa pun statusnya (mencerminkan stok FISIK yang benar-benar ada di
 * rak/gudang, termasuk yang sedang di-quarantine/blocked — bukan hanya
 * yang "sellable"). Halaman /inventory/batches menampilkan rincian per
 * status bila pengguna perlu tahu berapa yang benar-benar bisa dijual.
 */
export async function listStockBalance(params: {
  companyId: string;
  allowedBranchIds: string[];
  branchId?: string;
  productId?: string;
}): Promise<StockBalanceRow[]> {
  await syncExpiredBatchStatus(params.companyId);

  const branchIds = resolveEffectiveBranchIds(params.allowedBranchIds, params.branchId);
  if (branchIds.length === 0) return [];

  const grouped = await prisma.stockBatch.groupBy({
    by: ["branchId", "productId"],
    where: {
      companyId: params.companyId,
      branchId: { in: branchIds },
      productId: params.productId,
    },
    _sum: { qtyOnHand: true },
    having: { qtyOnHand: { _sum: { gt: 0 } } },
  });

  if (grouped.length === 0) return [];

  const [branches, products] = await Promise.all([
    prisma.branch.findMany({
      where: { id: { in: [...new Set(grouped.map((g) => g.branchId))] } },
      select: { id: true, code: true, name: true },
    }),
    prisma.product.findMany({
      where: { id: { in: [...new Set(grouped.map((g) => g.productId))] } },
      select: { id: true, sku: true, name: true },
    }),
  ]);

  const branchMap = new Map(branches.map((b) => [b.id, b]));
  const productMap = new Map(products.map((p) => [p.id, p]));

  return grouped
    .map((g) => {
      const branch = branchMap.get(g.branchId);
      const product = productMap.get(g.productId);
      if (!branch || !product) return null;
      return {
        branchId: branch.id,
        branchCode: branch.code,
        branchName: branch.name,
        productId: product.id,
        productSku: product.sku,
        productName: product.name,
        qtyOnHand: g._sum.qtyOnHand ?? new Prisma.Decimal(0),
      };
    })
    .filter((row): row is StockBalanceRow => row !== null)
    .sort((a, b) => a.productName.localeCompare(b.productName));
}
