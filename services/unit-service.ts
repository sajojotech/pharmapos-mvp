import { prisma } from "@/lib/prisma";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import {
  DEFAULT_PAGE_SIZE,
  isActiveWhereClause,
  type PaginatedQuery,
} from "@/lib/pagination";

export async function listActiveUnits(companyId: string) {
  return prisma.unit.findMany({
    where: { companyId, isActive: true },
    orderBy: { name: "asc" },
  });
}

export async function listUnitsPaginated(query: PaginatedQuery) {
  const pageSize = query.pageSize || DEFAULT_PAGE_SIZE;
  const where = {
    companyId: query.companyId,
    isActive: isActiveWhereClause(query.status),
    name: query.q ? { contains: query.q, mode: "insensitive" as const } : undefined,
  };

  const [data, totalCount] = await Promise.all([
    prisma.unit.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (query.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.unit.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getUnitById(companyId: string, id: string) {
  return prisma.unit.findFirst({ where: { id, companyId } });
}

export async function createUnit(params: {
  companyId: string;
  name: string;
  symbol?: string;
}) {
  try {
    return await prisma.unit.create({
      data: { companyId: params.companyId, name: params.name, symbol: params.symbol },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error("Nama satuan sudah dipakai.");
    }
    throw error;
  }
}

export async function updateUnit(params: {
  companyId: string;
  id: string;
  name: string;
  symbol?: string;
}) {
  try {
    const result = await prisma.unit.updateMany({
      where: { id: params.id, companyId: params.companyId },
      data: { name: params.name, symbol: params.symbol },
    });
    if (result.count === 0) throw new Error("Satuan tidak ditemukan.");
    return getUnitById(params.companyId, params.id);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error("Nama satuan sudah dipakai.");
    }
    throw error;
  }
}

export async function setUnitActive(params: {
  companyId: string;
  id: string;
  isActive: boolean;
}) {
  const result = await prisma.unit.updateMany({
    where: { id: params.id, companyId: params.companyId },
    data: { isActive: params.isActive },
  });
  if (result.count === 0) throw new Error("Satuan tidak ditemukan.");
  return getUnitById(params.companyId, params.id);
}
