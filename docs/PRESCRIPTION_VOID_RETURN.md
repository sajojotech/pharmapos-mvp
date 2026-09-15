# Resep Minimum, Void, & Retur Penjualan — Fase 09

Tiga alur yang saling independen tapi sama-sama beroperasi di atas
`PosTransaction`/batch traceability yang dibangun Fase 06/07: pengajuan
resep dua tahap, pembatalan transaksi yang **sudah PAID** (void, beda dari
`cancelledAt`/`cancelReason` pra-bayar yang sudah ada sejak Fase 06), dan
retur penjualan dengan kondisi barang. Laporan komprehensif & deployment
eksplisit di luar cakupan fase ini.

## Bagian A — Resep minimum (alur DUA TAHAP)

### Kenapa dua tahap, bukan pre-check saja

Dikonfirmasi eksplisit bersama user: pre-check saja (menolak checkout lalu
minta ulang setelah "her disetujui" secara manual) tidak merepresentasikan
kenyataan operasional — apoteker perlu meninjau SEBELUM stok dipotong/uang
diterima, dan kasir perlu tahu invoice-nya sudah "mengantre" menunggu
persetujuan. Karena itu dibangun model dua tahap nyata:

```
Kasir checkout, cart berisi produk requiresPrescription=true
        │
        ▼
createPendingPrescriptionTransaction (SATU $transaction, TANPA payment/FEFO)
  → PosTransaction status=PENDING_PRESCRIPTION_REVIEW, paidAt=null, item dibuat
  → Prescription dibuat (posTransactionId terisi), status=PENDING_REVIEW
        │
        ▼
Pharmacist/Manager/Owner review di /pos/prescriptions/[id]
   ├─ APPROVE → Prescription.status=APPROVED (PosTransaction TETAP
   │             PENDING_PRESCRIPTION_REVIEW — menunggu kasir bayar)
   └─ REJECT  → Prescription.status=REJECTED (WAJIB pharmacistNotes berisi
                alasan), PosTransaction → CANCELLED otomatis
                (cancelledById=reviewer)
        │ (bila APPROVED)
        ▼
Kasir kembali ke /pos/transactions/[id], isi pembayaran →
finalizePrescriptionPayment (SATU $transaction BARU):
  syarat: status masih PENDING_PRESCRIPTION_REVIEW, Prescription APPROVED
  → alokasi FEFO (reuse allocateFefoForItems — helper yang sama dipakai
    createPaidTransaction) + validatePayments + buat Payment →
    status=PAID, paidAt=now() → Prescription.status=COMPLETED
```

Transaksi TANPA produk resep tetap lewat `createPaidTransaction` yang
sudah ada sejak Fase 06/07 — perilakunya **tidak berubah** kecuali satu
pre-check baru: seluruh 180 test lama tetap hijau.

### Kenapa `PosTransaction.paidAt` jadi nullable

Skema lama: `paidAt DateTime @default(now())` — cocok selama SETIAP baris
`PosTransaction` dibuat sudah PAID (asumsi Fase 06/07). Fase 09
memperkenalkan baris yang dibuat `PENDING_PRESCRIPTION_REVIEW` (belum
dibayar) — memaksa `paidAt` terisi `now()` di titik itu akan berbohong
(transaksi tercatat "dibayar" padahal belum). Field diubah jadi
`DateTime?`, diisi eksplisit di `persistTransactionHeader` (`now()` hanya
bila `status===PAID`, `null` selain itu) dan diisi lagi di
`finalizePrescriptionPayment` saat status akhirnya berubah ke `PAID`. UI
yang menampilkan `paidAt` (`/pos/transactions`, `/pos/transactions/[id]`)
fallback ke `createdAt` bila `null`.

### `prepareTransaction`/`persistTransactionHeader` — refactor additive

`services/pos-transaction-service.ts` dipecah agar SATU pasang fungsi bisa
dipakai baik jalur bayar-langsung maupun jalur resep pending, tanpa
duplikasi logika harga/diskon:

