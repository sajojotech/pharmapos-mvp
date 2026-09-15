import {
  CashierShiftStatus,
  PosTransactionStatus,
  PrescriptionStatus,
  Prisma,
  Role,
  StockBatchStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { hasPermission } from "@/lib/permissions";
import { recordAudit } from "@/services/audit-service";
import { getDefaultCustomer } from "@/services/customer-service";
import { planFefoAllocation, type FefoAllocationPlanLine } from "@/services/stock-batch-service";
import { deductStockFromBatch } from "@/services/stock-ledger";
import { validatePayments, type PaymentInput } from "@/services/pos-payment-calc";

function resolveEffectiveBranchIds(
  allowedBranchIds: string[],
  requestedBranchId?: string,
): string[] {
  if (!requestedBranchId) return allowedBranchIds;
  return allowedBranchIds.includes(requestedBranchId) ? [requestedBranchId] : [];
}

// ---------------------------------------------------------------------------
// Pencarian produk & resolusi harga (Fase 06: penjualan hanya base unit —
// belum ada pemilihan satuan jual Strip/Box, lihat docs/POS.md)
// ---------------------------------------------------------------------------

/**
 * Peta harga override cabang untuk sekumpulan produk, hanya yang aktif DAN
 * (effectiveDate kosong ATAU sudah lewat) — memenuhi janji komentar skema
 * Fase 03 ("penerapan otomatis pada POS ada di fase berikutnya").
 */
async function resolveBranchPriceMap(
  branchId: string,
  productIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  if (productIds.length === 0) return new Map();

  const rows = await prisma.productBranchPrice.findMany({
    where: { branchId, productId: { in: productIds }, isActive: true },
  });

  const now = Date.now();
  const map = new Map<string, Prisma.Decimal>();
  for (const row of rows) {
    if (row.effectiveDate && row.effectiveDate.getTime() > now) continue;
    map.set(row.productId, row.price);
  }
  return map;
}

/**
 * Resolusi harga jual SATU produk, dipakai di dalam transaction posting
 * (server tidak pernah percaya harga yang dikirim client — lihat
 * docs/POS.md poin 8).
 */
export async function resolveSellingPrice(
  tx: Prisma.TransactionClient,
  branchId: string,
  productId: string,
  defaultSellingPrice: Prisma.Decimal | string,
): Promise<Prisma.Decimal> {
  const override = await tx.productBranchPrice.findUnique({
    where: { branchId_productId: { branchId, productId } },
  });
  if (
    override &&
    override.isActive &&
    (!override.effectiveDate || override.effectiveDate.getTime() <= Date.now())
  ) {
    return override.price;
  }
  return new Prisma.Decimal(defaultSellingPrice.toString());
}

export type SellableProductResult = {
  id: string;
  sku: string;
  name: string;
  genericName: string | null;
  baseUnitName: string;
  baseUnitSymbol: string | null;
  sellingPrice: string;
  /** Fase 09: bila true, kasir tidak bisa langsung membayar — harus lewat
   * alur pengajuan resep (createPendingPrescriptionTransaction). */
  requiresPrescription: boolean;
};

/**
 * Cari produk AKTIF berdasarkan barcode, SKU, nama, atau nama generik.
 * Bila query cocok persis dengan satu barcode, kembalikan HANYA produk itu
 * (jalur cepat "scan lalu langsung masuk keranjang"); selain itu kembalikan
 * semua kecocokan parsial (maks 20) untuk dipilih kasir.
 */
export async function searchSellableProducts(params: {
  companyId: string;
  branchId: string;
  query: string;
}): Promise<SellableProductResult[]> {
  const query = params.query.trim();
  if (!query) return [];

  const exactBarcodeMatch = await prisma.product.findFirst({
    where: {
      companyId: params.companyId,
      isActive: true,
      barcodes: { some: { barcode: query } },
    },
    include: { baseUnit: { select: { name: true, symbol: true } } },
  });

  const products = exactBarcodeMatch
    ? [exactBarcodeMatch]
    : await prisma.product.findMany({
        where: {
          companyId: params.companyId,
          isActive: true,
          OR: [
            { sku: { contains: query, mode: "insensitive" } },
            { name: { contains: query, mode: "insensitive" } },
            { genericName: { contains: query, mode: "insensitive" } },
            { barcodes: { some: { barcode: { contains: query } } } },
          ],
        },
        include: { baseUnit: { select: { name: true, symbol: true } } },
        orderBy: { name: "asc" },
        take: 20,
      });

  const priceMap = await resolveBranchPriceMap(
    params.branchId,
    products.map((p) => p.id),
  );

  return products.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    genericName: product.genericName,
    baseUnitName: product.baseUnit.name,
    baseUnitSymbol: product.baseUnit.symbol,
    sellingPrice: (priceMap.get(product.id) ?? product.defaultSellingPrice).toString(),
    requiresPrescription: product.requiresPrescription,
  }));
}

