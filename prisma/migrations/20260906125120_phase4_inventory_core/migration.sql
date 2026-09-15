-- CreateEnum
CREATE TYPE "StockBatchStatus" AS ENUM ('AVAILABLE', 'QUARANTINED', 'BLOCKED', 'EXPIRED', 'DAMAGED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING_BALANCE', 'PURCHASE_RECEIPT', 'POS_SALE', 'SALES_RETURN', 'SUPPLIER_RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'STOCK_ADJUSTMENT_IN', 'STOCK_ADJUSTMENT_OUT', 'STOCK_OPNAME', 'VOID_REVERSAL', 'EXPIRED_WRITE_OFF', 'DAMAGED_WRITE_OFF');

-- CreateEnum
CREATE TYPE "StockDocumentStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdjustmentDirection" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "StockBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "receivedDate" TIMESTAMP(3) NOT NULL,
    "qtyOnHand" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL,
    "status" "StockBatchStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "productId" TEXT NOT NULL,
    "stockBatchId" TEXT NOT NULL,
    "movementType" "StockMovementType" NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "qtyIn" DECIMAL(14,3) NOT NULL,
    "qtyOut" DECIMAL(14,3) NOT NULL,
    "balanceAfter" DECIMAL(14,3) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "StockDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustmentItem" (
    "id" TEXT NOT NULL,
    "stockAdjustmentId" TEXT NOT NULL,
    "stockBatchId" TEXT NOT NULL,
    "direction" "AdjustmentDirection" NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAdjustmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockOpname" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "notes" TEXT,
    "status" "StockDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockOpname_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockOpnameItem" (
    "id" TEXT NOT NULL,
    "stockOpnameId" TEXT NOT NULL,
    "stockBatchId" TEXT NOT NULL,
    "systemQty" DECIMAL(14,3) NOT NULL,
    "countedQty" DECIMAL(14,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockOpnameItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockBatch_companyId_idx" ON "StockBatch"("companyId");

-- CreateIndex
CREATE INDEX "StockBatch_branchId_idx" ON "StockBatch"("branchId");

-- CreateIndex
CREATE INDEX "StockBatch_productId_idx" ON "StockBatch"("productId");

-- CreateIndex
CREATE INDEX "StockBatch_warehouseId_idx" ON "StockBatch"("warehouseId");

-- CreateIndex
CREATE INDEX "StockBatch_status_idx" ON "StockBatch"("status");

-- CreateIndex
CREATE INDEX "StockBatch_expiryDate_idx" ON "StockBatch"("expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "StockBatch_branchId_productId_batchNumber_key" ON "StockBatch"("branchId", "productId", "batchNumber");

-- CreateIndex
CREATE INDEX "StockMovement_companyId_idx" ON "StockMovement"("companyId");

-- CreateIndex
CREATE INDEX "StockMovement_branchId_idx" ON "StockMovement"("branchId");

-- CreateIndex
CREATE INDEX "StockMovement_productId_idx" ON "StockMovement"("productId");

-- CreateIndex
CREATE INDEX "StockMovement_stockBatchId_idx" ON "StockMovement"("stockBatchId");

-- CreateIndex
CREATE INDEX "StockMovement_movementType_idx" ON "StockMovement"("movementType");

-- CreateIndex
CREATE INDEX "StockMovement_occurredAt_idx" ON "StockMovement"("occurredAt");

-- CreateIndex
CREATE INDEX "StockMovement_referenceType_referenceId_idx" ON "StockMovement"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "StockAdjustment_branchId_idx" ON "StockAdjustment"("branchId");

-- CreateIndex
CREATE INDEX "StockAdjustment_status_idx" ON "StockAdjustment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustment_companyId_documentNumber_key" ON "StockAdjustment"("companyId", "documentNumber");

-- CreateIndex
CREATE INDEX "StockAdjustmentItem_stockAdjustmentId_idx" ON "StockAdjustmentItem"("stockAdjustmentId");

-- CreateIndex
CREATE INDEX "StockAdjustmentItem_stockBatchId_idx" ON "StockAdjustmentItem"("stockBatchId");

-- CreateIndex
CREATE INDEX "StockOpname_branchId_idx" ON "StockOpname"("branchId");

-- CreateIndex
CREATE INDEX "StockOpname_status_idx" ON "StockOpname"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StockOpname_companyId_documentNumber_key" ON "StockOpname"("companyId", "documentNumber");

-- CreateIndex
CREATE INDEX "StockOpnameItem_stockOpnameId_idx" ON "StockOpnameItem"("stockOpnameId");

-- CreateIndex
CREATE INDEX "StockOpnameItem_stockBatchId_idx" ON "StockOpnameItem"("stockBatchId");

-- AddForeignKey
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_stockBatchId_fkey" FOREIGN KEY ("stockBatchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentItem" ADD CONSTRAINT "StockAdjustmentItem_stockAdjustmentId_fkey" FOREIGN KEY ("stockAdjustmentId") REFERENCES "StockAdjustment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentItem" ADD CONSTRAINT "StockAdjustmentItem_stockBatchId_fkey" FOREIGN KEY ("stockBatchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockOpname" ADD CONSTRAINT "StockOpname_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockOpname" ADD CONSTRAINT "StockOpname_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockOpname" ADD CONSTRAINT "StockOpname_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockOpname" ADD CONSTRAINT "StockOpname_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockOpnameItem" ADD CONSTRAINT "StockOpnameItem_stockOpnameId_fkey" FOREIGN KEY ("stockOpnameId") REFERENCES "StockOpname"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockOpnameItem" ADD CONSTRAINT "StockOpnameItem_stockBatchId_fkey" FOREIGN KEY ("stockBatchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
