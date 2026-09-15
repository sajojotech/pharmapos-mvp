"use server";

import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import {
  createCategory,
  getCategoryById,
  setCategoryActive,
  updateCategory,
} from "@/services/category-service";
import { recordAudit } from "@/services/audit-service";
import { actionErrorFromUnknown, actionSuccess, type ActionResult } from "@/lib/response";

const categorySchema = z.object({
  name: z.string().trim().min(1, "Nama kategori wajib diisi."),
});

export async function createCategoryAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = categorySchema.parse(input);
    const category = await createCategory({
      companyId: access.user.companyId,
      name: data.name,
    });

    await recordAudit({
      companyId: access.user.companyId,
      actorId: access.user.id,
      action: "CREATE",
      entityType: "Category",
      entityId: category.id,
      newValue: { name: category.name },
    });

    return actionSuccess({ id: category.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function updateCategoryAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = categorySchema.parse(input);
    const before = await getCategoryById(access.user.companyId, id);
    if (!before) return { success: false, error: "Kategori tidak ditemukan." };

    await updateCategory({ companyId: access.user.companyId, id, name: data.name });

    await recordAudit({
      companyId: access.user.companyId,
      actorId: access.user.id,
      action: "UPDATE",
      entityType: "Category",
      entityId: id,
      oldValue: { name: before.name },
      newValue: { name: data.name },
    });

    return actionSuccess({ id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function setCategoryActiveAction(
  id: string,
  isActive: boolean,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const before = await getCategoryById(access.user.companyId, id);
    if (!before) return { success: false, error: "Kategori tidak ditemukan." };

    await setCategoryActive({ companyId: access.user.companyId, id, isActive });

    await recordAudit({
      companyId: access.user.companyId,
      actorId: access.user.id,
      action: isActive ? "ACTIVATE" : "DEACTIVATE",
      entityType: "Category",
      entityId: id,
      oldValue: { isActive: before.isActive },
      newValue: { isActive },
    });

    return actionSuccess({ id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}
