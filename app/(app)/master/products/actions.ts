"use server";

import { revalidatePath } from "next/cache";
import { checkPermission } from "@/lib/rbac";
import { findAccessibleBranch } from "@/lib/rbac-core";
import {
  createProduct,
  createProductBranchPrice,
  getProductBranchPriceById,
  getProductDetail,
  setProductActive,
  setProductBranchPriceActive,
  updateProduct,
  updateProductBranchPrice,
} from "@/services/product-service";
import { recordAudit } from "@/services/audit-service";
import { actionErrorFromUnknown, actionSuccess, type ActionResult } from "@/lib/response";
import {
  productBranchPriceFormSchema,
  productFormSchema,
} from "./product-schema";

export async function createProductAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = productFormSchema.parse(input);
    const product = await createProduct({
      companyId: access.user.companyId,
      ...data,
    });

    await recordAudit({
      companyId: access.user.companyId,
      actorId: access.user.id,
      action: "CREATE",
      entityType: "Product",
      entityId: product.id,
      newValue: { sku: product.sku, name: product.name },
    });

    revalidatePath("/master/products");
    return actionSuccess({ id: product.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function updateProductAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = productFormSchema.parse(input);
    const before = await getProductDetail(access.user.companyId, id);
    if (!before) return { success: false, error: "Produk tidak ditemukan." };

    await updateProduct({ companyId: access.user.companyId, id, ...data });

    await recordAudit({
      companyId: access.user.companyId,
      actorId: access.user.id,
      action: "UPDATE",
      entityType: "Product",
      entityId: id,
      oldValue: {
        sku: before.sku,
        name: before.name,
        defaultSellingPrice: before.defaultSellingPrice.toString(),
        isActive: before.isActive,
      },
      newValue: {
        sku: data.sku,
        name: data.name,
        defaultSellingPrice: data.defaultSellingPrice,
        isActive: data.isActive,
      },
    });

    revalidatePath("/master/products");
    revalidatePath(`/master/products/${id}`);
    return actionSuccess({ id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function setProductActiveAction(
  id: string,
  isActive: boolean,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const before = await getProductDetail(access.user.companyId, id);
    if (!before) return { success: false, error: "Produk tidak ditemukan." };

    await setProductActive({ companyId: access.user.companyId, id, isActive });

    await recordAudit({
      companyId: access.user.companyId,
      actorId: access.user.id,
      action: isActive ? "ACTIVATE" : "DEACTIVATE",
      entityType: "Product",
      entityId: id,
      oldValue: { isActive: before.isActive },
      newValue: { isActive },
    });

    revalidatePath("/master/products");
    revalidatePath(`/master/products/${id}`);
    return actionSuccess({ id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

// ---------------------------------------------------------------------------
// Harga override per cabang
// ---------------------------------------------------------------------------

export async function createProductBranchPriceAction(
  productId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = productBranchPriceFormSchema.parse(input);

    const branch = await findAccessibleBranch(access.user, data.branchId);
    if (!branch) return { success: false, error: "Cabang tidak valid." };

    const product = await getProductDetail(access.user.companyId, productId);
    if (!product) return { success: false, error: "Produk tidak ditemukan." };

    const branchPrice = await createProductBranchPrice({
      productId,
      branchId: data.branchId,
      price: data.price,
      effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null,
      isActive: data.isActive,
    });

    await recordAudit({
      companyId: access.user.companyId,
      branchId: data.branchId,
      actorId: access.user.id,
      action: "CREATE",
      entityType: "ProductBranchPrice",
      entityId: branchPrice.id,
      newValue: { productId, branchId: data.branchId, price: data.price },
    });

    revalidatePath(`/master/products/${productId}`);
    return actionSuccess({ id: branchPrice.id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function updateProductBranchPriceAction(
  id: string,
  productId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const data = productBranchPriceFormSchema.parse(input);

    const branch = await findAccessibleBranch(access.user, data.branchId);
    if (!branch) return { success: false, error: "Cabang tidak valid." };

    const product = await getProductDetail(access.user.companyId, productId);
    if (!product) return { success: false, error: "Produk tidak ditemukan." };

    const before = await getProductBranchPriceById(productId, id);
    if (!before) return { success: false, error: "Data harga tidak ditemukan." };

    await updateProductBranchPrice({
      id,
      productId,
      branchId: data.branchId,
      price: data.price,
      effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null,
      isActive: data.isActive,
    });

    await recordAudit({
      companyId: access.user.companyId,
      branchId: data.branchId,
      actorId: access.user.id,
      action: "UPDATE",
      entityType: "ProductBranchPrice",
      entityId: id,
      oldValue: { price: before.price.toString(), isActive: before.isActive },
      newValue: { price: data.price, isActive: data.isActive },
    });

    revalidatePath(`/master/products/${productId}`);
    return actionSuccess({ id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}

export async function setProductBranchPriceActiveAction(
  id: string,
  productId: string,
  isActive: boolean,
): Promise<ActionResult<{ id: string }>> {
  const access = await checkPermission("master.manage");
  if (!access.ok) return { success: false, error: access.error };

  try {
    const product = await getProductDetail(access.user.companyId, productId);
    if (!product) return { success: false, error: "Produk tidak ditemukan." };

    const before = await getProductBranchPriceById(productId, id);
    if (!before) return { success: false, error: "Data harga tidak ditemukan." };

    await setProductBranchPriceActive({ id, productId, isActive });

    await recordAudit({
      companyId: access.user.companyId,
      actorId: access.user.id,
      action: isActive ? "ACTIVATE" : "DEACTIVATE",
      entityType: "ProductBranchPrice",
      entityId: id,
      oldValue: { isActive: before.isActive },
      newValue: { isActive },
    });

    revalidatePath(`/master/products/${productId}`);
    return actionSuccess({ id });
  } catch (error) {
    return actionErrorFromUnknown(error);
  }
}
