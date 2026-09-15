import { Role } from "@prisma/client";

/**
 * Permission matrix awal PharmaPOS. Setiap permission merepresentasikan satu
 * kapabilitas bisnis (bukan satu halaman) sehingga bisa dipakai ulang oleh
 * banyak halaman/route pada fase-fase berikutnya.
 */
export const PERMISSIONS = [
  "user.manage",
  "master.read",
  "master.manage",
  "inventory.read",
  "inventory.adjust",
  "purchase.manage",
  "pos.sell",
  "pos.void",
  "prescription.review",
  "shift.manage",
  "transfer.manage",
  "report.read.branch",
  "report.read.all",
  "audit.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Role yang memiliki akses lintas-cabang secara implisit (tidak bergantung
 * pada baris UserBranchAssignment). Keputusan ini dibuat pada Fase 01 —
 * lihat docs/DATABASE.md poin 7.
 */
export const GLOBAL_BRANCH_ROLES: Role[] = [
  Role.OWNER,
  Role.CENTRAL_ADMIN,
  Role.FINANCE_AUDITOR,
];

/**
 * Matrix permission per role. Didesain berdasarkan deskripsi role pada
 * spesifikasi produk (lihat docs/AUTH.md untuk penjelasan tiap baris).
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.OWNER]: [
    "user.manage",
    "master.read",
    "master.manage",
    "inventory.read",
    "inventory.adjust",
    "purchase.manage",
    "pos.sell",
    "pos.void",
    "prescription.review",
    "shift.manage",
    "transfer.manage",
    "report.read.branch",
    "report.read.all",
    "audit.read",
  ],
  [Role.CENTRAL_ADMIN]: [
    "user.manage",
    "master.read",
    "master.manage",
    "inventory.read",
    "purchase.manage",
    "transfer.manage",
    "report.read.branch",
    "report.read.all",
    "audit.read",
  ],
  [Role.BRANCH_MANAGER]: [
    "master.read",
    "inventory.read",
    "inventory.adjust",
    "pos.sell",
    "pos.void",
    "prescription.review",
    "shift.manage",
    "transfer.manage",
    "report.read.branch",
  ],
  [Role.PHARMACIST]: [
    "master.read",
    "inventory.read",
    "pos.sell",
    "prescription.review",
    "report.read.branch",
  ],
  [Role.CASHIER]: ["master.read", "inventory.read", "pos.sell", "shift.manage"],
  [Role.WAREHOUSE_STAFF]: [
    "master.read",
    "inventory.read",
    "inventory.adjust",
    "purchase.manage",
    "transfer.manage",
  ],
  [Role.FINANCE_AUDITOR]: [
    "master.read",
    "report.read.branch",
    "report.read.all",
    "audit.read",
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isGlobalBranchRole(role: Role): boolean {
  return GLOBAL_BRANCH_ROLES.includes(role);
}
