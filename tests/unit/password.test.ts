import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("password hashing", () => {
  it("tidak menyimpan password dalam bentuk plain-text (hash berbeda dari input)", async () => {
    const hash = await hashPassword("PharmaPOS#Dev2026");
    expect(hash).not.toBe("PharmaPOS#Dev2026");
    expect(hash.length).toBeGreaterThan(20);
  });

  it("verifyPassword mengembalikan true untuk password yang benar", async () => {
    const hash = await hashPassword("PharmaPOS#Dev2026");
    await expect(verifyPassword("PharmaPOS#Dev2026", hash)).resolves.toBe(true);
  });

  it("verifyPassword mengembalikan false untuk password yang salah", async () => {
    const hash = await hashPassword("PharmaPOS#Dev2026");
    await expect(verifyPassword("password-salah", hash)).resolves.toBe(false);
  });

  it("menghasilkan hash berbeda untuk input yang sama (salted)", async () => {
    const hashA = await hashPassword("sama-persis");
    const hashB = await hashPassword("sama-persis");
    expect(hashA).not.toBe(hashB);
  });
});
