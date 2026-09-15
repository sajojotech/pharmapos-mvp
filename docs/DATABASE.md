# Database — Fase 01 (Fondasi & Master Data)

Dokumen ini merangkum skema Prisma yang dibuat pada Fase 01, alasan di balik
keputusan desain penting, dan implikasinya untuk fase berikutnya (auth/RBAC,
inventory/FEFO, POS, transfer, laporan).

Sumber kebenaran skema selalu [prisma/schema.prisma](../prisma/schema.prisma)
— dokumen ini adalah ringkasan naratif, bukan pengganti.

## Model & enum

| Model                    | Ringkasan                                                                 |
| ------------------------- | -------------------------------------------------------------------------- |
| `Company`                 | Tenant. MVP satu baris, tapi seluruh model lain sudah `companyId`.         |
| `Branch`                  | Cabang apotek, milik satu `Company`.                                      |
| `Warehouse`               | Lokasi stok di dalam satu `Branch` (MVP: satu warehouse default/cabang).  |
| `User`                    | Akun login. Email unik global, password di-hash (bcrypt).                |
| `UserBranchAssignment`    | Penugasan user↔cabang (many-to-many eksplisit).                          |
| `Category`                | Kategori produk, milik `Company`.                                        |
| `Unit`                    | Satuan (Tablet, Strip, Box, dst), milik `Company`.                       |
| `Product`                 | Master produk terpusat (bukan per-cabang), milik `Company`.              |
| `ProductBarcode`          | Barcode fisik produk — **unik global**, lihat keputusan #3 di bawah.      |
| `ProductUnitConversion`   | Faktor konversi satuan alternatif → base unit produk.                    |
| `ProductBranchPrice`      | Override harga jual per cabang (opsional; fallback ke harga default).    |
| `Supplier`                | Pemasok, milik `Company`.                                                |
| `Customer`                | Pelanggan, milik `Company` (termasuk pelanggan default "Umum").          |
| `AppSetting`              | Konfigurasi key-value per company (mis. ambang dekat-ED, ambang selisih kas). |
| `AuditLog`                | Log audit append-only (belum ada penulis di fase ini).                   |

Enum `Role`: `OWNER`, `CENTRAL_ADMIN`, `BRANCH_MANAGER`, `PHARMACIST`,
`CASHIER`, `WAREHOUSE_STAFF`, `FINANCE_AUDITOR`.

## Constraint unik yang penting

