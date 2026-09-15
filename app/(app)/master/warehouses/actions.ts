"use server";

import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import {
  createWarehouse,
  getWarehouseById,
  setWarehouseActive,
  updateWarehouse,
} from "@/services/warehouse-service";
import { findAccessibleBranch } from "@/lib/rbac-core";
import { recordAudit } from "@/services/audit-service";
import { actionErrorFromUnknown, actionSuccess, type ActionResult } from "@/lib/response";

const warehouseSchema = z.object({
  branchId: z.string().min(1, "Cabang wajib dipilih."),
  code: z.string().trim().min(1, "Kode warehouse wajib diisi."),
  name: z.string().trim().min(1, "Nama warehouse wajib diisi."),
  isDefault: z.boolean(),
});

export async function createWarehouseAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = warehouseSchema.parse(input);

    const branch = await findAccessibleBranch(access.user, data.branchId);
    if (!branch) return { success: false, error: "Cabang tidak valid." };

    const warehouse = await createWarehouse(data);

    await recordAudit({
      companyId: access.user.companyId,
      branchId: data.branchId,
      actorId: access.user.id,
      action: "CREATE",
      entityType: "Warehouse",
      entityId: warehouse.id,
      newValue: { code: warehouse.code, name: warehouse.name, branchId: data.branchId },
    });

    return actionSuccess({ id: warehouse.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function updateWarehouseAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = warehouseSchema.parse(input);

    const branch = await findAccessibleBranch(access.user, data.branchId);
    if (!branch) return { success: false, error: "Cabang tidak valid." };

    const before = await getWarehouseById(access.user.companyId, id);
    if (!before) return { success: false, error: "Warehouse tidak ditemukan." };

    await updateWarehouse({ id, ...data });

    await recordAudit({
      companyId: access.user.companyId,
      branchId: data.branchId,
      actorId: access.user.id,
      action: "UPDATE",
      entityType: "Warehouse",
      entityId: id,
      oldValue: { code: before.code, name: before.name, branchId: before.branchId },
      newValue: data,
    });

    return actionSuccess({ id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function setWarehouseActiveAction(
  id: string,
  isActive: boolean,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const before = await getWarehouseById(access.user.companyId, id);
    if (!before) return { success: false, error: "Warehouse tidak ditemukan." };

    await setWarehouseActive({ companyId: access.user.companyId, id, isActive });

    await recordAudit({
      companyId: access.user.companyId,
      branchId: before.branchId,
      actorId: access.user.id,
      action: isActive ? "ACTIVATE" : "DEACTIVATE",
      entityType: "Warehouse",
      entityId: id,
      oldValue: { isActive: before.isActive },
      newValue: { isActive },
    });

    return actionSuccess({ id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}
