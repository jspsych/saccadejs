/**
 * Stage the ONNX eye-embedding model into `static/models/` so the site serves it from its
 * own origin, at two paths:
 *
 *   /models/eye_embedding.onnx                        (unversioned; legacy, mutable)
 *   /models/eye-embedding/<version>/eye_embedding.onnx (versioned; safe to cite)
 *   /models/eye-embedding/<version>/model.json         (that version's registry entry)
 *
 * The versioned path is the one to hand anyone: the unversioned path is whatever the last
 * deploy put there, which is the "resolve latest at runtime" trap -- a model that changes
 * under a running study splits the dataset silently. It stays only so links already in the
 * wild keep working.
 *
 * IMPORTANT: GitHub Pages serves only the current build. A versioned URL lives exactly as
 * long as that version's bytes are committed under `packages/core/models/`. Retiring a
 * version from the repo takes its URL down with it, so give it a durable home (npm/jsDelivr,
 * or a DOI) and flip `served` in releases.json before you do.
 *
 * The model is ~20 MB and committed once, in `packages/core/models/`. Copying rather than
 * symlinking is deliberate: Docusaurus's static-file copy does not follow symlinks on every
 * platform. Destination is gitignored (`docs/static/models/*.onnx`).
 *
 * Run automatically by `predev`/`prebuild`. Idempotent, and it verifies the sha256 recorded
 * in releases.json on every copy -- a corrupted or swapped model fails the build here rather
 * than silently producing wrong gaze in the browser.
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const modelsDir = resolve(here, "../../packages/core/models");
const registryPath = resolve(modelsDir, "releases.json");
const staticDir = resolve(here, "../static/models");

const registry = JSON.parse(readFileSync(registryPath, "utf8"));

// Mirror the registry into the site source first, before any early return: the releases
// page and the live demo both import it, so it has to exist even on a checkout with no
// model file (a fresh clone, or a docs-only PR).
const genDir = resolve(here, "../src/generated");
mkdirSync(genDir, { recursive: true });
writeFileSync(resolve(genDir, "model-releases.json"), JSON.stringify(registry, null, 2) + "\n");

const current = registry.releases.filter((r) => r.served).at(-1);
if (!current) {
  console.warn("[copy-model] no served release in releases.json — nothing to stage.");
  process.exit(0);
}

const src = resolve(modelsDir, current.file);
if (!existsSync(src)) {
  // Not fatal: every page but the live demo works without the model, and the demo tells the
  // visitor it is missing rather than crashing.
  console.warn(
    `[copy-model] ${src} not found — building the site without the model.\n` +
      "[copy-model] The live demo will not run until the core package's models/ directory exists.",
  );
  process.exit(0);
}

const srcStat = statSync(src);
if (srcStat.size !== current.bytes) {
  throw new Error(
    `[copy-model] ${current.file} is ${srcStat.size} bytes, but releases.json records ` +
      `${current.bytes} for ${registry.id}@${current.version}. Update the registry or ` +
      "restore the file; do not ship a model the registry does not describe.",
  );
}

const digest = createHash("sha256").update(readFileSync(src)).digest("hex");
if (digest !== current.sha256) {
  throw new Error(
    `[copy-model] sha256 mismatch for ${registry.id}@${current.version}.\n` +
      `  expected ${current.sha256}\n  actual   ${digest}\n` +
      "A new model needs a new version in releases.json, not a silent swap.",
  );
}

const versionDir = resolve(staticDir, registry.id, current.version);
mkdirSync(versionDir, { recursive: true });
mkdirSync(staticDir, { recursive: true });

const targets = [resolve(versionDir, current.file), resolve(staticDir, current.file)];
let copied = 0;
for (const dest of targets) {
  if (existsSync(dest)) {
    const d = statSync(dest);
    if (d.size === srcStat.size && d.mtimeMs >= srcStat.mtimeMs) continue;
  }
  copyFileSync(src, dest);
  copied += 1;
}

// The per-version manifest, so anyone holding the URL can check what they have.
writeFileSync(
  resolve(versionDir, "model.json"),
  JSON.stringify({ id: registry.id, ...current }, null, 2) + "\n",
);

const mb = (srcStat.size / 1e6).toFixed(1);
console.log(
  copied === 0
    ? `[copy-model] ${registry.id}@${current.version} already staged (sha256 verified).`
    : `[copy-model] staged ${registry.id}@${current.version} (${mb} MB, sha256 verified) ` +
        `to /models/${registry.id}/${current.version}/ and /models/.`,
);
