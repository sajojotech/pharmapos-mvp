# Dashboard, Laporan, & Export CSV — Fase 10

Lapisan pelaporan READ-ONLY di atas seluruh data operasional yang dibangun
Fase 01-09 (POS/FEFO, transfer, resep, void, retur, shift kasir, stok/
batch/movement). **Tidak ada perubahan skema/migrasi** — `AppSetting`
(key-value JSON, sudah dipakai `CASH_VARIANCE_THRESHOLD` sejak Fase 06)
cukup untuk menyimpan window ED (`NEAR_EXPIRY_WINDOW_DAYS`).

## Keputusan desain

### 1. Definisi "omzet/penjualan"

Transaksi dengan `paidAt IS NOT NULL` DAN `status != VOIDED` (mencakup
`PAID`, `PARTIALLY_RETURNED`, `RETURNED`) — angka **GROSS**, belum
dikurangi retur (retur punya laporannya sendiri: "Void, Retur, & Diskon").
`VOIDED` dikeluarkan total karena transaksinya sudah dibalik penuh
(`services/pos-void-service.ts`, Fase 09); `CANCELLED`/`DRAFT`/
`PENDING_PRESCRIPTION_REVIEW` memang belum pernah dibayar. Konstanta
`SALES_WHERE_BASE` di `services/reports/sales-report.ts` menegakkan ini
di satu tempat, dipakai ulang oleh laporan diskon.

### 2. Timezone & bucket harian — jebakan `timestamp` vs `timestamptz`

Seluruh laporan pakai Asia/Jakarta (WIB, offset tetap +07:00, TIDAK ada
DST). `lib/timezone.ts` membangun batas hari via literal offset ISO
(`jakartaDayStart("2026-09-10")` → `2026-09-10T00:00:00.000+07:00`) dan
`jakartaToday()` via `Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jakarta"})`.

**Catatan penting yang ditemukan saat implementasi**: kolom `DateTime`
Prisma di proyek ini (termasuk `PosTransaction.paidAt`) dipetakan ke
`timestamp(3) WITHOUT TIME ZONE` di Postgres (tanpa anotasi
`@db.Timestamptz`), BUKAN `timestamptz`. Prisma selalu menyimpan/membaca
nilai `DateTime` sebagai representasi UTC pada tipe naive tsb. Karena itu,
query bucket-harian (`getDailySalesByBranch`, satu-satunya laporan yang
butuh raw SQL untuk `date_trunc` per hari) **TIDAK** memakai
`paidAt AT TIME ZONE 'Asia/Jakarta'` — semantik `AT TIME ZONE` pada kolom
naive justru TERBALIK (ia akan menafsirkan nilai yang sudah naive-UTC itu
seolah-olah sudah dalam zona tsb, lalu mengonversinya lagi, menggeser
tanggal sehari lebih awal — bug ini sempat terjadi & tertangkap oleh test
integrasi sebelum diperbaiki). Solusi: tambahkan offset +7 jam sebagai
**interval** SEBELUM `date_trunc` (`t."paidAt" + interval '7 hours'`) —
murni aritmatika interval yang tidak bergantung pada timezone session
Postgres sama sekali. Filter `WHERE paidAt >= $dateFrom AND <= $dateTo`
(bukan ekspresi bucket) tetap aman dipakai apa adanya karena Prisma
menyerialisasi parameter `Date` JS secara konsisten dengan cara ia
menyimpan kolom naive tsb.

### 3. Dashboard vs `/reports/consolidated`

`/dashboard` = snapshot HARI INI saja tanpa filter (langsung berguna
begitu login). `/reports/consolidated` = versi date-range untuk analisis
periode, permission `report.read.all`. Dashboard men-split tampilan
berdasar `can(user,"report.read.all")` (BUKAN hardcode role) — Finance
Auditor otomatis dapat tampilan konsolidasi (konsisten dengan akses
report-nya), role lain (termasuk Cashier/Warehouse Staff) dapat tampilan
"cabang" terikat `activeBranchId` mereka — dashboard cabang ditampilkan
untuk SEMUA role tanpa permission tambahan (widget operasional dasar,
beda dari `/reports` yang tetap digerbangi `report.read.branch`). Widget
shift aktif hanya tampil bila `can(user,"shift.manage")`.

### 4. Gating izin

