# Autentikasi, RBAC & Konteks Cabang — Fase 02

Dokumen ini merangkum alur autentikasi, permission matrix, dan pola proteksi
route yang dibangun pada Fase 02. Sumber kebenaran tetap kode di
[lib/auth.ts](../lib/auth.ts), [lib/rbac.ts](../lib/rbac.ts), dan
[lib/rbac-core.ts](../lib/rbac-core.ts).

## Alur autentikasi

- **Provider:** Auth.js v5 (`next-auth@beta`) dengan **Credentials provider**
  (email + password), session strategy **JWT** (tanpa tabel Session di
  database — sesuai instruksi "credentials-based authentication untuk MVP").
- **Verifikasi kredensial** dilakukan di `services/auth-service.ts::verifyCredentials()`,
  dipisah dari konfigurasi Auth.js (`lib/auth.ts`) agar bisa diuji langsung
  tanpa menjalankan server HTTP (lihat `tests/integration/auth-service.test.ts`).
- **Login page** (`/login`) adalah Server Component yang redirect ke
  `/dashboard` bila sudah ada session, merender `<LoginForm>` (Client
  Component) yang memakai `useActionState` (React 19) memanggil Server
  Action `loginAction` (`app/login/actions.ts`). Server Action memvalidasi
  input dengan Zod, memanggil `signIn("credentials", { redirect: false })`,
  dan menampilkan **pesan error generik** ("Email atau password salah.")
  baik untuk email tidak terdaftar maupun password salah — sengaja tidak
  dibedakan agar tidak membocorkan email mana yang terdaftar (user
  enumeration).
- **Logout** lewat Server Action `logoutAction` (`lib/actions/auth-actions.ts`),
  dipicu form sederhana di header app shell.
- **Session payload** (disimpan di JWT, diisi di callback `jwt`/`session`
  pada `lib/auth.ts`): `userId`, `companyId`, `role`, `assignedBranchIds`.
  `assignedBranchIds` diambil sekali saat login (`getAssignedBranchIds`) —
  lihat "Known limitations" di bawah untuk implikasinya.
- **activeBranchId** **tidak** disimpan di JWT, melainkan di cookie
  `pharmapos_active_branch` (httpOnly), supaya user bisa berpindah cabang
  tanpa perlu re-issue token. Setiap pembacaan (`getActiveBranchContext()`)
  memvalidasi ulang nilai cookie terhadap `assignedBranchIds`/role saat itu
  juga (lihat `resolveActiveBranchId` di `lib/rbac-core.ts`) — cookie yang
  sudah tidak valid (mis. assignment dicabut) otomatis diabaikan dan
  fallback ke cabang lain yang sah.

## Kenapa tidak pakai middleware.ts

RBAC & proteksi halaman diterapkan lewat **layout/page Server Component**
(`app/(app)/layout.tsx` memanggil `requireAuth()`; tiap halaman memanggil
`requirePermission()`/`requireRole()` sendiri), **bukan** `middleware.ts`.
Alasan:

1. `authorize()` pada Credentials provider dan seluruh helper RBAC memakai
   Prisma Client secara langsung. Next.js middleware berjalan di Edge
   runtime secara default, yang tidak kompatibel dengan Prisma Client
   klasik (`prisma-client-js`) tanpa driver adapter — dan proyek ini
   sengaja bertahan di setup Prisma klasik (lihat docs/DATABASE.md).
2. Server Component di App Router berjalan di Node.js runtime secara
   default (bukan Edge, kecuali `export const runtime = "edge"` diset
   eksplisit), sehingga pemanggilan `requireAuth()`/`can()`/Prisma di
   layout & page **tetap berjalan di server pada setiap request** — bukan
   pengecekan client-side — cukup untuk memenuhi syarat keamanan tanpa
   kompleksitas split-config Edge yang biasa dipakai NextAuth v5 + middleware.

## Server-side helper (`lib/rbac.ts` & `lib/rbac-core.ts`)

