import { Prisma, StockBatchStatus, type StockMovementType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Tx = Prisma.TransactionClient;

/**
 * Movement type yang secara eksplisit dimaksudkan untuk MENGELUARKAN stok
 * dari batch yang justru BERMASALAH (kedaluwarsa/rusak) — satu-satunya
 * pengecualian terhadap aturan umum "tolak output dari batch yang tidak
 * AVAILABLE". Tanpa pengecualian ini, EXPIRED_WRITE_OFF/DAMAGED_WRITE_OFF
 * tidak akan pernah bisa dieksekusi sama sekali.
 */
const WRITE_OFF_MOVEMENT_TYPES: ReadonlySet<StockMovementType> = new Set([
  "EXPIRED_WRITE_OFF",
  "DAMAGED_WRITE_OFF",
]);

function toDecimalString(value: number | string | Prisma.Decimal): string {
  return value.toString();
}

function isPositiveQty(value: number | string | Prisma.Decimal): boolean {
  return new Prisma.Decimal(value.toString()).greaterThan(0);
}

/**
 * Update qtyOnHand batch secara ATOMIC lewat satu statement SQL
 * (`UPDATE ... SET qty = qty + $1`), bukan pola read-then-write. Ini adalah
 * pendekatan concurrency-safe utama proyek ini — lihat penjelasan lengkap
 * di docs/INVENTORY.md bagian "Pendekatan race condition".
 */
async function incrementBatchQty(
  tx: Tx,
  batchId: string,
  qty: number | string | Prisma.Decimal,
): Promise<Prisma.Decimal> {
  const rows = await tx.$queryRaw<{ qtyOnHand: Prisma.Decimal }[]>`
    UPDATE "StockBatch"
    SET "qtyOnHand" = "qtyOnHand" + ${toDecimalString(qty)}::numeric,
        "updatedAt" = now()
    WHERE id = ${batchId}
    RETURNING "qtyOnHand"
  `;
  const row = rows[0];
  if (!row) {
    throw new Error("Batch tidak ditemukan saat menambah saldo.");
  }
  return row.qtyOnHand;
}

/**
 * Kurangi qtyOnHand batch secara ATOMIC, HANYA bila saldo saat ini (pada
 * saat statement dieksekusi oleh database, bukan pada saat dibaca aplikasi)
 * mencukupi. Klausa `WHERE qtyOnHand >= qty` membuat operasi ini berlaku
 * sebagai "compare-and-swap" tunggal di level database — aman dari lost
 * update maupun saldo negatif walau dipanggil bersamaan dari banyak
 * transaction. Baris affected = 0 berarti gagal (batch tidak ada ATAU
 * saldo tidak cukup); pemanggil membedakan keduanya bila perlu.
 */
async function decrementBatchQtyIfSufficient(
  tx: Tx,
  batchId: string,
  qty: number | string | Prisma.Decimal,
): Promise<Prisma.Decimal> {
  const rows = await tx.$queryRaw<{ qtyOnHand: Prisma.Decimal }[]>`
    UPDATE "StockBatch"
    SET "qtyOnHand" = "qtyOnHand" - ${toDecimalString(qty)}::numeric,
        "updatedAt" = now()
    WHERE id = ${batchId} AND "qtyOnHand" >= ${toDecimalString(qty)}::numeric
    RETURNING "qtyOnHand"
  `;

  const row = rows[0];
  if (!row) {
    const existing = await tx.stockBatch.findUnique({
      where: { id: batchId },
      select: { id: true, qtyOnHand: true },
    });
    if (!existing) {
      throw new Error("Batch tidak ditemukan.");
    }
    throw new Error(
      `Stok pada batch tidak mencukupi (saldo saat ini: ${existing.qtyOnHand.toString()}).`,
    );
  }

  return row.qtyOnHand;
}

export type ReceiveStockParams = {
  companyId: string;
  branchId: string;
  warehouseId: string;
  productId: string;
  batchNumber: string;
  expiryDate: Date;
  receivedDate: Date;
  unitCost: number | string | Prisma.Decimal;
  qty: number | string | Prisma.Decimal;
  movementType: StockMovementType;
  referenceType: string;
  referenceId: string;
  createdById: string;
  notes?: string;
  /** Status batch BARU bila belum ada (default `AVAILABLE`). Dipakai
   * Fase 09 untuk retur DAMAGED/QUARANTINE — batch segregasi baru dibuat
   * langsung berstatus itu, bukan AVAILABLE, supaya tidak diam-diam
   * menambah stok yang bisa dijual (lihat services/sales-return-service.ts).
   * TIDAK memengaruhi status batch yang SUDAH ADA (find-or-create hanya
   * men-set status pada cabang CREATE). */
  status?: StockBatchStatus;
};

/**
 * Primitif "tambah stok ke batch" — dipakai untuk opening balance (seed),
 * stock adjustment IN, stock opname (selisih lebih), purchase receipt,
 * transfer masuk, dan retur penjualan (Fase 09).
 *
 * Bila batchNumber sudah ada untuk kombinasi branch+product, stok
 * ditambahkan ke batch tsb (bukan membuat baris duplikat) — TAPI hanya bila
 * expiryDate yang dikirim cocok dengan batch yang sudah ada; bila berbeda,
 * ditolak untuk mencegah dua lot yang berbeda tergabung tanpa sengaja
 * akibat kesalahan input nomor batch.
 *
 * WAJIB dipanggil di dalam `prisma.$transaction(...)` milik pemanggil bila
 * merupakan bagian dari operasi multi-langkah (mis. posting adjustment
 * dengan banyak item) — parameter `tx` menerima baik `PrismaClient` biasa
 * maupun `Prisma.TransactionClient`.
 */
export async function receiveStockToBatch(tx: Tx, params: ReceiveStockParams) {
  if (!isPositiveQty(params.qty)) {
    throw new Error("Qty penerimaan harus lebih dari 0.");
  }

  const existing = await tx.stockBatch.findUnique({
    where: {
      branchId_productId_batchNumber: {
        branchId: params.branchId,
        productId: params.productId,
        batchNumber: params.batchNumber,
      },
    },
  });

  const batch =
    existing ??
    (await tx.stockBatch.create({
      data: {
        companyId: params.companyId,
        branchId: params.branchId,
        warehouseId: params.warehouseId,
        productId: params.productId,
        batchNumber: params.batchNumber,
        expiryDate: params.expiryDate,
        receivedDate: params.receivedDate,
        qtyOnHand: 0,
        unitCost: toDecimalString(params.unitCost),
        status: params.status ?? StockBatchStatus.AVAILABLE,
      },
    }));

  if (existing) {
    const sameExpiry =
      existing.expiryDate.toISOString().slice(0, 10) ===
      params.expiryDate.toISOString().slice(0, 10);
    if (!sameExpiry) {
      throw new Error(
        `Nomor batch "${params.batchNumber}" sudah dipakai dengan tanggal ED berbeda (${existing.expiryDate.toISOString().slice(0, 10)}). Gunakan nomor batch lain.`,
      );
    }
  }

  const balanceAfter = await incrementBatchQty(tx, batch.id, params.qty);

  const movement = await tx.stockMovement.create({
    data: {
      companyId: params.companyId,
      branchId: params.branchId,
      warehouseId: params.warehouseId,
      productId: params.productId,
      stockBatchId: batch.id,
      movementType: params.movementType,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      qtyIn: toDecimalString(params.qty),
      qtyOut: "0",
      balanceAfter: balanceAfter.toString(),
      createdById: params.createdById,
      notes: params.notes,
    },
  });

  return { batchId: batch.id, balanceAfter, movement };
}

export type ReceiveToExistingBatchParams = {
  stockBatchId: string;
  qty: number | string | Prisma.Decimal;
  movementType: StockMovementType;
  referenceType: string;
  referenceId: string;
  createdById: string;
  notes?: string;
};

/**
 * Primitif "tambah stok ke batch YANG SUDAH ADA" (beda dari
 * `receiveStockToBatch`, yang mencari-atau-membuat batch lewat
 * batchNumber). Dipakai oleh Stock Adjustment (arah IN) dan Stock Opname
 * (selisih lebih) — keduanya mengoreksi batch yang sudah dipilih user,
 * bukan menerima lot baru. Tidak menyentuh field batch selain qtyOnHand.
 */
export async function receiveStockToExistingBatch(
  tx: Tx,
  params: ReceiveToExistingBatchParams,
) {
  if (!isPositiveQty(params.qty)) {
    throw new Error("Qty harus lebih dari 0.");
  }

  const batch = await tx.stockBatch.findUnique({
    where: { id: params.stockBatchId },
  });
  if (!batch) {
    throw new Error("Batch tidak ditemukan.");
  }

  const balanceAfter = await incrementBatchQty(tx, batch.id, params.qty);

  const movement = await tx.stockMovement.create({
    data: {
      companyId: batch.companyId,
      branchId: batch.branchId,
      warehouseId: batch.warehouseId,
      productId: batch.productId,
      stockBatchId: batch.id,
      movementType: params.movementType,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      qtyIn: toDecimalString(params.qty),
      qtyOut: "0",
      balanceAfter: balanceAfter.toString(),
      createdById: params.createdById,
      notes: params.notes,
    },
  });

  return { balanceAfter, movement };
}

export type DeductStockParams = {
  stockBatchId: string;
  qty: number | string | Prisma.Decimal;
  movementType: StockMovementType;
  referenceType: string;
  referenceId: string;
  createdById: string;
  notes?: string;
};

/**
 * Primitif "keluarkan stok dari batch" — menegakkan seluruh aturan bisnis
 * inti Fase 04:
 *   - Qty harus > 0.
 *   - Batch harus ada.
 *   - Untuk movement NON-write-off: batch harus berstatus AVAILABLE dan
 *     belum lewat ED (dicek langsung terhadap expiryDate, TIDAK bergantung
 *     pada apakah job sinkronisasi status EXPIRED sudah berjalan — lihat
 *     syncExpiredBatchStatus()).
 *   - Untuk EXPIRED_WRITE_OFF: batch harus berstatus EXPIRED atau memang
 *     sudah lewat ED.
 *   - Untuk DAMAGED_WRITE_OFF: batch harus berstatus DAMAGED.
 *   - Qty tidak boleh melebihi saldo batch (ditegakkan atomic di database,
 *     lihat decrementBatchQtyIfSufficient).
 */
export async function deductStockFromBatch(tx: Tx, params: DeductStockParams) {
  if (!isPositiveQty(params.qty)) {
    throw new Error("Qty pengeluaran harus lebih dari 0.");
  }

  const batch = await tx.stockBatch.findUnique({
    where: { id: params.stockBatchId },
  });
  if (!batch) {
    throw new Error("Batch tidak ditemukan.");
  }

  const isExpiredByDate = batch.expiryDate.getTime() < Date.now();
  const isWriteOff = WRITE_OFF_MOVEMENT_TYPES.has(params.movementType);

  if (!isWriteOff) {
    if (batch.status !== StockBatchStatus.AVAILABLE) {
      throw new Error(
        `Batch berstatus ${batch.status}, tidak dapat dikeluarkan untuk transaksi normal.`,
      );
    }
    if (isExpiredByDate) {
      throw new Error(
        "Batch sudah melewati tanggal kedaluwarsa, tidak dapat dikeluarkan.",
      );
    }
  } else if (params.movementType === "EXPIRED_WRITE_OFF") {
    if (batch.status !== StockBatchStatus.EXPIRED && !isExpiredByDate) {
      throw new Error(
        "Batch belum kedaluwarsa — tidak dapat di-write-off sebagai EXPIRED_WRITE_OFF.",
      );
    }
  } else if (params.movementType === "DAMAGED_WRITE_OFF") {
    if (batch.status !== StockBatchStatus.DAMAGED) {
      throw new Error(
        "Batch tidak berstatus DAMAGED — tidak dapat di-write-off sebagai DAMAGED_WRITE_OFF.",
      );
    }
  }

  const balanceAfter = await decrementBatchQtyIfSufficient(
    tx,
    batch.id,
    params.qty,
  );

  const movement = await tx.stockMovement.create({
    data: {
      companyId: batch.companyId,
      branchId: batch.branchId,
      warehouseId: batch.warehouseId,
      productId: batch.productId,
      stockBatchId: batch.id,
      movementType: params.movementType,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      qtyIn: "0",
      qtyOut: toDecimalString(params.qty),
      balanceAfter: balanceAfter.toString(),
      createdById: params.createdById,
      notes: params.notes,
    },
  });

  return { balanceAfter, movement };
}

/**
 * Sinkronkan status batch berdasarkan ED: batch AVAILABLE yang sudah lewat
 * ED diubah menjadi EXPIRED. Dipanggil di server (bukan dihitung di UI)
 * setiap kali daftar batch/stok dibaca (lihat services/stock-batch-service.ts)
 * sehingga status selalu akurat tanpa bergantung pada cron job terpisah.
 * Batch dengan qtyOnHand 0 tetap disinkronkan (histori status tetap benar),
 * tapi tidak berdampak praktis karena qty 0 sudah otomatis tidak bisa
 * dialokasikan.
 */
export async function syncExpiredBatchStatus(companyId: string): Promise<number> {
  const result = await prisma.stockBatch.updateMany({
    where: {
      companyId,
      status: StockBatchStatus.AVAILABLE,
      expiryDate: { lt: new Date() },
    },
    data: { status: StockBatchStatus.EXPIRED },
  });
  return result.count;
}
