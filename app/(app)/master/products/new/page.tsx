import { requirePermission } from "@/lib/rbac";
import { listActiveCategories } from "@/services/category-service";
import { listActiveUnits } from "@/services/unit-service";
import { ProductForm } from "../product-form";

export default async function NewProductPage() {
  const user = await requirePermission("master.manage");

  const [categories, units] = await Promise.all([
    listActiveCategories(user.companyId),
    listActiveUnits(user.companyId),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Tambah Produk</h1>
        <p className="mt-1 text-sm text-slate-600">
          Harga override per cabang dapat ditambahkan setelah produk dibuat,
          pada halaman detail produk.
        </p>
      </div>

      <ProductForm categories={categories} units={units} />
    </div>
  );
}
