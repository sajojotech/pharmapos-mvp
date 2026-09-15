"use server";

import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import {
  createSupplier,
  getSupplierById,
  setSupplierActive,
  updateSupplier,
} from "@/services/supplier-service";
import { recordAudit } from "@/services/audit-service";
import { actionErrorFromUnknown, actionSuccess, type ActionResult } from "@/lib/response";

const supplierSchema = z.object({
  code: z.string().trim().optional(),
  name: z.string().trim().min(1, "Nama supplier wajib diisi."),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
});

export async function createSupplierAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = supplierSchema.parse(input);
    const supplier = await createSupplier({
      companyId: access.user.companyId,
      ...data,
    });

    await recordAudit({
      companyId: access.user.companyId,
      actorId: access.user.id,
      action: "CREATE",
      entityType: "Supplier",
      entityId: supplier.id,
      newValue: { code: supplier.code, name: supplier.name },
    });

    return actionSuccess({ id: supplier.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function updateSupplierAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = supplierSchema.parse(input);
    const before = await getSupplierById(access.user.companyId, id);
    if (!before) return { success: false, error: "Supplier tidak ditemukan." };

    await updateSupplier({ companyId: access.user.companyId, id, ...data });

    await recordAudit({
      companyId: access.user.companyId,
      actorId: access.user.id,
      action: "UPDATE",
      entityType: "Supplier",
      entityId: id,
      oldValue: { code: before.code, name: before.name, phone: before.phone, address: before.address },
      newValue: data,
    });

    return actionSuccess({ id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function setSupplierActiveAction(
  id: string,
  isActive: boolean,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const before = await getSupplierById(access.user.companyId, id);
    if (!before) return { success: false, error: "Supplier tidak ditemukan." };

    await setSupplierActive({ companyId: access.user.companyId, id, isActive });

    await recordAudit({
      companyId: access.user.companyId,
      actorId: access.user.id,
      action: isActive ? "ACTIVATE" : "DEACTIVATE",
      entityType: "Supplier",
      entityId: id,
      oldValue: { isActive: before.isActive },
      newValue: { isActive },
    });

    return actionSuccess({ id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}