- `CreateTransactionItemsParams` — basis TANPA `payments`.
  `CreatePaidTransactionParams = CreateTransactionItemsParams & {payments}`.
- `prepareTransaction(tx, params, payments?)` — `payments` opsional;
  `validatePayments` hanya dijalankan bila diisi, selain itu
  `changeAmount=0` (placeholder, belum relevan sampai finalize).
- `persistTransactionHeader(tx, params, prepared, status, payments?)` —
  `status` kini EKSPLISIT (skema `@default(PAID)` tidak lagi diandalkan
  diam-diam), `payments` opsional (skip blok `payments: {createMany}` bila
  kosong).
- `allocateFefoForItems(tx, {...})` — loop alokasi FEFO diekstrak dari
  `runCreatePaidTransaction` supaya `finalizePrescriptionPayment` bisa
  memakai ulang persis logika yang sama (item SUDAH ADA di DB, tinggal
  dialokasikan) tanpa menyalin ulang `planFefoAllocation`+
  `executeAllocationPlan`.
- `assertNoPrescriptionItems(items)` — pre-check baru di
  `runCreatePaidTransaction`/`runCreatePaidTransactionWithBatchOverride`:
  tolak bila ADA item `requiresPrescription`, arahkan ke alur resep.

### RBAC — perubahan matrix yang disengaja

Instruksi fase ini eksplisit: *"Pharmacist/Manager berwenang
approve/reject"*. `prescription.review` yang sejak Fase 02 eksklusif untuk
`PHARMACIST`+`OWNER` kini ditambah `BRANCH_MANAGER` di
`lib/permissions.ts`. Ini supersede rasional Fase 02 (kompetensi apoteker
berlisensi) secara sadar, bukan regresi — lihat docs/AUTH.md.

### Limitasi MVP resep (eksplisit)

- **Tidak ada OCR/validasi gambar resep** — `imagePath` hanya field
  string opsional; upload file sungguhan di luar cakupan.
- **Tidak ada master data pasien** — `patientName`/`patientPhone` free
  text per transaksi, tidak ter-link ke entitas Customer/Patient.
- **Shift harus tetap OPEN sampai finalize** — bila shift kasir yang
  membuat pengajuan sudah ditutup sebelum resep disetujui, pembayaran
  tidak bisa diselesaikan lewat shift itu lagi
  (`finalizePrescriptionPayment` memanggil ulang `findOpenShiftForPayment`)
  — butuh intervensi manual (mis. buka shift baru lalu proses ulang secara
  manual); alur "pindah shift" otomatis di luar cakupan MVP ini.
- **Satu resep = satu transaksi** — tidak ada resep yang dipakai bertahap
  untuk beberapa kunjungan/pembelian.
- **`asOf` alokasi FEFO memakai waktu FINALIZE**, bukan waktu pengajuan —
  batch yang baru masuk di antara pengajuan & persetujuan resep ikut
  dipertimbangkan (disengaja: mencerminkan stok riil saat uang benar-benar
  diterima).

## Bagian B — Void

`services/pos-void-service.ts::voidTransaction`. Hanya transaksi berstatus
**PAID** persis yang bisa di-void (menolak VOIDED/CANCELLED/
PARTIALLY_RETURNED/RETURNED — otomatis mencegah void-ulang & void
pasca-retur). Permission `pos.void` — **sudah ada** sejak Fase 02
(OWNER+BRANCH_MANAGER), tidak ada perubahan matrix — dicek ULANG di
service (bukan hanya action layer), pola sama
`createPaidTransactionWithBatchOverride` Fase 07. `reason` wajib diisi.

Dalam SATU `$transaction`:
1. Untuk tiap `PosTransactionItemBatchAllocation` milik transaksi:
   `receiveStockToExistingBatch` (primitif Fase 04) dengan
   `movementType: "VOID_REVERSAL"` — qty dikembalikan **TEPAT** ke batch
   asal alokasi (bukan FEFO baru), termasuk kasus item yang dulu di-split
   FEFO ke >1 batch (setiap alokasi punya baris `VOID_REVERSAL`
   independen).
