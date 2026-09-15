import { z } from "zod";

export const productFormSchema = z
  .object({
    sku: z.string().trim().min(1, "SKU wajib diisi."),
    barcode: z.string().trim().optional(),
    name: z.string().trim().min(1, "Nama produk wajib diisi."),
    genericName: z.string().trim().optional(),
    brandName: z.string().trim().optional(),
    categoryId: z.string().min(1, "Kategori wajib dipilih."),
    baseUnitId: z.string().min(1, "Satuan dasar wajib dipilih."),
    defaultSellingPrice: z.number().min(0, "Harga jual tidak boleh negatif."),
    defaultMinStock: z.number().min(0, "Stok minimum tidak boleh negatif."),
    requiresPrescription: z.boolean(),
    isControlled: z.boolean(),
    isActive: z.boolean(),
    notes: z.string().trim().optional(),
    unitConversions: z.array(
      z.object({
        unitId: z.string().min(1, "Satuan wajib dipilih."),
        conversionFactor: z
          .number()
          .positive("Faktor konversi harus lebih besar dari 0."),
      }),
    ),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    data.unitConversions.forEach((conversion, index) => {
      if (conversion.unitId === data.baseUnitId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Satuan konversi tidak boleh sama dengan satuan dasar.",
          path: ["unitConversions", index, "unitId"],
        });
      }
      if (seen.has(conversion.unitId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Satuan konversi tidak boleh duplikat.",
          path: ["unitConversions", index, "unitId"],
        });
      }
      seen.add(conversion.unitId);
    });
  });

export type ProductFormValues = z.infer<typeof productFormSchema>;

export const productBranchPriceFormSchema = z.object({
  branchId: z.string().min(1, "Cabang wajib dipilih."),
  price: z.coerce.number().min(0, "Harga tidak boleh negatif."),
  effectiveDate: z.string().trim().optional(),
  isActive: z.boolean(),
});

export type ProductBranchPriceFormValues = z.infer<
  typeof productBranchPriceFormSchema
>;