| Fungsi | Lokasi | Guna |
| --- | --- | --- |
| `requireAuth()` | `lib/rbac.ts` | Wajib login; redirect `/login` bila belum. |
| `requireRole(...roles)` | `lib/rbac.ts` | Wajib login + role tertentu; redirect `/forbidden`. |
| `requirePermission(permission)` | `lib/rbac.ts` | Wajib login + permission tertentu (lewat matrix); redirect `/forbidden`. Pelengkap praktis di atas `can()`. |
| `can(user, permission, branchId?)` | `lib/rbac-core.ts` | Cek permission murni (+ opsional cek akses cabang). Tanpa I/O — mudah diuji. |
| `hasBranchAccess(user, branchId)` | `lib/rbac-core.ts` | Cek keanggotaan cabang murni (role global selalu lolos). |
| `findAccessibleBranch(user, branchId)` | `lib/rbac-core.ts` | Seperti `hasBranchAccess`, + validasi ke DB (cabang ada/aktif/satu company). Dipakai `setActiveBranchAction`. |
| `requireBranchAccess(branchId)` | `lib/rbac.ts` | Wajib login + akses ke branchId (pakai `findAccessibleBranch`); redirect `/forbidden`. |
| `getActiveBranchContext()` | `lib/rbac.ts` | Resolusi cabang aktif user saat ini (session + cookie, tervalidasi ulang). |

`can`, `hasBranchAccess`, `findAccessibleBranch`, dan `resolveActiveBranchId`
sengaja dipisah ke `lib/rbac-core.ts` (tanpa `import "server-only"` dan tanpa
memanggil `auth()`/`cookies()`/`redirect()` Next.js) supaya bisa diuji
langsung dengan Vitest tanpa request context Next.js sungguhan — lihat
`tests/unit/rbac.test.ts` dan `tests/integration/branch-access.test.ts`.
`lib/rbac.ts` (dijaga `server-only`) re-export semuanya + menambahkan
wrapper yang butuh session/cookies Next.js.

## Permission matrix

| Permission | OWNER | CENTRAL_ADMIN | BRANCH_MANAGER | PHARMACIST | CASHIER | WAREHOUSE_STAFF | FINANCE_AUDITOR |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `user.manage` | ✅ | ✅ | | | | | |
| `master.read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `master.manage` | ✅ | ✅ | | | | | |
| `inventory.read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| `inventory.adjust` | ✅ | | ✅ | | | ✅ | |
| `purchase.manage` | ✅ | ✅ | | | | ✅ | |
| `pos.sell` | ✅ | | ✅ | ✅ | ✅ | | |
| `pos.void` | ✅ | | ✅ | | | | |
| `prescription.review` | ✅ | | ✅ | ✅ | | | |
| `shift.manage` | ✅ | | ✅ | | ✅ | | |
| `transfer.manage` | ✅ | ✅ | ✅ | | | ✅ | |
| `report.read.branch` | ✅ | ✅ | ✅ | ✅ | | | ✅ |
| `report.read.all` | ✅ | ✅ | | | | | ✅ |
| `audit.read` | ✅ | ✅ | | | | | ✅ |

Definisi lengkap ada di [lib/permissions.ts](../lib/permissions.ts)
(`ROLE_PERMISSIONS`). Beberapa keputusan yang tidak eksplisit di
spesifikasi awal, didokumentasikan di sini:

- **CENTRAL_ADMIN** diberi `user.manage` (bukan hanya `master.manage`)
  karena spesifikasi menyebut Admin Pusat "kelola ... user tertentu".
