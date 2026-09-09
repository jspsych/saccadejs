import releases from "../models/releases.json";
import { formatModelIdentity } from "../src/types";
import type { ModelIdentity } from "../src/types";

const id = (over: Partial<ModelIdentity> = {}): ModelIdentity => ({
  sha256: null,
  version: null,
  contract: null,
  url: null,
  resolvedFrom: "unverified",
  ...over,
});

describe("formatModelIdentity", () => {
  it("names a verified release", () => {
    expect(formatModelIdentity(id({ version: "1.0.0", resolvedFrom: "registry" }))).toBe(
      "eye-embedding@1.0.0",
    );
  });

  it("falls back to a hash prefix for a model it does not recognise", () => {
    // Someone running their own weights still gets a fingerprint rather than "unknown".
    expect(
      formatModelIdentity(
        id({ sha256: "f4669a8398d940f89a907e57df68332a", resolvedFrom: "hash-only" }),
      ),
    ).toBe("sha256:f4669a8398d9");
  });

  it("prefers the version even when a hash is present, since the version implies the match", () => {
    expect(
      formatModelIdentity(
        id({ version: "1.0.0", sha256: "c323131f7660", resolvedFrom: "registry" }),
      ),
    ).toBe("eye-embedding@1.0.0");
  });

  it("reports unverified rather than throwing when there is nothing to go on", () => {
    expect(formatModelIdentity(id())).toBe("unverified");
    expect(formatModelIdentity(null)).toBe("unverified");
    expect(formatModelIdentity(undefined)).toBe("unverified");
  });
});

describe("the shipped release registry", () => {
  it("gives every release a full sha256, a size and a contract", () => {
    expect(releases.releases.length).toBeGreaterThan(0);
    for (const r of releases.releases) {
      expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(r.bytes).toBeGreaterThan(0);
      expect(typeof r.contract).toBe("number");
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
      // Fingerprint of everything the runtime must implement. propose_version.py in
      // jspsych/eye-tracking compares against it to decide major vs minor; a release
      // published without one cannot be classified mechanically.
      expect(r.contractHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it("has no duplicate versions and no duplicate hashes", () => {
    const versions = releases.releases.map((r) => r.version);
    const hashes = releases.releases.map((r) => r.sha256);
    expect(new Set(versions).size).toBe(versions.length);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("keeps at least one release served, or the site has no model to publish", () => {
    expect(releases.releases.some((r) => r.served)).toBe(true);
  });
});
