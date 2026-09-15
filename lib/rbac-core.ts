import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  hasPermission,
  isGlobalBranchRole,
  type Permission,
} from "@/lib/permissions";

/**
 * Logika RBAC & branch-access yang TIDAK bergantung pada Next.js request
 * context (auth()/cookies()/redirect()) sengaja dipisah dari lib/rbac.ts
 * (yang dijaga `server-only`) agar bisa diuji langsung dengan Vitest tanpa
 * request Next.js sungguhan — lihat tests/unit/rbac.test.ts dan
 * tests/integration/branch-access.test.ts.
 */

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  companyId: string;
  assignedBranchIds: string[];
};

export const ACTIVE_BRANCH_COOKIE = "pharmapos_active_branch";

/**
 * Cek permission murni (tanpa I/O), sesuai signature yang diminta:
 * can(user, permission, branchId). Parameter branchId opsional — bila diisi,
 * user juga harus punya akses ke cabang tsb (lihat hasBranchAccess).
 */
export function can(
  user: SessionUser,
  permission: Permission,
  branchId?: string,
): boolean {
  if (!hasPermission(user.role, permission)) return false;
  if (branchId && !hasBranchAccess(user, branchId)) return false;
  return true;
}

/**
 * Cek keanggotaan cabang murni (tanpa I/O ke database) — role global selalu
 * lolos, role lain harus ada di assignedBranchIds. Verifikasi tambahan
 * (cabang benar-benar ada, aktif, & satu company) dilakukan di
 * findAccessibleBranch/requireBranchAccess karena butuh akses database.
 */
export function hasBranchAccess(user: SessionUser, branchId: string): boolean {
  if (isGlobalBranchRole(user.role)) return true;
  return user.assignedBranchIds.includes(branchId);
}

/**
 * Versi hasBranchAccess yang juga memvalidasi ke database (cabang ada,
 * aktif, dan satu company dengan user) — dipakai di titik-titik yang
 * benar-benar mengubah/menyimpan branchId (mis. setActiveBranchAction),
 * bukan hanya baca dari token session.
 */
export async function findAccessibleBranch(user: SessionUser, branchId: string) {
  if (!hasBranchAccess(user, branchId)) return null;

  return prisma.branch.findFirst({
    where: { id: branchId, companyId: user.companyId, isActive: true },
  });
}

/**
 * Resolusi activeBranchId murni (tanpa I/O) dari kombinasi role, cabang yang
 * ditugaskan, cabang yang tersedia (untuk role global), dan pilihan yang
 * tersimpan di cookie. Dipisah dari getActiveBranchContext() agar mudah
 * diuji tanpa perlu request/cookies Next.js sungguhan.
 */
export function resolveActiveBranchId(params: {
  role: Role;
  assignedBranchIds: string[];
  availableBranchIds: string[];
  cookieBranchId: string | null;
}): string | null {
  const permittedIds = isGlobalBranchRole(params.role)
    ? params.availableBranchIds
    : params.assignedBranchIds;

  if (permittedIds.length === 0) return null;

  if (params.cookieBranchId && permittedIds.includes(params.cookieBranchId)) {
    return params.cookieBranchId;
  }

  return permittedIds[0] ?? null;
}