Mengikuti pola yang SUDAH ADA di seluruh codebase untuk halaman baca
(`requirePermission` di level page, TANPA re-check di service — dipakai
`/master/*`, `/inventory/*`, dst; re-check di service khusus dipakai
untuk aksi WRITE berisiko tinggi seperti void/prescription-review, tidak
relevan di sini karena laporan murni read). `report.read.branch` → menu
`/reports` + seluruh halaman laporan per-cabang (branch-scoped ke
`allowedBranchIds` pemanggil via `getAllowedBranchIds` — Owner/Central
Admin/Finance Auditor otomatis dapat SELURUH cabang aktif, role cabang
hanya cabang yang ditugaskan). `report.read.all` KHUSUS
`/reports/consolidated`. Route export CSV memakai `checkPermission(...)`
(varian non-redirect dari `lib/rbac.ts`) dengan permission yang SAMA
dengan halamannya — diverifikasi manual: request langsung ke
`/reports/*/export` sebagai Cashier mengembalikan **403**, bukan hanya
redirect halaman.

### 5. CSV vs pagination

Laporan yang murni AGGREGATE (sales-by-branch, by-cashier, by-payment-
method, by-product, top-products, void/retur/diskon, stock-available,
stock-minimum) TIDAK dipaginasi — ukurannya dibatasi jumlah grup (cabang/
kasir/produk), jadi tabel & CSV memanggil fungsi service yang SAMA dengan
filter yang SAMA → otomatis konsisten. Laporan yang reuse fungsi
`listXPaginated` yang sudah ada (stock-by-batch, near-expiry, expired,
kartu stok, transfer, shift-recap) tetap dipaginasi di tabel, tapi route
export memanggil fungsi yang SAMA dengan `page:1, pageSize:EXPORT_MAX_ROWS`
(`lib/report-export.ts`, 10.000 baris) supaya CSV berisi SELURUH baris
sesuai filter (bukan cuma satu halaman) — batas ini simplifikasi MVP yang
disengaja.

**Kenapa export dijamin konsisten dengan tabel & tidak bocor cabang lain**:
route export TIDAK menulis query terpisah — ia memanggil PERSIS fungsi
service yang sama dengan halaman, dengan filter yang di-parse dari
searchParams yang sama, dan `allowedBranchIds` yang sama (dari
`getAllowedBranchIds(access.user)`). Karena itu, test integrasi yang
membuktikan branch-scoping & filter tanggal/cabang pada fungsi service
SEKALIGUS membuktikan export benar — tidak ada test terpisah yang
memanggil Route Handler HTTP langsung (tidak ada preseden pola itu di
test suite manapun pada codebase ini).

### 6. Nilai CSV

Kolom angka/uang di CSV berupa angka MENTAH (mis. `255000`, bukan
`"Rp 255.000"`) supaya bisa dihitung ulang di Excel. Kolom tanggal pakai
format ISO (`YYYY-MM-DD`) atau `toISOString()` untuk timestamp — bukan
format Indonesia yang dipakai UI, supaya tetap gampang diparse ulang.
`lib/csv.ts::csvResponse` menambahkan BOM UTF-8 supaya Excel membaca nama
produk/pasien yang mengandung karakter non-ASCII dengan benar.

## Dashboard (role-based, `/dashboard`)

| Role | Widget |
| --- | --- |
| Owner / Central Admin / Finance Auditor (`report.read.all`) | Omzet + transaksi hari ini SELURUH cabang, penjualan per cabang (hari ini), produk terlaris (hari ini), stok kritis, produk mendekati ED, transfer in-transit/pending |
| Role cabang lainnya | Omzet + transaksi hari ini cabang aktif, status shift aktif (bila `shift.manage`), stok minimum, produk mendekati ED, transfer pending cabang aktif |

Sumber: `services/reports/dashboard-service.ts`
(`getGlobalDashboardSnapshot`/`getBranchDashboardSnapshot`), keduanya
compose ulang fungsi-fungsi report di bawah dengan
`dateFrom=dateTo=jakartaToday()`.

## 15 Laporan (`/reports/<slug>`)

