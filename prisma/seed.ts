import "dotenv/config";
import { PrismaClient, Role } from "@prisma/client";
import { hashPassword } from "../lib/password";
import { receiveStockToBatch } from "../services/stock-ledger";

const prisma = new PrismaClient();

/**
 * Password demo bersama untuk seluruh akun seed. HANYA untuk development
 * lokal — jangan pernah dipakai sebagai password produksi. Di-hash dengan
 * bcrypt sebelum disimpan; database tidak pernah menyimpan nilai plain-text.
 */
const DEMO_PASSWORD = "PharmaPOS#Dev2026";

async function main() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // ---- Company -------------------------------------------------------
  const company = await prisma.company.upsert({
    where: { name: "PT Sehat Sentosa" },
    update: {},
    create: { name: "PT Sehat Sentosa" },
  });

  // ---- Branches --------------------------------------------------------
  const branchSeeds = [
    {
      code: "PUSAT",
      name: "Apotek Sehat Sentosa Pusat",
      address: "Jl. Raya Darmo No. 10, Surabaya",
      phone: "031-5551001",
      warehouseCode: "GD-PUSAT",
      warehouseName: "Gudang Utama Pusat",
    },
    {
      code: "BARAT",
      name: "Apotek Sehat Sentosa Barat",
      address: "Jl. HR Muhammad No. 25, Surabaya",
      phone: "031-5551002",
      warehouseCode: "GD-BARAT",
      warehouseName: "Gudang Utama Barat",
    },
    {
      code: "TIMUR",
      name: "Apotek Sehat Sentosa Timur",
      address: "Jl. Kenjeran No. 88, Surabaya",
      phone: "031-5551003",
      warehouseCode: "GD-TIMUR",
      warehouseName: "Gudang Utama Timur",
    },
  ] as const;

  const branches: Record<string, { id: string }> = {};
  const warehouses: Record<string, { id: string }> = {};

  for (const b of branchSeeds) {
    const branch = await prisma.branch.upsert({
      where: { companyId_code: { companyId: company.id, code: b.code } },
      update: { name: b.name, address: b.address, phone: b.phone },
      create: {
        companyId: company.id,
        code: b.code,
        name: b.name,
        address: b.address,
        phone: b.phone,
      },
    });
    branches[b.code] = branch;

    const warehouse = await prisma.warehouse.upsert({
      where: { branchId_code: { branchId: branch.id, code: b.warehouseCode } },
      update: { name: b.warehouseName, isDefault: true },
      create: {
        branchId: branch.id,
        code: b.warehouseCode,
        name: b.warehouseName,
        isDefault: true,
      },
    });
    warehouses[b.code] = warehouse;
  }

  // ---- Categories --------------------------------------------------------
  const categoryNames = [
    "Obat Bebas",
    "Obat Bebas Terbatas",
    "Obat Keras (Resep)",
    "Alat Kesehatan",
    "Vitamin & Suplemen",
    "Perawatan Tubuh",
  ];

  const categories: Record<string, { id: string }> = {};
  for (const name of categoryNames) {
    categories[name] = await prisma.category.upsert({
      where: { companyId_name: { companyId: company.id, name } },
      update: {},
      create: { companyId: company.id, name },
    });
  }

  // ---- Units --------------------------------------------------------
  const unitSeeds = [
    { name: "Tablet", symbol: "tab" },
    { name: "Kapsul", symbol: "kap" },
    { name: "Strip", symbol: "strip" },
    { name: "Box", symbol: "box" },
    { name: "Botol", symbol: "btl" },
    { name: "Tube", symbol: "tube" },
    { name: "Pcs", symbol: "pcs" },
    { name: "Sachet", symbol: "sch" },
  ];

  const units: Record<string, { id: string }> = {};
  for (const u of unitSeeds) {
    units[u.name] = await prisma.unit.upsert({
      where: { companyId_name: { companyId: company.id, name: u.name } },
      update: { symbol: u.symbol },
      create: { companyId: company.id, name: u.name, symbol: u.symbol },
    });
  }

  // ---- Products --------------------------------------------------------
  type ProductSeed = {
    sku: string;
    name: string;
    genericName?: string;
    brandName?: string;
    category: string;
    baseUnit: string;
    price: number;
    minStock: number;
    requiresPrescription?: boolean;
    isControlled?: boolean;
    barcode: string;
    conversions?: { unit: string; factor: number }[];
  };

  const productSeeds: ProductSeed[] = [
    {
      sku: "OBT-0001",
      name: "Paracetamol 500mg",
      genericName: "Paracetamol",
      category: "Obat Bebas",
      baseUnit: "Tablet",
      price: 500,
      minStock: 100,
      barcode: "8991234500011",
      conversions: [
        { unit: "Strip", factor: 10 },
        { unit: "Box", factor: 100 },
      ],
    },
    {
      sku: "OBT-0002",
      name: "Amoxicillin 500mg",
      genericName: "Amoxicillin",
      category: "Obat Keras (Resep)",
      baseUnit: "Tablet",
      price: 1500,
      minStock: 50,
      requiresPrescription: true,
      barcode: "8991234500028",
      conversions: [
        { unit: "Strip", factor: 10 },
        { unit: "Box", factor: 100 },
      ],
    },
    {
      sku: "OBT-0003",
      name: "Ibuprofen 400mg",
      genericName: "Ibuprofen",
      category: "Obat Bebas Terbatas",
      baseUnit: "Tablet",
      price: 800,
      minStock: 60,
      barcode: "8991234500035",
      conversions: [{ unit: "Strip", factor: 10 }],
    },
    {
      sku: "OBT-0004",
      name: "Cetirizine 10mg",
      genericName: "Cetirizine",
      category: "Obat Bebas Terbatas",
      baseUnit: "Tablet",
      price: 700,
      minStock: 60,
      barcode: "8991234500042",
      conversions: [{ unit: "Strip", factor: 10 }],
    },
    {
      sku: "OBT-0005",
      name: "Omeprazole 20mg",
      genericName: "Omeprazole",
      category: "Obat Keras (Resep)",
      baseUnit: "Kapsul",
      price: 2500,
      minStock: 40,
      requiresPrescription: true,
      barcode: "8991234500059",
      conversions: [{ unit: "Strip", factor: 10 }],
    },
    {
      sku: "OBT-0006",
      name: "Alprazolam 0.5mg",
      genericName: "Alprazolam",
      category: "Obat Keras (Resep)",
      baseUnit: "Tablet",
      price: 3000,
      minStock: 20,
      requiresPrescription: true,
      isControlled: true,
      barcode: "8991234500066",
      conversions: [{ unit: "Strip", factor: 10 }],
    },
    {
      sku: "VIT-0001",
      name: "Vitamin C 500mg",
      genericName: "Ascorbic Acid",
      brandName: "Sehat-C",
      category: "Vitamin & Suplemen",
      baseUnit: "Tablet",
      price: 1000,
      minStock: 100,
      barcode: "8991234500073",
      conversions: [
        { unit: "Strip", factor: 10 },
        { unit: "Box", factor: 100 },
      ],
    },
    {
      sku: "VIT-0002",
      name: "Multivitamin Dewasa",
      brandName: "Sehat-Multi",
      category: "Vitamin & Suplemen",
      baseUnit: "Tablet",
      price: 1500,
      minStock: 80,
      barcode: "8991234500080",
      conversions: [{ unit: "Botol", factor: 30 }],
    },
    {
      sku: "ALK-0001",
      name: "Masker Medis 3 Ply",
      category: "Alat Kesehatan",
      baseUnit: "Pcs",
      price: 1000,
      minStock: 200,
      barcode: "8991234500097",
      conversions: [{ unit: "Box", factor: 50 }],
    },
    {
      sku: "ALK-0002",
      name: "Hand Sanitizer 100ml",
      brandName: "CleanHand",
      category: "Perawatan Tubuh",
      baseUnit: "Botol",
      price: 15000,
      minStock: 30,
      barcode: "8991234500103",
    },
    {
      sku: "ALK-0003",
      name: "Termometer Digital",
      category: "Alat Kesehatan",
      baseUnit: "Pcs",
      price: 45000,
      minStock: 10,
      barcode: "8991234500110",
    },
    {
      sku: "PRT-0001",
      name: "Salep Kulit Betamethasone",
      genericName: "Betamethasone",
      category: "Obat Keras (Resep)",
      baseUnit: "Tube",
      price: 12000,
      minStock: 15,
      requiresPrescription: true,
      barcode: "8991234500127",
    },
  ];

  const products: Record<string, { id: string }> = {};

  for (const p of productSeeds) {
    const category = categories[p.category];
    const baseUnit = units[p.baseUnit];
    if (!category || !baseUnit) {
      throw new Error(
        `Seed error: kategori "${p.category}" atau unit "${p.baseUnit}" tidak ditemukan untuk produk ${p.sku}`,
      );
    }

    const product = await prisma.product.upsert({
      where: { companyId_sku: { companyId: company.id, sku: p.sku } },
      update: {
        name: p.name,
        genericName: p.genericName,
        brandName: p.brandName,
        categoryId: category.id,
        baseUnitId: baseUnit.id,
        defaultSellingPrice: p.price,
        defaultMinStock: p.minStock,
        requiresPrescription: p.requiresPrescription ?? false,
        isControlled: p.isControlled ?? false,
      },
      create: {
        companyId: company.id,
        sku: p.sku,
        name: p.name,
        genericName: p.genericName,
        brandName: p.brandName,
        categoryId: category.id,
        baseUnitId: baseUnit.id,
        defaultSellingPrice: p.price,
        defaultMinStock: p.minStock,
        requiresPrescription: p.requiresPrescription ?? false,
        isControlled: p.isControlled ?? false,
      },
    });
    products[p.sku] = product;

    await prisma.productBarcode.upsert({
      where: { barcode: p.barcode },
      update: { productId: product.id },
      create: { productId: product.id, barcode: p.barcode },
    });

    for (const conv of p.conversions ?? []) {
      const unit = units[conv.unit];
      if (!unit) {
        throw new Error(
          `Seed error: unit konversi "${conv.unit}" tidak ditemukan untuk produk ${p.sku}`,
        );
      }
      await prisma.productUnitConversion.upsert({
        where: {
          productId_unitId: { productId: product.id, unitId: unit.id },
        },
        update: { conversionFactor: conv.factor },
        create: {
          productId: product.id,
          unitId: unit.id,
          conversionFactor: conv.factor,
        },
      });
    }
  }

  // ---- Product branch price override (contoh) ----------------------------
  const branchPriceOverrides = [
    { branchCode: "BARAT", sku: "OBT-0001", price: 550 },
    { branchCode: "TIMUR", sku: "VIT-0001", price: 950 },
  ];

  for (const override of branchPriceOverrides) {
    const branch = branches[override.branchCode];
    const product = products[override.sku];
    if (!branch || !product) continue;

    await prisma.productBranchPrice.upsert({
      where: {
        branchId_productId: { branchId: branch.id, productId: product.id },
      },
      update: { price: override.price },
      create: {
        branchId: branch.id,
        productId: product.id,
        price: override.price,
      },
    });
  }

  // ---- Suppliers --------------------------------------------------------
  const supplierSeeds = [
    {
      code: "SUP-001",
      name: "PT Kimia Farma Trading & Distribution",
      phone: "021-5551111",
      address: "Jakarta",
    },
    {
      code: "SUP-002",
      name: "PT Enseval Putera Megatrading",
      phone: "021-5552222",
      address: "Jakarta",
    },
    {
      code: "SUP-003",
      name: "PT Anugrah Pharmindo Lestari",
      phone: "031-5553333",
      address: "Surabaya",
    },
  ];

  for (const s of supplierSeeds) {
    await prisma.supplier.upsert({
      where: { companyId_code: { companyId: company.id, code: s.code } },
      update: { name: s.name, phone: s.phone, address: s.address },
      create: {
        companyId: company.id,
        code: s.code,
        name: s.name,
        phone: s.phone,
        address: s.address,
      },
    });
  }

  // ---- Customers --------------------------------------------------------
  const customerSeeds = [
    { code: "UMUM", name: "Umum" },
    { code: "CUST-0001", name: "Budi Santoso", phone: "0812-3456-7890" },
    { code: "CUST-0002", name: "Siti Aminah", phone: "0813-9876-5432" },
  ];

  for (const c of customerSeeds) {
    await prisma.customer.upsert({
      where: { companyId_code: { companyId: company.id, code: c.code } },
      update: { name: c.name, phone: c.phone },
      create: {
        companyId: company.id,
        code: c.code,
        name: c.name,
        phone: c.phone,
      },
    });
  }

  // ---- App settings --------------------------------------------------------
  const appSettingSeeds = [
    { key: "NEAR_EXPIRY_THRESHOLD_DAYS", value: 90 },
    { key: "CASH_VARIANCE_THRESHOLD", value: 10000 },
  ];

  for (const s of appSettingSeeds) {
    await prisma.appSetting.upsert({
      where: { companyId_key: { companyId: company.id, key: s.key } },
      update: { value: s.value },
      create: { companyId: company.id, key: s.key, value: s.value },
    });
  }

  // ---- Users (satu akun demo per role) ----------------------------
  type UserSeed = {
    email: string;
    name: string;
    role: Role;
    branchCodes: string[];
  };

  const userSeeds: UserSeed[] = [
    { email: "owner@pharmapos.local", name: "Owner Demo", role: Role.OWNER, branchCodes: [] },
    {
      email: "admin@pharmapos.local",
      name: "Admin Pusat Demo",
      role: Role.CENTRAL_ADMIN,
      branchCodes: [],
    },
    {
      email: "manager.pusat@pharmapos.local",
      name: "Manager Cabang Pusat",
      role: Role.BRANCH_MANAGER,
      branchCodes: ["PUSAT"],
    },
    {
      email: "apoteker.pusat@pharmapos.local",
      name: "Apoteker Pusat",
      role: Role.PHARMACIST,
      branchCodes: ["PUSAT"],
    },
    {
      email: "kasir.pusat@pharmapos.local",
      name: "Kasir Pusat",
      role: Role.CASHIER,
      branchCodes: ["PUSAT"],
    },
    {
      email: "gudang.pusat@pharmapos.local",
      name: "Staff Gudang Pusat",
      role: Role.WAREHOUSE_STAFF,
      branchCodes: ["PUSAT"],
    },
    {
      email: "auditor@pharmapos.local",
      name: "Finance Auditor Demo",
      role: Role.FINANCE_AUDITOR,
      branchCodes: [],
    },
  ];

  const users: Record<string, { id: string }> = {};

  for (const u of userSeeds) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, passwordHash },
      create: {
        companyId: company.id,
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash,
      },
    });
    users[u.email] = user;

    for (const branchCode of u.branchCodes) {
      const branch = branches[branchCode];
      if (!branch) continue;
      await prisma.userBranchAssignment.upsert({
        where: {
          userId_branchId: { userId: user.id, branchId: branch.id },
        },
        update: {},
        create: { userId: user.id, branchId: branch.id },
      });
    }
  }

  // ---- Saldo awal stok (opening balance) ----------------------------
  // Hanya dijalankan sekali (dicek lewat keberadaan StockBatch dgn
  // batchNumber tsb — receiveStockToBatch sendiri idempotent per
  // batchNumber, tapi kita skip seluruh blok bila sudah pernah jalan agar
  // re-run seed tidak terus menumpuk qty pada batch yang sama).
  const openingBalanceCreatedBy = users["gudang.pusat@pharmapos.local"];
  if (!openingBalanceCreatedBy) {
    throw new Error("Seed error: user gudang.pusat tidak ditemukan untuk opening balance.");
  }

  const alreadySeeded = await prisma.stockBatch.findFirst({
    where: { batchNumber: { startsWith: "OB-" } },
  });

  if (!alreadySeeded) {
    const dayOffset = (days: number) => {
      const date = new Date();
      date.setDate(date.getDate() + days);
      return date;
    };

    const openingBalances: {
      branchCode: string;
      sku: string;
      batchNumber: string;
      expiryOffsetDays: number;
      qty: number;
      unitCost: number;
    }[] = [
      // PUSAT — termasuk satu batch hampir ED (20 hari) dan satu batch yang
      // SUDAH lewat ED (untuk mendemonstrasikan sinkronisasi status EXPIRED
      // otomatis saat pertama kali dibaca — lihat syncExpiredBatchStatus()).
      { branchCode: "PUSAT", sku: "OBT-0001", batchNumber: "OB-PST-0001", expiryOffsetDays: 400, qty: 500, unitCost: 350 },
      { branchCode: "PUSAT", sku: "OBT-0002", batchNumber: "OB-PST-0002", expiryOffsetDays: 300, qty: 200, unitCost: 900 },
      { branchCode: "PUSAT", sku: "OBT-0002", batchNumber: "OB-PST-0002-EXPIRED", expiryOffsetDays: -10, qty: 25, unitCost: 900 },
      { branchCode: "PUSAT", sku: "OBT-0003", batchNumber: "OB-PST-0003", expiryOffsetDays: 250, qty: 300, unitCost: 500 },
      { branchCode: "PUSAT", sku: "OBT-0004", batchNumber: "OB-PST-0004", expiryOffsetDays: 20, qty: 80, unitCost: 450 },
      { branchCode: "PUSAT", sku: "OBT-0005", batchNumber: "OB-PST-0005", expiryOffsetDays: 180, qty: 60, unitCost: 1600 },
      { branchCode: "PUSAT", sku: "OBT-0006", batchNumber: "OB-PST-0006", expiryOffsetDays: 200, qty: 30, unitCost: 2000 },
      { branchCode: "PUSAT", sku: "VIT-0001", batchNumber: "OB-PST-0007", expiryOffsetDays: 500, qty: 400, unitCost: 700 },
      { branchCode: "PUSAT", sku: "ALK-0001", batchNumber: "OB-PST-0008", expiryOffsetDays: 700, qty: 1000, unitCost: 600 },
      // BARAT
      { branchCode: "BARAT", sku: "OBT-0001", batchNumber: "OB-BRT-0001", expiryOffsetDays: 350, qty: 250, unitCost: 350 },
      { branchCode: "BARAT", sku: "VIT-0001", batchNumber: "OB-BRT-0002", expiryOffsetDays: 450, qty: 150, unitCost: 700 },
      { branchCode: "BARAT", sku: "ALK-0002", batchNumber: "OB-BRT-0003", expiryOffsetDays: 600, qty: 40, unitCost: 12000 },
      // TIMUR
      { branchCode: "TIMUR", sku: "OBT-0001", batchNumber: "OB-TMR-0001", expiryOffsetDays: 320, qty: 180, unitCost: 350 },
      { branchCode: "TIMUR", sku: "VIT-0002", batchNumber: "OB-TMR-0002", expiryOffsetDays: 400, qty: 120, unitCost: 1100 },
      { branchCode: "TIMUR", sku: "ALK-0003", batchNumber: "OB-TMR-0003", expiryOffsetDays: 800, qty: 15, unitCost: 38000 },
    ];

    for (const ob of openingBalances) {
      const branch = branches[ob.branchCode];
      const warehouse = warehouses[ob.branchCode];
      const product = products[ob.sku];
      if (!branch || !warehouse || !product) {
        throw new Error(
          `Seed error: cabang/warehouse/produk tidak ditemukan untuk opening balance ${ob.batchNumber}`,
        );
      }

      await receiveStockToBatch(prisma, {
        companyId: company.id,
        branchId: branch.id,
        warehouseId: warehouse.id,
        productId: product.id,
        batchNumber: ob.batchNumber,
        expiryDate: dayOffset(ob.expiryOffsetDays),
        receivedDate: new Date(),
        unitCost: ob.unitCost,
        qty: ob.qty,
        movementType: "OPENING_BALANCE",
        referenceType: "Seed",
        referenceId: "opening-balance",
        createdById: openingBalanceCreatedBy.id,
        notes: "Saldo awal (seed)",
      });
    }
  }

  console.log("Seed selesai.");
  console.log(`Company: ${company.name}`);
  console.log(`Branches: ${branchSeeds.map((b) => b.code).join(", ")}`);
  console.log(`Products: ${productSeeds.length}`);
  console.log(`Users: ${userSeeds.length} (password demo: ${DEMO_PASSWORD})`);
}

main()
  .catch((error) => {
    console.error("Seed gagal:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
