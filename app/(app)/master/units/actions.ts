"use server";

import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import {
  createUnit,
  getUnitById,
  setUnitActive,
  updateUnit,
} from "@/services/unit-service";
import { recordAudit } from "@/services/audit-service";
import { actionErrorFromUnknown, actionSuccess, type ActionResult } from "@/lib/response";

const unitSchema = z.object({
  name: z.string().trim().min(1, "Nama satuan wajib diisi."),
  symbol: z.string().trim().optional(),
});

export async function createUnitAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = unitSchema.parse(input);
    const unit = await createUnit({
      companyId: access.user.companyId,
      name: data.name,
      symbol: data.symbol,
    });

    await recordAudit({
      companyId: access.user.companyId,
      actorId: access.user.id,
      action: "CREATE",
      entityType: "Unit",
      entityId: unit.id,
      newValue: { name: unit.name, symbol: unit.symbol },
    });

    return actionSuccess({ id: unit.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function updateUnitAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = unitSchema.parse(input);
    const before = await getUnitById(access.user.companyId, id);
    if (!before) return { success: false, error: "Satuan tidak ditemukan." };

    await updateUnit({
      companyId: access.user.companyId,
      id,
      name: data.name,
      symbol: data.symbol,
    });

    await recordAudit({
      companyId: access.user.companyId,
      actorId: access.user.id,
      action: "UPDATE",
      entityType: "Unit",
      entityId: id,
      oldValue: { name: before.name, symbol: before.symbol },
      newValue: { name: data.name, symbol: data.symbol },
    });

    return actionSuccess({ id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function setUnitActiveAction(
  id: string,
  isActive: boolean,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const before = await getUnitById(access.user.companyId, id);
    if (!before) return { success: false, error: "Satuan tidak ditemukan." };

    await setUnitActive({ companyId: access.user.companyId, id, isActive });

    await recordAudit({
      companyId: access.user.companyId,
      actorId: access.user.id,
      action: isActive ? "ACTIVATE" : "DEACTIVATE",
      entityType: "Unit",
      entityId: id,
      oldValue: { isActive: before.isActive },
      newValue: { isActive },
    });

    return actionSuccess({ id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}
