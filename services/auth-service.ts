import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import type { Role } from "@prisma/client";

export type CredentialsCheckResult =
  | {
      ok: true;
      user: {
        id: string;
        email: string;
        name: string;
        role: Role;
        companyId: string;
      };
    }
  | { ok: false; reason: "NOT_FOUND" }
  | {
      ok: false;
      reason: "INACTIVE" | "INVALID_PASSWORD";
      userId: string;
      companyId: string;
    };

/**
 * Verifikasi kredensial login terhadap database. Dipisah dari konfigurasi
 * Auth.js (lib/auth.ts) agar bisa diuji langsung tanpa perlu menjalankan
 * server HTTP/NextAuth, sesuai prinsip service layer di docs/ARCHITECTURE.md.
 */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<CredentialsCheckResult> {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  if (!user.isActive) {
    return {
      ok: false,
      reason: "INACTIVE",
      userId: user.id,
      companyId: user.companyId,
    };
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    return {
      ok: false,
      reason: "INVALID_PASSWORD",
      userId: user.id,
      companyId: user.companyId,
    };
  }

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      companyId: user.companyId,
    },
  };
}

export async function getAssignedBranchIds(userId: string): Promise<string[]> {
  const rows = await prisma.userBranchAssignment.findMany({
    where: { userId },
    select: { branchId: true },
  });
  return rows.map((row) => row.branchId);
}

/**
 * Audit log login. Tidak pernah menyimpan password/credential — hanya
 * userId, companyId, hasil (sukses/gagal), dan alasan gagal (kode singkat,
 * bukan detail sensitif). Percobaan login dengan email yang tidak terdaftar
 * sengaja TIDAK dicatat: tidak ada userId/companyId valid untuk dilampirkan,
 * dan mencatatnya akan membuka celah pencatatan noise dari tebakan email
 * acak tanpa nilai audit yang jelas.
 */
export async function recordLoginAttempt(params: {
  companyId: string;
  userId: string;
  success: boolean;
  reason?: string;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      companyId: params.companyId,
      actorId: params.success ? params.userId : null,
      action: params.success ? "LOGIN_SUCCESS" : "LOGIN_FAILURE",
      entityType: "User",
      entityId: params.userId,
      reason: params.reason,
    },
  });
}
