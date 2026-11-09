import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const root = new URL("../migration/open-thoughts/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", root), "utf8"),
);
assert.equal(manifest.schemaVersion, 1);
assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/);
assert.equal(manifest.sourceExport.copied, false);
assert.equal(
  manifest.posts.length,
  manifest.sourceExport.publicCollectionPosts,
);

const files = new Set();
for (const file of manifest.files) {
  assert(!files.has(file.file), `Duplicate preserved path: ${file.file}`);
  assert(
    /^(source|live)\//.test(file.file),
    `Unexpected preserved path: ${file.file}`,
  );
  const url = new URL(file.file, root);
  assert(
    url.href.startsWith(root.href),
    `Path outside migration directory: ${file.file}`,
  );
  const body = await readFile(url);
  assert.equal(body.length, file.bytes, `Size changed: ${file.file}`);
  assert.equal(
    createHash("sha256").update(body).digest("hex"),
    file.sha256,
    `Content changed: ${file.file}`,
  );
  files.add(file.file);
}

const slugs = new Set();
const atomIds = new Set();
for (const post of manifest.posts) {
  assert(!slugs.has(post.slug), `Duplicate post: ${post.slug}`);
  slugs.add(post.slug);
  assert(files.has(post.sourceFile), `Missing source: ${post.slug}`);
  assert(files.has(post.liveHtmlFile), `Missing live page: ${post.slug}`);
  assert.equal(post.legacyUrl, `${manifest.legacyOrigin}/blog/${post.slug}/`);
  assert.equal(post.nativePath, `/open-thoughts/${post.slug}/`);
  assert(!atomIds.has(post.legacyAtomId), `Duplicate Atom ID: ${post.slug}`);
  atomIds.add(post.legacyAtomId);
  const source = await readFile(new URL(post.sourceFile, root), "utf8");
  const frontmatter = source.split("---", 3)[1];
  assert(
    frontmatter.includes(`title: ${post.title}\n`),
    `Title mismatch: ${post.slug}`,
  );
  assert(
    frontmatter.includes(`date: ${post.publicDate}\n`),
    `Date mismatch: ${post.slug}`,
  );
  const html = await readFile(new URL(post.liveHtmlFile, root), "utf8");
  for (const id of [...post.legacyHeadingIds, ...post.legacyLandmarkIds]) {
    assert(
      html.includes(`id="${id}"`),
      `Missing legacy fragment ${id}: ${post.slug}`,
    );
  }
  const redirect = manifest.routePlan.articleRedirects.find(
    (row) => row.from === post.legacyUrl,
  );
  assert.equal(
    redirect?.to,
    `${manifest.intendedNativeOrigin}${post.nativeRecordPath ?? post.nativePath}`,
  );
}
assert.equal(manifest.routePlan.articleRedirects.length, manifest.posts.length);
console.log(
  `Verified ${manifest.posts.length} public posts and ${files.size} preserved files; redirect mappings are staged for cutover.`,
);

for (const asset of manifest.routePlan.assetFiles) {
  const body = await readFile(new URL(`../../${asset.publicFile}`, root));
  assert.equal(
    createHash("sha256").update(body).digest("hex"),
    asset.sha256,
    `Legacy asset changed: ${asset.publicFile}`,
  );
}
