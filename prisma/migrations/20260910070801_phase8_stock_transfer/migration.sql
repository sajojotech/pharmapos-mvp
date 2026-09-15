-- CreateEnum
CREATE TYPE "StockTransferStatus" AS ENUM ('DRAFT', 'REQUESTED', 'APPROVED', 'SHIPPED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceBranchId" TEXT NOT NULL,
    "destinationBranchId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "status" "StockTransferStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "shippedById" TEXT,
    "shippedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferItem" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sourceStockBatchId" TEXT NOT NULL,
    "sourceBatchNumberSnapshot" TEXT NOT NULL,
    "expiryDateSnapshot" TIMESTAMP(3) NOT NULL,
    "unitCostSnapshot" DECIMAL(14,2) NOT NULL,
    "qtyRequested" DECIMAL(14,3) NOT NULL,
    "qtyShipped" DECIMAL(14,3),
    "qtyReceived" DECIMAL(14,3),
    "destinationStockBatchId" TEXT,
    "discrepancyReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockTransferItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockTransfer_sourceBranchId_idx" ON "StockTransfer"("sourceBranchId");

-- CreateIndex
CREATE INDEX "StockTransfer_destinationBranchId_idx" ON "StockTransfer"("destinationBranchId");

-- CreateIndex
CREATE INDEX "StockTransfer_status_idx" ON "StockTransfer"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_companyId_documentNumber_key" ON "StockTransfer"("companyId", "documentNumber");

-- CreateIndex
CREATE INDEX "StockTransferItem_transferId_idx" ON "StockTransferItem"("transferId");

-- CreateIndex
CREATE INDEX "StockTransferItem_productId_idx" ON "StockTransferItem"("productId");

-- CreateIndex
CREATE INDEX "StockTransferItem_sourceStockBatchId_idx" ON "StockTransferItem"("sourceStockBatchId");

-- CreateIndex
CREATE INDEX "StockTransferItem_destinationStockBatchId_idx" ON "StockTransferItem"("destinationStockBatchId");

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_sourceBranchId_fkey" FOREIGN KEY ("sourceBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_destinationBranchId_fkey" FOREIGN KEY ("destinationBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_shippedById_fkey" FOREIGN KEY ("shippedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_sourceStockBatchId_fkey" FOREIGN KEY ("sourceStockBatchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_destinationStockBatchId_fkey" FOREIGN KEY ("destinationStockBatchId") REFERENCES "StockBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
