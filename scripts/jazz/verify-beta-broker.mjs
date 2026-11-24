import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Read-only by default. The optional output must be new; installed SDK files
// are updated through the reviewed pnpm patch, never by this verification tool.
const [source, option, destination, ...extra] = process.argv.slice(2);
if (
  !source ||
  extra.length ||
  (option !== undefined && (option !== "--output" || !destination))
)
  throw new Error(
    "Pass a Jazz source checkout, optionally followed by --output NEW_FILE",
  );
const root = fileURLToPath(new URL("../../", import.meta.url));
const commit = "c73bed9a4e868071f10de490ae3f753f3081772f";
const helper = execFileSync(
  "git",
  ["-C", resolve(source), "show", commit + ":dev/artifacts/wasm-glue-abi.mjs"],
  { encoding: "utf8" },
);
const { assertWasmGlueInstantiates, assertWasmGlueAbi } = await import(
  "data:text/javascript;base64," + Buffer.from(helper).toString("base64")
);
const consumer = createRequire(join(root, "packages/local-first/package.json"));
const sdkFile = consumer.resolve("jazz-tools/package.json");
const sdk = dirname(sdkFile);
const require = createRequire(sdkFile);
assert.equal(consumer("jazz-tools/package.json").version, "2.0.0-beta.1");
assert.equal(require("jazz-wasm/package.json").version, "2.0.0-beta.1");
assert.equal(require("esbuild/package.json").version, "0.27.7");
const { build, transform } = require("esbuild");
const wasmEntry = require.resolve("jazz-wasm");
const wasm = await readFile(join(dirname(wasmEntry), "jazz_wasm_bg.wasm"));
const configuration = {
  absWorkingDir: root,
  stdin: {
    contents: [
      'import { installJazzBrokerWorker } from "./jazz-broker-worker-core.js";',
      "installJazzBrokerWorker();",
      "export { installJazzBrokerWorker };",
    ].join("\n"),
    resolveDir: join(sdk, "dist/worker"),
    sourcefile: "beta-broker-entry.js",
  },
  write: false,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  legalComments: "none",
  alias: { "jazz-wasm": wasmEntry },
};
const readable = await build(configuration);
await assertWasmGlueInstantiates(wasm, readable.outputFiles[0].text);
// Without identifier minification in the first pass, esbuild embeds working-
// directory-relative module paths as lazy initializer names. A second pass
// preserves those names, making the artifact depend on the build machine.
const bundled = await build({ ...configuration, minifyIdentifiers: true });
const minified = await transform(bundled.outputFiles[0].text, {
  format: "esm",
  target: "es2022",
  legalComments: "none",
  minify: true,
});
assertWasmGlueAbi(wasm, minified.code);
const independent = await build({
  ...configuration,
  absWorkingDir: sdk,
  minifyIdentifiers: true,
});
const relocated = await transform(independent.outputFiles[0].text, {
  format: "esm",
  target: "es2022",
  legalComments: "none",
  minify: true,
});
assert.ok(
  relocated.code === minified.code,
  "Broker rebuild must be independent of working directory",
);
if (destination)
  await writeFile(resolve(destination), minified.code, { flag: "wx" });
else
  for (const path of [
    "packages/local-first",
    "apps/finance",
    "apps/clipper/apps/web",
    "apps/clipper/apps/extension",
  ]) {
    const installed = createRequire(join(root, path, "package.json"));
    const directory = dirname(installed.resolve("jazz-tools/package.json"));
    assert.equal(installed("jazz-tools/package.json").version, "2.0.0-beta.1");
    assert.ok(
      (await readFile(
        join(directory, "dist/worker/jazz-broker-worker.js"),
        "utf8",
      )) === minified.code,
      "Installed broker differs from the readable patched modules: " + path,
    );
  }
console.log(
  "Beta broker: native WASM instantiation, minified ABI and reproducible build verified",
);