| Laporan | Slug | Sumber data | Filter | Permission |
| --- | --- | --- | --- | --- |
| Penjualan per Cabang (Harian) | `sales-by-branch` | `getDailySalesByBranch` (raw SQL, day-bucket) | tanggal, cabang | `report.read.branch` |
| Penjualan per Kasir | `sales-by-cashier` | `getSalesByCashier` | tanggal, cabang | `report.read.branch` |
| Penjualan per Metode Pembayaran | `sales-by-payment-method` | `getSalesByPaymentMethod` | tanggal, cabang | `report.read.branch` |
| Penjualan per Produk & Kategori | `sales-by-product` | `getSalesByProductCategory` | tanggal, cabang, kategori | `report.read.branch` |
| Produk Terlaris | `top-products` | `getTopProducts` (limit 20) | tanggal, cabang, kategori | `report.read.branch` |
| Void, Retur, & Diskon | `void-return-discount` | `getVoidReport`+`getReturnReport`+`getDiscountReport` (3 tabel 1 halaman, export via `?section=void\|return\|discount`) | tanggal, cabang | `report.read.branch` |
| Rekap Shift & Variance Kas | `shift-recap` | `listShiftsPaginated` (+`dateFrom`/`dateTo` baru, additive) | tanggal, cabang, status | `report.read.branch` |
| Stok Tersedia per Cabang | `stock-available` | `getStockAvailableReport` (= `listStockBalance` Fase 04) | cabang, produk | `report.read.branch` |
| Stok per Batch | `stock-by-batch` | `listBatchesPaginated` (Fase 04, sudah ada) | cabang, produk, status, ED | `report.read.branch` |
| Stok Minimum | `stock-minimum` | `getStockMinimumReport` (reuse `listStockBalance` + enrich `defaultMinStock`/kategori) | cabang, kategori | `report.read.branch` |
| Produk Mendekati ED | `near-expiry` | `getNearExpiryReport` (reuse `listBatchesPaginated`, window dari `AppSetting NEAR_EXPIRY_WINDOW_DAYS`, default 90 hari) | cabang, produk | `report.read.branch` |
| Produk Kedaluwarsa | `expired` | `getExpiredReport` (reuse `listBatchesPaginated`, status EXPIRED) | cabang, produk | `report.read.branch` |
| Kartu Stok | `stock-card` | `listMovementsPaginated` (Fase 04, sudah ada) | cabang, produk, jenis mutasi, tanggal | `report.read.branch` |
| Transfer Antar-Cabang | `transfers` | `listTransfersPaginated` (+`dateFrom`/`dateTo` baru, additive) | tanggal, cabang, status | `report.read.branch` |
| Dashboard Konsolidasi | `consolidated` | `getConsolidatedReport` (versi date-range dari global snapshot) | tanggal | **`report.read.all`** |

Semua halaman: `requirePermission(...)` di level page, `getAllowedBranchIds(user)`
untuk branch-scoping, `ReportFilterBar`/`InventoryFilterBar` (reuse) untuk
filter, empty-state bila tidak ada data, `ReportExportLink` untuk CSV.

## Perluasan aditif (tidak mengubah perilaku pemanggil lama)

- `services/cashier-shift-service.ts::ShiftListQuery`/`listShiftsPaginated`:
  tambah `dateFrom?`/`dateTo?` opsional (filter `openedAt`). Halaman
  `/cashier/shifts` yang sudah ada tidak mengirim parameter ini — tidak
  terpengaruh (dibuktikan test tambahan di
  `tests/integration/cashier-shift-service.test.ts`).
- `services/stock-transfer-service.ts::TransferListQuery`/
  `listTransfersPaginated`: tambah `dateFrom?`/`dateTo?` opsional (filter
  `createdAt`), plus `branchScopeWhere` diekspor (dipakai ulang
  `services/reports/transfer-report.ts::listPendingTransfers`). Halaman
  `/inventory/transfers` tidak terpengaruh (test tambahan di
  `tests/integration/stock-transfer-service.test.ts`).

## Hasil test & quality gate

| Gate | Hasil |
| --- | --- |
| Migration | Tidak ada — Fase 10 murni read-only, tanpa perubahan skema |
| `npm run lint` | ✅ 0 error |
| `npm run typecheck` | ✅ |
| `npm run test` | ✅ **231/231** (203 lama tetap hijau + 28 baru) |
| `npm run build` | ✅ 61 route (30 route baru: 15 halaman laporan + 15 route export) |

