import { test, expect } from "@playwright/test";

test("root diarahkan ke halaman login saat belum autentikasi", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "PharmaPOS" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
});
