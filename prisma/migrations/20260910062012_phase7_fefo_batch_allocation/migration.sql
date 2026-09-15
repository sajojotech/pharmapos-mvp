-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PosTransactionStatus" ADD VALUE 'PENDING_PRESCRIPTION_REVIEW';
ALTER TYPE "PosTransactionStatus" ADD VALUE 'VOIDED';
ALTER TYPE "PosTransactionStatus" ADD VALUE 'PARTIALLY_RETURNED';
ALTER TYPE "PosTransactionStatus" ADD VALUE 'RETURNED';

-- CreateTable
CREATE TABLE "PosTransactionItemBatchAllocation" (
    "id" TEXT NOT NULL,
    "posTransactionItemId" TEXT NOT NULL,
    "stockBatchId" TEXT NOT NULL,
    "batchNumberSnapshot" TEXT NOT NULL,
    "expiryDateSnapshot" TIMESTAMP(3) NOT NULL,
    "qtyOut" DECIMAL(14,3) NOT NULL,
    "unitCostSnapshot" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosTransactionItemBatchAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosTransactionItemBatchAllocation_posTransactionItemId_idx" ON "PosTransactionItemBatchAllocation"("posTransactionItemId");

-- CreateIndex
CREATE INDEX "PosTransactionItemBatchAllocation_stockBatchId_idx" ON "PosTransactionItemBatchAllocation"("stockBatchId");

-- AddForeignKey
ALTER TABLE "PosTransactionItemBatchAllocation" ADD CONSTRAINT "PosTransactionItemBatchAllocation_posTransactionItemId_fkey" FOREIGN KEY ("posTransactionItemId") REFERENCES "PosTransactionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTransactionItemBatchAllocation" ADD CONSTRAINT "PosTransactionItemBatchAllocation_stockBatchId_fkey" FOREIGN KEY ("stockBatchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
