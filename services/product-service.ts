import { prisma } from "@/lib/prisma";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import {
  DEFAULT_PAGE_SIZE,
  isActiveWhereClause,
  type PaginatedQuery,
} from "@/lib/pagination";

/**
 * Daftar produk aktif milik sebuah company. Produk adalah master terpusat
 * (tidak per-cabang) — harga/stok per-cabang ditangani model terpisah pada
 * fase berikutnya.
 */
export async function listActiveProducts(companyId: string) {
  return prisma.product.findMany({
    where: { companyId, isActive: true },
    orderBy: { name: "asc" },
    include: { category: true, baseUnit: true },
  });
}

export async function findProductBySku(companyId: string, sku: string) {
  return prisma.product.findUnique({
    where: { companyId_sku: { companyId, sku } },
    include: { category: true, baseUnit: true, barcodes: true },
  });
}

/**
 * Lookup produk lewat barcode fisik (unik global) — dipakai nanti oleh
 * pencarian scan barcode di POS.
 */
export async function findProductByBarcode(barcode: string) {
  const productBarcode = await prisma.productBarcode.findUnique({
    where: { barcode },
    include: { product: true },
  });

  return productBarcode?.product ?? null;
}

export type ProductUnitConversionInput = {
  unitId: string;
  conversionFactor: number;
};

export type ProductInput = {
  companyId: string;
  sku: string;
  name: string;
  genericName?: string;
  brandName?: string;
  categoryId: string;
  baseUnitId: string;
  defaultSellingPrice: number;
  defaultMinStock: number;
  requiresPrescription: boolean;
  isControlled: boolean;
  isActive: boolean;
  notes?: string;
  /** Barcode fisik utama (opsional). Fase ini hanya mendukung 1 barcode/produk. */
  barcode?: string;
  unitConversions: ProductUnitConversionInput[];
};

export async function listProductsPaginated(query: PaginatedQuery) {
  const pageSize = query.pageSize || DEFAULT_PAGE_SIZE;
  const where = {
    companyId: query.companyId,
    isActive: isActiveWhereClause(query.status),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" as const } },
            { sku: { contains: query.q, mode: "insensitive" as const } },
            { genericName: { contains: query.q, mode: "insensitive" as const } },
            { barcodes: { some: { barcode: { contains: query.q } } } },
          ],
        }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { category: true, baseUnit: true, barcodes: true },
      orderBy: { name: "asc" },
      skip: (query.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getProductDetail(companyId: string, id: string) {
  return prisma.product.findFirst({
    where: { id, companyId },
    include: {
      category: true,
      baseUnit: true,
      barcodes: true,
      unitConversions: { include: { unit: true }, orderBy: { createdAt: "asc" } },
      branchPrices: {
        include: { branch: { select: { id: true, code: true, name: true } } },
        orderBy: { branch: { code: "asc" } },
      },
    },
  });
}

/**
 * Membuat produk + (opsional) barcode utama + daftar konversi satuan dalam
 * satu transaction — semua-atau-tidak-sama-sekali, konsisten dengan aturan
 * proyek untuk mutasi multi-tabel.
 */
export async function createProduct(params: ProductInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          companyId: params.companyId,
          sku: params.sku,
          name: params.name,
          genericName: params.genericName || null,
          brandName: params.brandName || null,
          categoryId: params.categoryId,
          baseUnitId: params.baseUnitId,
          defaultSellingPrice: params.defaultSellingPrice.toString(),
          defaultMinStock: params.defaultMinStock.toString(),
          requiresPrescription: params.requiresPrescription,
          isControlled: params.isControlled,
          isActive: params.isActive,
          notes: params.notes || null,
        },
      });

      if (params.barcode) {
        await tx.productBarcode.create({
          data: { productId: product.id, barcode: params.barcode },
        });
      }

      if (params.unitConversions.length > 0) {
        await tx.productUnitConversion.createMany({
          data: params.unitConversions.map((uc) => ({
            productId: product.id,
            unitId: uc.unitId,
            conversionFactor: uc.conversionFactor.toString(),
          })),
        });
      }

      return product;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error(
        "SKU atau barcode sudah dipakai oleh produk lain. Periksa kembali isian Anda.",
      );
    }
    throw error;
  }
}

/**
 * Update produk + sinkronisasi barcode utama + full-replace daftar konversi
 * satuan, dalam satu transaction.
 */
