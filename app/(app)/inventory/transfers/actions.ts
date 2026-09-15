"use server";

import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { listAvailableBatchesForBranch } from "@/services/stock-batch-service";
import {
  approveTransferRequest,
  cancelTransfer,
  createDraftTransfer,
  rejectTransferRequest,
  receiveTransfer,
  shipTransfer,
  submitTransferRequest,
  updateDraftTransfer,
} from "@/services/stock-transfer-service";
import { actionErrorFromUnknown, actionSuccess, type ActionResult } from "@/lib/response";
import { toPlainJSON } from "@/lib/serialize";
import type { BatchOption } from "./transfer-form";

const itemSchema = z.object({
  productId: z.string().min(1, "Produk wajib dipilih."),
  sourceStockBatchId: z.string().min(1, "Batch wajib dipilih."),
  qtyRequested: z.number().positive("Qty harus lebih dari 0."),
  notes: z.string().trim().optional(),
});

const headerSchema = z.object({
  sourceBranchId: z.string().min(1, "Cabang asal wajib dipilih."),
  destinationBranchId: z.string().min(1, "Cabang tujuan wajib dipilih."),
  notes: z.string().trim().optional(),
  items: z.array(itemSchema).min(1, "Minimal satu item."),
});

function requireBranchInvolved(allowedBranchIds: string[], sourceBranchId: string, destinationBranchId: string) {
  if (!allowedBranchIds.includes(sourceBranchId) && !allowedBranchIds.includes(destinationBranchId)) {
    return "Anda harus memiliki akses ke cabang asal atau cabang tujuan.";
  }
  return null;
}

export async function listBranchBatchesAction(
  branchId: string,
): Promise<ActionResult<BatchOption[]>> {
  const access = await checkPermission("transfer.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const allowedBranchIds = await getAllowedBranchIds(access.user);
    if (!allowedBranchIds.includes(branchId)) {
      return { success: false, error: "Anda tidak memiliki akses ke cabang tersebut." };
    }

    const batches = await listAvailableBatchesForBranch(access.user.companyId, branchId);
    return actionSuccess(toPlainJSON<BatchOption[]>(batches));
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function createTransferAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("transfer.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = headerSchema.parse(input);
    const allowedBranchIds = await getAllowedBranchIds(access.user);
    const branchError = requireBranchInvolved(allowedBranchIds, data.sourceBranchId, data.destinationBranchId);
    if (branchError) return { success: false, error: branchError };

    const transfer = await createDraftTransfer({
      companyId: access.user.companyId,
      sourceBranchId: data.sourceBranchId,
      destinationBranchId: data.destinationBranchId,
      notes: data.notes,
      createdById: access.user.id,
      items: data.items,
    });

    return actionSuccess({ id: transfer.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function updateTransferAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("transfer.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = headerSchema.parse(input);
    const allowedBranchIds = await getAllowedBranchIds(access.user);
    const branchError = requireBranchInvolved(allowedBranchIds, data.sourceBranchId, data.destinationBranchId);
    if (branchError) return { success: false, error: branchError };

    const updated = await updateDraftTransfer({
      id,
      companyId: access.user.companyId,
      allowedBranchIds,
      sourceBranchId: data.sourceBranchId,
      destinationBranchId: data.destinationBranchId,
      notes: data.notes,
      items: data.items,
    });

    return actionSuccess({ id: updated.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function submitTransferAction(id: string): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("transfer.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const allowedBranchIds = await getAllowedBranchIds(access.user);
    const updated = await submitTransferRequest({ allowedBranchIds, id, actorId: access.user.id });
    return actionSuccess({ id: updated.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function approveTransferAction(id: string): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("transfer.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const allowedBranchIds = await getAllowedBranchIds(access.user);
    const updated = await approveTransferRequest({ allowedBranchIds, id, actorId: access.user.id });
    return actionSuccess({ id: updated.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function rejectTransferAction(
  id: string,
  reason: string,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("transfer.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const allowedBranchIds = await getAllowedBranchIds(access.user);
    const updated = await rejectTransferRequest({
      allowedBranchIds,
      id,
      actorId: access.user.id,
      reason,
    });
    return actionSuccess({ id: updated.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function shipTransferAction(id: string): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("transfer.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const allowedBranchIds = await getAllowedBranchIds(access.user);
    const updated = await shipTransfer({ allowedBranchIds, id, actorId: access.user.id });
    return actionSuccess({ id: updated.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

const receiveSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qtyReceived: z.number().min(0),
        discrepancyReason: z.string().trim().optional(),
      }),
    )
    .min(1),
});

export async function receiveTransferAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string; status: string }>> {
  const access = await checkPermission("transfer.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = receiveSchema.parse(input);
    const allowedBranchIds = await getAllowedBranchIds(access.user);
    const updated = await receiveTransfer({
      allowedBranchIds,
      id,
      actorId: access.user.id,
      items: data.items,
    });
    return actionSuccess({ id: updated.id, status: updated.status });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function cancelTransferAction(id: string): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("transfer.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const allowedBranchIds = await getAllowedBranchIds(access.user);
    const updated = await cancelTransfer({ allowedBranchIds, id, actorId: access.user.id });
    return actionSuccess({ id: updated.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}
