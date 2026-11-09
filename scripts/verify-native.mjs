import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

// Explicit opt-in proof against an already-running isolated reader, not site data.
const target = process.argv[2];
assert(target, "Pass an explicit local native article URL.");
const url = new URL(target);
assert(
  ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
  "Use an isolated local reader.",
);
const response = await fetch(url);
assert.equal(response.status, 200);
const html = await response.text();
const articleHtml = html.match(/<article[^>]*>([\s\S]*?)<\/article>/)?.[1];
assert(
  articleHtml && articleHtml.length > 500,
  "Article body must be in initial HTML.",
);
assert(
  articleHtml.includes("<img "),
  "Proof article must contain a native image.",
);
assert(!articleHtml.includes("<iframe"), "Do not frame the article.");

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url.href);
  await page.locator("article img").first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const image = document.querySelector("article img");
    return image?.complete && image.naturalWidth > 0;
  });
  const evidence = await page.evaluate(() => ({
    title: document.querySelector("article h1")?.textContent,
    articleTextLength: document.querySelector("article")?.textContent?.length,
    articleLinks: document.querySelectorAll("article a").length,
    images: [...document.querySelectorAll("article img")].map((i) => ({
      loaded: i.complete && i.naturalWidth > 0,
      alt: i.alt,
    })),
    frames: document.querySelectorAll("iframe").length,
    canonical: document
      .querySelector('link[rel="canonical"]')
      ?.getAttribute("href"),
    record: document
      .querySelector('link[rel="site.standard.document"]')
      ?.getAttribute("href"),
  }));
  assert.equal(evidence.frames, 0);
  assert(evidence.articleTextLength > 500 && evidence.articleLinks > 0);
  assert.deepEqual(errors, []);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/native-proof.png",
    fullPage: true,
  });
  console.log(
    JSON.stringify(
      { url: url.href, initialHtml: true, ...evidence, pageErrors: errors },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
