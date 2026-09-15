"use server";

import { z } from "zod";
import { AdjustmentDirection } from "@prisma/client";
import { checkPermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import {
  createDraftAdjustment,
  postAdjustment,
} from "@/services/stock-adjustment-service";
import { actionErrorFromUnknown, actionSuccess, type ActionResult } from "@/lib/response";

const createSchema = z.object({
  branchId: z.string().min(1),
  reason: z.string().trim().min(1, "Alasan wajib diisi."),
  items: z
    .array(
      z.object({
        stockBatchId: z.string().min(1, "Batch wajib dipilih."),
        direction: z.enum(AdjustmentDirection),
        qty: z.number().positive("Qty harus lebih dari 0."),
      }),
    )
    .min(1, "Minimal satu item."),
});

export async function createAdjustmentAction(
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

    const adjustment = await createDraftAdjustment({
      companyId: access.user.companyId,
      branchId: data.branchId,
      reason: data.reason,
      createdById: access.user.id,
      items: data.items,
    });

    return actionSuccess({ id: adjustment.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function postAdjustmentAction(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("inventory.adjust");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const allowedBranchIds = await getAllowedBranchIds(access.user);
    const posted = await postAdjustment({
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
