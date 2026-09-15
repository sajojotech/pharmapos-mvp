"use server";

import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { reviewPrescription } from "@/services/prescription-service";
import { actionErrorFromUnknown, actionSuccess, type ActionResult } from "@/lib/response";

const reviewSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  notes: z.string().trim().optional(),
});

export async function reviewPrescriptionAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string; status: string }>> {
  const access = await checkPermission("prescription.review");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = reviewSchema.parse(input);
    const allowedBranchIds = await getAllowedBranchIds(access.user);

    const updated = await reviewPrescription({
      allowedBranchIds,
      prescriptionId: id,
      actorId: access.user.id,
      actorRole: access.user.role,
      decision: data.decision,
      notes: data.notes,
    });

    return actionSuccess({ id: updated.id, status: updated.status });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}
