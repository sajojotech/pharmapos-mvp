"use server";

import { z } from "zod";
import { PaymentMethod } from "@prisma/client";
import { checkPermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import {
  createPaidTransaction,
  createPendingPrescriptionTransaction,
  searchSellableProducts,
  type SellableProductResult,
} from "@/services/pos-transaction-service";
import { actionErrorFromUnknown, actionSuccess, type ActionResult } from "@/lib/response";

export async function searchProductsAction(
  branchId: string,
  query: string,
): Promise<ActionResult<SellableProductResult[]>> {
  const access = await checkPermission("pos.sell");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const allowedBranchIds = await getAllowedBranchIds(access.user);
    if (!allowedBranchIds.includes(branchId)) {
      return { success: false, error: "Anda tidak memiliki akses ke cabang tersebut." };
    }

    const results = await searchSellableProducts({
      companyId: access.user.companyId,
      branchId,
      query,
    });
    return actionSuccess(results);
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

const itemSchema = z.object({
  productId: z.string().min(1),
  qty: z.number().positive("Qty harus lebih dari 0."),
  discountAmount: z.number().min(0).default(0),
  notes: z.string().trim().optional(),
});

const paymentSchema = z.object({
  method: z.nativeEnum(PaymentMethod),
  amount: z.number().positive("Jumlah pembayaran harus lebih dari 0."),
  reference: z.string().trim().optional(),
});

const paySchema = z.object({
  shiftId: z.string().min(1),
  customerId: z.string().min(1).optional(),
  transactionDiscountAmount: z.number().min(0).default(0),
  notes: z.string().trim().optional(),
  items: z.array(itemSchema).min(1, "Keranjang tidak boleh kosong."),
  payments: z.array(paymentSchema).min(1, "Minimal satu metode pembayaran."),
});

export async function payTransactionAction(
  input: unknown,
): Promise<ActionResult<{ id: string; documentNumber: string }>> {
  const access = await checkPermission("pos.sell");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = paySchema.parse(input);
    const allowedBranchIds = await getAllowedBranchIds(access.user);

    const transaction = await createPaidTransaction({
      companyId: access.user.companyId,
      allowedBranchIds,
      shiftId: data.shiftId,
      createdById: access.user.id,
      customerId: data.customerId,
      transactionDiscountAmount: data.transactionDiscountAmount,
      notes: data.notes,
      items: data.items,
      payments: data.payments,
    });

    return actionSuccess({ id: transaction.id, documentNumber: transaction.documentNumber });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

const prescriptionSchema = z.object({
  patientName: z.string().trim().min(1, "Nama pasien wajib diisi."),
  patientPhone: z.string().trim().optional(),
  doctorName: z.string().trim().min(1, "Nama dokter wajib diisi."),
  prescriptionNumber: z.string().trim().min(1, "Nomor resep wajib diisi."),
  prescriptionDate: z.coerce.date(),
  pharmacistNotes: z.string().trim().optional(),
});

const createPendingPrescriptionSchema = z.object({
  shiftId: z.string().min(1),
  customerId: z.string().min(1).optional(),
  transactionDiscountAmount: z.number().min(0).default(0),
  notes: z.string().trim().optional(),
  items: z.array(itemSchema).min(1, "Keranjang tidak boleh kosong."),
  prescription: prescriptionSchema,
});

/**
 * Tahap 1 alur resep (Fase 09): buat transaksi PENDING_PRESCRIPTION_REVIEW
 * TANPA payment/alokasi stok — dipakai `pos-terminal.tsx` saat keranjang
 * mengandung produk `requiresPrescription`. Lihat
 * docs/PRESCRIPTION_VOID_RETURN.md.
 */
export async function createPrescriptionPendingAction(
  input: unknown,
): Promise<ActionResult<{ id: string; documentNumber: string }>> {
  const access = await checkPermission("pos.sell");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = createPendingPrescriptionSchema.parse(input);
    const allowedBranchIds = await getAllowedBranchIds(access.user);

    const transaction = await createPendingPrescriptionTransaction({
      companyId: access.user.companyId,
      allowedBranchIds,
      shiftId: data.shiftId,
      createdById: access.user.id,
      customerId: data.customerId,
      transactionDiscountAmount: data.transactionDiscountAmount,
      notes: data.notes,
      items: data.items,
      prescription: data.prescription,
    });

    return actionSuccess({ id: transaction.id, documentNumber: transaction.documentNumber });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}
