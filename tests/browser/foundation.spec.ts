import { test, expect } from "@playwright/test";

test("the foundation contains navigation without homepage copy", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("main")).toBeEmpty();
  await page.getByRole("link", { name: "Open Thoughts", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Open Thoughts" }),
  ).toBeVisible();
  await expect(
    page.getByText("No published posts.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("direct unknown article requests return 404", async ({ request }) => {
  const response = await request.get("/open-thoughts/unknown/");
  expect(response.status()).toBe(404);
});

test("navigation remains available at mobile width and via keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Home", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Open Thoughts", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/open-thoughts\/$/);
});
