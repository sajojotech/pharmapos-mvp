import bcrypt from "bcryptjs";

/**
 * Cost factor bcrypt. 12 adalah nilai umum yang seimbang antara keamanan dan
 * latensi login untuk aplikasi web pada 2026. Dipakai konsisten oleh seed
 * dan (pada fase autentikasi) alur ganti password.
 */
const SALT_ROUNDS = 12;

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function verifyPassword(
  plainPassword: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}
