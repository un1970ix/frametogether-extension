import { $ } from "bun";
import { getManifest } from "./src/manifest.ts";

await $`rm -rf dist`;
await $`mkdir -p dist/{background,content,popup,options}`;

const builds = [
  { entry: "./src/background/index.ts", out: "background/index.js" },
  { entry: "./src/content/index.ts", out: "content/index.js" },
  { entry: "./src/popup/index.ts", out: "popup/index.js" },
  { entry: "./src/options/index.ts", out: "options/index.js" },
];

for (const { entry, out } of builds) {
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: "./dist",
    target: "browser",
    format: "esm",
    naming: { entry: out.replace(/\.js$/, ".[ext]") },
  });

  if (!result.success) {
    console.error(`Failed to build ${entry}:`, result.logs);
    process.exit(1);
  }
}

await $`cp -r public/* dist/`;

const target = (process.env.TARGET || "chrome") as "chrome" | "firefox";
const manifest = getManifest(target);

await Bun.write("dist/manifest.json", JSON.stringify(manifest, null, 2));
console.log(`built for ${target}`);
