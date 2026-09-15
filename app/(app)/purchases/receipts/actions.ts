"use server";

import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import {
  cancelDraftReceipt,
  createDraftReceipt,
  postReceipt,
  updateDraftReceipt,
} from "@/services/purchase-receipt-service";
import { actionErrorFromUnknown, actionSuccess, type ActionResult } from "@/lib/response";

const itemSchema = z.object({
  productId: z.string().min(1, "Produk wajib dipilih."),
  unitId: z.string().min(1, "Satuan wajib dipilih."),
  qty: z.number().positive("Qty harus lebih dari 0."),
  unitCost: z.number().min(0, "Harga beli tidak boleh negatif."),
  discountAmount: z.number().min(0, "Diskon tidak boleh negatif.").default(0),
  batchNumber: z.string().trim().optional(),
  expiryDate: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const headerSchema = z.object({
  branchId: z.string().min(1),
  supplierId: z.string().min(1, "Supplier wajib dipilih."),
  supplierInvoiceNumber: z.string().trim().min(1, "No. faktur supplier wajib diisi."),
  supplierInvoiceDate: z.string().trim().min(1, "Tanggal faktur wajib diisi."),
  receivedDate: z.string().trim().min(1, "Tanggal penerimaan wajib diisi."),
  notes: z.string().trim().optional(),
  items: z.array(itemSchema).min(1, "Minimal satu item."),
});

function toItemParams(items: z.infer<typeof itemSchema>[]) {
  return items.map((item) => ({
    productId: item.productId,
    unitId: item.unitId,
    qty: item.qty,
    unitCost: item.unitCost,
    discountAmount: item.discountAmount,
    batchNumber: item.batchNumber || undefined,
    expiryDate: item.expiryDate ? new Date(item.expiryDate) : undefined,
    notes: item.notes || undefined,
  }));
}

export async function createReceiptAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("purchase.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = headerSchema.parse(input);

    const allowedBranchIds = await getAllowedBranchIds(access.user);
    if (!allowedBranchIds.includes(data.branchId)) {
      return { success: false, error: "Anda tidak memiliki akses ke cabang tersebut." };
    }

    const receipt = await createDraftReceipt({
      companyId: access.user.companyId,
      branchId: data.branchId,
      supplierId: data.supplierId,
      supplierInvoiceNumber: data.supplierInvoiceNumber,
      supplierInvoiceDate: new Date(data.supplierInvoiceDate),
      receivedDate: new Date(data.receivedDate),
      notes: data.notes,
      createdById: access.user.id,
      items: toItemParams(data.items),
    });

    return actionSuccess({ id: receipt.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function updateReceiptAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("purchase.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = headerSchema.parse(input);
    const allowedBranchIds = await getAllowedBranchIds(access.user);
    if (!allowedBranchIds.includes(data.branchId)) {
      return { success: false, error: "Anda tidak memiliki akses ke cabang tersebut." };
    }

    const updated = await updateDraftReceipt({
      id,
      companyId: access.user.companyId,
      allowedBranchIds,
      branchId: data.branchId,
      supplierId: data.supplierId,
      supplierInvoiceNumber: data.supplierInvoiceNumber,
      supplierInvoiceDate: new Date(data.supplierInvoiceDate),
      receivedDate: new Date(data.receivedDate),
      notes: data.notes,
      items: toItemParams(data.items),
    });

    return actionSuccess({ id: updated.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function postReceiptAction(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("purchase.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const allowedBranchIds = await getAllowedBranchIds(access.user);
    const posted = await postReceipt({
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

export async function cancelReceiptAction(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("purchase.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const allowedBranchIds = await getAllowedBranchIds(access.user);
    const cancelled = await cancelDraftReceipt({
      companyId: access.user.companyId,
      allowedBranchIds,
      id,
      actorId: access.user.id,
    });
    return actionSuccess({ id: cancelled.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}
