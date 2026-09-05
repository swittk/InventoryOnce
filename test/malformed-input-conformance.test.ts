import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { decodeMalformedInputAssuranceManifest } from "./malformed-input-assurance.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const manifestPath = path.join(
  repositoryRoot,
  "formal/implementation-conformance/MALFORMED_INPUT_ASSURANCE.json"
);

/** Read one repository file referenced by machine malformed-input assurance. */
function source(relativePath: string): string {
  const resolved = path.resolve(repositoryRoot, relativePath);
  const relative = path.relative(repositoryRoot, resolved);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Malformed-input assurance path must stay inside the repository.");
  }
  return readFileSync(resolved, "utf8");
}

describe("malformed concrete input assurance manifest", () => {
  it("rejects assurance evidence paths that escape the repository", () => {
    expect(() => source("../outside-repository.txt")).toThrow(/stay inside the repository/i);
  });
  it("binds every malformed-input invariant to a live guard and negative behavior regression", () => {
    const manifest = decodeMalformedInputAssuranceManifest(
      JSON.parse(readFileSync(manifestPath, "utf8"))
    );
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.entries.length).toBeGreaterThan(0);
    expect(new Set(manifest.entries.map((entry) => entry.id)).size).toBe(
      manifest.entries.length
    );
    for (const entry of manifest.entries) {
      expect(entry.id.trim().length, `${entry.id}: id`).toBeGreaterThan(0);
      expect(entry.invariant.trim().length, `${entry.id}: invariant`).toBeGreaterThan(0);
      expect(entry.guards.length, `${entry.id}: guards`).toBeGreaterThan(0);
      expect(entry.behaviorEvidence.length, `${entry.id}: evidence`).toBeGreaterThan(0);
      for (const guard of entry.guards) {
        expect(guard.contains, `${entry.id}: guard marker`).toBeTruthy();
        expect(source(guard.file), `${entry.id}: ${guard.file}`).toContain(guard.contains);
      }
      for (const evidence of entry.behaviorEvidence) {
        expect(evidence.testTitle, `${entry.id}: test title`).toBeTruthy();
        const evidenceSource = source(evidence.file);
        expect(evidenceSource, `${entry.id}: ${evidence.file}`).toContain(evidence.testTitle);
        if (evidence.contains !== undefined) {
          expect(evidenceSource, `${entry.id}: behavior marker`).toContain(evidence.contains);
        }
      }
    }
  });
  it("rejects malformed manifest shape before traversal", () => {
    expect(() =>
      decodeMalformedInputAssuranceManifest({
        schemaVersion: 1,
        entries: [
          {
            id: "broken",
            invariant: "broken",
            guards: "not-an-array",
            behaviorEvidence: [],
          },
        ],
      })
    ).toThrow(/guard\/evidence arrays/i);
  });
});
