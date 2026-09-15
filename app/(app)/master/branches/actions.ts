"use server";

import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import {
  createBranch,
  getBranchById,
  setBranchActive,
  updateBranch,
} from "@/services/branch-service";
import { recordAudit } from "@/services/audit-service";
import { actionErrorFromUnknown, actionSuccess, type ActionResult } from "@/lib/response";

const branchSchema = z.object({
  code: z.string().trim().min(1, "Kode cabang wajib diisi."),
  name: z.string().trim().min(1, "Nama cabang wajib diisi."),
  address: z.string().trim().min(1, "Alamat wajib diisi."),
  phone: z.string().trim().min(1, "Telepon wajib diisi."),
});

export async function createBranchAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = branchSchema.parse(input);
    const branch = await createBranch({ companyId: access.user.companyId, ...data });

    await recordAudit({
      companyId: access.user.companyId,
      branchId: branch.id,
      actorId: access.user.id,
      action: "CREATE",
      entityType: "Branch",
      entityId: branch.id,
      newValue: { code: branch.code, name: branch.name },
    });

    return actionSuccess({ id: branch.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function updateBranchAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = branchSchema.parse(input);
    const before = await getBranchById(access.user.companyId, id);
    if (!before) return { success: false, error: "Cabang tidak ditemukan." };

    await updateBranch({ companyId: access.user.companyId, id, ...data });

    await recordAudit({
      companyId: access.user.companyId,
      branchId: id,
      actorId: access.user.id,
      action: "UPDATE",
      entityType: "Branch",
      entityId: id,
      oldValue: {
        code: before.code,
        name: before.name,
        address: before.address,
        phone: before.phone,
      },
      newValue: data,
    });

    return actionSuccess({ id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function setBranchActiveAction(
  id: string,
  isActive: boolean,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const before = await getBranchById(access.user.companyId, id);
    if (!before) return { success: false, error: "Cabang tidak ditemukan." };

    await setBranchActive({ companyId: access.user.companyId, id, isActive });

    await recordAudit({
      companyId: access.user.companyId,
      branchId: id,
      actorId: access.user.id,
      action: isActive ? "ACTIVATE" : "DEACTIVATE",
      entityType: "Branch",
      entityId: id,
      oldValue: { isActive: before.isActive },
      newValue: { isActive },
    });

    return actionSuccess({ id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}
