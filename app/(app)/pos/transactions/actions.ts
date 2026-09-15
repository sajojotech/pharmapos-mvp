"use server";

import { z } from "zod";
import { PaymentMethod, SalesReturnItemCondition } from "@prisma/client";
import { checkPermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { finalizePrescriptionPayment } from "@/services/pos-transaction-service";
import { voidTransaction } from "@/services/pos-void-service";
import { createSalesReturn } from "@/services/sales-return-service";
import { actionErrorFromUnknown, actionSuccess, type ActionResult } from "@/lib/response";

const paymentSchema = z.object({
  method: z.nativeEnum(PaymentMethod),
  amount: z.number().positive("Jumlah pembayaran harus lebih dari 0."),
  reference: z.string().trim().optional(),
});

const finalizeSchema = z.object({
  payments: z.array(paymentSchema).min(1, "Minimal satu metode pembayaran."),
});

/**
 * Tahap 2 alur resep (Fase 09): kasir melanjutkan pembayaran SETELAH
 * `Prescription.status=APPROVED`. Lihat
 * services/pos-transaction-service.ts::finalizePrescriptionPayment.
 */
export async function finalizePrescriptionPaymentAction(
  transactionId: string,
  input: unknown,
): Promise<ActionResult<{ id: string; status: string }>> {
  const access = await checkPermission("pos.sell");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = finalizeSchema.parse(input);
    const allowedBranchIds = await getAllowedBranchIds(access.user);

    const updated = await finalizePrescriptionPayment({
      allowedBranchIds,
      transactionId,
      actorId: access.user.id,
      payments: data.payments,
    });

    return actionSuccess({ id: updated.id, status: updated.status });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function voidTransactionAction(
  transactionId: string,
  reason: string,
): Promise<ActionResult<{ id: string; status: string }>> {
  const access = await checkPermission("pos.void");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const allowedBranchIds = await getAllowedBranchIds(access.user);

    const updated = await voidTransaction({
      allowedBranchIds,
      transactionId,
      actorId: access.user.id,
      actorRole: access.user.role,
      reason,
    });

    return actionSuccess({ id: updated.id, status: updated.status });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

const returnItemSchema = z.object({
  posTransactionItemId: z.string().min(1),
  qty: z.number().positive("Qty retur harus lebih dari 0."),
  condition: z.nativeEnum(SalesReturnItemCondition),
});

const createReturnSchema = z.object({
  reason: z.string().trim().min(1, "Alasan retur wajib diisi."),
  items: z.array(returnItemSchema).min(1, "Minimal satu item retur."),
});

export async function createSalesReturnAction(
  transactionId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("pos.sell");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = createReturnSchema.parse(input);
    const allowedBranchIds = await getAllowedBranchIds(access.user);

    const salesReturn = await createSalesReturn({
      companyId: access.user.companyId,
      allowedBranchIds,
      posTransactionId: transactionId,
      actorId: access.user.id,
      actorRole: access.user.role,
      reason: data.reason,
      items: data.items,
    });

    return actionSuccess({ id: salesReturn.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}
