import { prisma } from "@/lib/prisma";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import {
  DEFAULT_PAGE_SIZE,
  isActiveWhereClause,
  type PaginatedQuery,
} from "@/lib/pagination";

export type WarehouseInput = {
  branchId: string;
  code: string;
  name: string;
  isDefault: boolean;
};

export async function listWarehousesPaginated(query: PaginatedQuery) {
  const pageSize = query.pageSize || DEFAULT_PAGE_SIZE;
  const where = {
    branch: { companyId: query.companyId },
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
    prisma.warehouse.findMany({
      where,
      include: { branch: { select: { code: true, name: true } } },
      orderBy: [{ branch: { code: "asc" } }, { code: "asc" }],
      skip: (query.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.warehouse.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getWarehouseById(companyId: string, id: string) {
  return prisma.warehouse.findFirst({
    where: { id, branch: { companyId } },
    include: { branch: { select: { code: true, name: true } } },
  });
}

/**
 * Memastikan hanya ada satu warehouse default per cabang: bila warehouse ini
 * di-set default, warehouse lain di cabang yang sama otomatis dilepas status
 * default-nya dalam satu transaction (integritas data, bukan sekadar UI).
 */
export async function createWarehouse(params: WarehouseInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.create({ data: params });
      if (params.isDefault) {
        await tx.warehouse.updateMany({
          where: { branchId: params.branchId, id: { not: warehouse.id } },
          data: { isDefault: false },
        });
      }
      return warehouse;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error("Kode warehouse sudah dipakai di cabang ini.");
    }
    throw error;
  }
}

export async function updateWarehouse(params: WarehouseInput & { id: string }) {
  try {
    return await prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.update({
        where: { id: params.id },
        data: {
          branchId: params.branchId,
          code: params.code,
          name: params.name,
          isDefault: params.isDefault,
        },
      });
      if (params.isDefault) {
        await tx.warehouse.updateMany({
          where: { branchId: params.branchId, id: { not: warehouse.id } },
          data: { isDefault: false },
        });
      }
      return warehouse;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error("Kode warehouse sudah dipakai di cabang ini.");
    }
    throw error;
  }
}

export async function setWarehouseActive(params: {
  companyId: string;
  id: string;
  isActive: boolean;
}) {
  const existing = await getWarehouseById(params.companyId, params.id);
  if (!existing) throw new Error("Warehouse tidak ditemukan.");
  return prisma.warehouse.update({
    where: { id: params.id },
    data: { isActive: params.isActive },
  });
}
