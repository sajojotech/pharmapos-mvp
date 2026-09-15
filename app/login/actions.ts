"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

const loginSchema = z.object({
  email: z.email("Format email tidak valid."),
  password: z.string().min(1, "Password wajib diisi."),
});

export type LoginState = {
  success: boolean;
  error?: string;
};

export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { success: false, error: "Email atau password tidak valid." };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (error) {
    // Pesan generik dengan sengaja — tidak membedakan "email tidak
    // terdaftar" vs "password salah" agar tidak membocorkan email mana yang
    // terdaftar di sistem (user enumeration).
    if (error instanceof AuthError) {
      return { success: false, error: "Email atau password salah." };
    }
    throw error;
  }

  redirect("/dashboard");
}
