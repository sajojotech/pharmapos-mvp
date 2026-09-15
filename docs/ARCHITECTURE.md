# Arsitektur PharmaPOS

> Ditulis ulang Fase 11 (hardening) — versi sebelumnya ditulis saat
> bootstrap Fase 01 dan sudah tidak mencerminkan struktur nyata yang
> terbentuk sepanjang Fase 02-10 (mis. menyebut folder `features/` yang
> pada praktiknya tidak pernah dipakai — modul domain hidup langsung di
> `app/(app)/<modul>/` beserta komponennya).

## Prinsip utama

PharmaPOS dibangun sebagai **modular monolith**: satu aplikasi Next.js
(App Router) yang dipecah menjadi modul domain yang jelas batasnya
(auth, master data, inventory, purchases, POS, reports, settings), tanpa
kompleksitas operasional microservices.

- **Server-first.** Server Components dipakai default untuk membaca data
  (langsung memanggil fungsi `services/*.ts`, tanpa lapisan HTTP/fetch
  tambahan). Client Components (`"use client"`) hanya untuk
  interaktivitas yang benar-benar butuh state/browser API — form dengan
  banyak state lokal (POS terminal, form shift), dropdown/filter yang
  mengubah URL search params, dsb.
- **Otorisasi di server, selalu.** RBAC (`lib/rbac.ts`) dan pembatasan
  akses cabang/company divalidasi di server pada SETIAP request (layout
  root `app/(app)/layout.tsx` memanggil `requireAuth()`; tiap
  `page.tsx` memanggil `requirePermission(...)`; tiap Server Action
  memanggil `checkPermission(...)`) — tidak pernah hanya menyembunyikan
  menu di UI.
- **Uang & kuantitas pakai `Prisma.Decimal`.** Tidak ada floating point
  untuk nilai bisnis (harga, stok, kas) di mana pun dalam codebase ini.
- **Waktu disimpan sebagai `timestamp` (BUKAN `timestamptz`), Prisma
  selalu bekerja dalam UTC di level aplikasi; ditampilkan Asia/Jakarta**
  lewat `lib/format.ts`/`lib/timezone.ts`. Lihat catatan penting di
  [docs/BUSINESS_RULES.md](BUSINESS_RULES.md) soal jebakan `AT TIME ZONE`
  pada kolom naive ini (ditemukan & diperbaiki Fase 11).
- **Transaksi atomic.** Semua operasi yang mengubah stok dan/atau
  keuangan dibungkus `prisma.$transaction(...)`, dan primitif stok
  (`services/stock-ledger.ts`) memakai `UPDATE ... WHERE qtyOnHand >=
  qty` (compare-and-swap tunggal di database) — bukan baca-lalu-tulis.
- **Immutable ledger.** Dokumen yang sudah *posted* tidak dihapus/diedit;
  koreksi lewat void/reversal/return/adjustment yang tercatat sebagai
  baris baru, bukan mengubah baris lama.

## Struktur folder (aktual, per Fase 11)

