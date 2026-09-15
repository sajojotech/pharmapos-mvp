# Master Data & Admin Operasional — Fase 03

Ringkasan halaman, mutasi, validasi, dan keputusan desain yang dibangun pada
Fase 03. Tidak ada model transaksional (StockBatch, PurchaseReceipt, POS,
dll) yang dibangun pada fase ini — lihat [docs/DATABASE.md](DATABASE.md) dan
[docs/AUTH.md](AUTH.md) untuk fase-fase sebelumnya.

## Halaman yang dibangun

| Route | Fitur | Guard |
| --- | --- | --- |
| `/master/branches` | List+search+filter status+pagination, create/edit (modal), nonaktifkan/aktifkan | read: `master.read`, manage: `master.manage` |
| `/master/warehouses` | Sama seperti Branch + pilih cabang, flag `isDefault` (auto-unset default lain di cabang yang sama) | idem |
| `/master/categories` | CRUD sederhana (nama) | idem |
| `/master/units` | CRUD sederhana (nama, simbol) | idem |
| `/master/products` | List+search (SKU/nama/generik/barcode)+filter+pagination, link ke detail | read: `master.read`, tombol create: `master.manage` |
| `/master/products/new` | Form lengkap (React Hook Form + Zod) + subform konversi satuan (`useFieldArray`) | `master.manage` |
| `/master/products/[id]` | Edit form yang sama (read-only summary bila tidak punya `master.manage`) + subform Harga Override per Cabang | read: `master.read`, edit: `master.manage` |
| `/master/suppliers` | CRUD (kode, nama, telepon, alamat) | idem |
| `/master/customers` | CRUD (kode, nama, telepon, alamat) | idem |
| `/settings/users` | List+search+pagination, create/edit user (role, penugasan cabang lewat checkbox, set/reset password), nonaktifkan/aktifkan | `user.manage` (OWNER/CENTRAL_ADMIN) |

Semua tabel memakai **TanStack Table** (`components/master/master-table.tsx`,
mode manual — sorting/filter/pagination dilakukan server-side lewat URL
search params `q`/`status`/`page`, bukan client-side TanStack state) dan
**server-side pagination** (`lib/pagination.ts`, page size 10).

## Mutasi (Server Actions) yang selesai

Setiap entitas punya `actions.ts` sendiri (create/update/setActive), semuanya:
1. Memanggil `checkPermission(...)` di baris pertama (menolak tanpa redirect
   — lihat catatan RBAC di bawah).
2. Validasi payload dengan **Zod** (skema di file yang sama, atau
   `product-schema.ts` untuk Product).
3. Memanggil fungsi service (`services/*.ts`) yang melakukan mutasi Prisma
   (dibungkus `$transaction` untuk mutasi multi-tabel: Product+barcode+
   konversi satuan, Warehouse dengan guard default, User+branchAssignments).
4. Menulis `AuditLog` untuk entitas yang disyaratkan (lihat di bawah).

## Audit log