Cakupan test baru:
- **Permission matrix** (`tests/unit/permissions.test.ts`, describe block
  baru): CASHIER & WAREHOUSE_STAFF tidak punya `report.read.branch`
  maupun `report.read.all`; BRANCH_MANAGER/PHARMACIST punya
  `report.read.branch` TAPI BUKAN `report.read.all` (tidak bisa buka
  laporan konsolidasi); OWNER/CENTRAL_ADMIN/FINANCE_AUDITOR punya
  keduanya.
- **CSV** (`tests/unit/csv.test.ts`): escaping koma/kutip-ganda/newline,
  BOM UTF-8 (diverifikasi lewat byte mentah, karena `Response.text()`
  membuang BOM saat decode — perilaku standar `TextDecoder`),
  `Content-Disposition: attachment`.
- **Sales report** (`tests/integration/sales-report-service.test.ts`):
  omzet dikelompokkan benar per hari & per cabang; `allowedBranchIds`
  terbatas → cabang lain tidak bocor; VOIDED tidak terhitung tapi
  transaksi biasa tetap gross; agregasi per kasir/metode-pembayaran/
  produk benar; `getTopProducts` terurut qty desc.
- **Inventory report** (`tests/integration/inventory-report-service.test.ts`):
  window default 90 hari & override `AppSetting` bekerja; batch dalam
  window muncul di near-expiry, di luar window tidak; batch yang sudah
  lewat ED muncul HANYA di expired (dipisah tegas dari near-expiry);
  produk di bawah/sama `defaultMinStock` muncul di stock-minimum.
- **Void/Retur/Diskon** (`tests/integration/void-return-discount-report.test.ts`):
  reuse `voidTransaction`/`createSalesReturn` Fase 09 — hasilnya muncul
  tepat di laporan masing-masing dengan alasan & aktor benar; diskon
  teragregasi benar per cabang.
- **Dashboard & Consolidated** (`tests/integration/dashboard-service.test.ts`):
  snapshot cabang tidak bocor ke cabang lain; snapshot global menjumlahkan
  lintas cabang sesuai `allowedBranchIds`; consolidated report menghormati
  date range custom (rentang di luar data mengembalikan nol).
- **QA manual browser** (dicatat di sini karena tidak ada test HTTP
  langsung ke Route Handler): Owner → `/dashboard` widget konsolidasi
  tampil dengan data live seed (omzet, stok kritis, near-ED, transfer
  pending); `/reports` menampilkan seluruh 15 link + section Konsolidasi.
  Branch Manager → `/reports` OK tapi TIDAK ada section Konsolidasi;
  `/reports/consolidated` → halaman Forbidden. Cashier → tidak ada menu
  "Laporan" di nav; `/reports` → halaman Forbidden; `fetch()` langsung ke
  `/reports/sales-by-branch/export` → **403** (membuktikan gating di
  level Route Handler, bukan hanya UI/redirect halaman). CSV export
  `sales-by-branch` & `near-expiry` diperiksa byte-per-byte — isinya
  identik dengan tabel yang ditampilkan (angka mentah, bukan format
  Rupiah).

## Limitasi MVP (eksplisit)

- **`EXPORT_MAX_ROWS = 10.000`** — laporan yang reuse fungsi paginated
  (stock-by-batch, near-expiry, expired, kartu stok, transfer, shift-
  recap) membatasi export CSV ke 10.000 baris pertama sesuai filter,
  bukan true streaming tanpa batas. Cukup untuk skala data MVP; perlu
  direvisi (cursor-based export atau job async) bila volume data jauh
  lebih besar di kemudian hari.
- **Dashboard = hari ini saja** — tidak ada filter tanggal di `/dashboard`
  sama sekali (by design, lihat poin 3); analisis periode arbitrer ada di
  `/reports/consolidated` & laporan penjualan lainnya.
- **Timezone tunggal (Asia/Jakarta, offset tetap)** — hardcoded di
  `lib/timezone.ts` dan raw SQL `getDailySalesByBranch`, konsisten dengan
  asumsi single-tenant/single-timezone yang sudah berlaku sejak Fase 01
  (`NEXT_PUBLIC_TIME_ZONE` default).
- **"Penjualan per Produk & Kategori"** menampilkan baris PER PRODUK
  (dengan kolom kategori & filter kategori), BUKAN rollup agregat per
  kategori terpisah — keputusan scope untuk MVP.
