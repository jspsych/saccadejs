/**
 * Bootstrap shim for the root `build` and `test` scripts.
 *
 * While `packages/` is empty (before the first plugin/adapter is contributed), both
 * `npm run build --workspaces` and `jest` hard-error ("No workspaces found!" / no projects
 * matched). This wrapper makes those scripts a clean no-op until at least one package exists,
 * so CI stays green on a tooling-only repo. Once any package under `packages/` has a
 * package.json it delegates to the real command — identical to jspsych-contrib's behavior —
 * forwarding any extra CLI args (e.g. `--ci --coverage --maxWorkers=2`).
 *
 * Usage: node scripts/ci-run.mjs <build|test> [...args]
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [, , kind, ...rest] = process.argv;

const packagesDir = fileURLToPath(new URL("../packages/", import.meta.url));
const hasPackages =
  existsSync(packagesDir) &&
  readdirSync(packagesDir).some((entry) =>
    existsSync(fileURLToPath(new URL(`../packages/${entry}/package.json`, import.meta.url))),
  );

if (!hasPackages) {
  console.log(`No packages in /packages yet — skipping ${kind}.`);
  process.exit(0);
}

/**
 * Build order matters: `npm run build --workspaces` runs packages alphabetically, and the
 * extension and plugins import the core's built `dist/` types. Sort the workspace packages
 * topologically by their in-repo dependencies (dependencies, devDependencies,
 * peerDependencies) and build them one at a time in that order.
 */
function buildOrder() {
  const pkgs = readdirSync(packagesDir)
    .map((dir) => {
      const file = fileURLToPath(new URL(`../packages/${dir}/package.json`, import.meta.url));
      return existsSync(file) ? { dir, ...JSON.parse(readFileSync(file, "utf8")) } : null;
    })
    .filter(Boolean);
  const names = new Set(pkgs.map((p) => p.name));
  const deps = (p) =>
    Object.keys({ ...p.dependencies, ...p.devDependencies, ...p.peerDependencies }).filter((n) =>
      names.has(n),
    );
  const order = [];
  const seen = new Set();
  const visit = (p, stack = new Set()) => {
    if (seen.has(p.name)) return;
    if (stack.has(p.name)) throw new Error(`workspace dependency cycle at ${p.name}`);
    stack.add(p.name);
    for (const d of deps(p))
      visit(
        pkgs.find((q) => q.name === d),
        stack,
      );
    seen.add(p.name);
    order.push(p.name);
  };
  for (const p of pkgs) visit(p);
  return order;
}

let result = { status: 0 };
if (kind === "build") {
  for (const name of buildOrder()) {
    console.log(`\n▶ build ${name}`);
    result = spawnSync("npm", ["run", "build", "--if-present", "-w", name, ...rest], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (result.status !== 0) break;
  }
} else {
  result = spawnSync("jest", rest, { stdio: "inherit", shell: process.platform === "win32" });
}

process.exit(result.status ?? 1);
