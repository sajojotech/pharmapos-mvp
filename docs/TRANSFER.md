# Transfer Stok Antar-Cabang — Fase 08

Perpindahan stok antar-cabang dengan traceability batch/ED/cost yang sama
ketatnya dengan penerimaan barang (Fase 05) dan penjualan POS (Fase 07).
Resep dan retur/void penjualan eksplisit di luar cakupan fase ini — hanya
`transfer.manage` (permission yang **sudah ada** sejak Fase 02, dipegang
OWNER/CENTRAL_ADMIN/BRANCH_MANAGER/WAREHOUSE_STAFF, tidak ada perubahan
matrix) yang dipakai.

## Lifecycle (diagram teks)

```
                    (cabang TUJUAN)              (cabang ASAL)
DRAFT ──submit──▶ REQUESTED ──approve──▶ APPROVED ──ship──▶ SHIPPED
  │                   │                      │                 │
  │ cancel             │ cancel               │ cancel           │ (tidak bisa
  ▼                   ▼                      ▼                 │  dibatalkan)
CANCELLED         CANCELLED              CANCELLED              │
                   │                                            │
                   └──reject──▶ REJECTED                        │
                                                                 ▼
                                                     (cabang TUJUAN) receive
                                                                 │
                                          ┌──────────────────────┴───┐
                                          ▼                          ▼
                                      RECEIVED            PARTIALLY_RECEIVED
                                 (semua item qty          (ada item qty
                                  diterima = qty              diterima <
                                  dikirim)                  qty dikirim,
                                                          discrepancyReason
                                                                terisi)
```

`RECEIVED`/`PARTIALLY_RECEIVED` adalah status akhir — satu kali aksi terima
per transfer, bukan sesi penerimaan bertahap (sejalan dengan larangan
membangun modul retur/susulan pada fase ini).

## Keputusan desain

### 1. Alur inisiasi: cabang tujuan meminta, cabang asal menyetujui & mengirim

Cabang **TUJUAN** (yang butuh stok) membuat DRAFT dan mengajukan
(REQUESTED). Cabang **ASAL** (yang mengirim) menyetujui/menolak lalu
mengirim (SHIP). Cabang **TUJUAN** mengonfirmasi penerimaan. Ini memberi
RBAC yang jelas per aksi (lihat bagian RBAC).

### 2. Batch dipilih manual saat DRAFT, bukan FEFO otomatis

Beda dari POS (Fase 07, FEFO otomatis oleh sistem karena kasir tidak perlu/
tidak sempat tahu detail batch), transfer butuh **pemilihan sadar oleh
staf gudang** — mereka yang tahu fisik pallet/lot mana yang mau dikirim.
`StockTransferItem.sourceStockBatchId` dipilih dari dropdown
`services/stock-batch-service.ts::listAvailableBatchesForBranch`
(sudah ada sejak Fase 04, sudah terurut FEFO sebagai bantuan urutan, tapi
user tetap bebas memilih baris mana pun). Snapshot
`batchNumber`/`expiryDate`/`unitCost` diambil pada saat item dibuat —
nilai-nilai ini pada dasarnya permanen sekali batch dibuat (sama seperti
alasan `PosTransactionItem.unitPrice` snapshot di Fase 06/07) — dan
divalidasi ulang secara atomic saat SHIP.

### 3. Ship & Receive: reuse primitif Fase 04, bukan primitif baru

- **SHIP** (per item): `services/stock-ledger.ts::deductStockFromBatch`
  dengan `movementType: "TRANSFER_OUT"` (nilai enum yang **sudah ada** sejak
  Fase 01) — primitif atomic yang sama dipakai POS (Fase 07), sudah
  menegakkan AVAILABLE + belum-expired + `WHERE qtyOnHand >= qty`
  race-safe (lihat docs/INVENTORY.md).
- **RECEIVE** (per item, qty > 0): `services/stock-ledger.ts::receiveStockToBatch`
  dengan `movementType: "TRANSFER_IN"` — primitif yang sama dipakai
  Purchase Receipt (Fase 05), find-or-create by `(branchId, productId,
  batchNumber)`. Karena `batchNumber`/`expiryDate`/`unitCost` yang dikirim
  PERSIS snapshot dari batch asal, batch tujuan otomatis mewarisi identitas
  yang sama.
- **Genealogy**: `StockTransferItem.sourceStockBatchId` +
  `destinationStockBatchId` — dua FK yang bersama-sama membentuk jejak
  lengkap "batch tujuan X berasal dari batch asal Y lewat transfer Z",
  tanpa perlu tabel genealogy terpisah.
- Ship dan Receive masing-masing berjalan dalam SATU `prisma.$transaction`
  (semua item dalam satu aksi sekaligus) — gagal di item mana pun
  membatalkan seluruhnya, pola yang sama dengan
  `purchase-receipt-service.ts::postReceipt` dan
  `pos-transaction-service.ts::createPaidTransaction`.

### 4. Stok in-transit: tidak ada model terpisah — tercermin dari status dokumen

**Ini adalah keputusan penanganan stok in-transit yang diminta fase ini.**
Antara `SHIPPED` dan `RECEIVED`, qty yang sedang berpindah **tidak
tercatat di `StockBatch` mana pun** — sudah dikurangi dari batch asal
(TRANSFER_OUT), belum ditambahkan ke batch tujuan (TRANSFER_IN belum
terjadi). Ini disengaja, bukan bug:

