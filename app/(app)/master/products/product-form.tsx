"use client";

import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Prisma } from "@prisma/client";
import { productFormSchema, type ProductFormValues } from "./product-schema";
import { createProductAction, updateProductAction } from "./actions";

type ProductDetail = Prisma.ProductGetPayload<{
  include: {
    barcodes: true;
    unitConversions: { include: { unit: true } };
  };
}>;

type CategoryOption = { id: string; name: string };
type UnitOption = { id: string; name: string; symbol: string | null };

function toFormValues(product?: ProductDetail | null): ProductFormValues {
  if (!product) {
    return {
      sku: "",
      barcode: "",
      name: "",
      genericName: "",
      brandName: "",
      categoryId: "",
      baseUnitId: "",
      defaultSellingPrice: 0,
      defaultMinStock: 0,
      requiresPrescription: false,
      isControlled: false,
      isActive: true,
      notes: "",
      unitConversions: [],
    };
  }

  return {
    sku: product.sku,
    barcode: product.barcodes[0]?.barcode ?? "",
    name: product.name,
    genericName: product.genericName ?? "",
    brandName: product.brandName ?? "",
    categoryId: product.categoryId,
    baseUnitId: product.baseUnitId,
    defaultSellingPrice: Number(product.defaultSellingPrice.toString()),
    defaultMinStock: Number(product.defaultMinStock.toString()),
    requiresPrescription: product.requiresPrescription,
    isControlled: product.isControlled,
    isActive: product.isActive,
    notes: product.notes ?? "",
    unitConversions: product.unitConversions.map((uc) => ({
      unitId: uc.unitId,
      conversionFactor: Number(uc.conversionFactor.toString()),
    })),
  };
}

export function ProductForm({
  categories,
  units,
  product,
}: {
  categories: CategoryOption[];
  units: UnitOption[];
  product?: ProductDetail | null;
}) {
  const router = useRouter();
  const isEdit = !!product;

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: toFormValues(product),
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "unitConversions",
  });

  async function onSubmit(values: ProductFormValues) {
    const result = isEdit
      ? await updateProductAction(product.id, values)
      : await createProductAction(values);

    if (!result.success) {
      toast.error(result.error);
      return;
    }

    toast.success("Produk berhasil disimpan.");
    router.push(`/master/products/${result.data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
      <section className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <Field label="SKU" error={errors.sku?.message}>
          <input
            {...register("sku")}
            disabled={isSubmitting}
            className={inputClass}
          />
        </Field>

        <Field label="Barcode (opsional)" error={errors.barcode?.message}>
          <input
            {...register("barcode")}
            disabled={isSubmitting}
            className={inputClass}
          />
        </Field>

        <Field label="Nama Produk" error={errors.name?.message}>
          <input
            {...register("name")}
            disabled={isSubmitting}
            className={inputClass}
          />
        </Field>

        <Field label="Nama Generik (opsional)" error={errors.genericName?.message}>
          <input
            {...register("genericName")}
            disabled={isSubmitting}
            className={inputClass}
          />
        </Field>

        <Field label="Merek (opsional)" error={errors.brandName?.message}>
          <input
            {...register("brandName")}
            disabled={isSubmitting}
            className={inputClass}
          />
        </Field>

        <Field label="Kategori" error={errors.categoryId?.message}>
          <select {...register("categoryId")} disabled={isSubmitting} className={inputClass}>
            <option value="">Pilih kategori</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Satuan Dasar" error={errors.baseUnitId?.message}>
          <select {...register("baseUnitId")} disabled={isSubmitting} className={inputClass}>
            <option value="">Pilih satuan dasar</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.symbol ? ` (${u.symbol})` : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Harga Jual Default (Rp)" error={errors.defaultSellingPrice?.message}>
          <input
            type="number"
            min={0}
            step="1"
            {...register("defaultSellingPrice", { valueAsNumber: true })}
            disabled={isSubmitting}
            className={inputClass}
          />
        </Field>

        <Field label="Stok Minimum Default" error={errors.defaultMinStock?.message}>
          <input
            type="number"
            min={0}
            step="1"
            {...register("defaultMinStock", { valueAsNumber: true })}
            disabled={isSubmitting}
            className={inputClass}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Catatan (opsional)" error={errors.notes?.message}>
            <textarea
              {...register("notes")}
              disabled={isSubmitting}
              rows={2}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-6 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" {...register("requiresPrescription")} disabled={isSubmitting} />
            Wajib resep (requiresPrescription)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" {...register("isControlled")} disabled={isSubmitting} />
            Obat terkontrol (isControlled)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" {...register("isActive")} disabled={isSubmitting} />
            Aktif
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Konversi Satuan
          </h3>
          <button
            type="button"
            onClick={() => append({ unitId: "", conversionFactor: 1 })}
            disabled={isSubmitting}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            + Tambah Konversi
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Faktor konversi dihitung relatif terhadap satuan dasar. Mis. jika
          satuan dasar Tablet dan Strip = 10, artinya 1 Strip = 10 Tablet.
        </p>

        <div className="mt-3 flex flex-col gap-2">
          {fields.length === 0 && (
            <p className="text-sm text-slate-400">Belum ada konversi satuan.</p>
          )}
          {fields.map((field, index) => (
            <div key={field.id} className="flex items-start gap-2">
              <div className="flex-1">
                <select
                  {...register(`unitConversions.${index}.unitId` as const)}
                  disabled={isSubmitting}
                  className={inputClass}
                >
                  <option value="">Pilih satuan</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                {errors.unitConversions?.[index]?.unitId && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.unitConversions[index]?.unitId?.message}
                  </p>
                )}
              </div>
              <div className="w-40">
                <input
                  type="number"
                  min={0}
                  step="0.0001"
                  placeholder="Faktor"
                  {...register(`unitConversions.${index}.conversionFactor` as const, {
                    valueAsNumber: true,
                  })}
                  disabled={isSubmitting}
                  className={inputClass}
                />
                {errors.unitConversions?.[index]?.conversionFactor && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.unitConversions[index]?.conversionFactor?.message}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(index)}
                disabled={isSubmitting}
                className="rounded-md border border-slate-300 px-2.5 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50"
              >
                Hapus
              </button>
            </div>
          ))}
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          disabled={isSubmitting}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
        >
          Batal
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {isSubmitting ? "Menyimpan..." : "Simpan Produk"}
        </button>
      </div>
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60";

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
