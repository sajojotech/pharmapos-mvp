# Panduan Deployment — Fase 11

**Belum di-deploy.** Dokumen ini disiapkan sebagai panduan siap-pakai
untuk deployment production yang eksplisit diminta user, sesuai
instruksi Fase 11 ("Jangan melakukan GitHub push atau deployment
production pada fase ini"). Ikuti dokumen ini HANYA setelah user secara
eksplisit meminta push/deploy.

## 1. Environment variable production

Sumber kebenaran: [lib/env.ts](../lib/env.ts) (divalidasi Zod saat start
— aplikasi menolak start dengan pesan jelas bila ada yang hilang/tidak
valid, bukan error runtime samar).

| Variable | Wajib | Catatan production |
| --- | --- | --- |
| `DATABASE_URL` | Ya | Connection string PostgreSQL production (lihat bagian 2). **Jangan** memakai kredensial dev (`postgres`/`postgres`). |
| `AUTH_SECRET` | Ya, min. 16 karakter | Generate baru khusus production: `openssl rand -base64 32`. **Jangan pernah** memakai nilai `.env.example` atau nilai dev. |
| `AUTH_URL` | Ya, harus URL valid | Domain production sungguhan (mis. `https://pharmapos.namadomain.com`), BUKAN `localhost`. |
| `NEXT_PUBLIC_APP_NAME` | Tidak (default "PharmaPOS") | Boleh disesuaikan per tenant/branding. |
| `NEXT_PUBLIC_TIME_ZONE` | Tidak (default "Asia/Jakarta") | **Jangan diubah** kecuali seluruh asumsi timezone di `lib/timezone.ts` dan raw SQL `services/reports/sales-report.ts::getDailySalesByBranch` (hardcode offset +07:00) ikut ditinjau ulang — lihat docs/BUSINESS_RULES.md poin 3. |

Variabel lain yang TIDAK dipakai proyek ini (tidak perlu di-set):
`NEXTAUTH_SECRET`/`NEXTAUTH_URL` (nama lama Auth.js v4 — proyek ini
pakai Auth.js v5 beta dengan nama `AUTH_SECRET`/`AUTH_URL`).

Password akun demo di seed (`PharmaPOS#Dev2026`) **TIDAK BOLEH** dipakai
di production — lihat bagian 5.

## 2. PostgreSQL production

- Rekomendasi minimal: PostgreSQL 16 (versi yang dipakai & diuji selama
  pengembangan — lihat `docker-compose.yml`), dengan koneksi TLS
  (`sslmode=require` pada `DATABASE_URL`) bila provider mendukung.
- Skema TIDAK memakai ekstensi Postgres apa pun di luar bawaan (tidak
  ada `pgcrypto`/`uuid-ossp`, dst — primary key pakai `cuid()` yang
  digenerate di level Prisma, bukan database) — provider managed
  Postgres mana pun (Supabase, Neon, RDS, Railway, dll.) seharusnya
  cocok tanpa konfigurasi ekstensi tambahan.
- **Connection pooling**: aplikasi Next.js serverless (Vercel) membuka
  banyak koneksi database pendek-umur secara paralel. Bila provider
  Postgres punya batas koneksi ketat, pakai connection pooler
  (PgBouncer/provider's built-in pooler, mis. Supabase's "Transaction"
  pooler atau Neon's pooled connection string) untuk `DATABASE_URL` —
  proyek ini belum diuji dengan Prisma Accelerate/Data Proxy; bila
  dipakai, uji ulang seluruh `$transaction` multi-statement (lihat
  docs/BUSINESS_RULES.md poin 3) karena beberapa proxy connection
  pooling mode ("transaction mode") punya batasan terhadap
  prepared-statement/session-level behaviour yang dipakai Prisma.
- Backup: aktifkan point-in-time recovery (PITR) atau snapshot berkala
  di sisi provider — di luar cakupan kode aplikasi ini.

## 3. Migration production

**Jangan pernah** memakai `prisma migrate dev` di production (perintah
itu bisa mereset database dalam skenario drift). Gunakan:

```bash
npx prisma migrate deploy
```

(sudah terdaftar sebagai `npm run prisma:deploy`). Perintah ini HANYA
menerapkan migration yang belum diterapkan dari `prisma/migrations/`
secara berurutan — tidak pernah membuat migration baru maupun mereset
data.

Urutan yang direkomendasikan saat deploy pertama kali / update:

1. `npm ci` (bukan `npm install` — memakai `package-lock.json` persis,
   reproducible).
2. `npx prisma generate` (biasanya otomatis lewat `postinstall`, tapi
   pastikan berjalan sebelum build bila pipeline CI memisahkan langkah
   install & build).
3. `npx prisma migrate deploy` — **sebelum** menjalankan build/start
   aplikasi versi baru, supaya skema selalu siap sebelum kode yang
   mengasumsikannya berjalan.
4. `npm run build`.
5. Jalankan aplikasi (`npm run start`, atau serverless functions Vercel).

**Seed production**: `prisma/seed.ts` idempotent (aman dijalankan
berkali-kali) TAPI dirancang untuk data DEMO (password sama untuk semua
akun, nama company/cabang contoh). **Jangan** jalankan
`npm run prisma:seed` di production apa adanya — buat proses onboarding
terpisah (di luar cakupan MVP ini) yang membuat akun Owner pertama
dengan password unik, atau jalankan seed lalu SEGERA ganti seluruh
password akun demo sebelum sistem dipakai sungguhan.

## 4. Deploy ke Vercel

Proyek ini adalah aplikasi Next.js standar (App Router), tidak memakai
konfigurasi build khusus di `next.config.ts` — deploy Vercel mengikuti
alur baku:

1. Hubungkan repository ke project Vercel.
2. Set environment variable (bagian 1) di Vercel Project Settings →
   Environment Variables, untuk environment Production (dan Preview
   bila dipakai, dengan `DATABASE_URL`/`AUTH_URL` yang BERBEDA dari
   production sungguhan).
3. Build command default (`npm run build` / `next build`) sudah benar
   — `postinstall` men-generate Prisma Client otomatis.
4. **Migration TIDAK otomatis dijalankan oleh Vercel saat build** —
   jalankan `npx prisma migrate deploy` secara terpisah SEBELUM
   deployment baru menerima traffic (mis. lewat CI/CD step manual, atau
   Vercel "Deploy Hook" yang dirantai dengan step migration, atau
   dijalankan manual dari mesin dev/CI yang connect ke DB production).
   Ini di luar cakupan otomatisasi MVP ini — dilakukan manual dengan
   hati-hati setiap kali ada migration baru.
5. Auth.js v5 di Vercel: pastikan `AUTH_URL` sama persis dengan domain
   production (termasuk `https://`, tanpa trailing slash) — Auth.js
   memvalidasi origin request terhadap nilai ini untuk mencegah CSRF.
6. Region: pilih region Vercel yang paling dekat dengan region database
   (mis. bila database di Singapore, pilih Vercel region `sin1`) untuk
   latensi query yang rendah — aplikasi ini melakukan banyak query
   Prisma per request (dashboard/laporan terutama, lihat
   docs/REPORTS.md), latensi database-ke-app sangat memengaruhi
   responsivitas.

## 5. Checklist sebelum go-live

- [ ] `AUTH_SECRET` unik, digenerate baru (bukan nilai dev/`.env.example`).
- [ ] `DATABASE_URL` menunjuk ke database production (bukan dev/staging).
- [ ] `AUTH_URL` = domain production sungguhan.
- [ ] Seluruh akun demo (`*.pharmapos.local`) TIDAK ada di database
      production — atau bila seed dipakai sebagai starting point,
      password SEMUA akun tsb sudah diganti sebelum go-live.
- [ ] `npx prisma migrate deploy` sudah dijalankan & berhasil terhadap
      database production SEBELUM traffic pertama.
- [ ] Backup/PITR database production aktif.
- [ ] Connection pooling database sudah dikonfigurasi bila provider
      membatasi jumlah koneksi.

## 6. Rollback

- **Rollback kode**: Vercel menyimpan riwayat deployment — "Instant
  Rollback" ke deployment sebelumnya adalah operasi standar Vercel,
  tidak butuh langkah khusus dari proyek ini SELAMA migration schema
  BELUM berjalan untuk versi baru (lihat poin berikut).
- **Rollback schema/migration**: Prisma Migrate **tidak** punya
  perintah "migrate down" bawaan untuk production. Bila migration baru
  bermasalah SETELAH `migrate deploy` diterapkan:
  1. Rollback kode aplikasi ke versi SEBELUM migration itu (lewat
     Vercel Instant Rollback) HANYA aman bila migration tsb backward
     compatible (kolom baru nullable, tidak menghapus kolom yang masih
     dipakai kode lama, dst).
  2. Bila migration BUKAN backward compatible (mis. mengubah tipe
     kolom, menghapus kolom yang masih dibaca kode versi lama), rollback
     KODE SAJA tidak cukup — perlu migration BARU yang membalikkan
     perubahan schema (`prisma migrate dev -n rollback_xxx` di lokal,
     review manual, lalu `migrate deploy` ke production), BUKAN
     menghapus/mengedit file migration yang sudah diterapkan.
  3. **Jangan pernah** menjalankan `prisma migrate reset` di production
     — perintah ini menghapus SELURUH data.
- Sejauh Fase 11, seluruh migration proyek ini (lihat
  `prisma/migrations/`) bersifat ADDITIVE (tambah kolom/tabel nullable
  atau dengan default) — belum ada migration yang mengubah/menghapus
  kolom yang sudah dipakai data nyata, sehingga risiko rollback saat ini
  relatif rendah. Tinjau ulang asumsi ini setiap kali migration baru
  dibuat.

## 7. Yang TIDAK dilakukan Fase 11 (di luar cakupan)

- CI/CD pipeline (GitHub Actions, dst.) untuk otomatisasi
  lint/test/migrate/deploy — proyek ini menjalankan seluruh quality
  gate secara manual per fase (lihat README).
- Monitoring/alerting production (Sentry, log aggregation, dst.).
- Load testing / kapasitas server.
- Multi-region/high-availability deployment.
