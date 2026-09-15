import { prisma } from "@/lib/prisma";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import {
  DEFAULT_PAGE_SIZE,
  isActiveWhereClause,
  type PaginatedQuery,
} from "@/lib/pagination";

export async function listActiveCategories(companyId: string) {
  return prisma.category.findMany({
    where: { companyId, isActive: true },
    orderBy: { name: "asc" },
  });
}

export async function listCategoriesPaginated(query: PaginatedQuery) {
  const pageSize = query.pageSize || DEFAULT_PAGE_SIZE;
  const where = {
    companyId: query.companyId,
    isActive: isActiveWhereClause(query.status),
    name: query.q ? { contains: query.q, mode: "insensitive" as const } : undefined,
  };

  const [data, totalCount] = await Promise.all([
    prisma.category.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (query.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.category.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getCategoryById(companyId: string, id: string) {
  return prisma.category.findFirst({ where: { id, companyId } });
}

export async function createCategory(params: { companyId: string; name: string }) {
  try {
    return await prisma.category.create({
      data: { companyId: params.companyId, name: params.name },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error("Nama kategori sudah dipakai.");
    }
    throw error;
  }
}

export async function updateCategory(params: {
  companyId: string;
  id: string;
  name: string;
}) {
  try {
    const result = await prisma.category.updateMany({
      where: { id: params.id, companyId: params.companyId },
      data: { name: params.name },
    });
    if (result.count === 0) throw new Error("Kategori tidak ditemukan.");
    return getCategoryById(params.companyId, params.id);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error("Nama kategori sudah dipakai.");
    }
    throw error;
  }
}

export async function setCategoryActive(params: {
  companyId: string;
  id: string;
  isActive: boolean;
}) {
  const result = await prisma.category.updateMany({
    where: { id: params.id, companyId: params.companyId },
    data: { isActive: params.isActive },
  });
  if (result.count === 0) throw new Error("Kategori tidak ditemukan.");
  return getCategoryById(params.companyId, params.id);
}