```
app/
  (app)/                 Route group ber-layout sama: sidebar+header,
                          requireAuth() di layout.tsx. SETIAP folder di
                          bawah ini = satu modul domain:
    dashboard/            page.tsx (widget berbasis role)
    master/               products/ categories/ units/ branches/
                          warehouses/ suppliers/ customers/ — masing-
                          masing: page.tsx (list+filter), actions.ts
                          (Server Action create/update/setActive),
                          [id]/page.tsx bila ada detail
    purchases/receipts/   list, [id] detail, [id]/edit, new — draft→post
    inventory/            stock/ batches/ movements/ adjustments/
                          opname/ transfers/ — operasional gudang
    pos/                  pos-terminal.tsx (kasir), transactions/[id]/
                          (invoice+void+retur), prescriptions/[id]/
                          (review resep)
    cashier/shifts/       buka/tutup shift, riwayat
    reports/              15 halaman laporan + index, masing-masing
                          page.tsx + export/route.ts (CSV)
    settings/users/       manajemen user
  api/auth/[...nextauth]/ Route Handler Auth.js (satu-satunya di luar
                          route group (app), karena API auth publik)
  login/                  Halaman login (di luar (app) — tidak perlu
                          sidebar/auth-wrapper)
  forbidden/              Halaman 403 generik (tujuan redirect
                          requirePermission/requireRole)

components/
  app-shell/              Sidebar, Header, BranchSelector, nav-items.ts
                          (daftar menu + permission per item)
  inventory/               Filter bar & badge status khusus modul inventory
  master/                 Table/toolbar/pagination generik dipakai
                          seluruh halaman master data
  reports/                ReportFilterBar, ReportExportLink (Fase 10)
  ui/                     Primitif lepas-konteks (Modal, ConfirmActionButton,
                          StatusBadge) — TIDAK mengandung business logic

lib/
  rbac.ts / rbac-core.ts  can()/requireAuth()/requirePermission()/
                          checkPermission() — rbac-core.ts SENGAJA tanpa
                          "server-only" supaya bisa diuji Vitest tanpa
                          request Next.js sungguhan
  permissions.ts          PERMISSIONS union + ROLE_PERMISSIONS matrix
                          (satu-satunya sumber kebenaran RBAC)
  auth.ts                 Konfigurasi Auth.js v5 (Credentials provider)
  actions/                Server Action lintas-modul (mis. pilih cabang
                          aktif) yang tidak natural dimiliki satu modul
  prisma.ts               Singleton PrismaClient
  format.ts / timezone.ts Formatter Rupiah/tanggal (Asia/Jakarta) +
                          helper batas hari untuk laporan (Fase 10)
  csv.ts / report-export.ts  Serialisasi CSV + helper export (Fase 10)
  response.ts             actionSuccess/actionErrorFromUnknown (Server
                          Action) & apiSuccess/apiError (Route Handler)
                          — bentuk response konsisten, tidak pernah
                          membocorkan raw error ke client
  env.ts                  Validasi environment variable (Zod) saat modul
                          pertama kali diimpor
  document-number.ts      Penomoran dokumen sekuensial (INV-/PR-/ADJ-/
                          OPN-/TRF-) dengan retry aman terhadap tabrakan
                          — lihat docs/BUSINESS_RULES.md poin 3

services/
  <domain>-service.ts     Business logic & akses data Prisma per domain
                          (satu file ~ satu aggregate/modul: pos-
                          transaction, stock-ledger, stock-transfer,
                          purchase-receipt, cashier-shift, dst.)
  reports/                Fungsi agregasi khusus laporan (Fase 10) —
                          dipisah dari service domain aslinya karena
                          query-nya beda bentuk (grouped/aggregate,
                          bukan CRUD per-baris)

prisma/
  schema.prisma           Satu-satunya sumber kebenaran skema
  migrations/              Migration history (jangan diedit manual)
  seed.ts                  Seed idempotent (upsert) — lihat README

tests/
  unit/                   Vitest — fungsi murni (lib/, kalkulasi, RBAC)
  integration/             Vitest — service layer terhadap Postgres dev
                          sungguhan (`fileParallelism:false`, lihat
                          vitest.config.ts)
  e2e/                    Playwright — alur lintas-halaman lewat browser
                          sungguhan (lihat playwright.config.ts)

docs/                     Dokumentasi teknis & aturan bisnis (satu file
                          per fase pengerjaan — dokumen historis, TIDAK
                          diedit ulang di fase berikutnya kecuali secara
                          eksplisit disebut "diperbarui Fase N")
```

### Kenapa `services/` terpisah dari `app/`

Server Component (`page.tsx`) dan Server Action (`actions.ts`) dibuat
setipis mungkin: mem-parsing input (Zod), memanggil satu/lebih fungsi
`services/`, lalu mengembalikan hasil lewat `lib/response.ts`. Seluruh
logika bisnis (alokasi FEFO, perhitungan kas shift, aturan void/retur,
agregasi laporan) hidup di `services/` sebagai fungsi async biasa yang
menerima `PrismaClient`/`Prisma.TransactionClient` sebagai parameter —
ini membuatnya bisa diuji langsung dengan Vitest (lihat
`tests/integration/`) tanpa menjalankan server Next.js maupun browser.

## Request flow

### Server Component (baca data) — pola paling umum

```
Browser → GET /inventory/batches?branchId=...
        → app/(app)/layout.tsx: requireAuth() [redirect /login bila gagal]
        → app/(app)/inventory/batches/page.tsx:
            requirePermission("inventory.read") [redirect /forbidden bila gagal]
            → getAllowedBranchIds(user)   (branch-service.ts, server-side,
                                           TIDAK memercayai branchId client)
            → listBatchesPaginated({ allowedBranchIds, branchId, ... })
              (stock-batch-service.ts — query Prisma langsung)
        → HTML dirender di server, dikirim ke browser (tidak ada
          round-trip JSON terpisah untuk data awal halaman)
```

### Server Action (mutasi) — dipanggil dari Client Component