2. `Payment.updateMany({isReversed: true})` — baris `Payment` ASLI TIDAK
   dihapus/diedit nilainya (fakta finansial historis tetap utuh), hanya
   ditandai sudah dibalik.
3. Update transaksi: `status=VOIDED, voidedAt, voidedById, voidReason`
   (3 kolom baru, TERPISAH dari `cancelledAt/cancelledById/cancelReason`
   yang sudah ada — void ≠ cancel pra-bayar, riwayat harus jelas beda).
4. `recordAudit("VOID_TRANSACTION", reason)`.

## Bagian C — Retur penjualan

`services/sales-return-service.ts::createSalesReturn`. Genealogy retur
mengikuti struktur alokasi FEFO asal: satu `SalesReturnItem` = satu
`PosTransactionItemBatchAllocation` asal yang terpengaruh. Permission
`pos.sell` (retur = operasi rutin loket, beda dari void yang butuh
eskalasi manager/owner — keputusan desain, bukan diminta eksplisit oleh
instruksi).

1. Branch access, `reason` wajib, transaksi harus **PAID** atau
   **PARTIALLY_RETURNED** (retur bertahap diperbolehkan; `RETURNED`
   penuh/`VOIDED`/status lain ditolak).
2. Per item diminta: hitung sisa returnable PER alokasi asal (`qtyOut`
   dikurangi total `SalesReturnItem.qtyReturned` yang sudah ada dari
   retur MANAPUN sebelumnya untuk alokasi itu), walk alokasi terurut
   `createdAt ASC` (urutan sama saat dialokasikan FEFO), serap qty
   diminta secara berurutan. Total diminta melebihi total returnable →
   **seluruh retur ditolak** (atomic — tidak ada perubahan parsial,
   ditegakkan oleh pembungkus `$transaction`).
3. Per baris alokasi yang terserap qty > 0:
   - **SELLABLE** → `receiveStockToExistingBatch` balik ke batch ASAL
     apa adanya, `movementType: "SALES_RETURN"`.
   - **DAMAGED/QUARANTINE** → batch tujuan **SEGREGASI terpisah** (supaya
     TIDAK diam-diam menambah stok yang bisa dijual): `receiveStockToBatch`
     dengan `batchNumber: "<batchNumberSnapshot>-RETURN-<condition>"`
     (identitas stabil — retur berikutnya dengan kondisi+batch asal sama
     menumpuk ke batch segregasi yang SAMA), `expiryDate`/`unitCost`
     diwarisi dari allocation asal, `status` di-set eksplisit
     `DAMAGED`/`QUARANTINED` lewat parameter baru
     `receiveStockToBatch({..., status})` (default tetap `AVAILABLE` bila
     tidak diisi — backward compatible, tidak mengubah pemanggil lama).
4. Setelah semua item diproses: status transaksi induk dihitung ulang
   dari AGREGAT seluruh retur historis (bukan hanya retur kali ini) vs
   qty asli tiap item → `RETURNED` (semua item fully returned) atau
   `PARTIALLY_RETURNED` (sebagian).
5. `recordAudit("PROCESS_SALES_RETURN", reason)`.

`getReturnableSummary` — dipakai UI form retur untuk menampilkan sisa
returnable per alokasi sebelum submit.

## RBAC ringkas

| Aksi | Permission | Perubahan matrix? |
| --- | --- | --- |
| Checkout resep (create pending + finalize) | `pos.sell` | Tidak |
| Review resep (approve/reject) | `prescription.review` | **Ya** — tambah `BRANCH_MANAGER` |
| Void transaksi | `pos.void` | Tidak (sudah OWNER+BRANCH_MANAGER sejak Fase 02) |
| Proses retur | `pos.sell` | Tidak |