- **BRANCH_MANAGER** diberi `transfer.manage` (approve/terima transfer di
  cabangnya) dan `pos.void`/`inventory.adjust` (approval sesuai kewenangan
  cabang). **Perubahan Fase 09**: `prescription.review` yang SEBELUMNYA
  (Fase 02) sengaja eksklusif untuk `PHARMACIST`+`OWNER` (rasional lama:
  kompetensi apoteker berlisensi) kini juga diberikan ke `BRANCH_MANAGER`,
  mengikuti instruksi eksplisit Fase 09 ("Pharmacist/Manager berwenang
  approve/reject") — supersede rasional lama, ditulis di sini secara
  eksplisit (bukan diam-diam) supaya jelas ini keputusan yang disengaja,
  bukan regresi. Lihat [docs/PRESCRIPTION_VOID_RETURN.md](PRESCRIPTION_VOID_RETURN.md).
- **CASHIER** sengaja tidak diberi `report.read.branch` — laporan cabang
  penuh adalah kewenangan manager; kasir hanya beroperasi lewat layar
  shift/POS-nya sendiri (dibangun di fase berikutnya).
- **WAREHOUSE_STAFF** diberi `purchase.manage` (mereka yang memproses
  penerimaan barang) tapi tidak permission pelaporan.
- **FINANCE_AUDITOR** murni read-only — tidak ada satu pun permission
  `.manage`/`.adjust`/`.sell`/`.void` yang diberikan.

Role global (`OWNER`, `CENTRAL_ADMIN`, `FINANCE_AUDITOR`, lihat
`GLOBAL_BRANCH_ROLES`) selalu lolos cek `branchId` pada `can()` — keputusan
ini diwarisi dari Fase 01 (lihat docs/DATABASE.md poin 7).

## Route yang dilindungi

| Route | Guard | Catatan |
| --- | --- | --- |
| `/` | — | Redirect ke `/dashboard` (sudah login) atau `/login` (belum). |
| `/login` | — (publik) | Redirect ke `/dashboard` bila sudah login. |
| `/forbidden` | — (publik) | Halaman pesan akses ditolak. |
| `/dashboard` | `requireAuth()` (lewat layout) | Semua role yang login. |
| `/master/products` | `requirePermission("master.read")` | Read-only (list produk asli dari DB). |
| `/master/users` | `requireRole(OWNER, CENTRAL_ADMIN)` | Read-only (list user + role + cabang). |
| `/inventory/stock` | `requirePermission("inventory.read")` + `requireBranchAccess(activeBranchId)` | Placeholder, menampilkan cabang aktif. |
| `/pos` | `requirePermission("pos.sell")` + `requireBranchAccess(activeBranchId)` | Placeholder, menampilkan cabang aktif. |
| `/api/auth/*` | ditangani Auth.js | Endpoint internal NextAuth. |

Semua route di atas (kecuali `/login`, `/forbidden`, `/api/auth/*`) berada
di route group `app/(app)/` sehingga otomatis melewati `requireAuth()` di
layout — halaman tetap memanggil guard permission/role spesifiknya sendiri
karena "sudah login" saja tidak cukup untuk sebagian besar halaman
operasional.

## Konteks cabang aktif (active branch)

- Role global (`OWNER`/`CENTRAL_ADMIN`/`FINANCE_AUDITOR`) melihat **branch
  selector** di header berisi seluruh cabang aktif company, dan boleh
  berpindah kapan saja.
- Role per-cabang dengan **tepat satu** cabang ditugaskan **tidak** melihat
  selector — cabang mereka otomatis aktif tanpa perlu memilih.
- Role per-cabang dengan **lebih dari satu** cabang ditugaskan (skenario
  yang didukung skema meski belum ada di data seed) akan melihat selector
  berisi hanya cabang-cabang yang ditugaskan ke mereka.
- Role per-cabang **tanpa** cabang yang ditugaskan tidak melihat selector
  dan mendapat pesan "belum ditugaskan ke cabang mana pun" di halaman
  operasional (`/inventory/stock`, `/pos`).
- Perpindahan cabang lewat `setActiveBranchAction` (Server Action) yang
  **memvalidasi ulang di server** bahwa `branchId` yang dikirim benar-benar
  ada dalam cakupan akses user — klien tidak pernah dipercaya begitu saja.

## Audit log login

`services/auth-service.ts::recordLoginAttempt()` menulis ke `AuditLog` pada
setiap **login sukses** dan **login gagal karena password salah/akun
nonaktif** (action `LOGIN_SUCCESS`/`LOGIN_FAILURE`, `entityType: "User"`).
Percobaan dengan **email yang tidak terdaftar sama sekali** sengaja tidak
dicatat — tidak ada `userId`/`companyId` valid untuk dilampirkan, dan
mencatatnya berisiko membanjiri audit log dengan noise dari tebakan email
acak tanpa nilai investigasi yang jelas. **Password tidak pernah** masuk ke
audit log dalam bentuk apa pun.

## Known limitations (Fase 02)

- **JWT bisa basi terhadap perubahan assignment.** `assignedBranchIds`
  diisi ke token saat login dan tidak otomatis diperbarui bila admin
  mengubah `UserBranchAssignment` user yang sedang login — user tsb perlu
  login ulang agar perubahan berlaku. Untuk MVP ini dianggap dapat
  diterima; bisa ditingkatkan nanti dengan `session.update()` trigger atau
  beralih ke database session strategy bila diperlukan.
- **Belum ada rate limiting / lockout** pada percobaan login gagal
  berulang — di luar cakupan Fase 02, catat sebagai kandidat hardening
  keamanan sebelum production.
- **Halaman master data & manajemen user masih read-only** (belum ada
  create/update/delete) — sesuai batasan fase ini yang eksplisit melarang
  membangun fitur bisnis di luar auth/RBAC/branch context.
