"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import {
  ACTIVE_BRANCH_COOKIE,
  findAccessibleBranch,
  requireAuth,
} from "@/lib/rbac";
import type { ActionResult } from "@/lib/response";

const inputSchema = z.object({ branchId: z.string().min(1) });

/**
 * Mengubah cabang aktif user. Server-side memvalidasi ulang bahwa branchId
 * yang dikirim benar-benar berada dalam cakupan akses user (role global atau
 * UserBranchAssignment) — TIDAK mempercayai input klien begitu saja, sesuai
 * aturan "menolak branchId di luar assignment user".
 */
export async function setActiveBranchAction(
  branchId: string,
): Promise<ActionResult<{ branchId: string }>> {
  const parsed = inputSchema.safeParse({ branchId });
  if (!parsed.success) {
    return { success: false, error: "Cabang tidak valid." };
  }

  const user = await requireAuth();
  const branch = await findAccessibleBranch(user, parsed.data.branchId);

  if (!branch) {
    return {
      success: false,
      error: "Anda tidak memiliki akses ke cabang tersebut.",
    };
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_BRANCH_COOKIE, branch.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  return { success: true, data: { branchId: branch.id } };
}