- Total `StockBatch.qtyOnHand` yang terlihat di seluruh cabang (dijumlah
  lintas cabang) TURUN sementara sebesar qty in-transit selama masa itu —
  konsisten dengan kenyataan fisik: barang sedang di truk/kurir, bukan di
  rak cabang mana pun.
- Qty ini TIDAK hilang/tidak traceable: `StockTransfer.status = SHIPPED`
  + `StockTransferItem.qtyShipped` (belum sama dengan `qtyReceived`) ITU
  SENDIRI adalah catatan resmi "sedang dalam perjalanan", dan
  `StockMovement TRANSFER_OUT` sudah tercatat permanen di ledger cabang
  asal.
- Query "qty in-transit saat ini" (bila dibutuhkan laporan nanti): jumlah
  `qtyShipped - COALESCE(qtyReceived, 0)` pada `StockTransferItem` yang
  transfer induknya berstatus `SHIPPED`.
- **Kenapa tidak membuat model "gudang in-transit" terpisah** (mis.
  `StockBatch` pihak ketiga netral): tidak diminta skema fase ini, dan
  menambah lokasi stok ketiga adalah kompleksitas signifikan (butuh
  warehouse/branch virtual, aturan akses tersendiri, dst.) yang tidak
  sepadan dengan manfaatnya untuk MVP — status dokumen `SHIPPED` sudah
  cukup untuk menjawab "ke mana stok ini" secara traceable.

Selisih penerimaan (`qtyReceived < qtyShipped`, mis. rusak/hilang di
perjalanan) dicatat sebagai teks (`discrepancyReason`) saja — TIDAK
memicu movement/write-off otomatis (itu wilayah retur, sengaja di luar
fase ini).

### 5. Cancel diblokir setelah SHIPPED

`cancelTransfer` hanya menerima status `DRAFT`/`REQUESTED`/`APPROVED`.
Setelah `SHIPPED`, tidak ada tombol Cancel sama sekali di UI (digantikan
catatan penjelasan) dan pemanggilan service melempar error eksplisit:
"stok sudah berpindah fisik dari cabang asal; pembatalan butuh alur
retur/reversal yang belum dibangun fase ini."

## RBAC per-aksi (branch-scoped, bukan cuma permission)

| Aksi | Syarat cabang |
| --- | --- |
| Lihat (list/detail) | akses ke `sourceBranchId` **atau** `destinationBranchId` |
| Create draft, edit draft, submit, cancel | akses ke `sourceBranchId` **atau** `destinationBranchId` |
| Approve, Reject, Ship | akses ke `sourceBranchId` |
| Receive | akses ke `destinationBranchId` |

Role global (`OWNER`, `CENTRAL_ADMIN`) selalu lolos cek cabang
(`hasBranchAccess`, sudah ada sejak Fase 02) — otomatis memenuhi
"Owner/Central Admin dapat memantau semua", dan karena keduanya juga
punya `transfer.manage`, mereka juga bisa bertindak di transfer mana pun —
konsisten dengan pola global-role yang sudah ada di seluruh codebase
(tidak ada preseden "read-only meski permission ada").

## Hasil test & quality gate

| Gate | Hasil |
| --- | --- |
| Migration | ✅ `20260910070801_phase8_stock_transfer` diterapkan bersih |
| `npm run lint` | ✅ 0 error |
| `npm run typecheck` | ✅ |
| `npm run test` | ✅ **180/180** (10 test baru di `tests/integration/stock-transfer-service.test.ts`) |
| `npm run build` | ✅ 34 route |

Cakupan test baru:
- Tolak `sourceBranchId === destinationBranchId`.
- Lifecycle penuh draft→request→approve→ship→receive: ship mengurangi
  batch sumber tepat & membuat `TRANSFER_OUT`; receive
  membuat/menambah batch tujuan dengan `batchNumber`/`expiryDate`/
  `unitCost` PERSIS sama dengan snapshot asal & membuat `TRANSFER_IN`;
  `destinationStockBatchId` terisi (genealogy lengkap).
- Ship yang melebihi saldo batch (disimulasikan berkurang di tempat lain
  setelah approve) ditolak atomic — status tetap `APPROVED`, tidak ada
  movement baru.
- Penerimaan parsial: qty kurang tanpa alasan ditolak; dengan alasan →
  `PARTIALLY_RECEIVED`, selisih tercatat.
- Cancel ditolak setelah `SHIPPED`; diizinkan sebelumnya (DRAFT/REQUESTED/
  APPROVED).
- Alasan penolakan kosong ditolak.
- RBAC: user di luar cabang asal maupun tujuan tidak bisa melihat
  (`getTransferById` → null) atau memproses (aksi → error) transfer
  tsb; cabang tujuan tidak bisa approve (harus cabang asal); cabang asal
  tidak bisa receive (harus cabang tujuan).

## Catatan untuk fase berikutnya

- Retur/reversal transfer yang sudah `SHIPPED` (mis. barang dikembalikan
  ke cabang asal) sengaja tidak dibangun — akan butuh `StockMovementType`
  tambahan atau alur `SALES_RETURN`/`SUPPLIER_RETURN`-setara untuk
  transfer.
- Laporan "qty in-transit saat ini lintas cabang" bisa dibangun di atas
  query yang sudah dijelaskan pada poin 4 tanpa perubahan skema.
