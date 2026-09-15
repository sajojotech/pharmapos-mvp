import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL wajib diisi"),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET minimal 16 karakter"),
  AUTH_URL: z.url("AUTH_URL harus berupa URL yang valid"),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("PharmaPOS"),
  NEXT_PUBLIC_TIME_ZONE: z.string().min(1).default("Asia/Jakarta"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Environment variable tidak valid. Periksa file .env Anda:\n${issues}`,
    );
  }

  return parsed.data;
}

export const env = loadEnv();