Semua service menerima `allowedBranchIds` dan re-validasi branch scope
sebelum baca/tulis apa pun — pola konsisten Fase 04-08. Permission yang
membutuhkan eskalasi (`prescription.review`, `pos.void`) dicek ULANG di
service, bukan hanya action layer.

## Hasil test & quality gate

| Gate | Hasil |
| --- | --- |
| Migration | ✅ `20260910074510_phase9_prescription_void_return` + `20260910075508_phase9_paid_at_nullable` diterapkan bersih |
| `npm run lint` | ✅ 0 error |
| `npm run typecheck` | ✅ |
| `npm run test` | ✅ **203/203** (180 lama tetap hijau + 23 test baru: 9 di `prescription-service.test.ts`, 5 di `pos-void-service.test.ts`, 9 di `sales-return-service.test.ts`) |
| `npm run build` | ✅ 30 route (termasuk `/pos/prescriptions`, `/pos/prescriptions/[id]`, `/pos/transactions/[id]/return`) |

Cakupan test baru (state batch/stok setelah void & retur, diverifikasi
lewat query langsung ke `StockBatch`/`StockMovement`):

- **Resep**: produk `requiresPrescription` ditolak `createPaidTransaction`
  langsung; produk non-resep tetap bisa (no regression); create-pending
  tidak memotong stok sama sekali (qtyOnHand & jumlah allocation = 0);
  ditolak bila cart tidak mengandung produk resep; Pharmacist bisa
  approve, Cashier ditolak (`izin`); reject wajib catatan & meng-cascade
  `PosTransaction` ke `CANCELLED`; finalize ditolak bila resep belum
  APPROVED; setelah APPROVED, finalize memotong stok FEFO tepat, status
  →PAID, Prescription→COMPLETED, audit log `PAY_AFTER_PRESCRIPTION`
  tercatat.
- **Void**: ditolak untuk role tanpa `pos.void` & alasan kosong; branch
  access ditegakkan; qty dikembalikan **TEPAT** ke MASING-MASING batch
  alokasi asal (termasuk item yang dulu di-split FEFO ke 2 batch — kedua
  batch diverifikasi kembali ke qty semula persis); `VOID_REVERSAL`
  tercatat SATU per alokasi; `Payment.isReversed=true` untuk semua baris;
  audit log `VOID_TRANSACTION` dengan `reason` tersimpan; void kedua kali
  atas transaksi yang sama ditolak (`Hanya transaksi berstatus PAID`).
- **Retur**: ditolak untuk role tanpa `pos.sell`, alasan kosong, & branch
  access; SELLABLE menambah balik qty batch ASAL & status transaksi
  →PARTIALLY_RETURNED (retur sebagian) atau →RETURNED (retur penuh); retur
  melebihi sisa returnable ditolak SELURUHNYA, termasuk saat sisa itu
  berasal dari akumulasi beberapa retur berturut-turut sebelumnya (retur
  tepat-sisa berikutnya tetap berhasil, membuktikan perhitungan sisa
  returnable akurat); DAMAGED/QUARANTINE membuat batch SEGREGASI terpisah
  berstatus sesuai DAN **tidak menambah** `qtyOnHand` batch AVAILABLE asal
  (diverifikasi eksplisit lewat query batch asal setelah retur);
  `getReturnableSummary` menghitung sisa returnable per alokasi dengan
  benar setelah retur sebagian.

## Catatan untuk fase berikutnya

- Laporan komprehensif (ringkasan penjualan/void/retur per periode,
  dashboard) sengaja di luar cakupan fase ini — data mentahnya (AuditLog,
  StockMovement, SalesReturn/Item, status PosTransaction) sudah lengkap
  untuk dibangun di atasnya tanpa perubahan skema.
- Deployment/production hardening eksplisit di luar cakupan.
- Modul pasien master data / linking riwayat resep per pasien bisa
  dibangun di atas `Prescription.patientName`/`patientPhone` yang ada
  tanpa migrasi besar (tambah `patientId` opsional yang menunjuk entitas
  baru).
