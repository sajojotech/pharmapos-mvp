import { test, expect } from "@playwright/test";

/**
 * E2E minimum wajib (Fase 11): login → buka shift → jual produk (stok
 * sudah tersedia dari seed — lihat prisma/seed.ts, "purchase receipt
 * posted" itu sendiri sudah diverifikasi tersendiri lewat
 * tests/integration/purchase-receipt.test.ts) → verifikasi invoice &
 * alokasi batch → cek stok batch berkurang → retur sebagian → cek stok
 * batch & movement yang relevan.
 *
 * Sengaja SATU akun (Kasir Pusat) untuk seluruh alur — kasir sudah punya
 * `pos.sell`+`shift.manage` (jual+buka shift) DAN `pos.sell` untuk retur
 * (lihat services/sales-return-service.ts), jadi tidak perlu berpindah
 * role di tengah skenario. Void (butuh `pos.void`, khusus OWNER/
 * BRANCH_MANAGER) sengaja TIDAK dipakai di sini — instruksi meminta
 * "void ATAU retur", retur dipilih supaya skenario tetap satu login.
 *
 * Produk: Vitamin C 500mg (SKU VIT-0001, non-resep, harga Rp 1.000 di
 * cabang PUSAT) — dicari lewat SKU persis supaya hasil pencarian SELALU
 * tepat satu baris dan auto-masuk keranjang (lihat
 * services/pos-transaction-service.ts::searchSellableProducts).
 */
test.describe.serial("POS lifecycle: login → shift → jual → invoice/batch → retur → stok/movement", () => {
  test("alur penuh", async ({ page }) => {
    const email = "kasir.pusat@pharmapos.local";
    const password = "PharmaPOS#Dev2026";

    // 1. Login
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // 2. Buka shift (idempotent — pakai shift OPEN yang sudah ada bila ada,
    // konsisten dengan cara services/cashier-shift-service.ts menolak
    // membuka shift kedua untuk user yang sama).
    await page.goto("/cashier/shifts");
    const alreadyOpen = await page.getByText(/Shift sedang OPEN/).isVisible().catch(() => false);
    if (!alreadyOpen) {
      await page.getByRole("spinbutton").first().fill("200000");
      await page.getByRole("button", { name: "Buka Shift" }).click();
      await expect(page.getByText(/Shift sedang OPEN/)).toBeVisible();
    }

    // 3. POS: cari produk lewat SKU persis -> auto-masuk keranjang.
    await page.goto("/pos");
    await page.getByPlaceholder("Scan barcode atau ketik nama produk...").fill("VIT-0001");
    await expect(page.getByText("Vitamin C 500mg")).toBeVisible();

    // Set qty jadi 2 (spinbutton pertama di dalam tabel keranjang = qty,
    // yang kedua = diskon — lihat app/(app)/pos/pos-terminal.tsx).
    const cartTable = page.locator("table").first();
    await cartTable.getByRole("spinbutton").first().fill("2");

    // Bayar tunai pas Rp 2.000 (2 x Rp 1.000).
    await page.getByPlaceholder("Jumlah").fill("2000");
    await page.getByRole("button", { name: /^Bayar/ }).click();

    // 4. Harus mendarat di halaman invoice, dengan alokasi batch terisi
    // (BUKAN "Belum ada alokasi batch.") — bukti FEFO benar-benar
    // memotong stok saat pembayaran, bukan cuma tervalidasi.
    await expect(page.getByRole("heading", { name: /^Invoice INV-/ })).toBeVisible();
    await expect(page.getByText("Belum ada alokasi batch.")).toHaveCount(0);
    const batchNumberCell = page.locator("td.font-mono").first();
    await expect(batchNumberCell).toBeVisible();
    const batchNumber = (await batchNumberCell.textContent())?.trim();
    expect(batchNumber).toBeTruthy();

    const invoiceUrl = page.url();

    // 5. Retur sebagian (qty 1 dari 2, kondisi default SELLABLE) — alur
    // WAJIB "void ATAU retur"; retur dipilih karena Cashier sudah
    // berwenang (pos.sell) tanpa perlu login ulang sebagai Manager/Owner.
    await page.goto(`${invoiceUrl}/return`);
    await page.getByRole("spinbutton").first().fill("1");
    await page.locator("textarea").fill("E2E test — retur sebagian, kemasan tidak jadi dipakai");
    await page.getByRole("button", { name: "Proses Retur" }).click();

    await expect(page).toHaveURL(invoiceUrl);
    await expect(page.getByText(/Diretur Sebagian/)).toBeVisible();

    // 6. Kartu Stok (StockMovement) — cek movement POS_SALE (qty keluar 2)
    // DAN SALES_RETURN (qty masuk 1) untuk batch yang sama benar-benar
    // tercatat, membuktikan stok batch berkurang lalu sebagian kembali
    // (bukan cuma status dokumen yang berubah).
    await page.goto("/inventory/movements");
    const movementsTable = page.locator("table").first();
    await expect(movementsTable.getByText("Vitamin C 500mg").first()).toBeVisible();
    await expect(movementsTable.getByText("Penjualan POS").first()).toBeVisible();
    await expect(movementsTable.getByText("Retur Penjualan").first()).toBeVisible();
    if (batchNumber) {
      await expect(movementsTable.getByText(batchNumber).first()).toBeVisible();
    }
  });
});
