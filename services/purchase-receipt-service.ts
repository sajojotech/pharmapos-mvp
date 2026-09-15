import { Prisma, StockDocumentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { createWithSequentialNumber } from "@/lib/document-number";
import { recordAudit } from "@/services/audit-service";
import { receiveStockToBatch } from "@/services/stock-ledger";

function resolveEffectiveBranchIds(
  allowedBranchIds: string[],
  requestedBranchId?: string,
): string[] {
  if (!requestedBranchId) return allowedBranchIds;
  return allowedBranchIds.includes(requestedBranchId) ? [requestedBranchId] : [];
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export type ReceiptListQuery = {
  companyId: string;
  allowedBranchIds: string[];
  branchId?: string;
  status?: StockDocumentStatus;
  page: number;
  pageSize?: number;
};

export async function listReceiptsPaginated(query: ReceiptListQuery) {
  const pageSize = query.pageSize || DEFAULT_PAGE_SIZE;
  const branchIds = resolveEffectiveBranchIds(query.allowedBranchIds, query.branchId);

  const where: Prisma.PurchaseReceiptWhereInput = {
    companyId: query.companyId,
    branchId: { in: branchIds },
    status: query.status,
  };

  const [data, totalCount] = await Promise.all([
    prisma.purchaseReceipt.findMany({
      where,
      include: {
        branch: { select: { code: true, name: true } },
        supplier: { select: { name: true } },
        createdBy: { select: { name: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.purchaseReceipt.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getReceiptById(allowedBranchIds: string[], id: string) {
  return prisma.purchaseReceipt.findFirst({
    where: { id, branchId: { in: allowedBranchIds } },
    include: {
      branch: { select: { code: true, name: true } },
      supplier: { select: { name: true, code: true } },
      createdBy: { select: { name: true } },
      postedBy: { select: { name: true } },
      items: {
        include: {
          product: { select: { sku: true, name: true } },
          unit: { select: { name: true, symbol: true } },
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Create / update draft
// ---------------------------------------------------------------------------

export type ReceiptItemInput = {
  productId: string;
  unitId: string;
  qty: number;
  unitCost: number;
  discountAmount: number;
  batchNumber?: string;
  expiryDate?: Date;
  notes?: string;
};

export type CreateReceiptParams = {
  companyId: string;
  branchId: string;
  supplierId: string;
  supplierInvoiceNumber: string;
  supplierInvoiceDate: Date;
  receivedDate: Date;
  notes?: string;
  createdById: string;
  items: ReceiptItemInput[];
};

function itemsCreateData(items: ReceiptItemInput[]) {
  return items.map((item) => ({
    productId: item.productId,
    unitId: item.unitId,
    qty: item.qty.toString(),
    unitCost: item.unitCost.toString(),
    discountAmount: item.discountAmount.toString(),
    batchNumber: item.batchNumber || null,
    expiryDate: item.expiryDate ?? null,
    notes: item.notes || null,
  }));
}

/**
 * Validasi `supplierId` + seluruh `productId` item benar-benar milik
 * `companyId` pemanggil (Fase 11 hardening) — tanpa ini, dokumen bisa
 * dibuat dengan referensi supplier/produk company LAIN (header dokumen
 * sendiri sudah company-scoped, tapi field FK di dalamnya tidak pernah
 * dicek), yang saat postReceipt() memakai data produk (baseUnitId, dst)
 * milik company yang salah untuk membuat StockBatch/StockMovement.
 */
async function assertReceiptReferencesBelongToCompany(
  companyId: string,
  supplierId: string,
  items: ReceiptItemInput[],
) {
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, companyId } });
  if (!supplier) {
    throw new Error("Supplier tidak ditemukan.");
  }

  const productIds = [...new Set(items.map((item) => item.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, companyId },
    select: { id: true },
  });
  if (products.length !== productIds.length) {
    throw new Error("Salah satu produk pada item tidak ditemukan.");
  }
}

export async function createDraftReceipt(params: CreateReceiptParams) {
  if (params.items.length === 0) {
    throw new Error("Purchase receipt harus memiliki minimal satu item.");
  }
  await assertReceiptReferencesBelongToCompany(params.companyId, params.supplierId, params.items);

  return createWithSequentialNumber({
    prefix: "PR",
    countExisting: () =>
      prisma.purchaseReceipt.count({ where: { companyId: params.companyId } }),
    attemptCreate: (documentNumber) =>
      prisma.purchaseReceipt.create({
        data: {
          companyId: params.companyId,
          branchId: params.branchId,
          supplierId: params.supplierId,
          documentNumber,
          supplierInvoiceNumber: params.supplierInvoiceNumber,
          supplierInvoiceDate: params.supplierInvoiceDate,
          receivedDate: params.receivedDate,
          notes: params.notes,
          createdById: params.createdById,
          items: { create: itemsCreateData(params.items) },
        },
        include: { items: true },
      }),
  });
}

export type UpdateReceiptParams = Omit<CreateReceiptParams, "companyId" | "createdById"> & {
  id: string;
  companyId: string;
  allowedBranchIds: string[];
};

/**
 * Update dokumen DRAFT: header + full-replace item (hapus semua item lama,
 * buat ulang) — konsisten dengan pola sinkronisasi konversi satuan di
 * Product (Fase 03). Menolak bila dokumen bukan DRAFT atau di luar akses
 * cabang pemanggil.
 */
export async function updateDraftReceipt(params: UpdateReceiptParams) {
  if (params.items.length === 0) {
    throw new Error("Purchase receipt harus memiliki minimal satu item.");
  }
  await assertReceiptReferencesBelongToCompany(params.companyId, params.supplierId, params.items);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.purchaseReceipt.findFirst({
      where: {
        id: params.id,
        companyId: params.companyId,
        branchId: { in: params.allowedBranchIds },
      },
    });
    if (!existing) {
      throw new Error("Purchase receipt tidak ditemukan atau di luar akses cabang Anda.");
    }
    if (existing.status !== StockDocumentStatus.DRAFT) {
      throw new Error("Hanya dokumen berstatus DRAFT yang dapat diedit.");
    }

    await tx.purchaseReceiptItem.deleteMany({ where: { purchaseReceiptId: existing.id } });

    return tx.purchaseReceipt.update({
      where: { id: existing.id },
      data: {
        branchId: params.branchId,
        supplierId: params.supplierId,
        supplierInvoiceNumber: params.supplierInvoiceNumber,
        supplierInvoiceDate: params.supplierInvoiceDate,
        receivedDate: params.receivedDate,
        notes: params.notes,
        items: { create: itemsCreateData(params.items) },
      },
      include: { items: true },
    });
  });
}

// ---------------------------------------------------------------------------
// Post / cancel
// ---------------------------------------------------------------------------

/**
 * Cari faktor konversi dari `unitId` (satuan yang dipakai saat membeli) ke
 * base unit produk. Mengembalikan 1 bila unitId memang sudah base unit.
 */
async function resolveConversionFactor(
  tx: Prisma.TransactionClient,
  productId: string,
  unitId: string,
  baseUnitId: string,
): Promise<Prisma.Decimal> {
  if (unitId === baseUnitId) return new Prisma.Decimal(1);

  const conversion = await tx.productUnitConversion.findUnique({
    where: { productId_unitId: { productId, unitId } },
  });
  if (!conversion) {
    throw new Error(
      "Salah satu produk belum memiliki konversi untuk satuan pembelian yang dipilih.",
    );
  }
  return new Prisma.Decimal(conversion.conversionFactor.toString());
}

/**
 * Posting: validasi penuh + konversi qty/harga ke base unit + panggil
 * receiveStockToBatch per item, seluruhnya dalam SATU transaction. Gagal di
 * satu item = seluruh dokumen rollback (dokumen tetap DRAFT, tidak ada
 * batch/movement yang tercipta sebagian) — lihat docs/PURCHASING.md.
 */
export async function postReceipt(params: {
  companyId: string;
  allowedBranchIds: string[];
  id: string;
  postedById: string;
}) {
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.purchaseReceipt.findFirst({
      where: {
        id: params.id,
        companyId: params.companyId,
        branchId: { in: params.allowedBranchIds },
      },
      include: { items: true, supplier: true },
    });
    if (!receipt) {
      throw new Error("Purchase receipt tidak ditemukan atau di luar akses cabang Anda.");
    }
    if (receipt.status !== StockDocumentStatus.DRAFT) {
      throw new Error("Hanya dokumen berstatus DRAFT yang dapat diposting.");
    }
    if (receipt.items.length === 0) {
      throw new Error("Dokumen tidak memiliki item untuk diposting.");
    }
    if (!receipt.supplier.isActive) {
      throw new Error(`Supplier "${receipt.supplier.name}" sudah nonaktif.`);
    }

    const warehouse = await tx.warehouse.findFirst({
      where: { branchId: receipt.branchId, isDefault: true, isActive: true },
    });
    if (!warehouse) {
      throw new Error("Cabang ini belum memiliki warehouse default yang aktif.");
    }

    for (const item of receipt.items) {
      const product = await tx.product.findFirst({
        where: { id: item.productId, companyId: receipt.companyId },
      });
      if (!product) {
        throw new Error("Salah satu produk pada dokumen ini tidak ditemukan.");
      }
      if (!product.isActive) {
        throw new Error(`Produk "${product.name}" sudah nonaktif dan tidak dapat diterima.`);
      }

      const qty = new Prisma.Decimal(item.qty.toString());
      if (qty.lessThanOrEqualTo(0)) {
        throw new Error(`Qty produk "${product.name}" harus lebih dari 0.`);
      }

      if (!item.batchNumber || !item.batchNumber.trim()) {
        throw new Error(`Nomor batch wajib diisi untuk produk "${product.name}" sebelum posting.`);
      }
      if (!item.expiryDate) {
        throw new Error(`Tanggal ED wajib diisi untuk produk "${product.name}" sebelum posting.`);
      }
      if (item.expiryDate.getTime() <= receipt.receivedDate.getTime()) {
        throw new Error(
          `Tanggal ED produk "${product.name}" harus lebih besar dari tanggal penerimaan.`,
        );
      }

      const unitCost = new Prisma.Decimal(item.unitCost.toString());
      if (unitCost.lessThan(0)) {
        throw new Error(`Harga beli produk "${product.name}" tidak boleh negatif.`);
      }
      const discount = new Prisma.Decimal(item.discountAmount.toString());
      if (discount.lessThan(0)) {
        throw new Error(`Diskon produk "${product.name}" tidak boleh negatif.`);
      }

      const lineSubtotal = qty.times(unitCost);
      if (discount.greaterThan(lineSubtotal)) {
        throw new Error(`Diskon produk "${product.name}" tidak boleh melebihi subtotal baris.`);
      }
      const lineTotal = lineSubtotal.minus(discount);

      const conversionFactor = await resolveConversionFactor(
        tx,
        item.productId,
        item.unitId,
        product.baseUnitId,
      );

      const baseQty = qty.times(conversionFactor);
      const baseUnitCost = lineTotal.dividedBy(baseQty);

      await receiveStockToBatch(tx, {
        companyId: receipt.companyId,
        branchId: receipt.branchId,
        warehouseId: warehouse.id,
        productId: item.productId,
        batchNumber: item.batchNumber,
        expiryDate: item.expiryDate,
        receivedDate: receipt.receivedDate,
        unitCost: baseUnitCost,
        qty: baseQty,
        movementType: "PURCHASE_RECEIPT",
        referenceType: "PurchaseReceipt",
        referenceId: receipt.id,
        createdById: params.postedById,
        notes: item.notes ?? undefined,
      });
    }

    const posted = await tx.purchaseReceipt.update({
      where: { id: receipt.id },
      data: {
        status: StockDocumentStatus.POSTED,
        postedAt: new Date(),
        postedById: params.postedById,
      },
    });

    await recordAudit(
      {
        companyId: receipt.companyId,
        branchId: receipt.branchId,
        actorId: params.postedById,
        action: "POST",
        entityType: "PurchaseReceipt",
        entityId: receipt.id,
        newValue: {
          documentNumber: receipt.documentNumber,
          itemCount: receipt.items.length,
        },
      },
      tx,
    );

    return posted;
  });
}

/**
 * Batalkan dokumen DRAFT (belum pernah memengaruhi stok, sehingga tidak
 * perlu reversal apa pun). MVP ini SENGAJA tidak menyediakan pembatalan
 * dokumen yang sudah POSTED — lihat docs/PURCHASING.md.
 */
export async function cancelDraftReceipt(params: {
  companyId: string;
  allowedBranchIds: string[];
  id: string;
  actorId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.purchaseReceipt.findFirst({
      where: {
        id: params.id,
        companyId: params.companyId,
        branchId: { in: params.allowedBranchIds },
      },
    });
    if (!receipt) {
      throw new Error("Purchase receipt tidak ditemukan atau di luar akses cabang Anda.");
    }
    if (receipt.status !== StockDocumentStatus.DRAFT) {
      throw new Error("Hanya dokumen berstatus DRAFT yang dapat dibatalkan.");
    }

    const cancelled = await tx.purchaseReceipt.update({
      where: { id: receipt.id },
      data: { status: StockDocumentStatus.CANCELLED },
    });

    await recordAudit(
      {
        companyId: receipt.companyId,
        branchId: receipt.branchId,
        actorId: params.actorId,
        action: "CANCEL",
        entityType: "PurchaseReceipt",
        entityId: receipt.id,
        newValue: { documentNumber: receipt.documentNumber },
      },
      tx,
    );

    return cancelled;
  });
}
