import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { can, requirePermission } from "@/lib/rbac";
import { getProductDetail } from "@/services/product-service";
import { listActiveCategories } from "@/services/category-service";
import { listActiveUnits } from "@/services/unit-service";
import { listActiveBranches } from "@/services/branch-service";
import { toPlainJSON } from "@/lib/serialize";
import { ProductForm } from "../product-form";
import { BranchPriceSection } from "./branch-price-section";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("master.read");
  const { id } = await params;
  const canManage = can(user, "master.manage");

  const product = await getProductDetail(user.companyId, id);
  if (!product) notFound();

  const [categories, units, branches] = await Promise.all([
    listActiveCategories(user.companyId),
    listActiveUnits(user.companyId),
    listActiveBranches(user.companyId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{product.name}</h1>
        <p className="mt-1 text-sm text-slate-600">SKU: {product.sku}</p>
      </div>

      {canManage ? (
        <ProductForm
          categories={categories}
          units={units}
          product={toPlainJSON(product)}
        />
      ) : (
        <ReadOnlyProductSummary product={product} />
      )}

      <BranchPriceSection
        productId={product.id}
        branchPrices={toPlainJSON(product.branchPrices)}
        branchOptions={branches}
        canManage={canManage}
      />
    </div>
  );
}

type ProductDetail = Prisma.ProductGetPayload<{
  include: { category: true; baseUnit: true };
}>;

function ReadOnlyProductSummary({ product }: { product: ProductDetail }) {
  return (
    <section className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
      <Info label="Kategori" value={product.category.name} />
      <Info label="Satuan Dasar" value={product.baseUnit.name} />
      <Info label="Nama Generik" value={product.genericName || "-"} />
      <Info label="Merek" value={product.brandName || "-"} />
      <Info label="Wajib Resep" value={product.requiresPrescription ? "Ya" : "Tidak"} />
      <Info label="Obat Terkontrol" value={product.isControlled ? "Ya" : "Tidak"} />
      <Info label="Status" value={product.isActive ? "Aktif" : "Nonaktif"} />
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-0.5 text-sm text-slate-900">{value}</p>
    </div>
  );
}
