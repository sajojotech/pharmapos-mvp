import { prisma } from "@/lib/prisma";
import { isGlobalBranchRole } from "@/lib/permissions";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import {
  DEFAULT_PAGE_SIZE,
  isActiveWhereClause,
  type PaginatedQuery,
} from "@/lib/pagination";
import type { Role } from "@prisma/client";

export type BranchInput = {
  companyId: string;
  code: string;
  name: string;
  address: string;
  phone: string;
};

/**
 * Daftar cabang aktif milik sebuah company, diurutkan berdasarkan kode.
 * Pembatasan akses per-user (mis. hanya cabang yang ditugaskan) akan
 * ditambahkan di lapisan pemanggil pada fase RBAC.
 */
export async function listActiveBranches(companyId: string) {
  return prisma.branch.findMany({
    where: { companyId, isActive: true },
    orderBy: { code: "asc" },
  });
}

export async function findBranchByCode(companyId: string, code: string) {
  return prisma.branch.findUnique({
    where: { companyId_code: { companyId, code } },
  });
}

/**
 * Cabang yang boleh dipilih seorang user sebagai "cabang aktif". Role global
 * (lihat lib/permissions.ts) boleh memilih dari seluruh cabang aktif
 * company; role lainnya hanya dari cabang yang ditugaskan (UserBranchAssignment).
 */
export async function listSelectableBranches(params: {
  companyId: string;
  role: Role;
  assignedBranchIds: string[];
}) {
  if (isGlobalBranchRole(params.role)) {
    return listActiveBranches(params.companyId);
  }

  if (params.assignedBranchIds.length === 0) {
    return [];
  }

  return prisma.branch.findMany({
    where: {
      id: { in: params.assignedBranchIds },
      companyId: params.companyId,
      isActive: true,
    },
    orderBy: { code: "asc" },
  });
}

/**
 * Daftar branchId yang boleh diakses seorang user — dipakai untuk membatasi
 * query data operasional (stok, batch, movement, adjustment, opname) agar
 * user cabang tidak bisa melihat/memutasi data cabang lain. Role global
 * mendapat SELURUH cabang aktif company; role lain hanya cabang yang
 * ditugaskan.
 */
export async function getAllowedBranchIds(params: {
  companyId: string;
  role: Role;
  assignedBranchIds: string[];
}): Promise<string[]> {
  const branches = await listSelectableBranches(params);
  return branches.map((b) => b.id);
}

export async function listBranchesPaginated(query: PaginatedQuery) {
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
    prisma.branch.findMany({
      where,
      orderBy: { code: "asc" },
      skip: (query.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.branch.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getBranchById(companyId: string, id: string) {
  return prisma.branch.findFirst({ where: { id, companyId } });
}

export async function createBranch(params: BranchInput) {
  try {
    return await prisma.branch.create({ data: params });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error("Kode cabang sudah dipakai.");
    }
    throw error;
  }
}

export async function updateBranch(params: BranchInput & { id: string }) {
  try {
    const result = await prisma.branch.updateMany({
      where: { id: params.id, companyId: params.companyId },
      data: {
        code: params.code,
        name: params.name,
        address: params.address,
        phone: params.phone,
      },
    });
    if (result.count === 0) throw new Error("Cabang tidak ditemukan.");
    return getBranchById(params.companyId, params.id);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error("Kode cabang sudah dipakai.");
    }
    throw error;
  }
}

export async function setBranchActive(params: {
  companyId: string;
  id: string;
  isActive: boolean;
}) {
  const result = await prisma.branch.updateMany({
    where: { id: params.id, companyId: params.companyId },
    data: { isActive: params.isActive },
  });
  if (result.count === 0) throw new Error("Cabang tidak ditemukan.");
  return getBranchById(params.companyId, params.id);
}
