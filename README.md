# PharmaPOS

Aplikasi POS apotek multi-cabang dan multi-user berbasis web.

> **Status:** Fase 11 — Hardening, QA Menyeluruh, & Dokumentasi Final.
> Seluruh modul MVP (master data, inventori/FEFO, purchase receipt, shift
> kasir & POS, transfer antar-cabang, resep/void/retur, dashboard &
> laporan — Fase 01-10) sudah dibangun. Fase 11 murni audit &
> perbaikan: keamanan (authorization/branch-isolation), konsistensi
> transaksi/audit log, test tambahan untuk celah yang ditemukan, dan
> dokumentasi final (dokumen ini, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
> [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md),
> [docs/ERD.mmd](docs/ERD.mmd), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).
> Lihat laporan release-readiness (dibagikan di akhir sesi Fase 11) untuk
> daftar temuan & status GitHub-push/deploy readiness. Deployment
> **belum** dilakukan — lihat [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
> untuk panduan saat diminta eksplisit. Dokumen per-fase lengkap:
> [docs/DATABASE.md](docs/DATABASE.md), [docs/INVENTORY.md](docs/INVENTORY.md),
> [docs/PURCHASING.md](docs/PURCHASING.md), [docs/POS.md](docs/POS.md),
> [docs/TRANSFER.md](docs/TRANSFER.md),
> [docs/PRESCRIPTION_VOID_RETURN.md](docs/PRESCRIPTION_VOID_RETURN.md),
> [docs/REPORTS.md](docs/REPORTS.md) untuk keputusan skema/bisnis per
> fase, [docs/AUTH.md](docs/AUTH.md) untuk alur auth/RBAC/permission
> matrix, dan [docs/MASTER_DATA.md](docs/MASTER_DATA.md) untuk detail
> Fase 03.

## Stack

- Next.js (App Router) + React + TypeScript (strict)
- PostgreSQL + Prisma ORM
- Auth.js v5 (`next-auth@beta`) — Credentials provider, session JWT
- Tailwind CSS v4
- Zod (validasi)
- Vitest (unit test) + Playwright (E2E test)
- Docker Compose (PostgreSQL lokal)

## Setup lokal

### 1. Prasyarat

- Node.js LTS (disarankan v22/v24)
- Docker Desktop (untuk PostgreSQL lokal)

### 2. Clone environment variables

```bash
cp .env.example .env
```

Sesuaikan `AUTH_SECRET` bila perlu (nilai default `.env.example` hanya contoh,
**jangan** dipakai di production).

### 3. Jalankan PostgreSQL lokal

```bash
docker compose up -d
```

Ini akan menjalankan PostgreSQL 16 pada port `5432` dengan database
`pharmapos`, user/password `postgres`/`postgres`, dan volume persisten
`pharmapos_postgres_data`.

Cek status container:

```bash
docker compose ps
```

### 4. Install dependencies

```bash
npm install
```

`postinstall` akan otomatis menjalankan `prisma generate`.

### 5. Jalankan development server

```bash
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000) — akan diarahkan ke
`/login`. Gunakan salah satu akun demo di bawah untuk masuk.

### 6. Migration & seed database

Setelah PostgreSQL lokal jalan (langkah 3) dan dependencies terpasang
(langkah 4):

```bash
npx prisma migrate dev
npx prisma db seed
```

- `prisma migrate dev` membuat/menerapkan migration development (sudah ada
  migration awal `prisma/migrations/20260906110244_init`, jadi perintah ini
  cukup menerapkannya ke database baru Anda).
- `prisma db seed` mengisi data demo (company, cabang, warehouse, kategori,
  satuan, produk, supplier, customer, app setting, dan user demo untuk
  setiap role). **Idempotent** — aman dijalankan berkali-kali, tidak akan
  membuat data duplikat (memakai `upsert` pada kolom unik masing-masing
  tabel).

Untuk production, migration diterapkan dengan (lihat juga
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) pada fase deployment):

```bash
npx prisma migrate deploy
```

### Akun demo (development only)

Semua akun demo memakai password yang sama, di-hash dengan bcrypt sebelum
disimpan (tidak pernah plain-text di database):

```
Password demo: PharmaPOS#Dev2026
```

> ⚠️ Password ini **hanya untuk development lokal**. Jangan pernah memakai
> nilai ini (atau pola serupa) sebagai password akun production — akun
> production harus dibuat dengan password unik yang kuat lewat alur
> manajemen user pada fase autentikasi.

| Email                              | Role              | Akses cabang            |
| ----------------------------------- | ----------------- | ------------------------ |
| `owner@pharmapos.local`             | OWNER              | Seluruh cabang (global) |
| `admin@pharmapos.local`             | CENTRAL_ADMIN      | Seluruh cabang (global) |
| `manager.pusat@pharmapos.local`     | BRANCH_MANAGER     | Cabang Pusat             |
| `apoteker.pusat@pharmapos.local`    | PHARMACIST         | Cabang Pusat             |
| `kasir.pusat@pharmapos.local`       | CASHIER            | Cabang Pusat             |
| `gudang.pusat@pharmapos.local`      | WAREHOUSE_STAFF    | Cabang Pusat             |
| `auditor@pharmapos.local`           | FINANCE_AUDITOR    | Seluruh cabang (global, read-only) |

Role global (`OWNER`, `CENTRAL_ADMIN`, `FINANCE_AUDITOR`) sengaja **tidak**
memiliki baris `UserBranchAssignment` — akses lintas-cabang mereka
ditentukan oleh `Role` lewat permission matrix (lihat
[docs/AUTH.md](docs/AUTH.md)), bukan oleh assignment.

## Scripts

| Script                  | Keterangan                                   |
| ------------------------ | --------------------------------------------- |
| `npm run dev`            | Menjalankan Next.js development server        |
| `npm run build`          | Build production                              |
| `npm run start`          | Menjalankan hasil build production             |
| `npm run lint`           | ESLint                                        |
| `npm run typecheck`      | Pengecekan tipe TypeScript (`tsc --noEmit`)   |
| `npm run test`           | Unit test (Vitest)                            |
| `npm run test:watch`     | Unit test mode watch                          |
| `npm run test:e2e`       | E2E test (Playwright)                         |
| `npm run prisma:generate`| Generate Prisma Client                        |
| `npm run prisma:migrate` | Membuat & menjalankan migration (development) |
| `npm run prisma:deploy`  | Menjalankan migration (production)            |
| `npm run prisma:seed`    | Menjalankan seed database                     |

## Environment variables

Lihat [.env.example](.env.example). Validasi dilakukan melalui
[lib/env.ts](lib/env.ts) menggunakan Zod — aplikasi akan gagal start dengan
pesan yang jelas apabila ada variabel yang hilang/tidak valid.

| Variable                  | Keterangan                                              |
| -------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`             | Connection string PostgreSQL                            |
| `AUTH_SECRET`               | Secret penandatanganan JWT session Auth.js               |
| `AUTH_URL`                  | Base URL aplikasi untuk autentikasi                      |
| `NEXT_PUBLIC_APP_NAME`      | Nama aplikasi yang ditampilkan di UI                     |
| `NEXT_PUBLIC_TIME_ZONE`     | Timezone tampilan (default `Asia/Jakarta`)               |

## Struktur folder

Lihat [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Diagram relasi data
inti: [docs/ERD.mmd](docs/ERD.mmd) (Mermaid — bisa dirender langsung di
GitHub/editor yang mendukung). Aturan bisnis lintas-modul (FEFO, ledger
stok, retur, void, transfer, RBAC) dikonsolidasi di
[docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md).

## Testing

```bash
npm run test        # Unit + integration test (Vitest) — butuh Postgres lokal jalan (docker compose up -d)
npm run test:watch  # Mode watch
npm run test:e2e    # E2E (Playwright) — otomatis menjalankan `next dev` di port 3100,
                     # butuh browser Playwright terpasang: npx playwright install chromium
```

Test integration berjalan **sekuensial** (`fileParallelism:false` di
`vitest.config.ts`) terhadap Postgres dev yang sama, dan membuat data
uji dengan prefix `TEST-`/email `test-*@test.local` yang dibersihkan
sendiri lewat `afterAll` di tiap file — aman dijalankan berulang tanpa
mengotori data demo.

## Troubleshooting

**`Can't reach database server at localhost:5432`**
Postgres lokal belum jalan. `docker compose up -d`, lalu tunggu healthy:
`docker compose ps` (kolom STATUS harus `healthy`, biasanya <10 detik).

**`prisma generate` gagal dengan `EPERM`/file lock di Windows saat `next dev` masih jalan**
Matikan dev server dulu sebelum menjalankan perintah Prisma apa pun
(`migrate dev`, `generate`, `db seed`) — Windows mengunci
`query_engine-windows.dll.node` selama proses Node yang memuatnya masih
hidup. Jalankan Prisma CLI, baru nyalakan lagi `npm run dev`.

**Warning `The configuration property package.json#prisma is deprecated`**
Aman diabaikan untuk saat ini (lihat [docs/DATABASE.md](docs/DATABASE.md)
poin 10) — proyek ini sengaja bertahan di Prisma 6.x; migrasi ke
`prisma.config.ts` dipertimbangkan saat naik ke Prisma 7.

**`npx playwright test` gagal dengan `Executable doesn't exist ... chrome-headless-shell.exe`**
Browser Playwright belum terpasang (terpisah dari `npm install`).
Jalankan `npx playwright install chromium` — di jaringan yang lambat
proses ini bisa memakan beberapa menit (mengunduh ~150-250MB); bila
timeout berulang, coba
`PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=300000 npx playwright install chromium`
atau unduh manual lalu tempatkan sesuai path yang diminta pesan error.

**Login demo gagal / "Email atau password salah"**
Pastikan sudah menjalankan `npx prisma db seed` (bagian Setup lokal
langkah 6) DAN memakai password persis `PharmaPOS#Dev2026` (case-
sensitive) — pesan error sengaja generik (tidak membedakan "email tidak
terdaftar" vs "password salah") untuk mencegah user enumeration, lihat
`app/login/actions.ts`.

**Shift tidak bisa dibuka: "Anda masih memiliki shift yang belum ditutup"**
Satu user hanya boleh punya SATU shift `OPEN` lintas cabang mana pun
(constraint disengaja, lihat docs/POS.md). Tutup shift yang ada dulu di
`/cashier/shifts`, atau login sebagai user lain.

## Fase berikutnya (belum dikerjakan)

- Retur transfer antar-cabang yang sudah SHIPPED (lihat
  [docs/TRANSFER.md](docs/TRANSFER.md) bagian "Catatan untuk fase
  berikutnya") & pembatalan Purchase Receipt yang sudah POSTED (lihat
  [docs/PURCHASING.md](docs/PURCHASING.md) bagian "Alur dokumen").
- Retur ke supplier (`SUPPLIER_RETURN`, enum movement sudah ada sejak
  Fase 01, belum ada service/UI-nya — beda dari retur PENJUALAN dari
  customer yang sudah dibangun Fase 09, lihat
  [docs/PRESCRIPTION_VOID_RETURN.md](docs/PRESCRIPTION_VOID_RETURN.md)).
- Master data pasien (linking `Prescription.patientName`/`patientPhone`
  ke entitas Customer/Patient) & upload gambar resep sungguhan (lihat
  limitasi MVP di [docs/PRESCRIPTION_VOID_RETURN.md](docs/PRESCRIPTION_VOID_RETURN.md)).
- UI admin untuk override batch manual (fungsinya sudah ada & teruji di
  `services/pos-transaction-service.ts::createPaidTransactionWithBatchOverride`,
  belum ada halaman yang memanggilnya — lihat [docs/POS.md](docs/POS.md)).
- Export CSV pada laporan yang reuse fungsi paginated (stock-by-batch,
  near-expiry, expired, kartu stok, transfer, shift-recap) dibatasi
  `EXPORT_MAX_ROWS=10.000` baris (lihat limitasi MVP di
  [docs/REPORTS.md](docs/REPORTS.md)) — perlu direvisi (cursor-based
  export/job async) bila volume data jauh lebih besar.
- Pengembalian uang tunai (cash refund) saat retur belum tercatat
  sebagai pengurang kas shift (lihat docs/BUSINESS_RULES.md catatan
  Fase 11 poin 5 & `computeExpectedCash` di `services/cashier-shift-calc.ts`).
- CI/CD, monitoring/alerting production, load testing — lihat
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) bagian "Yang TIDAK dilakukan
  Fase 11".
- Push ke GitHub & deploy ke Vercel (hanya bila diminta secara eksplisit
  — lihat [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).
