import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Ask the exact call-graph helper whether Vitest executes one registration callback. */
function callbackExecutes(callee: string, insideSkippedSuite = false): boolean {
  const script = [
    'const { vitestCallbackExecutes } = require("./scripts/formal-implementation-vitest-semantics.cjs");',
    'process.stdout.write(JSON.stringify(vitestCallbackExecutes(process.argv[1], process.argv[2] === "true")));',
  ].join("\n");
  return JSON.parse(
    execFileSync(process.execPath, ["-e", script, callee, String(insideSkippedSuite)], {
      cwd: repositoryRoot,
      encoding: "utf8",
    })
  );
}

describe("formal call-graph Vitest callback semantics", () => {
  it("does not treat skipped test callbacks as executable", () => {
    expect(callbackExecutes("it.skip")).toBe(false);
    expect(callbackExecutes("test.skip")).toBe(false);
    expect(callbackExecutes("it", true)).toBe(false);
    expect(callbackExecutes("test", true)).toBe(false);
  });

  it("preserves describe.skip collection callbacks", () => {
    expect(callbackExecutes("describe.skip")).toBe(true);
    expect(callbackExecutes("describe.skip", true)).toBe(true);
    expect(callbackExecutes("it.each")).toBe(true);
  });
});