| Model                   | Unique constraint                    | Alasan |
| ------------------------ | -------------------------------------- | ------ |
| `Company`                | `name`                                 | Kunci upsert seed; akan direlaksasi/diganti saat multi-company sungguhan diimplementasikan (lihat keputusan #5). |
| `Branch`                 | `(companyId, code)`                    | Kode cabang unik per company, bukan global. |
| `Warehouse`              | `(branchId, code)`                     | Kode warehouse unik per cabang. |
| `User`                   | `email`                                | Login memakai email; satu email = satu akun di seluruh sistem. |
| `UserBranchAssignment`   | `(userId, branchId)`                   | Sesuai spesifikasi — user tidak bisa ditugaskan dobel ke cabang yang sama. |
| `Category`               | `(companyId, name)`                    | Nama kategori unik per company. |
| `Unit`                   | `(companyId, name)`                    | Nama satuan unik per company. |
| `Product`                | `(companyId, sku)`                     | SKU unik per company (bukan global — lihat keputusan #4). |
| `ProductBarcode`         | `barcode` (global)                     | Lihat keputusan #3. |
| `ProductUnitConversion`  | `(productId, unitId)`                  | Satu produk hanya punya satu faktor konversi per unit. |
| `ProductBranchPrice`     | `(branchId, productId)`                | Satu harga override per kombinasi cabang+produk. |
| `Supplier`               | `(companyId, code)`                    | `code` nullable — banyak NULL diperbolehkan (semantik Postgres), unik hanya saat diisi. |
| `Customer`               | `(companyId, code)`                    | Sama seperti Supplier; `UMUM` dipakai sebagai kode pelanggan default. |
| `AppSetting`             | `(companyId, key)`                     | Satu nilai per key per company. |

## Index yang ditambahkan

Selain index implisit dari unique constraint di atas, ditambahkan index pada:

- Semua kolom `companyId` / `branchId` (foreign key yang paling sering
  dipakai untuk pembatasan akses/filter tenant & cabang).
- Semua kolom `isActive` (dipakai hampir di semua daftar master data).
- `Product.categoryId`, `Product.baseUnitId`, `Product.name` (pencarian
  produk), `Product.requiresPrescription` (filter POS/resep pada fase
  berikutnya).
- `User.role` (query RBAC "semua user dengan role X").
- `AuditLog.entityType + entityId` dan `AuditLog.createdAt` (pola akses log
  yang paling umum: riwayat satu entitas, atau log dalam rentang waktu).

## Keputusan desain & implikasinya untuk fase berikutnya

1. **Primary key: `cuid()` pada semua model.** Dipilih dibanding UUID karena
   tidak memerlukan ekstensi database apa pun, tetap globally-unique, dan
   urut-terhadap-waktu secara kasar (memudahkan debugging). Konsisten di
   seluruh skema — fase berikutnya harus mengikuti pola yang sama.

2. **Password di-hash dengan bcrypt (cost factor 12), bukan Argon2.**
   `bcryptjs` (implementasi pure-JS) dipilih agar tidak bergantung pada
   kompilasi native module (`bcrypt`/`@node-rs/argon2` butuh toolchain
   native yang tidak selalu tersedia, terutama di Windows). Ini valid
   sesuai instruksi awal proyek ("Argon2 **atau** bcrypt"). Fase autentikasi
   berikutnya harus memakai `lib/password.ts` yang sudah ada
   (`hashPassword`/`verifyPassword`), jangan implementasi hashing baru.

3. **`ProductBarcode.barcode` unik secara GLOBAL, bukan per-company.**
   Barcode fisik (EAN/UPC) pada kemasan merepresentasikan satu identitas
   produk di dunia nyata. Mengunikkannya hanya per-company akan membuka
   celah dua produk berbeda dari dua company terdaftar dengan barcode fisik
   identik — dan lebih penting, akan menyulitkan pencarian scan-barcode di
   POS pada fase berikutnya (kasir men-scan barcode tanpa context company
   yang eksplisit; lookup harus bisa `WHERE barcode = ?` langsung tanpa
   join tambahan). Implikasi: saat modul multi-company sungguhan
   dibangun, keputusan ini tetap valid selama asumsi "satu barcode fisik
   = satu produk di seluruh sistem" dipegang; jika asumsi itu berubah
   (mis. white-label multi-tenant yang saling asing), constraint ini perlu
   ditinjau ulang.

4. **`Product.sku` unik per company (bukan global).** Berbeda dari barcode,
   SKU adalah kode internal masing-masing perusahaan — dua company berbeda
   secara wajar bisa memakai skema SKU yang sama tanpa itu berarti produk
   yang sama.

5. **`Company.name` diberi unique constraint untuk mendukung `upsert` pada
   seed yang idempotent.** ini adalah kompromi MVP single-company. Saat
   multi-company sungguhan dibangun, constraint ini kemungkinan perlu
   dilonggarkan (dua company berbeda bisa saja punya nama yang sama di
   dunia nyata) dan diganti mekanisme onboarding/lookup yang tidak
   bergantung pada keunikan nama.

6. **Stok disimpan dalam base unit produk (`Product.baseUnitId`).**
   `ProductUnitConversion` menyimpan faktor konversi satuan lain *relatif
   terhadap base unit* (mis. base unit Tablet, Strip → factor 10, Box →
   factor 100). Ini adalah keputusan yang mengikat desain `StockBatch`/
   `StockMovement` pada fase inventory: kuantitas di ledger stok harus selalu
   dicatat dalam base unit, dan konversi ke satuan lain hanya terjadi di
   lapisan tampilan/input.

7. **Role global vs. role per-cabang tidak direpresentasikan sebagai kolom
   boolean, melainkan sebagai konvensi pembacaan `Role`.** `OWNER`,
   `CENTRAL_ADMIN`, dan `FINANCE_AUDITOR` **tidak wajib** punya baris
   `UserBranchAssignment` — kode RBAC pada fase berikutnya harus
   memperlakukan tiga role ini sebagai "akses semua cabang" tanpa
   bergantung pada tabel assignment, sementara `BRANCH_MANAGER`,
   `PHARMACIST`, `CASHIER`, `WAREHOUSE_STAFF` **wajib** dicek lewat
   `UserBranchAssignment`. Ini didokumentasikan juga sebagai komentar pada
   model di `schema.prisma`.

8. **Semua nilai uang pakai `Decimal(14,2)`, kuantitas pakai `Decimal(14,3)`
   atau `Decimal(14,4)` (faktor konversi).** Tidak ada `Float`/`Int` untuk
   nilai bisnis di mana pun dalam skema ini, sesuai aturan global proyek.
   `tests/integration/constraints.test.ts` memverifikasi nilai yang
   dikembalikan benar-benar instance `Prisma.Decimal`.

9. **`onDelete` dipilih per-jenis relasi:**
   - `Restrict` untuk referensi ke master data bersama (`Category`, `Unit`,
     `Supplier`, `Customer`, `Company`) — mencegah penghapusan yang bisa
     mengorbankan integritas data; nonaktifkan lewat `isActive`, jangan hapus.
   - `Cascade` untuk data anak yang sepenuhnya dimiliki induknya
     (`Warehouse` milik `Branch`; `ProductBarcode`/`ProductUnitConversion`/
     `ProductBranchPrice` milik `Product`; `UserBranchAssignment` milik
     `User`/`Branch`).
   - `SetNull` untuk referensi opsional pada `AuditLog` (`branchId`,
     `actorId`) — log tetap ada meski entitas yang dirujuk kelak dihapus.

10. **`package.json#prisma.seed` (bukan `prisma.config.ts`) dipakai untuk
    mendaftarkan seed command.** Prisma versi ini (`6.19.3`) masih
    mendukungnya, hanya menampilkan warning deprecation (akan dihapus di
    Prisma 7). Proyek ini sengaja bertahan di Prisma 6.x (lihat catatan di
    README fase sebelumnya) sehingga warning ini aman diabaikan untuk saat
    ini; migrasi ke `prisma.config.ts` bisa dipertimbangkan saat proyek
    naik ke Prisma 7 di masa depan.

## Yang sengaja belum ada di Fase 01

- Model transaksional: `StockBatch`, `StockMovement`, `PurchaseReceipt`,
  `PosTransaction`, `CashierShift`, `StockTransfer`, `SalesReturn`, dll.
- Penulisan `AuditLog` (model sudah ada, tapi belum ada kode yang menulis ke
  sana — akan mulai dipakai begitu ada mutasi sensitif pada fase berikutnya).
- RBAC/permission guard (`can(user, 'stock.adjust', branchId)`) — akan
  dibangun di atas `Role` + `UserBranchAssignment` yang sudah tersedia.
