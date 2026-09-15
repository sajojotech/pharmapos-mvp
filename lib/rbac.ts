import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isGlobalBranchRole, type Permission } from "@/lib/permissions";
import { listActiveBranches } from "@/services/branch-service";
import {
  ACTIVE_BRANCH_COOKIE,
  can,
  findAccessibleBranch,
  hasBranchAccess,
  resolveActiveBranchId,
  type SessionUser,
} from "@/lib/rbac-core";

export {
  ACTIVE_BRANCH_COOKIE,
  can,
  findAccessibleBranch,
  hasBranchAccess,
  resolveActiveBranchId,
};
export type { SessionUser };

/**
 * Ambil user dari session Auth.js tanpa redirect. Kembalikan null bila
 * belum login. Dipakai oleh halaman publik (mis. /login) yang perlu tahu
 * status login tanpa memaksa redirect.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user) return null;

  // Dibangun eksplisit (bukan cast langsung) karena tipe bawaan Auth.js
  // untuk `email`/`name` bersifat opsional/nullable (DefaultSession), padahal
  // pada aplikasi ini keduanya selalu terisi (diisi di callbacks `jwt`/
  // `session` pada lib/auth.ts dari data User yang wajib punya email/name).
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? "",
    role: session.user.role,
    companyId: session.user.companyId,
    assignedBranchIds: session.user.assignedBranchIds,
  };
}

/**
 * Wajib login. Redirect ke /login bila belum ada session. Dipakai di
 * awal Server Component/Server Action untuk halaman yang butuh login.
 */
export async function requireAuth(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

/**
 * Wajib login DAN memiliki salah satu role yang diizinkan. Redirect ke
 * /forbidden bila role tidak sesuai.
 */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireAuth();
  if (!roles.includes(user.role)) {
    redirect("/forbidden");
  }
  return user;
}

/**
 * Wajib login DAN memiliki permission tertentu (lewat permission matrix).
 * Redirect ke /forbidden bila tidak punya izin.
 */
export async function requirePermission(
  permission: Permission,
): Promise<SessionUser> {
  const user = await requireAuth();
  if (!can(user, permission)) {
    redirect("/forbidden");
  }
  return user;
}

/**
 * Cek permission TANPA redirect — mengembalikan hasil sebagai nilai, bukan
 * melempar navigasi. Dipakai di awal Server Action mutasi master data yang
 * dipanggil langsung dari Client Component (mis. lewat tombol/form modal):
 * Server Action semacam ini butuh mengembalikan pesan error yang bisa
 * ditampilkan di UI, bukan me-redirect pengguna di tengah interaksi modal.
 * Ini juga titik pertahanan utama terhadap client yang memanipulasi request
 * langsung ke Server Action tanpa lewat UI yang semestinya.
 */
export async function checkPermission(
  permission: Permission,
): Promise<{ ok: true; user: SessionUser } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) {
    return { ok: false, error: "Anda harus login untuk melakukan aksi ini." };
  }
  if (!can(user, permission)) {
    return {
      ok: false,
      error: "Anda tidak memiliki izin untuk melakukan aksi ini.",
    };
  }
  return { ok: true, user };
}

/**
 * Wajib login DAN punya akses ke branchId tertentu. Redirect ke /forbidden
 * bila tidak. Mengembalikan user + record branch agar pemanggil tidak perlu
 * query ulang.
 */
export async function requireBranchAccess(branchId: string) {
  const user = await requireAuth();
  const branch = await findAccessibleBranch(user, branchId);
  if (!branch) {
    redirect("/forbidden");
  }
  return { user, branch };
}

export type ActiveBranchContext = SessionUser & {
  activeBranchId: string | null;
  activeBranch: Awaited<ReturnType<typeof prisma.branch.findUnique>> | null;
};

/**
 * Konteks cabang aktif user saat ini: mengombinasikan session (role,
 * assignedBranchIds) dengan cookie pilihan cabang, tervalidasi ulang di
 * server pada setiap pemanggilan (lihat resolveActiveBranchId).
 */
export async function getActiveBranchContext(): Promise<ActiveBranchContext> {
  const user = await requireAuth();

  const availableBranchIds = isGlobalBranchRole(user.role)
    ? (await listActiveBranches(user.companyId)).map((b) => b.id)
    : [];

  const cookieStore = await cookies();
  const cookieBranchId = cookieStore.get(ACTIVE_BRANCH_COOKIE)?.value ?? null;

  const activeBranchId = resolveActiveBranchId({
    role: user.role,
    assignedBranchIds: user.assignedBranchIds,
    availableBranchIds,
    cookieBranchId,
  });

  const activeBranch = activeBranchId
    ? await prisma.branch.findUnique({ where: { id: activeBranchId } })
    : null;

  return { ...user, activeBranchId, activeBranch };
}
