"use server";

import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import {
  createCustomer,
  getCustomerById,
  setCustomerActive,
  updateCustomer,
} from "@/services/customer-service";
import { recordAudit } from "@/services/audit-service";
import { actionErrorFromUnknown, actionSuccess, type ActionResult } from "@/lib/response";

const customerSchema = z.object({
  code: z.string().trim().optional(),
  name: z.string().trim().min(1, "Nama customer wajib diisi."),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
});

export async function createCustomerAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = customerSchema.parse(input);
    const customer = await createCustomer({ companyId: access.user.companyId, ...data });

    await recordAudit({
      companyId: access.user.companyId,
      actorId: access.user.id,
      action: "CREATE",
      entityType: "Customer",
      entityId: customer.id,
      newValue: { code: customer.code, name: customer.name },
    });

    return actionSuccess({ id: customer.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function updateCustomerAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = customerSchema.parse(input);
    const before = await getCustomerById(access.user.companyId, id);
    if (!before) return { success: false, error: "Customer tidak ditemukan." };

    await updateCustomer({ companyId: access.user.companyId, id, ...data });

    await recordAudit({
      companyId: access.user.companyId,
      actorId: access.user.id,
      action: "UPDATE",
      entityType: "Customer",
      entityId: id,
      oldValue: { code: before.code, name: before.name, phone: before.phone, address: before.address },
      newValue: data,
    });

    return actionSuccess({ id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function setCustomerActiveAction(
  id: string,
  isActive: boolean,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const before = await getCustomerById(access.user.companyId, id);
    if (!before) return { success: false, error: "Customer tidak ditemukan." };

    await setCustomerActive({ companyId: access.user.companyId, id, isActive });

    await recordAudit({
      companyId: access.user.companyId,
      actorId: access.user.id,
      action: isActive ? "ACTIVATE" : "DEACTIVATE",
      entityType: "Customer",
      entityId: id,
      oldValue: { isActive: before.isActive },
      newValue: { isActive },
    });

    return actionSuccess({ id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}
