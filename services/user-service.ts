import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { isGlobalBranchRole } from "@/lib/permissions";
import {
  DEFAULT_PAGE_SIZE,
  isActiveWhereClause,
  type PaginatedQuery,
} from "@/lib/pagination";

const userListSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  branchAssignments: {
    select: { branch: { select: { id: true, code: true, name: true } } },
  },
} as const;

/**
 * Daftar user beserta cabang yang ditugaskan. Sengaja TIDAK menyertakan
 * passwordHash — fungsi ini dipakai untuk tampilan manajemen user, bukan
 * untuk keperluan autentikasi (lihat services/auth-service.ts).
 */
export async function listUsersWithBranches(companyId: string) {
  return prisma.user.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
    select: userListSelect,
  });
}

export async function listUsersPaginated(query: PaginatedQuery) {
  const pageSize = query.pageSize || DEFAULT_PAGE_SIZE;
  const where = {
    companyId: query.companyId,
    isActive: isActiveWhereClause(query.status),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" as const } },
            { email: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { name: "asc" },
      select: userListSelect,
      skip: (query.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getUserById(companyId: string, id: string) {
  return prisma.user.findFirst({
    where: { id, companyId },
    select: userListSelect,
  });
}

export type UserInput = {
  companyId: string;
  email: string;
  name: string;
  role: Role;
  branchIds: string[];
};

/**
 * Membuat user + hash password + penugasan cabang (bila role bukan role
 * global) dalam satu transaction. Role global (OWNER/CENTRAL_ADMIN/
 * FINANCE_AUDITOR) sengaja tidak diberi baris UserBranchAssignment — lihat
 * docs/DATABASE.md poin 7 dan docs/AUTH.md.
 */
export async function createUser(params: UserInput & { password: string }) {
  const passwordHash = await hashPassword(params.password);
  const branchIds = isGlobalBranchRole(params.role) ? [] : params.branchIds;

  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          companyId: params.companyId,
          email: params.email,
          name: params.name,
          role: params.role,
          passwordHash,
        },
      });

      if (branchIds.length > 0) {
        await tx.userBranchAssignment.createMany({
          data: branchIds.map((branchId) => ({ userId: user.id, branchId })),
        });
      }

      // Select ulang (BUKAN kembalikan `user` dari tx.user.create langsung)
      // supaya (a) branchAssignments yang baru dibuat ikut terbawa, dan
      // (b) passwordHash TIDAK PERNAH keluar dari fungsi ini sama sekali
      // (Fase 11 hardening) — lihat userListSelect di atas.
      return tx.user.findUniqueOrThrow({ where: { id: user.id }, select: userListSelect });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error("Email sudah dipakai user lain.");
    }
    throw error;
  }
}

/**
 * Update user (nama/role/cabang) + full-replace UserBranchAssignment, dan
 * opsional ganti password (kosongkan untuk mempertahankan password lama).
 */
export async function updateUser(
  params: UserInput & { id: string; password?: string },
) {
  const branchIds = isGlobalBranchRole(params.role) ? [] : params.branchIds;

  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: params.id },
        data: {
          email: params.email,
          name: params.name,
          role: params.role,
          ...(params.password
            ? { passwordHash: await hashPassword(params.password) }
            : {}),
        },
      });

      await tx.userBranchAssignment.deleteMany({ where: { userId: user.id } });
      if (branchIds.length > 0) {
        await tx.userBranchAssignment.createMany({
          data: branchIds.map((branchId) => ({ userId: user.id, branchId })),
        });
      }

      // Lihat catatan di createUser() — select ulang tanpa passwordHash.
      return tx.user.findUniqueOrThrow({ where: { id: user.id }, select: userListSelect });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error("Email sudah dipakai user lain.");
    }
    throw error;
  }
}

export async function setUserActive(params: {
  companyId: string;
  id: string;
  isActive: boolean;
}) {
  const result = await prisma.user.updateMany({
    where: { id: params.id, companyId: params.companyId },
    data: { isActive: params.isActive },
  });
  if (result.count === 0) throw new Error("User tidak ditemukan.");
  return prisma.user.findUnique({ where: { id: params.id }, select: userListSelect });
}
