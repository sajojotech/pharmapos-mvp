"use server";

import { z } from "zod";
import { Role } from "@prisma/client";
import { checkPermission } from "@/lib/rbac";
import { findAccessibleBranch, type SessionUser } from "@/lib/rbac-core";
import {
  createUser,
  getUserById,
  setUserActive,
  updateUser,
} from "@/services/user-service";
import { recordAudit } from "@/services/audit-service";
import { isGlobalBranchRole } from "@/lib/permissions";
import { actionErrorFromUnknown, actionSuccess, type ActionResult } from "@/lib/response";

const baseUserSchema = z.object({
  email: z.email("Format email tidak valid."),
  name: z.string().trim().min(1, "Nama wajib diisi."),
  role: z.enum(Role),
  branchIds: z.array(z.string()),
});

const createUserSchema = baseUserSchema.extend({
  password: z.string().min(8, "Password minimal 8 karakter."),
});

const updateUserSchema = baseUserSchema.extend({
  password: z
    .union([z.literal(""), z.string().min(8, "Password minimal 8 karakter.")])
    .optional(),
});

async function validateBranchIds(
  user: SessionUser,
  role: Role,
  branchIds: string[],
): Promise<string | null> {
  if (isGlobalBranchRole(role) || branchIds.length === 0) return null;
  for (const branchId of branchIds) {
    const branch = await findAccessibleBranch(user, branchId);
    if (!branch) return "Salah satu cabang yang dipilih tidak valid.";
  }
  return null;
}

export async function createUserAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("user.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = createUserSchema.parse(input);

    const branchError = await validateBranchIds(access.user, data.role, data.branchIds);
    if (branchError) return { success: false, error: branchError };

    const user = await createUser({
      companyId: access.user.companyId,
      email: data.email,
      name: data.name,
      role: data.role,
      branchIds: data.branchIds,
      password: data.password,
    });

    await recordAudit({
      companyId: access.user.companyId,
      actorId: access.user.id,
      action: "CREATE",
      entityType: "User",
      entityId: user.id,
      newValue: { email: user.email, role: user.role },
    });

    return actionSuccess({ id: user.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function updateUserAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("user.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = updateUserSchema.parse(input);

    const branchError = await validateBranchIds(access.user, data.role, data.branchIds);
    if (branchError) return { success: false, error: branchError };

    const before = await getUserById(access.user.companyId, id);
    if (!before) return { success: false, error: "User tidak ditemukan." };

    await updateUser({
      id,
      companyId: access.user.companyId,
      email: data.email,
      name: data.name,
      role: data.role,
      branchIds: data.branchIds,
      password: data.password || undefined,
    });

    await recordAudit({
      companyId: access.user.companyId,
      actorId: access.user.id,
      action: "UPDATE",
      entityType: "User",
      entityId: id,
      oldValue: { email: before.email, name: before.name, role: before.role },
      newValue: { email: data.email, name: data.name, role: data.role },
      reason: data.password ? "Termasuk reset password" : undefined,
    });

    return actionSuccess({ id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function setUserActiveAction(
  id: string,
  isActive: boolean,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("user.manage");
  if (!access.ok) return { success: false, error: access.error };

  if (id === access.user.id && !isActive) {
    return { success: false, error: "Anda tidak bisa menonaktifkan akun Anda sendiri." };
  }

  try {
    const before = await getUserById(access.user.companyId, id);
    if (!before) return { success: false, error: "User tidak ditemukan." };

    await setUserActive({ companyId: access.user.companyId, id, isActive });

    await recordAudit({
      companyId: access.user.companyId,
      actorId: access.user.id,
      action: isActive ? "ACTIVATE" : "DEACTIVATE",
      entityType: "User",
      entityId: id,
      oldValue: { isActive: before.isActive },
      newValue: { isActive },
    });

    return actionSuccess({ id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}
