import { PrismaClient } from "@prisma/client";

/**
 * Next.js dev server melakukan hot-reload modul, yang tanpa penanganan
 * khusus akan membuat instance PrismaClient baru setiap reload dan cepat
 * menghabiskan connection pool database. Pola standar Prisma+Next.js ini
 * menyimpan satu instance di `globalThis` pada mode development, dan
 * membuat instance baru (sekali) di production.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
