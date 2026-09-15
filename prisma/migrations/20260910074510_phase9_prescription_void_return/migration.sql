-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SalesReturnItemCondition" AS ENUM ('SELLABLE', 'DAMAGED', 'QUARANTINE');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "isReversed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PosTransaction" ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" TEXT;

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "posTransactionId" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "patientPhone" TEXT,
    "doctorName" TEXT NOT NULL,
    "prescriptionNumber" TEXT NOT NULL,
    "prescriptionDate" TIMESTAMP(3) NOT NULL,
    "imagePath" TEXT,
    "pharmacistNotes" TEXT,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesReturn" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "posTransactionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesReturnItem" (
    "id" TEXT NOT NULL,
    "salesReturnId" TEXT NOT NULL,
    "posTransactionItemId" TEXT NOT NULL,
    "sourceAllocationId" TEXT NOT NULL,
    "qtyReturned" DECIMAL(14,3) NOT NULL,
    "condition" "SalesReturnItemCondition" NOT NULL,
    "destinationStockBatchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_posTransactionId_key" ON "Prescription"("posTransactionId");

-- CreateIndex
CREATE INDEX "Prescription_companyId_idx" ON "Prescription"("companyId");

-- CreateIndex
CREATE INDEX "Prescription_branchId_idx" ON "Prescription"("branchId");

-- CreateIndex
CREATE INDEX "Prescription_status_idx" ON "Prescription"("status");

-- CreateIndex
CREATE INDEX "SalesReturn_companyId_idx" ON "SalesReturn"("companyId");

-- CreateIndex
CREATE INDEX "SalesReturn_branchId_idx" ON "SalesReturn"("branchId");

-- CreateIndex
CREATE INDEX "SalesReturn_posTransactionId_idx" ON "SalesReturn"("posTransactionId");

-- CreateIndex
CREATE INDEX "SalesReturnItem_salesReturnId_idx" ON "SalesReturnItem"("salesReturnId");

-- CreateIndex
CREATE INDEX "SalesReturnItem_posTransactionItemId_idx" ON "SalesReturnItem"("posTransactionItemId");

-- CreateIndex
CREATE INDEX "SalesReturnItem_sourceAllocationId_idx" ON "SalesReturnItem"("sourceAllocationId");

-- AddForeignKey
ALTER TABLE "PosTransaction" ADD CONSTRAINT "PosTransaction_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_posTransactionId_fkey" FOREIGN KEY ("posTransactionId") REFERENCES "PosTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_posTransactionId_fkey" FOREIGN KEY ("posTransactionId") REFERENCES "PosTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturnItem" ADD CONSTRAINT "SalesReturnItem_salesReturnId_fkey" FOREIGN KEY ("salesReturnId") REFERENCES "SalesReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturnItem" ADD CONSTRAINT "SalesReturnItem_posTransactionItemId_fkey" FOREIGN KEY ("posTransactionItemId") REFERENCES "PosTransactionItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturnItem" ADD CONSTRAINT "SalesReturnItem_sourceAllocationId_fkey" FOREIGN KEY ("sourceAllocationId") REFERENCES "PosTransactionItemBatchAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturnItem" ADD CONSTRAINT "SalesReturnItem_destinationStockBatchId_fkey" FOREIGN KEY ("destinationStockBatchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
