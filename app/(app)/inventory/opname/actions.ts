"use server";

import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { createDraftOpname, postOpname } from "@/services/stock-opname-service";
import { actionErrorFromUnknown, actionSuccess, type ActionResult } from "@/lib/response";

const createSchema = z.object({
  branchId: z.string().min(1),
  notes: z.string().trim().optional(),
  items: z
    .array(
      z.object({
        stockBatchId: z.string().min(1, "Batch wajib dipilih."),
        countedQty: z.number().min(0, "Qty hasil hitung tidak boleh negatif."),
      }),
    )
    .min(1, "Minimal satu item."),
});

export async function createOpnameAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("inventory.adjust");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = createSchema.parse(input);

    const allowedBranchIds = await getAllowedBranchIds(access.user);
    if (!allowedBranchIds.includes(data.branchId)) {
      return { success: false, error: "Anda tidak memiliki akses ke cabang tersebut." };
    }

    const opname = await createDraftOpname({
      companyId: access.user.companyId,
      branchId: data.branchId,
      notes: data.notes,
      createdById: access.user.id,
      items: data.items,
    });

    return actionSuccess({ id: opname.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function postOpnameAction(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("inventory.adjust");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const allowedBranchIds = await getAllowedBranchIds(access.user);
    const posted = await postOpname({
      companyId: access.user.companyId,
      allowedBranchIds,
      id,
      postedById: access.user.id,
    });
    return actionSuccess({ id: posted.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}
