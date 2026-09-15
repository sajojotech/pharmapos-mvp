import { NextResponse } from "next/server";
import { ZodError } from "zod";

/**
 * Bentuk response sukses yang konsisten untuk Route Handlers.
 */
export function apiSuccess<T>(data: T, init?: { status?: number }) {
  return NextResponse.json(
    { success: true as const, data },
    { status: init?.status ?? 200 },
  );
}

/**
 * Bentuk response gagal yang konsisten untuk Route Handlers.
 */
export function apiError(
  message: string,
  status = 400,
  details?: unknown,
) {
  return NextResponse.json(
    { success: false as const, error: { message, details } },
    { status },
  );
}

/**
 * Menerjemahkan error tak terduga (mis. dari try/catch) menjadi response API
 * yang konsisten, tanpa membocorkan detail internal ke client.
 */
export function apiErrorFromUnknown(error: unknown) {
  if (error instanceof ZodError) {
    return apiError("Input tidak valid.", 422, error.flatten());
  }

  if (error instanceof Error) {
    return apiError(error.message, 400);
  }

  return apiError("Terjadi kesalahan yang tidak diketahui.", 500);
}

/**
 * Hasil generik untuk Server Actions, karena Server Actions tidak
 * mengembalikan Response HTTP melainkan objek biasa yang dikonsumsi client.
 */
export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; details?: unknown };

export function actionSuccess<T>(data: T): ActionResult<T> {
  return { success: true, data };
}

export function actionErrorFromUnknown<T>(error: unknown): ActionResult<T> {
  if (error instanceof ZodError) {
    return {
      success: false,
      error: "Input tidak valid.",
      details: error.flatten(),
    };
  }

  if (error instanceof Error) {
    return { success: false, error: error.message };
  }

  return { success: false, error: "Terjadi kesalahan yang tidak diketahui." };
}
