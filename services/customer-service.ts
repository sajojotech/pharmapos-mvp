import { prisma } from "@/lib/prisma";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import {
  DEFAULT_PAGE_SIZE,
  isActiveWhereClause,
  type PaginatedQuery,
} from "@/lib/pagination";

export type CustomerInput = {
  companyId: string;
  code?: string;
  name: string;
  phone?: string;
  address?: string;
};

export async function listCustomersPaginated(query: PaginatedQuery) {
  const pageSize = query.pageSize || DEFAULT_PAGE_SIZE;
  const where = {
    companyId: query.companyId,
    isActive: isActiveWhereClause(query.status),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" as const } },
            { code: { contains: query.q, mode: "insensitive" as const } },
            { phone: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (query.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.customer.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getCustomerById(companyId: string, id: string) {
  return prisma.customer.findFirst({ where: { id, companyId } });
}

/**
 * Daftar customer aktif (tanpa paginasi) — dipakai mengisi dropdown
 * pemilihan customer di POS (Fase 06).
 */
export async function listActiveCustomers(companyId: string) {
  return prisma.customer.findMany({
    where: { companyId, isActive: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Customer "Umum" (kode "UMUM", lihat prisma/seed.ts) — dipakai sebagai
 * customer default transaksi POS bila kasir tidak memilih customer
 * tertentu. Dilempar sebagai error eksplisit bila belum di-seed karena POS
 * tidak dapat berjalan tanpa customer default ini.
 */
export async function getDefaultCustomer(companyId: string) {
  const customer = await prisma.customer.findUnique({
    where: { companyId_code: { companyId, code: "UMUM" } },
  });
  if (!customer) {
    throw new Error(
      'Customer default "Umum" (kode UMUM) belum ada — hubungi Admin Pusat.',
    );
  }
  return customer;
}

export async function createCustomer(params: CustomerInput) {
  try {
    return await prisma.customer.create({
      data: {
        companyId: params.companyId,
        code: params.code || null,
        name: params.name,
        phone: params.phone || null,
        address: params.address || null,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error("Kode customer sudah dipakai.");
    }
    throw error;
  }
}

export async function updateCustomer(
  params: CustomerInput & { id: string },
) {
  try {
    const result = await prisma.customer.updateMany({
      where: { id: params.id, companyId: params.companyId },
      data: {
        code: params.code || null,
        name: params.name,
        phone: params.phone || null,
        address: params.address || null,
      },
    });
    if (result.count === 0) throw new Error("Customer tidak ditemukan.");
    return getCustomerById(params.companyId, params.id);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error("Kode customer sudah dipakai.");
    }
    throw error;
  }
}

export async function setCustomerActive(params: {
  companyId: string;
  id: string;
  isActive: boolean;
}) {
  const result = await prisma.customer.updateMany({
    where: { id: params.id, companyId: params.companyId },
    data: { isActive: params.isActive },
  });
  if (result.count === 0) throw new Error("Customer tidak ditemukan.");
  return getCustomerById(params.companyId, params.id);
}