export async function updateProduct(params: ProductInput & { id: string }) {
  try {
    return await prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id: params.id },
        data: {
          sku: params.sku,
          name: params.name,
          genericName: params.genericName || null,
          brandName: params.brandName || null,
          categoryId: params.categoryId,
          baseUnitId: params.baseUnitId,
          defaultSellingPrice: params.defaultSellingPrice.toString(),
          defaultMinStock: params.defaultMinStock.toString(),
          requiresPrescription: params.requiresPrescription,
          isControlled: params.isControlled,
          isActive: params.isActive,
          notes: params.notes || null,
        },
      });

      const existingBarcode = await tx.productBarcode.findFirst({
        where: { productId: product.id },
        orderBy: { createdAt: "asc" },
      });

      if (params.barcode) {
        if (existingBarcode) {
          if (existingBarcode.barcode !== params.barcode) {
            await tx.productBarcode.update({
              where: { id: existingBarcode.id },
              data: { barcode: params.barcode },
            });
          }
        } else {
          await tx.productBarcode.create({
            data: { productId: product.id, barcode: params.barcode },
          });
        }
      } else if (existingBarcode) {
        await tx.productBarcode.delete({ where: { id: existingBarcode.id } });
      }

      await tx.productUnitConversion.deleteMany({ where: { productId: product.id } });
      if (params.unitConversions.length > 0) {
        await tx.productUnitConversion.createMany({
          data: params.unitConversions.map((uc) => ({
            productId: product.id,
            unitId: uc.unitId,
            conversionFactor: uc.conversionFactor.toString(),
          })),
        });
      }

      return product;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error(
        "SKU atau barcode sudah dipakai oleh produk lain. Periksa kembali isian Anda.",
      );
    }
    throw error;
  }
}

export async function setProductActive(params: {
  companyId: string;
  id: string;
  isActive: boolean;
}) {
  const result = await prisma.product.updateMany({
    where: { id: params.id, companyId: params.companyId },
    data: { isActive: params.isActive },
  });
  if (result.count === 0) throw new Error("Produk tidak ditemukan.");
  return prisma.product.findUnique({ where: { id: params.id } });
}

// ---------------------------------------------------------------------------
// Harga override per cabang (ProductBranchPrice)
// ---------------------------------------------------------------------------

export type ProductBranchPriceInput = {
  productId: string;
  branchId: string;
  price: number;
  effectiveDate?: Date | null;
  isActive: boolean;
};

export async function createProductBranchPrice(params: ProductBranchPriceInput) {
  try {
    return await prisma.productBranchPrice.create({
      data: {
        productId: params.productId,
        branchId: params.branchId,
        price: params.price.toString(),
        effectiveDate: params.effectiveDate ?? null,
        isActive: params.isActive,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error("Produk ini sudah punya harga override untuk cabang tsb.");
    }
    throw error;
  }
}

export async function updateProductBranchPrice(
  params: ProductBranchPriceInput & { id: string },
) {
  try {
    const result = await prisma.productBranchPrice.updateMany({
      where: { id: params.id, productId: params.productId },
      data: {
        branchId: params.branchId,
        price: params.price.toString(),
        effectiveDate: params.effectiveDate ?? null,
        isActive: params.isActive,
      },
    });
    if (result.count === 0) {
      throw new Error("Data harga tidak ditemukan untuk produk ini.");
    }
    return getProductBranchPriceById(params.productId, params.id);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error("Produk ini sudah punya harga override untuk cabang tsb.");
    }
    throw error;
  }
}

export async function setProductBranchPriceActive(params: {
  id: string;
  productId: string;
  isActive: boolean;
}) {
  const result = await prisma.productBranchPrice.updateMany({
    where: { id: params.id, productId: params.productId },
    data: { isActive: params.isActive },
  });
  if (result.count === 0) {
    throw new Error("Data harga tidak ditemukan untuk produk ini.");
  }
  return getProductBranchPriceById(params.productId, params.id);
}

/**
 * `productId` WAJIB diisi (Fase 11 hardening) — `ProductBranchPrice` tidak
 * punya kolom `companyId` langsung, hanya lewat relasi `productId`.
 * Pemanggil (Server Action) HARUS sudah memvalidasi `productId` tsb milik
 * `companyId` user (mis. lewat `getProductDetail`) sebelum memanggil ini,
 * supaya baris harga milik produk company LAIN tidak bisa dibaca/diubah
 * hanya dengan menebak `id`.
 */
export async function getProductBranchPriceById(productId: string, id: string) {
  return prisma.productBranchPrice.findFirst({ where: { id, productId } });
}

/**
 * Untuk setiap produk aktif: base unit (factor 1) + seluruh satuan
 * konversi terdaftar (mis. Box, Strip) — satu query untuk SEMUA produk
 * sekaligus. Dipakai mengisi form Purchase Receipt yang butuh tahu satuan
 * pembelian valid untuk produk apa pun yang dipilih user, tanpa round-trip
 * per produk. Faktor ini dipakai services/purchase-receipt-service.ts
 * untuk mengonversi qty/harga ke base unit saat posting.
 */
export async function listActiveProductsWithPurchasableUnits(companyId: string) {
  const activeProducts = await prisma.product.findMany({
    where: { companyId, isActive: true },
    include: {
      baseUnit: { select: { id: true, name: true, symbol: true } },
      unitConversions: {
        include: { unit: { select: { id: true, name: true, symbol: true } } },
      },
    },
    orderBy: { name: "asc" },
  });

  return activeProducts.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    units: [
      {
        unitId: product.baseUnit.id,
        name: product.baseUnit.name,
        symbol: product.baseUnit.symbol,
        conversionFactor: "1",
      },
      ...product.unitConversions.map((uc) => ({
        unitId: uc.unit.id,
        name: uc.unit.name,
        symbol: uc.unit.symbol,
        conversionFactor: uc.conversionFactor.toString(),
      })),
    ],
  }));
}

