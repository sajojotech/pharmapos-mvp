/**
 * React Server Components hanya boleh mengirim plain object ke Client
 * Component. Instance `Prisma.Decimal`/`Date` BUKAN plain object, sehingga
 * akan gagal/di-drop diam-diam saat dikirim sebagai prop ke Client
 * Component. Keduanya sudah mengimplementasikan `toJSON()`, jadi round-trip
 * JSON ini mengubahnya menjadi string biasa (aman dipakai lagi lewat
 * `new Date(...)`/`Number(...)` di sisi client).
 *
 * Pakai fungsi ini setiap kali sebuah Server Component (page.tsx) meneruskan
 * hasil query Prisma sebagai prop ke Client Component.
 *
 * Parameter generik `TOutput` SENGAJA independen dari tipe input (bukan
 * `toPlainJSON<T>(value: T): T`) — runtime value setelah round-trip ini
 * punya bentuk berbeda dari tipe Prisma aslinya (field `Decimal`/`Date`
 * menjadi `string`), jadi memaksa tipe balik sama seperti input akan
 * "berbohong" secara tipe. Selalu tentukan `TOutput` secara eksplisit di
 * titik pemanggilan (mis. `toPlainJSON<ProductFormPayload>(product)`) agar
 * tipe yang diterima Client Component jujur sesuai runtime-nya.
 */
export function toPlainJSON<TOutput>(value: unknown): TOutput {
  return JSON.parse(JSON.stringify(value)) as TOutput;
}