Ditulis untuk **Product, Supplier, Branch, ProductBranchPrice** (sesuai
instruksi fase ini) pada create/update/activate/deactivate — lewat
`services/audit-service.ts::recordAudit()`. **User** juga sengaja diaudit
(walau tidak eksplisit diminta) karena perubahan role/status akun adalah
perubahan sensitif menurut prinsip global proyek ("Semua perubahan sensitif
membuat AuditLog"). Category, Unit, Warehouse, Customer **tidak** diaudit —
mengikuti cakupan eksplisit instruksi fase ini.

## Validasi bisnis yang diterapkan

- **SKU unik per company** (`Product.companyId+sku`) — divalidasi Prisma
  unique constraint, diterjemahkan ke pesan Indonesia di service layer.
- **Barcode unik global** (`ProductBarcode.barcode`) — idem; fase ini hanya
  mendukung **satu barcode utama per produk** (form punya satu field
  "Barcode"). Mendukung banyak barcode per produk adalah keputusan yang
  sengaja ditunda (lihat "Known limitations").
- **ProductBranchPrice unik per (branchId, productId)** — divalidasi Prisma
  unique constraint.
- **Konversi satuan**: menolak faktor ≤ 0, menolak satuan konversi yang
  sama dengan satuan dasar, menolak baris konversi duplikat (dua baris
  dengan `unitId` yang sama) — divalidasi di `product-schema.ts` lewat
  `superRefine`, dijalankan baik di client (react-hook-form) maupun ulang
  di server (actions.ts memanggil skema yang sama).
- **Field wajib Product**: SKU, nama, kategori, satuan dasar wajib diisi;
  harga jual & stok minimum tidak boleh negatif.
- **Password user**: minimal 8 karakter saat create; opsional saat edit
  (kosongkan untuk mempertahankan password lama).
- **User tidak bisa menonaktifkan akun sendiri** — dicegah di
  `setUserActiveAction` (guard eksplisit, bukan hanya UI).
- **Data nonaktif tidak muncul di selector operasional** — semua
  `listActiveXxx()` (dipakai dropdown kategori/satuan/cabang di form
  Product/Warehouse) memfilter `isActive: true`; halaman admin list sendiri
  tetap menampilkan semua status dengan filter eksplisit.

## RBAC yang diterapkan

Sesuai instruksi: **hanya Owner/Central Admin** yang punya `master.manage`
dan `user.manage` (lihat matrix di [docs/AUTH.md](AUTH.md), tidak berubah
dari Fase 02). Role lain (Branch Manager, Pharmacist, Cashier, Warehouse
Staff, Finance Auditor) hanya punya `master.read` — halaman master data
tetap bisa mereka **lihat**, tapi:
- Tombol "+ Tambah", "Edit", "Nonaktifkan/Aktifkan" **disembunyikan** di UI
  (`canManage` dihitung di Server Component lewat `can(user, "master.manage")`
  lalu diteruskan sebagai prop boolean — bukan dicek ulang di client).
- Halaman yang murni mutasi (`/master/products/new`) **redirect ke
  `/forbidden`** untuk role tanpa `master.manage`, bahkan lewat akses URL
  langsung (diverifikasi manual: Cashier login → akses langsung
  `/master/products/new` → `/forbidden`).
- Setiap Server Action mutasi memanggil `checkPermission()` di baris
  pertama — walau UI disembunyikan, memanggil action ini secara langsung
  (mis. lewat request yang dimanipulasi) tetap ditolak dengan
  `{success:false, error:"Anda tidak memiliki izin..."}`. Ini **tidak bisa
  diuji otomatis** dengan Vitest (memanggil action ini butuh `auth()`/
  `cookies()` yang hanya tersedia dalam request Next.js sungguhan — sama
  seperti keterbatasan `setActiveBranchAction` di Fase 02) — diverifikasi
  lewat review kode (pola yang identik & konsisten di semua actions.ts)
  dan QA manual di browser (tombol/menu hilang, akses URL langsung ditolak).
  `hasPermission()`/`can()` yang jadi dasar `checkPermission()` diuji
  lengkap lewat unit test (`tests/unit/master-permissions.test.ts`).

## Bug yang ditemukan & diperbaiki selama fase ini

**React Server Components menolak instance `Prisma.Decimal` sebagai prop ke
Client Component** ("Only plain objects can be passed..."). Ditemukan saat
QA manual (fitur "Tambah Harga Cabang" gagal submit tanpa pesan error yang
jelas). Diperbaiki dengan `lib/serialize.ts::toPlainJSON()` — round-trip
`JSON.parse(JSON.stringify(x))` yang memanfaatkan `Decimal.toJSON()`
bawaan Prisma (mengembalikan string) — dipasang di setiap page.tsx yang
meneruskan hasil query Product/ProductBranchPrice ke Client Component.
**Trade-off yang disadari**: tipe TypeScript pada komponen client (mis.
`Prisma.ProductGetPayload<...>`) masih menyatakan field tsb bertipe
`Decimal`, padahal runtime-nya sudah `string` setelah `toPlainJSON()` —
aman secara fungsional (string maupun Decimal punya `.toString()`) tapi
tidak 100% jujur secara tipe. Diterima sebagai kompromi pragmatis yang umum
dipakai pada kombinasi Next.js App Router + Prisma; halaman master data
lain (Branch/Warehouse/Category/dst) tidak terdampak karena tidak punya
kolom `Decimal`.

## Hasil test & quality gate

| Gate | Hasil |
| --- | --- |
| `npm run lint` | 0 error (1 warning informational dari React Compiler soal `useReactTable`, tidak memblokir) |
| `npm run typecheck` | Lulus |
| `npm run test` | **92/92** lulus (termasuk 4 file test baru fase ini) |
| `npm run build` | Sukses, 17 route ter-generate |

Test baru fase ini:
- `tests/unit/product-schema.test.ts` — field wajib, harga/stok negatif,
  validasi konversi satuan (faktor ≤0, sama dengan base unit, duplikat).
- `tests/unit/master-permissions.test.ts` — `master.manage`/`user.manage`
  hanya untuk OWNER/CENTRAL_ADMIN.
- `tests/integration/product-service.test.ts` — SKU unik, barcode unik,
  ProductBranchPrice unik (ditolak) + happy path (create+cleanup).
- `tests/integration/active-selectors.test.ts` — data nonaktif (kategori,
  satuan, cabang, produk buatan test) tidak muncul di `listActiveXxx()`.

## Catatan untuk fase inventori berikutnya

- **Base unit adalah satuan penyimpanan stok** — `ProductUnitConversion`
  sudah lengkap dengan `conversionFactor` relatif terhadap `baseUnitId`;
  modul StockBatch/StockMovement fase berikutnya harus selalu mencatat
  kuantitas dalam base unit produk (keputusan ini diwarisi dari Fase 01,
  sekarang punya UI pengelolaan penuh).
- **Warehouse.isDefault** sekarang dijaga tepat-satu-per-cabang oleh
  service layer (`createWarehouse`/`updateWarehouse`) — modul penerimaan
  barang bisa mengandalkan "ambil warehouse default cabang X" tanpa
  validasi ulang.
- **ProductBranchPrice.effectiveDate** (kolom baru fase ini) baru
  **disimpan**, belum ada logika "otomatis berlaku mulai tanggal tsb" —
  modul POS/harga fase berikutnya perlu memutuskan bagaimana
  effectiveDate memengaruhi harga yang benar-benar dipakai saat transaksi.
- **Supplier** siap dipakai sebagai referensi `PurchaseReceipt.supplierId`.
- Produk/kategori/satuan/supplier/customer nonaktif harus tetap
  dikecualikan secara konsisten di semua selector operasional fase
  berikutnya (pola `listActiveXxx()` sudah mapan, tinggal diikuti).

## Known limitations (disengaja, di luar cakupan fase ini)

- Satu produk hanya bisa punya **satu barcode utama** lewat UI ini (model
  `ProductBarcode` sebenarnya mendukung banyak barcode/produk, tapi form
  fase ini tidak mengekspos itu).
- Tidak ada fitur "reset password kirim email" — admin memasukkan password
  baru secara manual saat edit user.
- Tidak ada validasi "minimal satu OWNER aktif" — secara teori seluruh
  akun OWNER bisa dinonaktifkan (hanya guard "tidak bisa nonaktifkan diri
  sendiri" yang ada).
