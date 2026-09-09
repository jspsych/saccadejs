/**
 * Stage the ONNX eye-embedding models into `static/models/`, so the site serves them from its
 * own origin:
 *
 *   /models/eye-embedding/<version>/eye_embedding.onnx  (every published version)
 *   /models/eye-embedding/<version>/model.json          (that version's registry entry)
 *   /models/eye_embedding.onnx                          (the newest, unversioned; legacy)
 *
 * **Every** served release is staged, not just the newest: a versioned URL that stops
 * resolving is worse than never having published it, because it is already written into
 * someone's methods section. Model files are ~20 MB on GitHub's own infrastructure, so
 * keeping them all is cheap; policy is to keep every version up indefinitely.
 *
 * The versioned path is the one to hand anyone. The unversioned path is whatever the last
 * deploy put there -- the "resolve latest at runtime" trap, where a model that changes under
 * a running study splits the dataset silently. It stays only so links already in the wild
 * keep working.
 *
 * Layout in `packages/core/models/`: the current model sits at the top level as
 * `eye_embedding.onnx`, because `packageModelUrl()` in assets.ts resolves exactly that path
 * for bundler users. Superseded versions move into `<version>/eye_embedding.onnx`, and each
 * release's `file` in releases.json names wherever its bytes actually live. So a new release
 * means: move the outgoing model down into its version directory, drop the new one at the
 * top level, and update both `file` fields. Forget either and this script fails loudly on a
 * missing file or a hash mismatch, rather than quietly dropping a version off the site.
 *
 * Copying rather than symlinking is deliberate: Docusaurus's static-file copy does not follow
 * symlinks on every platform. Destination is gitignored.
 *
 * Run automatically by `predev`/`prebuild`. Idempotent, and it verifies each release's
 * recorded sha256 on every build -- a corrupted or swapped model fails here rather than
 * silently producing wrong gaze in the browser.
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

const served = registry.releases.filter((r) => r.served);
if (served.length === 0) {
  console.warn("[copy-model] no served release in releases.json — nothing to stage.");
  process.exit(0);
}

const newest = served.at(-1);
mkdirSync(staticDir, { recursive: true });

let staged = 0;
let skipped = 0;

for (const release of served) {
  const src = resolve(modelsDir, release.file);

  if (!existsSync(src)) {
    if (release === newest) {
      // Not fatal for the newest: every page but the live demo works without a model, and the
      // demo tells the visitor it is missing rather than crashing. A fresh clone that has not
      // fetched the model should still be able to build the docs.
      console.warn(
        `[copy-model] ${src} not found — building the site without the model.\n` +
          "[copy-model] The live demo will not run until the core package's models/ exists.",
      );
      skipped += 1;
      continue;
    }
    // A previously published version going missing is different: its URL is already in
    // someone's methods section, and this build would quietly take it down.
    throw new Error(
      `[copy-model] ${registry.id}@${release.version} is marked served but ${release.file} ` +
        "is missing. Published URLs must keep resolving: restore the file, or set " +
        "`served: false` deliberately and say where it went.",
    );
  }

  const srcStat = statSync(src);
  if (srcStat.size !== release.bytes) {
    throw new Error(
      `[copy-model] ${release.file} is ${srcStat.size} bytes, but releases.json records ` +
        `${release.bytes} for ${registry.id}@${release.version}. Update the registry or ` +
        "restore the file; do not ship a model the registry does not describe.",
    );
  }

  const digest = createHash("sha256").update(readFileSync(src)).digest("hex");
  if (digest !== release.sha256) {
    throw new Error(
      `[copy-model] sha256 mismatch for ${registry.id}@${release.version}.\n` +
        `  expected ${release.sha256}\n  actual   ${digest}\n` +
        "A new model needs a new version in releases.json, not a silent swap.",
    );
  }

  const versionDir = resolve(staticDir, registry.id, release.version);
  mkdirSync(versionDir, { recursive: true });

  // Every version gets its versioned path; only the newest also takes the legacy one.
  const targets = [resolve(versionDir, "eye_embedding.onnx")];
  if (release === newest) targets.push(resolve(staticDir, "eye_embedding.onnx"));

  for (const dest of targets) {
    if (existsSync(dest)) {
      const d = statSync(dest);
      if (d.size === srcStat.size && d.mtimeMs >= srcStat.mtimeMs) continue;
    }
    copyFileSync(src, dest);
  }

  writeFileSync(
    resolve(versionDir, "model.json"),
    JSON.stringify({ id: registry.id, ...release }, null, 2) + "\n",
  );
  staged += 1;
}

const versions = served
  .filter((r) => existsSync(resolve(modelsDir, r.file)))
  .map((r) => r.version)
  .join(", ");
console.log(
  staged === 0
    ? `[copy-model] nothing staged (${skipped} release(s) missing their file).`
    : `[copy-model] staged ${staged} version(s) of ${registry.id} — ${versions} — each sha256 verified.`,
);
