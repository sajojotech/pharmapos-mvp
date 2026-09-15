"use server";

import { z } from "zod";
import { Role } from "@prisma/client";
import { checkPermission, getSessionUser } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import {
  addCashMovement,
  approveShift,
  closeShift,
  openShift,
} from "@/services/cashier-shift-service";
import { actionErrorFromUnknown, actionSuccess, type ActionResult } from "@/lib/response";

const openShiftSchema = z.object({
  branchId: z.string().min(1),
  openingCash: z.number().min(0, "Modal kas awal tidak boleh negatif."),
});

export async function openShiftAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("shift.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = openShiftSchema.parse(input);
    const allowedBranchIds = await getAllowedBranchIds(access.user);
    if (!allowedBranchIds.includes(data.branchId)) {
      return { success: false, error: "Anda tidak memiliki akses ke cabang tersebut." };
    }

    const shift = await openShift({
      companyId: access.user.companyId,
      branchId: data.branchId,
      userId: access.user.id,
      openingCash: data.openingCash,
    });
    return actionSuccess({ id: shift.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

const cashMovementSchema = z.object({
  shiftId: z.string().min(1),
  direction: z.enum(["IN", "OUT"]),
  amount: z.number().positive("Jumlah kas harus lebih dari 0."),
  reason: z.string().trim().min(1, "Alasan wajib diisi."),
});

export async function cashMovementAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("shift.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = cashMovementSchema.parse(input);
    const allowedBranchIds = await getAllowedBranchIds(access.user);

    const movement = await addCashMovement({
      allowedBranchIds,
      shiftId: data.shiftId,
      direction: data.direction,
      amount: data.amount,
      reason: data.reason,
      actorId: access.user.id,
    });
    return actionSuccess({ id: movement.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

const closeShiftSchema = z.object({
  shiftId: z.string().min(1),
  actualCash: z.number().min(0, "Kas aktual tidak boleh negatif."),
  closingNotes: z.string().trim().optional(),
});

export async function closeShiftAction(
  input: unknown,
): Promise<ActionResult<{ id: string; status: string }>> {
  const access = await checkPermission("shift.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = closeShiftSchema.parse(input);
    const allowedBranchIds = await getAllowedBranchIds(access.user);

    const shift = await closeShift({
      allowedBranchIds,
      shiftId: data.shiftId,
      actorId: access.user.id,
      actualCash: data.actualCash,
      closingNotes: data.closingNotes,
    });
    return actionSuccess({ id: shift.id, status: shift.status });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

/**
 * Persetujuan shift PENDING_APPROVAL sengaja dibatasi ke OWNER/BRANCH_MANAGER
 * lewat requireRole langsung (bukan permission baru di matrix) — kasir
 * pemilik shift tidak boleh menyetujui selisih kasnya sendiri. Lihat
 * docs/POS.md.
 */
export async function approveShiftAction(
  shiftId: string,
): Promise<ActionResult<{ id: string }>> {
  const user = await getSessionUser();
  if (!user) {
    return { success: false, error: "Anda harus login untuk melakukan aksi ini." };
  }
  const allowedApproverRoles: Role[] = [Role.OWNER, Role.BRANCH_MANAGER];
  if (!allowedApproverRoles.includes(user.role)) {
    return {
      success: false,
      error: "Hanya Owner/Manager Cabang yang dapat menyetujui penutupan shift ini.",
    };
  }

  try {
    const allowedBranchIds = await getAllowedBranchIds(user);
    const shift = await approveShift({
      allowedBranchIds,
      shiftId,
      actorId: user.id,
      actorRole: user.role,
    });
    return actionSuccess({ id: shift.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}