// ---------------------------------------------------------------------------
// Query riwayat
// ---------------------------------------------------------------------------

export type TransactionListQuery = {
  companyId: string;
  allowedBranchIds: string[];
  branchId?: string;
  page: number;
  pageSize?: number;
};

export async function listTransactionsPaginated(query: TransactionListQuery) {
  const pageSize = query.pageSize || DEFAULT_PAGE_SIZE;
  const branchIds = resolveEffectiveBranchIds(query.allowedBranchIds, query.branchId);

  const where: Prisma.PosTransactionWhereInput = {
    companyId: query.companyId,
    branchId: { in: branchIds },
  };

  const [data, totalCount] = await Promise.all([
    prisma.posTransaction.findMany({
      where,
      include: {
        branch: { select: { code: true, name: true } },
        customer: { select: { name: true } },
        createdBy: { select: { name: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.posTransaction.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getTransactionById(allowedBranchIds: string[], id: string) {
  return prisma.posTransaction.findFirst({
    where: { id, branchId: { in: allowedBranchIds } },
    include: {
      branch: { select: { code: true, name: true, address: true, phone: true } },
      customer: { select: { name: true, code: true } },
      createdBy: { select: { name: true } },
      voidedBy: { select: { name: true } },
      shift: { select: { id: true, openedAt: true } },
      items: {
        include: {
          product: { select: { sku: true, name: true, requiresPrescription: true } },
          allocations: {
            include: { stockBatch: { select: { warehouse: { select: { code: true, name: true } } } } },
            orderBy: { createdAt: "asc" },
          },
        },
      },
      payments: true,
      prescription: { include: { reviewedBy: { select: { name: true } } } },
      salesReturns: { include: { createdBy: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
}

// ---------------------------------------------------------------------------
// Bayar (create + item + payment, atomic, langsung PAID, dengan alokasi FEFO)
// ---------------------------------------------------------------------------

export type PosItemInput = {
  productId: string;
  qty: number;
  discountAmount?: number;
  notes?: string;
};

/** Basis bersama Fase 09: sama dengan `CreatePaidTransactionParams` TAPI
 * tanpa `payments` — dipakai `createPendingPrescriptionTransaction`, yang
 * belum punya pembayaran sama sekali saat item dibuat (menunggu approval
 * resep dulu, lihat docs/PRESCRIPTION_VOID_RETURN.md). */
export type CreateTransactionItemsParams = {
  companyId: string;
  allowedBranchIds: string[];
  shiftId: string;
  createdById: string;
  customerId?: string;
  transactionDiscountAmount?: number;
  notes?: string;
  items: PosItemInput[];
};

export type CreatePaidTransactionParams = CreateTransactionItemsParams & {
  payments: PaymentInput[];
};

type PreparedItem = {
  productId: string;
  productName: string;
  requiresPrescription: boolean;
  qty: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  notes: string | null;
};

type PreparedTransaction = {
  shift: NonNullable<Awaited<ReturnType<typeof findOpenShiftForPayment>>>;
  branchId: string;
  customerId: string;
  items: PreparedItem[];
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  changeAmount: Prisma.Decimal;
};

async function findOpenShiftForPayment(
  tx: Prisma.TransactionClient,
  params: { shiftId: string; allowedBranchIds: string[]; createdById: string },
) {
  const shift = await tx.cashierShift.findFirst({
    where: { id: params.shiftId, branchId: { in: params.allowedBranchIds } },
  });
  if (!shift) {
    throw new Error("Shift tidak ditemukan atau di luar akses cabang Anda.");
  }
  if (shift.status !== CashierShiftStatus.OPEN) {
    throw new Error("Shift tidak berstatus OPEN — buka shift terlebih dahulu.");
  }
  if (shift.userId !== params.createdById) {
    throw new Error("Shift ini bukan milik Anda.");
  }
  return shift;
}

/**
 * Validasi & perhitungan header (shift, customer, harga & diskon per item,
 * total, payment) — dipakai bersama oleh `createPaidTransaction` (alokasi
 * FEFO otomatis), `createPaidTransactionWithBatchOverride` (alokasi batch
 * manual), DAN `createPendingPrescriptionTransaction` (Fase 09, belum ada
 * payment sama sekali), supaya logika harga/diskon tidak terduplikasi.
 * TIDAK membuat baris apa pun di database — murni validasi & kalkulasi.
 *
 * `payments` OPSIONAL: bila tidak diisi (jalur resep pending), validasi
 * pembayaran dilewati dan `changeAmount` diisi 0 sebagai placeholder (belum
 * relevan sampai `finalizePrescriptionPayment` dipanggil nanti).
 */
async function prepareTransaction(
  tx: Prisma.TransactionClient,
  params: CreateTransactionItemsParams,
  payments?: PaymentInput[],
): Promise<PreparedTransaction> {
  if (params.items.length === 0) {
    throw new Error("Keranjang tidak boleh kosong.");
  }

  const shift = await findOpenShiftForPayment(tx, params);
  // branchId SELALU diambil dari shift itu sendiri, bukan dari input client
  // — mencegah pembayaran dicatat di cabang yang berbeda dari shift yang
  // benar-benar dipakai.
  const branchId = shift.branchId;

  const customer = params.customerId
    ? await tx.customer.findFirst({ where: { id: params.customerId, companyId: params.companyId } })
    : await getDefaultCustomer(params.companyId);
  if (!customer) {
    throw new Error("Customer tidak ditemukan.");
  }

  const productIds = [...new Set(params.items.map((item) => item.productId))];
  const products = await tx.product.findMany({
    where: { id: { in: productIds }, companyId: params.companyId },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  let subtotal = new Prisma.Decimal(0);
  let itemDiscountTotal = new Prisma.Decimal(0);
  const preparedItems: PreparedItem[] = [];

  for (const item of params.items) {
    if (item.qty <= 0) {
      throw new Error("Qty item harus lebih dari 0.");
    }
    const product = productMap.get(item.productId);
    if (!product) {
      throw new Error("Salah satu produk pada keranjang tidak ditemukan.");
    }
    if (!product.isActive) {
      throw new Error(`Produk "${product.name}" sudah nonaktif dan tidak dapat dijual.`);
    }

    const unitPrice = await resolveSellingPrice(tx, branchId, item.productId, product.defaultSellingPrice);
    const qty = new Prisma.Decimal(item.qty.toString());
    const lineSubtotal = qty.times(unitPrice);
    const discount = new Prisma.Decimal((item.discountAmount ?? 0).toString());
    if (discount.lessThan(0)) {
      throw new Error(`Diskon "${product.name}" tidak boleh negatif.`);
    }
    if (discount.greaterThan(lineSubtotal)) {
      throw new Error(`Diskon "${product.name}" tidak boleh melebihi subtotal barisnya.`);
    }
    const lineTotal = lineSubtotal.minus(discount);

    subtotal = subtotal.plus(lineSubtotal);
    itemDiscountTotal = itemDiscountTotal.plus(discount);

    preparedItems.push({
      productId: item.productId,
      productName: product.name,
      requiresPrescription: product.requiresPrescription,
      qty,
      unitPrice,
      discountAmount: discount,
      lineTotal,
      notes: item.notes?.trim() || null,
    });
  }

  const transactionDiscount = new Prisma.Decimal((params.transactionDiscountAmount ?? 0).toString());
  if (transactionDiscount.lessThan(0)) {
    throw new Error("Diskon transaksi tidak boleh negatif.");
  }

  const discountAmount = itemDiscountTotal.plus(transactionDiscount);
  const totalAmount = subtotal.minus(discountAmount);
  if (totalAmount.lessThan(0)) {
    throw new Error("Total diskon tidak boleh melebihi subtotal transaksi.");
  }

  const changeAmount = payments ? validatePayments(totalAmount, payments).changeAmount : new Prisma.Decimal(0);

  return {
    shift,
    branchId,
    customerId: customer.id,
    items: preparedItems,
    subtotal,
    discountAmount,
    totalAmount,
    changeAmount,
  };
}

/**
 * Buat header PosTransaction + payments (belum item — item dibuat satu per
 * satu di luar supaya id-nya bisa dipakai alokasi batch).
 *
 * TIDAK memakai `lib/document-number.ts::createWithSequentialNumber` di
 * sini secara langsung — pola retry-di-tempatnya itu mengasumsikan setiap
 * percobaan adalah transaction independen (aman untuk dokumen seperti
 * PurchaseReceipt yang dibuat di LUAR `$transaction` besar). Di sini kita
 * berada DI DALAM satu `$transaction` besar (mencakup alokasi FEFO) — bila
 * `create()` gagal karena tabrakan `documentNumber` (P2002), transaction
 * Postgres yang mendasarinya sudah "aborted" dan percobaan ulang lewat
 * `tx` yang SAMA akan gagal lagi dengan error berbeda ("current
 * transaction is aborted"), bukan retry yang bersih. Sebagai gantinya,
 * nomor dihitung SEKALI di sini, dan seluruh `$transaction` (lihat
 * `createPaidTransaction`/`createPaidTransactionWithBatchOverride`)
 * diulang dari awal (koneksi/transaction baru) bila terjadi tabrakan —
 * lihat `retryOnDocumentNumberCollision`.
 */
async function persistTransactionHeader(
  tx: Prisma.TransactionClient,
  params: CreateTransactionItemsParams,
  prepared: PreparedTransaction,
  status: PosTransactionStatus,
  payments?: PaymentInput[],
) {
  // Berbasis nomor urut TERBESAR yang sudah ada (bukan COUNT baris) —
  // penting supaya penomoran tetap benar walau ada "gap" (mis. dokumen
  // yang dihapus, atau percobaan gagal sebelumnya): COUNT+1 bisa
  // menghasilkan kandidat yang SAMA berulang kali (selalu bentrok) bila
  // jumlah baris tidak lagi selaras dengan angka tertinggi yang pernah
  // dipakai. MAX+1 selalu menghasilkan kandidat baru yang benar, termasuk
  // saat retryOnDocumentNumberCollision mengulang dari transaction yang
  // fresh setelah tabrakan konkuren.
  const last = await tx.posTransaction.findFirst({
    where: { companyId: params.companyId, documentNumber: { startsWith: "INV-" } },
    orderBy: { documentNumber: "desc" },
    select: { documentNumber: true },
  });
  const lastSeq = last ? Number.parseInt(last.documentNumber.slice(4), 10) || 0 : 0;
  const documentNumber = `INV-${String(lastSeq + 1).padStart(6, "0")}`;

  return tx.posTransaction.create({
    data: {
      companyId: params.companyId,
      branchId: prepared.branchId,
      cashierShiftId: prepared.shift.id,
      customerId: prepared.customerId,
      documentNumber,
      status,
      paidAt: status === PosTransactionStatus.PAID ? new Date() : null,
      subtotal: prepared.subtotal.toString(),
      discountAmount: prepared.discountAmount.toString(),
      totalAmount: prepared.totalAmount.toString(),
      changeAmount: prepared.changeAmount.toString(),
      notes: params.notes?.trim() || null,
      createdById: params.createdById,
      ...(payments
        ? {
            payments: {
              createMany: {
                data: payments.map((p) => ({
                  method: p.method,
                  amount: p.amount.toString(),
                  reference: p.reference?.trim() || null,
                })),
              },
            },
          }
        : {}),
    },
  });
}

/**
 * Ulangi SELURUH `runTransaction()` (bukan hanya satu query) dari awal bila
 * gagal karena tabrakan unique constraint (documentNumber) — setiap
 * percobaan baru berarti koneksi/transaction Postgres yang baru & bersih,
 * dan `persistTransactionHeader` akan menghitung ulang nomor dokumen
 * berdasarkan data ter-commit terkini. Lihat penjelasan di
 * `persistTransactionHeader`.
 */
async function retryOnDocumentNumberCollision<T>(
  runTransaction: () => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await runTransaction();
    } catch (error) {
      if (isUniqueConstraintError(error) && attempt < maxAttempts - 1) continue;
      throw error;
    }
  }
  throw new Error("Gagal membuat nomor invoice setelah beberapa percobaan.");
}

/** Eksekusi satu baris rencana alokasi: potong stok (atomic) + catat allocation. */
async function executeAllocationPlan(
  tx: Prisma.TransactionClient,
  params: {
    posTransactionItemId: string;
    referenceId: string;
    createdById: string;
    plan: FefoAllocationPlanLine[];
  },
) {
  for (const line of params.plan) {
    await deductStockFromBatch(tx, {
      stockBatchId: line.batchId,
      qty: line.qty,
      movementType: "POS_SALE",
      referenceType: "PosTransaction",
      referenceId: params.referenceId,
      createdById: params.createdById,
    });

    await tx.posTransactionItemBatchAllocation.create({
      data: {
        posTransactionItemId: params.posTransactionItemId,
        stockBatchId: line.batchId,
        batchNumberSnapshot: line.batchNumber,
        expiryDateSnapshot: line.expiryDate,
        qtyOut: line.qty.toString(),
        unitCostSnapshot: line.unitCost.toString(),
      },
    });
  }
}

/**
 * Alokasikan FEFO untuk SEKUMPULAN item yang SUDAH ADA di database (sudah
 * punya `id`) — dipakai `runCreatePaidTransaction` (item baru saja dibuat
 * di loop yang sama) DAN `finalizePrescriptionPayment` (Fase 09; item
 * dibuat lebih awal saat `createPendingPrescriptionTransaction`, baru
 * dialokasikan di sini setelah resep disetujui & pembayaran diisi).
 * `asOf` sengaja parameter terpisah (bukan `transaction.paidAt`) karena
 * pada jalur resep, `paidAt` yang sebenarnya baru ditentukan SETELAH
 * alokasi ini selesai — pemanggil mengirim waktu "sekarang" yang relevan.
 */
async function allocateFefoForItems(
  tx: Prisma.TransactionClient,
  params: {
    companyId: string;
    branchId: string;
    createdById: string;
    referenceId: string;
    asOf: Date;
    items: { id: string; productId: string; productName: string; qty: Prisma.Decimal }[];
  },
) {
  for (const item of params.items) {
    let plan: FefoAllocationPlanLine[];
    try {
      plan = await planFefoAllocation(tx, {
        companyId: params.companyId,
        branchId: params.branchId,
        productId: item.productId,
        qtyNeeded: item.qty,
        asOf: params.asOf,
      });
    } catch {
      throw new Error(
        `Stok "${item.productName}" tidak mencukupi (diminta ${item.qty.toString()}).`,
      );
    }

    await executeAllocationPlan(tx, {
      posTransactionItemId: item.id,
      referenceId: params.referenceId,
      createdById: params.createdById,
      plan,
    });
  }
}

/**
 * Tolak keranjang yang mengandung produk `requiresPrescription` pada jalur
 * pembayaran LANGSUNG (Fase 09) — item semacam itu WAJIB lewat
 * `createPendingPrescriptionTransaction` + review apoteker/manager dulu.
 * TIDAK dipakai oleh jalur resep itu sendiri (yang justru mensyaratkan
 * SEBALIKNYA — minimal satu item resep).
 */
function assertNoPrescriptionItems(items: PreparedItem[]) {
  const item = items.find((i) => i.requiresPrescription);
  if (item) {
    throw new Error(
      `Produk "${item.productName}" memerlukan resep — gunakan alur pengajuan resep, bukan pembayaran langsung.`,
    );
  }
}

/**
 * Buat & bayar transaksi POS dalam SATU $transaction: validasi header/harga/
 * diskon/pembayaran (prepareTransaction) → buat header+payments → per item,
 * buat baris item lalu alokasikan stok keluar via FEFO (planFefoAllocation +
 * deductStockFromBatch, lihat services/stock-batch-service.ts &
 * services/stock-ledger.ts) → audit log. Gagal di titik MANA PUN (termasuk
 * stok tidak cukup pada item terakhir) membatalkan SELURUH transaction —
 * tidak ada header/item/payment/movement yang tersisa parsial.
 */
export async function createPaidTransaction(params: CreatePaidTransactionParams) {
  return retryOnDocumentNumberCollision(() => runCreatePaidTransaction(params));
}

async function runCreatePaidTransaction(params: CreatePaidTransactionParams) {
  return prisma.$transaction(async (tx) => {
    const prepared = await prepareTransaction(tx, params, params.payments);
    assertNoPrescriptionItems(prepared.items);
    const transaction = await persistTransactionHeader(
      tx,
      params,
      prepared,
      PosTransactionStatus.PAID,
      params.payments,
    );

    const createdItems: { id: string; productId: string; productName: string; qty: Prisma.Decimal }[] =
      [];
    for (const item of prepared.items) {
      const createdItem = await tx.posTransactionItem.create({
        data: {
          posTransactionId: transaction.id,
          productId: item.productId,
          qty: item.qty.toString(),
          unitPrice: item.unitPrice.toString(),
          discountAmount: item.discountAmount.toString(),
          lineTotal: item.lineTotal.toString(),
          notes: item.notes,
        },
      });
      createdItems.push({
        id: createdItem.id,
        productId: item.productId,
        productName: item.productName,
        qty: item.qty,
      });
    }

    await allocateFefoForItems(tx, {
      companyId: params.companyId,
      branchId: prepared.branchId,
      createdById: params.createdById,
      referenceId: transaction.id,
      asOf: transaction.paidAt ?? new Date(),
      items: createdItems,
    });

    await recordAudit(
      {
        companyId: params.companyId,
        branchId: prepared.branchId,
        actorId: params.createdById,
        action: "PAY",
        entityType: "PosTransaction",
        entityId: transaction.id,
        newValue: {
          documentNumber: transaction.documentNumber,
          totalAmount: prepared.totalAmount.toString(),
          itemCount: prepared.items.length,
        },
      },
      tx,
    );

    return tx.posTransaction.findUniqueOrThrow({
      where: { id: transaction.id },
      include: { items: true, payments: true },
    });
  });
}

// ---------------------------------------------------------------------------
// Override batch manual — INTERNAL, TIDAK dipanggil dari UI/action kasir
// normal manapun. Disiapkan sebagai extension point (mis. koreksi/kasus
// khusus gudang) sesuai instruksi Fase 07: hanya untuk role berizin
// (`inventory.adjust`), wajib alasan, wajib audit log. Lihat docs/POS.md.
// ---------------------------------------------------------------------------

export type ManualBatchAllocationInput = { stockBatchId: string; qty: number };

export type CreatePaidTransactionWithBatchOverrideParams = CreatePaidTransactionParams & {
  overrideActorId: string;
  overrideActorRole: Role;
  overrideReason: string;
  /** Dikunci ke INDEX pada array `items` (bukan productId) — item pada
   * index yang sama harus punya productId yang cocok dengan batch yang
   * dipilih. Item TANPA entri di sini tetap dialokasikan via FEFO normal. */
  manualAllocations: Record<number, ManualBatchAllocationInput[]>;
};

/**
 * Validasi pilihan batch manual satu item: setiap batch harus benar-benar
 * milik cabang+produk+company yang sama, berstatus AVAILABLE, dan belum
 * lewat ED — override memilih BATCH MANA yang dipakai, bukan mengizinkan
 * batch yang seharusnya tidak eligible (expired/blocked/quarantined/
 * damaged/habis) untuk tetap bisa dijual. Total qty pilihan harus PERSIS
 * sama dengan qty item (tidak boleh kurang/lebih).
 */
async function planManualAllocation(
  tx: Prisma.TransactionClient,
  params: {
    companyId: string;
    branchId: string;
    productId: string;
    qtyNeeded: Prisma.Decimal;
    asOf: Date;
    choices: ManualBatchAllocationInput[];
  },
): Promise<FefoAllocationPlanLine[]> {
  if (params.choices.length === 0) {
    throw new Error("Alokasi batch manual wajib memilih minimal satu batch.");
  }

  const plan: FefoAllocationPlanLine[] = [];
  let total = new Prisma.Decimal(0);

  for (const choice of params.choices) {
    if (choice.qty <= 0) {
      throw new Error("Qty alokasi batch manual harus lebih dari 0.");
    }
    const batch = await tx.stockBatch.findFirst({
      where: {
        id: choice.stockBatchId,
        companyId: params.companyId,
        branchId: params.branchId,
        productId: params.productId,
      },
    });
    if (!batch) {
      throw new Error("Batch yang dipilih tidak ditemukan pada cabang/produk ini.");
    }
    if (batch.status !== StockBatchStatus.AVAILABLE) {
      throw new Error(`Batch "${batch.batchNumber}" berstatus ${batch.status}, tidak dapat dipilih.`);
    }
    if (batch.expiryDate.getTime() < params.asOf.getTime()) {
      throw new Error(`Batch "${batch.batchNumber}" sudah melewati ED, tidak dapat dipilih.`);
    }

    const qty = new Prisma.Decimal(choice.qty.toString());
    plan.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      unitCost: batch.unitCost,
      qty,
    });
    total = total.plus(qty);
  }

  if (!total.equals(params.qtyNeeded)) {
    throw new Error(
      `Total qty alokasi batch manual (${total.toString()}) harus persis sama dengan qty item (${params.qtyNeeded.toString()}).`,
    );
  }

  return plan;
}

export async function createPaidTransactionWithBatchOverride(
  params: CreatePaidTransactionWithBatchOverrideParams,
) {
  if (!hasPermission(params.overrideActorRole, "inventory.adjust")) {
    throw new Error("Anda tidak memiliki izin untuk melakukan override batch.");
  }
  if (!params.overrideReason.trim()) {
    throw new Error("Alasan override batch wajib diisi.");
  }

  return retryOnDocumentNumberCollision(() => runCreatePaidTransactionWithBatchOverride(params));
}

async function runCreatePaidTransactionWithBatchOverride(
  params: CreatePaidTransactionWithBatchOverrideParams,
) {
  return prisma.$transaction(async (tx) => {
    const prepared = await prepareTransaction(tx, params, params.payments);
    assertNoPrescriptionItems(prepared.items);
    const transaction = await persistTransactionHeader(
      tx,
      params,
      prepared,
      PosTransactionStatus.PAID,
      params.payments,
    );

    for (const [index, item] of prepared.items.entries()) {
      const createdItem = await tx.posTransactionItem.create({
        data: {
          posTransactionId: transaction.id,
          productId: item.productId,
          qty: item.qty.toString(),
          unitPrice: item.unitPrice.toString(),
          discountAmount: item.discountAmount.toString(),
          lineTotal: item.lineTotal.toString(),
          notes: item.notes,
        },
      });

      const manualChoices = params.manualAllocations[index];
      const asOf = transaction.paidAt ?? new Date();
      const plan = manualChoices
        ? await planManualAllocation(tx, {
            companyId: params.companyId,
            branchId: prepared.branchId,
            productId: item.productId,
            qtyNeeded: item.qty,
            asOf,
            choices: manualChoices,
          })
        : await planFefoAllocation(tx, {
            companyId: params.companyId,
            branchId: prepared.branchId,
            productId: item.productId,
            qtyNeeded: item.qty,
            asOf,
          }).catch(() => {
            throw new Error(
              `Stok "${item.productName}" tidak mencukupi (diminta ${item.qty.toString()}).`,
            );
          });

      await executeAllocationPlan(tx, {
        posTransactionItemId: createdItem.id,
        referenceId: transaction.id,
        createdById: params.overrideActorId,
        plan,
      });
    }

    await recordAudit(
      {
        companyId: params.companyId,
        branchId: prepared.branchId,
        actorId: params.overrideActorId,
        action: "PAY_WITH_BATCH_OVERRIDE",
        entityType: "PosTransaction",
        entityId: transaction.id,
        reason: params.overrideReason.trim(),
        newValue: {
          documentNumber: transaction.documentNumber,
          totalAmount: prepared.totalAmount.toString(),
          manualAllocations: params.manualAllocations,
        },
      },
      tx,
    );

    return tx.posTransaction.findUniqueOrThrow({
      where: { id: transaction.id },
      include: { items: true, payments: true },
    });
  });
}

// ---------------------------------------------------------------------------
// Resep minimum (Fase 09) — alur DUA TAHAP: create-pending (tanpa payment/
// FEFO) -> review apoteker/manager (services/prescription-service.ts) ->
// finalize (FEFO + payment). Lihat docs/PRESCRIPTION_VOID_RETURN.md.
// ---------------------------------------------------------------------------

export type CreatePendingPrescriptionParams = CreateTransactionItemsParams & {
  prescription: {
    patientName: string;
    patientPhone?: string;
    doctorName: string;
    prescriptionNumber: string;
    prescriptionDate: Date;
    imagePath?: string;
    pharmacistNotes?: string;
  };
};

/**
 * Tahap 1 alur resep: buat header PosTransaction berstatus
 * PENDING_PRESCRIPTION_REVIEW (TANPA payment, TANPA alokasi FEFO — stok
 * belum dipotong sama sekali) + baris item + Prescription terkait
 * (status PENDING_REVIEW). Ditolak bila TIDAK ADA item yang
 * `requiresPrescription` (keranjang seperti ini seharusnya lewat
 * `createPaidTransaction` biasa).
 */
export async function createPendingPrescriptionTransaction(
  params: CreatePendingPrescriptionParams,
) {
  if (!params.prescription.patientName.trim()) {
    throw new Error("Nama pasien wajib diisi.");
  }
  if (!params.prescription.doctorName.trim()) {
    throw new Error("Nama dokter wajib diisi.");
  }
  if (!params.prescription.prescriptionNumber.trim()) {
    throw new Error("Nomor resep wajib diisi.");
  }

  return retryOnDocumentNumberCollision(() =>
    runCreatePendingPrescriptionTransaction(params),
  );
}

async function runCreatePendingPrescriptionTransaction(
  params: CreatePendingPrescriptionParams,
) {
  return prisma.$transaction(async (tx) => {
    const prepared = await prepareTransaction(tx, params);
    if (!prepared.items.some((item) => item.requiresPrescription)) {
      throw new Error(
        "Keranjang tidak mengandung produk yang memerlukan resep — gunakan pembayaran langsung.",
      );
    }

    const transaction = await persistTransactionHeader(
      tx,
      params,
      prepared,
      PosTransactionStatus.PENDING_PRESCRIPTION_REVIEW,
    );

    for (const item of prepared.items) {
      await tx.posTransactionItem.create({
        data: {
          posTransactionId: transaction.id,
          productId: item.productId,
          qty: item.qty.toString(),
          unitPrice: item.unitPrice.toString(),
          discountAmount: item.discountAmount.toString(),
          lineTotal: item.lineTotal.toString(),
          notes: item.notes,
        },
      });
    }

    const prescription = await tx.prescription.create({
      data: {
        companyId: params.companyId,
        branchId: prepared.branchId,
        posTransactionId: transaction.id,
        patientName: params.prescription.patientName.trim(),
        patientPhone: params.prescription.patientPhone?.trim() || null,
        doctorName: params.prescription.doctorName.trim(),
        prescriptionNumber: params.prescription.prescriptionNumber.trim(),
        prescriptionDate: params.prescription.prescriptionDate,
        imagePath: params.prescription.imagePath?.trim() || null,
        pharmacistNotes: params.prescription.pharmacistNotes?.trim() || null,
        status: PrescriptionStatus.PENDING_REVIEW,
        createdById: params.createdById,
      },
    });

    await recordAudit(
      {
        companyId: params.companyId,
        branchId: prepared.branchId,
        actorId: params.createdById,
        action: "CREATE_PENDING_PRESCRIPTION",
        entityType: "PosTransaction",
        entityId: transaction.id,
        newValue: {
          documentNumber: transaction.documentNumber,
          prescriptionId: prescription.id,
          totalAmount: prepared.totalAmount.toString(),
        },
      },
      tx,
    );

    return tx.posTransaction.findUniqueOrThrow({
      where: { id: transaction.id },
      include: { items: true, prescription: true },
    });
  });
}

export type FinalizePrescriptionPaymentParams = {
  allowedBranchIds: string[];
  transactionId: string;
  actorId: string;
  payments: PaymentInput[];
};

/**
 * Tahap 2 alur resep: dipanggil SETELAH `Prescription.status=APPROVED`.
 * Memvalidasi shift ASLI (tempat transaksi dibuat) masih OPEN & milik
 * actor yang menyelesaikan pembayaran, lalu mengalokasikan FEFO (baru
 * SEKARANG stok dipotong) + mencatat payment + menutup status PAID +
 * menandai Prescription COMPLETED. `asOf` alokasi FEFO memakai waktu
 * finalize ini (BUKAN waktu create-pending) — batch yang baru masuk di
 * antara pengajuan & persetujuan resep tetap ikut dipertimbangkan.
 */
export async function finalizePrescriptionPayment(
  params: FinalizePrescriptionPaymentParams,
) {
  return prisma.$transaction(async (tx) => {
    const transaction = await tx.posTransaction.findFirst({
      where: { id: params.transactionId, branchId: { in: params.allowedBranchIds } },
      include: {
        items: { include: { product: { select: { name: true } } } },
        prescription: true,
      },
    });
    if (!transaction) {
      throw new Error("Transaksi tidak ditemukan atau di luar akses cabang Anda.");
    }
    if (transaction.status !== PosTransactionStatus.PENDING_PRESCRIPTION_REVIEW) {
      throw new Error("Transaksi ini tidak sedang menunggu pembayaran resep.");
    }
    if (!transaction.prescription || transaction.prescription.status !== PrescriptionStatus.APPROVED) {
      throw new Error("Resep belum disetujui — pembayaran belum dapat diproses.");
    }

    await findOpenShiftForPayment(tx, {
      shiftId: transaction.cashierShiftId,
      allowedBranchIds: params.allowedBranchIds,
      createdById: params.actorId,
    });

    const { changeAmount } = validatePayments(transaction.totalAmount, params.payments);
    const now = new Date();

    await allocateFefoForItems(tx, {
      companyId: transaction.companyId,
      branchId: transaction.branchId,
      createdById: params.actorId,
      referenceId: transaction.id,
      asOf: now,
      items: transaction.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        qty: item.qty,
      })),
    });

    await tx.payment.createMany({
      data: params.payments.map((p) => ({
        posTransactionId: transaction.id,
        method: p.method,
        amount: p.amount.toString(),
        reference: p.reference?.trim() || null,
      })),
    });

    await tx.posTransaction.update({
      where: { id: transaction.id },
      data: {
        status: PosTransactionStatus.PAID,
        paidAt: now,
        changeAmount: changeAmount.toString(),
      },
    });

    await tx.prescription.update({
      where: { id: transaction.prescription.id },
      data: { status: PrescriptionStatus.COMPLETED },
    });

    await recordAudit(
      {
        companyId: transaction.companyId,
        branchId: transaction.branchId,
        actorId: params.actorId,
        action: "PAY_AFTER_PRESCRIPTION",
        entityType: "PosTransaction",
        entityId: transaction.id,
        newValue: {
          documentNumber: transaction.documentNumber,
          totalAmount: transaction.totalAmount.toString(),
        },
      },
      tx,
    );

    return tx.posTransaction.findUniqueOrThrow({
      where: { id: transaction.id },
      include: { items: true, payments: true, prescription: true },
    });
  });
}