```
Client Component (mis. pos-terminal.tsx, "use client")
  → memanggil fungsi Server Action (mis. payTransactionAction(input))
    lewat import biasa — Next.js otomatis membuat ini jadi POST
    request tersembunyi ke server
  → app/(app)/pos/actions.ts::payTransactionAction:
      checkPermission("pos.sell")            [return {success:false}
                                               bila gagal, TIDAK redirect
                                               — supaya Client Component
                                               bisa menampilkan errornya]
      paySchema.parse(input)                 [Zod — tolak bila invalid]
      getAllowedBranchIds(access.user)
      → createPaidTransaction({...})          (pos-transaction-service.ts)
          prisma.$transaction(async (tx) => {
            prepareTransaction (validasi harga/diskon/stok)
            persistTransactionHeader (buat header+payment)
            allocateFefoForItems (FEFO + deductStockFromBatch per item)
            recordAudit(..., tx)
          })
      → actionSuccess({id, documentNumber}) ATAU actionErrorFromUnknown(error)
  ← Client Component menerima ActionResult biasa (bukan Response HTTP
    mentah), toast sukses/error, lalu router.push/router.refresh()
```

### Route Handler (CSV export, Auth.js)

Dua kategori route handler di proyek ini:
1. `app/api/auth/[...nextauth]/route.ts` — didelegasikan penuh ke
   Auth.js (`lib/auth.ts`).
2. `app/(app)/reports/<slug>/export/route.ts` (Fase 10) — `GET` biasa
   yang mem-parsing `searchParams`, memanggil `checkPermission(...)`
   (pola sama Server Action, karena Route Handler juga tidak bisa
   `redirect()` dengan makna yang sama seperti Server Component), lalu
   memanggil FUNGSI SERVICE YANG SAMA dengan halaman laporannya (bukan
   query terpisah) sebelum men-serialize ke CSV (`lib/csv.ts`) — lihat
   [docs/REPORTS.md](REPORTS.md) poin desain #5 untuk alasan lengkap.

## Server/Client boundary

- Default: **Server Component**. Sebuah file HANYA menjadi Client
  Component bila diberi `"use client"` secara eksplisit di baris
  pertama — dipakai untuk: form dengan banyak `useState` lokal (POS
  terminal, form buka/tutup shift, form review resep), komponen filter
  yang membaca/menulis `useSearchParams()`/`usePathname()`
  (`ReportFilterBar`, `InventoryFilterBar`), dan tombol dengan state
  loading/konfirmasi (`VoidButton`, `ConfirmActionButton`).
- Server Action (`"use server"` di `actions.ts`) adalah SATU-SATUNYA
  jalan Client Component memanggil mutasi — tidak ada `fetch()` manual
  ke endpoint custom untuk mutasi data di proyek ini.
- Data yang dikirim dari Server Component ke Client Component (sebagai
  props) HARUS plain JSON-serializable — `Prisma.Decimal`/`Date`
  di-passthrough lewat `lib/serialize.ts::toPlainJSON()` (keduanya
  mengimplementasikan `toJSON()`, round-trip JSON mengubahnya jadi
  string biasa) sebelum diteruskan sebagai prop ke Client Component.

## Environment & konfigurasi

Environment variable divalidasi lewat `lib/env.ts` (Zod) saat modul
tersebut pertama kali diimpor — aplikasi gagal start dengan pesan jelas
bila ada variabel yang hilang/tidak valid, bukan error runtime samar di
tengah request. Lihat [.env.example](../.env.example) untuk daftar
lengkap dan [docs/DEPLOYMENT.md](DEPLOYMENT.md) untuk nilai production.

## Status per Fase (ringkas — lihat README untuk status TERKINI)

| Fase | Fokus |
| --- | --- |
| 01 | Bootstrap: struktur, tooling, Docker Compose Postgres |
| 02 | Auth.js + RBAC dasar |
| 03 | Master data (produk, kategori, satuan, cabang, warehouse, supplier, customer) |
| 04 | Inventori inti: batch, ED, ledger, adjustment, opname |
| 05 | Purchase receipt (draft→posted) |
| 06 | Shift kasir & POS dasar (belum potong stok nyata) |
| 07 | FEFO nyata + pengurangan stok POS |
| 08 | Transfer stok antar-cabang |
| 09 | Resep minimum (2 tahap), void, retur penjualan |
| 10 | Dashboard berbasis role + 15 laporan + export CSV |
| 11 | **Hardening**: audit keamanan/konsistensi, E2E Playwright, dokumentasi final (dokumen ini) |

Detail keputusan desain tiap fase ada di dokumen masing-masing
(`docs/AUTH.md`, `docs/MASTER_DATA.md`, `docs/INVENTORY.md`,
`docs/PURCHASING.md`, `docs/POS.md`, `docs/TRANSFER.md`,
`docs/PRESCRIPTION_VOID_RETURN.md`, `docs/REPORTS.md`). Aturan bisnis
inti dikonsolidasi di [docs/BUSINESS_RULES.md](BUSINESS_RULES.md).
