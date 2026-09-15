import { prisma } from "@/lib/prisma";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import {
  DEFAULT_PAGE_SIZE,
  isActiveWhereClause,
  type PaginatedQuery,
} from "@/lib/pagination";

export type SupplierInput = {
  companyId: string;
  code?: string;
  name: string;
  phone?: string;
  address?: string;
};

export async function listSuppliersPaginated(query: PaginatedQuery) {
  const pageSize = query.pageSize || DEFAULT_PAGE_SIZE;
  const where = {
    companyId: query.companyId,
    isActive: isActiveWhereClause(query.status),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" as const } },
            { code: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    prisma.supplier.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (query.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.supplier.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getSupplierById(companyId: string, id: string) {
  return prisma.supplier.findFirst({ where: { id, companyId } });
}

export async function createSupplier(params: SupplierInput) {
  try {
    return await prisma.supplier.create({
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
      throw new Error("Kode supplier sudah dipakai.");
    }
    throw error;
  }
}

export async function updateSupplier(
  params: SupplierInput & { id: string },
) {
  try {
    const result = await prisma.supplier.updateMany({
      where: { id: params.id, companyId: params.companyId },
      data: {
        code: params.code || null,
        name: params.name,
        phone: params.phone || null,
        address: params.address || null,
      },
    });
    if (result.count === 0) throw new Error("Supplier tidak ditemukan.");
    return getSupplierById(params.companyId, params.id);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error("Kode supplier sudah dipakai.");
    }
    throw error;
  }
}

export async function setSupplierActive(params: {
  companyId: string;
  id: string;
  isActive: boolean;
}) {
  const result = await prisma.supplier.updateMany({
    where: { id: params.id, companyId: params.companyId },
    data: { isActive: params.isActive },
  });
  if (result.count === 0) throw new Error("Supplier tidak ditemukan.");
  return getSupplierById(params.companyId, params.id);
}
