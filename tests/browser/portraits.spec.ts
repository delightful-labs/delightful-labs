import { expect, test } from "@playwright/test";

// External apps are outside this portrait check; don't create real accounts in CI.
test.beforeEach(async ({ page }) => {
  await page.route(
    /^https:\/\/(clipper|finance)\.delightfullabs\.com\//,
    (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html><body></body></html>",
      }),
  );
});

test("renders Paper dithering and lets the visitor pause and resume", async ({
  page,
}) => {
  await page.goto("/");
  const portrait = page.getByRole("img", { name: "Portrait of Matt Derocher" });
  await expect(portrait.locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "Pause portrait rotation" }).click();
  const index = await portrait.getAttribute("data-portrait");
  await expect(
    page.getByRole("button", { name: "Play portrait rotation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play portrait rotation" }).click();
  await expect(portrait).not.toHaveAttribute("data-portrait", index!, {
    timeout: 10_000,
  });
});

test("renders a static dithered portrait with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const portrait = page.getByRole("img", { name: "Portrait of Matt Derocher" });
  await expect(portrait.locator("canvas")).toBeVisible();
  await expect(portrait).toHaveAttribute("data-portrait", "0");
  await expect(
    page.getByRole("button", { name: /portrait rotation/ }),
  ).toHaveCount(0);
});

test("retains a grayscale photo when WebGL is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (type === "webgl2") return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.goto("/");
  const image = page.locator(".portrait img");
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty("complete", true);
  await expect(image).toHaveCSS("filter", "grayscale(1)");
  await expect(
    page.getByRole("button", { name: /portrait rotation/ }),
  ).toHaveCount(0);
});
