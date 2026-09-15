-- CreateEnum
CREATE TYPE "CashierShiftStatus" AS ENUM ('OPEN', 'PENDING_APPROVAL', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashMovementDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "PosTransactionStatus" AS ENUM ('DRAFT', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'QRIS', 'BANK_TRANSFER', 'DEBIT_CARD', 'E_WALLET');

-- CreateTable
CREATE TABLE "CashierShift" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "CashierShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openingCash" DECIMAL(14,2) NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closingNotes" TEXT,
    "expectedCash" DECIMAL(14,2),
    "actualCash" DECIMAL(14,2),
    "variance" DECIMAL(14,2),
    "varianceThreshold" DECIMAL(14,2),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashierShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "cashierShiftId" TEXT NOT NULL,
    "direction" "CashMovementDirection" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosTransaction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "cashierShiftId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "status" "PosTransactionStatus" NOT NULL DEFAULT 'PAID',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "changeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosTransactionItem" (
    "id" TEXT NOT NULL,
    "posTransactionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosTransactionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "posTransactionId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashierShift_companyId_idx" ON "CashierShift"("companyId");

-- CreateIndex
CREATE INDEX "CashierShift_branchId_idx" ON "CashierShift"("branchId");

-- CreateIndex
CREATE INDEX "CashierShift_userId_idx" ON "CashierShift"("userId");

-- CreateIndex
CREATE INDEX "CashierShift_status_idx" ON "CashierShift"("status");

-- CreateIndex
-- Partial unique index: satu user hanya boleh punya SATU shift berstatus
-- OPEN pada satu waktu (lintas cabang mana pun). Tidak dapat diekspresikan
-- lewat Prisma schema DSL (tidak mendukung partial/filtered unique index),
-- jadi ditambahkan manual di sini — lihat docs/POS.md & catatan pada model
-- CashierShift di schema.prisma. Service tetap melakukan pre-check ramah
-- pengguna sebelum insert; index ini adalah jaring pengaman konkurensi
-- tingkat database (analog dengan pendekatan atomic update di
-- services/stock-ledger.ts, diterapkan pada constraint keberadaan baris,
-- bukan pada aritmetika saldo).
CREATE UNIQUE INDEX "CashierShift_userId_open_key" ON "CashierShift"("userId") WHERE "status" = 'OPEN';

-- CreateIndex
CREATE INDEX "CashMovement_cashierShiftId_idx" ON "CashMovement"("cashierShiftId");

-- CreateIndex
CREATE INDEX "PosTransaction_branchId_idx" ON "PosTransaction"("branchId");

-- CreateIndex
CREATE INDEX "PosTransaction_cashierShiftId_idx" ON "PosTransaction"("cashierShiftId");

-- CreateIndex
CREATE INDEX "PosTransaction_customerId_idx" ON "PosTransaction"("customerId");

-- CreateIndex
CREATE INDEX "PosTransaction_status_idx" ON "PosTransaction"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PosTransaction_companyId_documentNumber_key" ON "PosTransaction"("companyId", "documentNumber");

-- CreateIndex
CREATE INDEX "PosTransactionItem_posTransactionId_idx" ON "PosTransactionItem"("posTransactionId");

-- CreateIndex
CREATE INDEX "PosTransactionItem_productId_idx" ON "PosTransactionItem"("productId");

-- CreateIndex
CREATE INDEX "Payment_posTransactionId_idx" ON "Payment"("posTransactionId");

-- AddForeignKey
ALTER TABLE "CashierShift" ADD CONSTRAINT "CashierShift_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierShift" ADD CONSTRAINT "CashierShift_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierShift" ADD CONSTRAINT "CashierShift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierShift" ADD CONSTRAINT "CashierShift_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierShift" ADD CONSTRAINT "CashierShift_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_cashierShiftId_fkey" FOREIGN KEY ("cashierShiftId") REFERENCES "CashierShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTransaction" ADD CONSTRAINT "PosTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTransaction" ADD CONSTRAINT "PosTransaction_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTransaction" ADD CONSTRAINT "PosTransaction_cashierShiftId_fkey" FOREIGN KEY ("cashierShiftId") REFERENCES "CashierShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTransaction" ADD CONSTRAINT "PosTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTransaction" ADD CONSTRAINT "PosTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTransaction" ADD CONSTRAINT "PosTransaction_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTransactionItem" ADD CONSTRAINT "PosTransactionItem_posTransactionId_fkey" FOREIGN KEY ("posTransactionId") REFERENCES "PosTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTransactionItem" ADD CONSTRAINT "PosTransactionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_posTransactionId_fkey" FOREIGN KEY ("posTransactionId") REFERENCES "PosTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
