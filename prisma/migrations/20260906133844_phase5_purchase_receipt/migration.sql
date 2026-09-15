-- CreateTable
CREATE TABLE "PurchaseReceipt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "supplierInvoiceNumber" TEXT NOT NULL,
    "supplierInvoiceDate" TIMESTAMP(3) NOT NULL,
    "receivedDate" TIMESTAMP(3) NOT NULL,
    "status" "StockDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReceiptItem" (
    "id" TEXT NOT NULL,
    "purchaseReceiptId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "batchNumber" TEXT,
    "expiryDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseReceipt_branchId_idx" ON "PurchaseReceipt"("branchId");

-- CreateIndex
CREATE INDEX "PurchaseReceipt_supplierId_idx" ON "PurchaseReceipt"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseReceipt_status_idx" ON "PurchaseReceipt"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceipt_companyId_documentNumber_key" ON "PurchaseReceipt"("companyId", "documentNumber");

-- CreateIndex
CREATE INDEX "PurchaseReceiptItem_purchaseReceiptId_idx" ON "PurchaseReceiptItem"("purchaseReceiptId");

-- CreateIndex
CREATE INDEX "PurchaseReceiptItem_productId_idx" ON "PurchaseReceiptItem"("productId");

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptItem" ADD CONSTRAINT "PurchaseReceiptItem_purchaseReceiptId_fkey" FOREIGN KEY ("purchaseReceiptId") REFERENCES "PurchaseReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptItem" ADD CONSTRAINT "PurchaseReceiptItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptItem" ADD CONSTRAINT "PurchaseReceiptItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
