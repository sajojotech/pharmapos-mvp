import type { Permission } from "@/lib/permissions";

export type NavItem = {
  href: string;
  label: string;
  /** null = tidak butuh permission khusus, cukup login. */
  permission: Permission | null;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", permission: null },
  { href: "/master/products", label: "Master Produk", permission: "master.read" },
  { href: "/master/categories", label: "Kategori", permission: "master.read" },
  { href: "/master/units", label: "Satuan", permission: "master.read" },
  { href: "/master/branches", label: "Cabang", permission: "master.read" },
  { href: "/master/warehouses", label: "Warehouse", permission: "master.read" },
  { href: "/master/suppliers", label: "Supplier", permission: "master.read" },
  { href: "/master/customers", label: "Customer", permission: "master.read" },
  { href: "/purchases/receipts", label: "Penerimaan Barang", permission: "purchase.manage" },
  { href: "/inventory/stock", label: "Saldo Stok", permission: "inventory.read" },
  { href: "/inventory/batches", label: "Batch Stok", permission: "inventory.read" },
  { href: "/inventory/movements", label: "Kartu Stok", permission: "inventory.read" },
  { href: "/inventory/adjustments", label: "Stock Adjustment", permission: "inventory.read" },
  { href: "/inventory/opname", label: "Stock Opname", permission: "inventory.read" },
  { href: "/inventory/transfers", label: "Transfer Stok", permission: "transfer.manage" },
  { href: "/cashier/shifts", label: "Shift Kasir", permission: "shift.manage" },
  { href: "/pos", label: "Kasir (POS)", permission: "pos.sell" },
  { href: "/pos/transactions", label: "Riwayat Transaksi", permission: "pos.sell" },
  { href: "/pos/prescriptions", label: "Review Resep", permission: "prescription.review" },
  { href: "/reports", label: "Laporan", permission: "report.read.branch" },
  { href: "/settings/users", label: "Manajemen User", permission: "user.manage" },
];
