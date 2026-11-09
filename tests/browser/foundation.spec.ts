import { test, expect } from "@playwright/test";

test("the homepage embeds the apps and keeps writing native", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    /^https:\/\/(clipper|finance)\.delightfullabs\.com\//,
    (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html><body></body></html>",
      }),
  );
  await page.goto("/");
  const frames = page.locator("main iframe");
  await expect(frames).toHaveCount(2);
  for (const [name, host] of [
    ["Clipper", "clipper"],
    ["Finance", "finance"],
  ]) {
    const frame = page.getByTitle(name, { exact: true });
    await expect(frame).toHaveAttribute(
      "src",
      `https://${host}.delightfullabs.com/`,
    );
    expect((await frame.boundingBox())?.width).toBe(375);
    await expect(
      page.getByRole("link", { name: `Open ${name} in a new tab` }),
    ).toHaveAttribute("href", `https://${host}.delightfullabs.com/`);
  }
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
  await page.route(
    /^https:\/\/(clipper|finance)\.delightfullabs\.com\//,
    (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html><body></body></html>",
      }),
  );
  await page.goto("/");
  const boxes = await page.locator("main iframe").all();
  for (const frame of boxes) {
    const box = await frame.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(375);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  }
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
