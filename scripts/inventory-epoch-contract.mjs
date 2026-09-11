import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { readAssuranceFile } from "./assurance-files.mjs";

/** Independently established pre-epoch proof head; historical proof bytes never authenticate themselves. */
export const EPOCH_PRIOR_PROOF_HEAD = "6983219e13295b8f6b073daefc3cbcd90b32ac35";
/** Prior fully certified PR head before Review 5176369856 added malformed-input admission guards. */
export const CURRENT_REVIEW_RUNTIME_PRIOR_HEAD = "1f4858d81b4ea6ef5d983b4e57fd680519c1e833";
/** Exact PR head reviewed by Full Review 5181962020. */
export const REVIEW_518196_RUNTIME_PRIOR_HEAD = "3763c9adad02eb7e9289f33f9917a72aec7d6e59";
/** Exact supported-domain runtime repair head for Full Review 5181962020. */
export const REVIEW_518196_RUNTIME_CERTIFIED_HEAD = "e22c095d73cf1777b62a0c71aa40d62cac6655dc";
/** Exact compact pin inherited by the reviewed predecessor before the Review 5181962020 runtime change. */
export const REVIEW_518196_PRIOR_COMPACT_PIN = "dbec89ec76f87e541cb8d6dff88c369426477fdd";
/** Exact compact-certified tree inherited by that predecessor. */
export const REVIEW_518196_PRIOR_COMPACT_CERTIFIED_HEAD = "f76ed2e8bb349846bb2083e1e09689cc285f9ed8";
/** Immutable runtime patch admitted by the Review 5181962020 transport. */
const REVIEW_518196_RUNTIME_PATCH = Object.freeze([
  Object.freeze({ file: "src/model.ts", patchSha256: "1db11b0ad497cff390141969cbb7df7dcb040ef47bc46b43973c5eba39af586e", priorSha256: "1ae3505cbf09e4b5ad003f14ab0363dca016d4c22dcfbae14926c978b5655ddc", currentSha256: "3edf36474afb9ba9fcfb825a3b6dcb4579fc0438963166caed7f588311ba71bc" }),
]);
/** Exact PR head reviewed by Full Review 5181132010. */
export const REVIEW_518113_RUNTIME_PRIOR_HEAD = "dc287206c21f7ab9f7a7fc111ac7b0312e22d1b8";
/** Exact supported-domain runtime repair head for Full Review 5181132010. */
export const REVIEW_518113_RUNTIME_CERTIFIED_HEAD = "ba2b74e99f4d2e51aa81553b7d9cacc7c10c586a";
/** Exact compact pin inherited by the reviewed predecessor before the Review 5181132010 runtime change. */
export const REVIEW_518113_PRIOR_COMPACT_PIN = "ceb527e08cc2f775644c28a469556dc924e73536";
/** Exact compact-certified tree inherited by that predecessor. */
export const REVIEW_518113_PRIOR_COMPACT_CERTIFIED_HEAD = "6509bc071b0a1b6169a6acaab551f3f4598869da";
/** Immutable runtime patch admitted by the Review 5181132010 transport. */
const REVIEW_518113_RUNTIME_PATCH = Object.freeze([
  Object.freeze({ file: "src/model.ts", patchSha256: "4b89e58eb31457bd607c923d714ebd71e332e43742e31c1ede23dbe46287be22", priorSha256: "9c4b76f4dd92022eaaee93552765d0b09898651aea3de6f4bffa6c41786b9dd6", currentSha256: "1ae3505cbf09e4b5ad003f14ab0363dca016d4c22dcfbae14926c978b5655ddc" }),
]);
/** Exact PR head reviewed by Full Review 5180096971. */
export const REVIEW_518009_RUNTIME_PRIOR_HEAD = "868d9295079148fb00e66ccf146b504fdcdee41e";
/** Exact runtime repair head independently full-certified for Full Review 5180096971. */
export const REVIEW_518009_RUNTIME_CERTIFIED_HEAD = "9dfd0a30cd032989c336b9292807113ae7ba9635";
/** Exact compact pin inherited by the reviewed predecessor before the Review 5180096971 runtime change. */
export const REVIEW_518009_PRIOR_COMPACT_PIN = "0f876778a85419ff2e1f58938af6231594c27f52";
/** Exact compact-certified tree inherited by that predecessor. */
export const REVIEW_518009_PRIOR_COMPACT_CERTIFIED_HEAD = "ff3368fd3bd92d665e6acdc2dcbae7d4b6bebf5b";
/** Immutable runtime patch admitted by the Review 5180096971 transport. */
const REVIEW_518009_RUNTIME_PATCH = Object.freeze([
  Object.freeze({ file: "src/commands.ts", patchSha256: "b74171f7c9bf6f1dc45cd60a1cc1570010dbba2e27dd741377f4b6f1021d859d", priorSha256: "fc2f48062ed4f83633798b01e2780381ab034db7f3a83011556e3a30053f7255", currentSha256: "28b89e567e0c3619d9d9bca10cc501342f31e4bea91645efda4f180c7cec0621" }),
]);
/** Exact PR head reviewed by Full Review 5178499142. */
export const REVIEW_517849_RUNTIME_PRIOR_HEAD = "a7d872d92a1f555e41e016592c9e840afad59bd6";
/** Exact product/assurance repair head independently full-certified for Full Review 5178499142. */
export const REVIEW_517849_RUNTIME_CERTIFIED_HEAD = "919d979811013e202ac01e4981b5d40bda53fc40";
/** Immutable two-file runtime patch admitted by the Review 5178499142 transport. */
const REVIEW_517849_RUNTIME_PATCH = Object.freeze([
  Object.freeze({ file: "src/events.ts", patchSha256: "00f9f60fcb96475cbe43b1fd653f47d29ac330b3b0e5a9bad980dbe77cd77654", priorSha256: "00155761783c7396c3c06e0756e70eb4fc96b6caa936ef7106344ab00d05705d", currentSha256: "c05db661416309c1d0ccc048d3bcc71a4a0381c16e4bb8cdbbcfe13041d4cc6f" }),
  Object.freeze({ file: "src/fungibility.ts", patchSha256: "195d7bca9b532cb773f399cb5849907da5a3d1d55d6a902bfd92a27b0d2e14ab", priorSha256: "3c6de2a463fb57aee417b442cfba202e13277cc0de80a49ee2020f12c65d47b7", currentSha256: "6f8c2e715b4edf11d8a2d466af44276cc8a55653de54b81af5fa342d59aff34f" }),
]);
/** Immediate compact-certified PR head reviewed before Full Review 5177225566. */
export const REVIEW_517722_RUNTIME_PRIOR_HEAD = "63f520f3bb21fcbb5da51c31ef9e5d327f8de51f";
/** Exact product/assurance repair head independently certified for Full Review 5177225566. */
export const REVIEW_517722_RUNTIME_CERTIFIED_HEAD = "3ea1626f6e42533b018bd532626c421e9f9aa2a9";
/** Immutable compact certificate pinned by the immediate Review 5177225566 predecessor. */
export const REVIEW_517722_PRIOR_COMPACT_CERTIFICATE = "86056e5b16a928ac009ac6054a1ddfd71d9bb4dc";
/** Exact tree independently validated by that predecessor certificate. */
export const REVIEW_517722_PRIOR_COMPACT_CERTIFIED_HEAD = "9c95d79be6da37cd0db9245b9e59b7b29f908221";
/** Immutable seven-file runtime patch admitted by the Review 5177225566 transport. */
const REVIEW_517722_RUNTIME_PATCH = Object.freeze([
  Object.freeze({ file: "src/corrections.ts", patchSha256: "5219153ea745b0e06a32dfdaaa4a010133db282e58ca44a8915564abec06cfa0", priorSha256: "4aa9c8adc2568fd4a6ea3d44f05691929a90e2dd7eb959278bd90c0f7c99b87e", currentSha256: "439e67f78ef3676d24e5981b80fa9b09f32336ab79808bcea44d6df2f374638c" }),
  Object.freeze({ file: "src/events.ts", patchSha256: "b1b1518929ce88eb8fd21fdea227e177e5db283864e32683916f547890e9310a", priorSha256: "b30214304cd638a305b3d2dfb6ab7992b6c90c25c2dcfc0a001df3c9c333ec77", currentSha256: "00155761783c7396c3c06e0756e70eb4fc96b6caa936ef7106344ab00d05705d" }),
  Object.freeze({ file: "src/fungibility.ts", patchSha256: "bf19f876e1814bfe1dd3f60c9ac5995db2e752dcff26d6d9b27caf7599c58579", priorSha256: "6a4000cb79131cd5390c76a4e1235e72bbbee746279d719463d70d72cb17ae75", currentSha256: "3c6de2a463fb57aee417b442cfba202e13277cc0de80a49ee2020f12c65d47b7" }),
  Object.freeze({ file: "src/model.ts", patchSha256: "f54cf15eb00fd11240a58af847ee145a9ba53d2b9e7dc3c38cbaab65e7f0aebf", priorSha256: "634096c43e1f05a1960f741c64140bbac92f9605fdef1d2cfcb8232c02ab8f66", currentSha256: "9c4b76f4dd92022eaaee93552765d0b09898651aea3de6f4bffa6c41786b9dd6" }),
  Object.freeze({ file: "src/projection.ts", patchSha256: "2a2df4aada41ccacfb6b82124307d88e4373a71f4d45935ae448a2a65853edde", priorSha256: "eb95c0ce59d87fe84bd150289b5edc50c3900340a3025ecd17d22013bcd67569", currentSha256: "0f302d058f13f6fd501fb7f58a99074b8440858e221e7852e104478742b7e24e" }),
  Object.freeze({ file: "src/traceability-replay.ts", patchSha256: "ac3b0323c9ff1b0629e917c0ca2fc0a707860817ec98a32d8e5c049c90fe6217", priorSha256: "b7d8ebf3f50317b2e9229adb0235e486ef1e192ea8a4127316ec3c786e485b2a", currentSha256: "c7ec98f5c927516faa0f44a64b7419126687cad69a43affb3438ee631a4eb536" }),
  Object.freeze({ file: "src/traceability.ts", patchSha256: "3c6730fa1a6b80131d06ae433d2c44264eee0b4ab7d5417a85f07a5533989175", priorSha256: "7db0c39cb3262339e76790a7ba10569d67d205ab84f1adb078b6b6d95e93a59c", currentSha256: "20f6de5a795095c3ec401e456c7318c9967ccc192ad88070597530de926e3403" }),
]);
/** Exact temporal vocabulary migration. This map belongs to the proof, not the public runtime. */
export const epochNames = Object.freeze({
  "occurredAt": "occurredAtEpochMs",
  "recordedAt": "recordedAtEpochMs",
  "createdAt": "createdAtEpochMs",
  "expiresAt": "expiresAtEpochMs",
  "startedAt": "startedAtEpochMs",
  "statusAt": "statusAtEpochMs",
  "lastChangedAt": "lastChangedAtEpochMs",
  "observedAt": "observedAtEpochMs",
  "completedAt": "completedAtEpochMs",
  "manufacturedAt": "manufacturedAtEpochMs",
  "openedAt": "openedAtEpochMs",
  "useBy": "useByEpochMs",
  "cutoverAt": "cutoverAtEpochMs",
  "snapshotAt": "snapshotAtEpochMs",
  "layerStartedAt": "layerStartedAtEpochMs",
  "reservationAt": "reservationAtEpochMs",
  "receivedAt": "receivedAtEpochMs",
  "preparedAt": "preparedAtEpochMs",
  "dispatchedAt": "dispatchedAtEpochMs",
  "lastReceivedAt": "lastReceivedAtEpochMs",
  "releasedAt": "releasedAtEpochMs",
  "adapterCertifiedAt": "adapterCertifiedAtEpochMs",
  "dualRunStartedAt": "dualRunStartedAtEpochMs",
  "fenceStartedAt": "fenceStartedAtEpochMs",
  "activatedAt": "activatedAtEpochMs",
  "certifiedAt": "certifiedAtEpochMs",
  "defaultAt": "defaultAtEpochMs",
  "explicitCutoverAt": "explicitCutoverAtEpochMs",
  "replacementOccurredAt": "replacementOccurredAtEpochMs",
  "actualStartedAt": "actualStartedAtEpochMs",
  "desiredStartedAt": "desiredStartedAtEpochMs",
  "lastCountWorkAt": "lastCountWorkAtEpochMs",
  "sourceStartedAt": "sourceStartedAtEpochMs",
  "destinationStartedAt": "destinationStartedAtEpochMs",
  "effectiveUseBy": "effectiveUseByEpochMs",
  "allocationLayerStartedAt": "allocationLayerStartedAtEpochMs",
  "allocationEffectiveUseBy": "allocationEffectiveUseByEpochMs",
  "allocationLotExpiresAt": "allocationLotExpiresAtEpochMs",
  "containerUseBy": "containerUseByEpochMs",
  "lotExpiry": "lotExpiryEpochMs",
  "at": "atEpochMs",
  "now": "nowEpochMs",
  "positiveLayerStartedAtByPositionId": "positiveLayerStartedAtEpochMsByPositionId",
  "assertCanonicalInventoryTime": "assertInventoryEpochMilliseconds",
  "requireCanonicalTime": "requireEpochMilliseconds",
  "requireCanonicalStoredTime": "requireStoredEpochMilliseconds",
  "requireCanonicalCutoverTime": "requireCutoverEpochMilliseconds",
  "inventoryPositionEffectiveUseBy": "inventoryPositionEffectiveUseByEpochMs",
  "resolveInventoryCutoverAt": "resolveInventoryCutoverAtEpochMs"
});
const inverse = new Map(Object.entries(epochNames).map(([before, after]) => [after, before]));
const nullableTimes = new Set(["adapterCertifiedAtEpochMs", "dualRunStartedAtEpochMs", "fenceStartedAtEpochMs", "activatedAtEpochMs"]);
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const historical = new Map();
const currentReviewHistorical = new Map();
const review517722Historical = new Map();

/** Read one immutable ordinary Git blob from the immediate compact-certified Review 5177225566 predecessor. */
export function readReview517722PriorFile(root, file) {
  const key = `${root}:${file}`;
  if (!review517722Historical.has(key)) review517722Historical.set(key, execFileSync("git", ["show", `${REVIEW_517722_RUNTIME_PRIOR_HEAD}:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 }));
  return Buffer.from(review517722Historical.get(key));
}

/** Read one immutable ordinary Git blob from the prior certified review head. */
function readCurrentReviewPriorFile(root, file) {
  const key = `${root}:${file}`;
  if (!currentReviewHistorical.has(key)) currentReviewHistorical.set(key, execFileSync("git", ["show", `${CURRENT_REVIEW_RUNTIME_PRIOR_HEAD}:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 }));
  return Buffer.from(currentReviewHistorical.get(key));
}

/** Read one immutable ordinary Git blob exactly once per repository/proof pass. */
export function readEpochPriorFile(root, file) {
  const key = `${root}:${file}`;
  if (!historical.has(key)) historical.set(key, execFileSync("git", ["show", `${EPOCH_PRIOR_PROOF_HEAD}:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 }));
  return Buffer.from(historical.get(key));
}

/** Bijectively rename callable identity paths while retaining ownership, mode and overload identities. */
export function epochSurfaceKey(key) {
  return key.replace(/[A-Za-z_$][A-Za-z0-9_$]*/gu, name => Object.hasOwn(epochNames, name) ? epochNames[name] : name);
}

/** Canonical emitted syntax retains literal contents and every operator while ignoring trivia and type-only spelling. */
function syntax(text, runtime = true) {
  const emitted = runtime ? ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, removeComments: true } }).outputText : text;
  const source = ts.createSourceFile("proof.ts", emitted, ts.ScriptTarget.Latest, true, runtime ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  assert.equal(source.parseDiagnostics.length, 0, "Epoch proof cannot compare unparsable source.");
  function visit(node) {
    if (!ts.isSourceFile(node) && typeof node.text === "string") return [node.kind, node.text];
    const children = []; ts.forEachChild(node, child => { children.push(visit(child)); });
    return [node.kind, node.operator ?? null, ts.isVariableDeclarationList(node) ? node.flags & ts.NodeFlags.BlockScoped : null, ...children];
  }
  return JSON.stringify(visit(source));
}

function functionSpan(text, name) {
  const source = ts.createSourceFile("proof.ts", text, ts.ScriptTarget.Latest, true);
  const found = source.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.equal(found.length, 1, `Expected exactly one temporal helper ${name}.`);
  return { source, node: found[0] };
}
function replaceFunction(text, name, replacement) {
  const { source, node } = functionSpan(text, name);
  return text.slice(0, node.getStart(source)) + replacement + text.slice(node.getEnd());
}
function checkFunction(text, name, expected) {
  assert.equal(syntax(functionSpan(text, name).node.getText()), syntax(expected), `Unproved temporal helper body: ${name}`);
}
function replaceOnce(text, before, after, label) {
  assert.equal(text.split(before).length, 2, `Temporal transformation must have one exact ${label}.`);
  return text.replace(before, after);
}

/** Exact integer-domain rules, independent of the implementation's current source hashes. */
function restoreNumericHelpers(file, current, prior) {
  let text = current;
  if (file === "src/events.ts") {
    checkFunction(text, "assertInventoryEpochMilliseconds", `export function assertInventoryEpochMilliseconds(value, label) {
      if (!Number.isSafeInteger(value)) { throw new Error(\`\${label} must be safe-integer epoch milliseconds.\`); }
    }`);
    text = replaceFunction(text, "assertInventoryEpochMilliseconds", functionSpan(prior, "assertCanonicalInventoryTime").node.getText());
  }
  if (file === "src/authority.ts") {
    checkFunction(text, "requireEpochMilliseconds", `function requireEpochMilliseconds(value, label) {
      if (!Number.isSafeInteger(value)) { throw new Error(\`InventoryOnce authority \${label} must be safe-integer epoch milliseconds.\`); } return value;
    }`);
    checkFunction(text, "requireStoredEpochMilliseconds", `function requireStoredEpochMilliseconds(value, label) {
      if (value === null) { throw new Error(\`InventoryOnce authority \${label} must retain epoch milliseconds.\`); } return requireEpochMilliseconds(value, label);
    }`);
    checkFunction(text, "requireNullableEpochMilliseconds", `function requireNullableEpochMilliseconds(row, field) {
      const value = row[field]; if (value === null) return null;
      if (typeof value !== "number") { throw new Error(\`InventoryOnce authority field '\${field}' must be epoch milliseconds or null.\`); }
      return requireEpochMilliseconds(value, field);
    }`);
    text = replaceFunction(text, "requireEpochMilliseconds", functionSpan(prior, "requireCanonicalTime").node.getText());
    text = replaceFunction(text, "requireStoredEpochMilliseconds", functionSpan(prior, "requireCanonicalStoredTime").node.getText());
    text = replaceFunction(text, "requireNullableEpochMilliseconds", "");
    text = replaceOnce(text, `(left.recordedAtEpochMs < right.recordedAtEpochMs ? -1 : left.recordedAtEpochMs > right.recordedAtEpochMs ? 1 : 0)`, "compareCanonicalText(left.recordedAtEpochMs, right.recordedAtEpochMs)", "numeric mismatch comparison");
    text = replaceOnce(text, `const sourceParts = [
    state.sourceRoot.length !== 0,
    state.sourcePlanDigest.length !== 0,
    state.sourceCatalogDigest.length !== 0,
    state.dualRunStartedAtEpochMs !== null,
  ];`, `const sourceParts = [state.sourceRoot, state.sourcePlanDigest, state.sourceCatalogDigest, state.dualRunStartedAtEpochMs];`, "source-time presence tuple");
    text = replaceOnce(text, `for (const present of sourceParts) {
    if (present) sourcePartCount += 1;
  }`, `for (const value of sourceParts) { if (value.length !== 0) sourcePartCount += 1; }`, "source evidence completeness");
  }
  if (file === "src/authority-cutover.ts") {
    checkFunction(text, "requireCutoverEpochMilliseconds", `function requireCutoverEpochMilliseconds(value, label) {
      if (value === null || !Number.isSafeInteger(value)) { throw new Error(\`InventoryOnce cutover \${label} must be safe-integer epoch milliseconds.\`); }
    }`);
    text = replaceFunction(text, "requireCutoverEpochMilliseconds", functionSpan(prior, "requireCanonicalCutoverTime").node.getText());
    text = replaceOnce(text, `authority.dualRunStartedAtEpochMs ??
    authority.adapterCertifiedAtEpochMs ??
    authority.fenceStartedAtEpochMs`, `authority.dualRunStartedAtEpochMs || authority.adapterCertifiedAtEpochMs || authority.fenceStartedAtEpochMs`, "null-aware retained time selection");
    text = text.replaceAll("    requireCutoverEpochMilliseconds(value, label);", "    requireRetainedCutoverText(value, label);\n    requireCutoverEpochMilliseconds(value, label);".replace("\n", "\n"));
  }
  if (file === "src/allocation.ts") {
    text = replaceOnce(text, `(left.receivedAtEpochMs < right.receivedAtEpochMs ? -1 : left.receivedAtEpochMs > right.receivedAtEpochMs ? 1 : 0)`, "compareInventoryIdentityText(left.receivedAtEpochMs, right.receivedAtEpochMs)", "numeric FIFO comparison");
    text = replaceOnce(text, "return left < right ? -1 : left > right ? 1 : 0;", "return compareInventoryIdentityText(left, right);", "numeric optional expiry comparison");
  }
  if (file === "src/facade.ts") {
    checkFunction(text, "requirePolicyBatchEpochMilliseconds", `function requirePolicyBatchEpochMilliseconds(value, label) {
      const epochMs = requirePolicyBatchMetadataNumber(value, label); assertInventoryEpochMilliseconds(epochMs, label); return epochMs;
    }`);
    text = replaceFunction(text, "requirePolicyBatchEpochMilliseconds", "");
    text = text.replaceAll("requirePolicyBatchEpochMilliseconds(", "requirePolicyBatchMetadataString(");
    text = replaceOnce(text, "Date.now()", "new Date().toISOString()", "numeric system clock");
  }
  return text;
}

/** Reverse exactly the Review 5178499142 two-file runtime repair to its reviewed predecessor. */
function restoreReview517849Runtime(file, current, prior) {
  let text = current;
  if (file === "src/events.ts") {
    text = replaceOnce(text, "  const seenEdges = new Set<string>();\n", "", "Review 517849 edge-set declaration");
    text = replaceOnce(text, `    const edgeIdentity = traceabilityEdgeIdentity(change);
    if (seenEdges.has(edgeIdentity)) {
      throw new Error(
        \`Inventory event asserts multiple traceability actions for one edge '\${edgeIdentity}'.\`
      );
    }
    seenEdges.add(edgeIdentity);
`, "", "Review 517849 edge-conflict guard");
    const helper = `/** Stable action-independent identity for one relation edge inside an event. */
function traceabilityEdgeIdentity(
  change: InventoryTraceabilityRelationChange
): string {
  return inventoryIntentFingerprint([
    change.kind,
    inventoryTraceabilityNodeIdentity(change.from),
    inventoryTraceabilityNodeIdentity(change.to),
  ]);
}

`;
    text = replaceOnce(text, helper, "", "Review 517849 edge identity helper");
  }
  if (file === "src/fungibility.ts") {
    text = replaceOnce(text, 'import { compareInventoryIdentityText } from "./ordering.js";\n', "", "Review 517849 canonical comparator import");
    text = replaceOnce(text, `    (left, right) =>
      compareInventoryIdentityText(
        left.member.itemRevisionId,
        right.member.itemRevisionId
      )
`, "    (left, right) => left.member.itemRevisionId.localeCompare(right.member.itemRevisionId)\n", "Review 517849 deterministic member ordering");
  }
  assert.equal(syntax(text), syntax(prior), `Review 517849 runtime transport changed executable semantics outside the audited repair: ${file}`);
  assert.equal(syntax(text, false), syntax(prior, false), `Review 517849 runtime transport changed typed source outside the audited repair: ${file}`);
  return text;
}

/** Prove Full Review 5181962020 as one immutable exact source transition above the prior compact-certified PR head. */
export function verifyReview518196RuntimeTransport(root) {
  execFileSync("git", ["merge-base", "--is-ancestor", REVIEW_518196_RUNTIME_PRIOR_HEAD, REVIEW_518196_RUNTIME_CERTIFIED_HEAD], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["merge-base", "--is-ancestor", REVIEW_518196_RUNTIME_CERTIFIED_HEAD, "HEAD"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["merge-base", "--is-ancestor", REVIEW_518196_PRIOR_COMPACT_PIN, REVIEW_518196_RUNTIME_PRIOR_HEAD], { cwd: root, stdio: "ignore" });
  const priorFiles = execFileSync("git", ["ls-tree", "-r", "--name-only", REVIEW_518196_RUNTIME_PRIOR_HEAD, "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n");
  const currentFiles = execFileSync("git", ["ls-tree", "-r", "--name-only", REVIEW_518196_RUNTIME_CERTIFIED_HEAD, "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n");
  assert.deepEqual(currentFiles, priorFiles, "Review 5181962020 changed the runtime module domain.");
  for (const file of ["final-head-transport.json", "final-v309.json", "final-a121-b58.json", "final-surface-bindings.json", "final-binder-report.json"]) {
    const relative = `experiments/tla-conformance/final-convergence/${file}`;
    const certified = execFileSync("git", ["show", `${REVIEW_518196_PRIOR_COMPACT_CERTIFIED_HEAD}:${relative}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    const priorHead = execFileSync("git", ["show", `${REVIEW_518196_RUNTIME_PRIOR_HEAD}:${relative}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(sha256(priorHead), sha256(certified), `Prior compact-certified artifact drifted before Review 5181962020: ${file}`);
  }
  const changed = execFileSync("git", ["diff", "--name-only", REVIEW_518196_RUNTIME_PRIOR_HEAD, REVIEW_518196_RUNTIME_CERTIFIED_HEAD, "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  assert.deepEqual(changed, REVIEW_518196_RUNTIME_PATCH.map(row => row.file), "Review 5181962020 runtime patch escaped its audited dimensionless-position ownership family.");
  const laterRuntimeDelta = execFileSync("git", ["diff", "--name-only", REVIEW_518196_RUNTIME_CERTIFIED_HEAD, "HEAD", "--", "src"], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(laterRuntimeDelta, "", "Runtime source changed after the Review 5181962020 repair candidate.");
  const expectedByFile = new Map(REVIEW_518196_RUNTIME_PATCH.map(row => [row.file, row]));
  const inputs = [], priorSources = new Map(), transitions = [];
  for (const file of currentFiles) {
    const current = readAssuranceFile(root, file);
    const certified = execFileSync("git", ["show", `${REVIEW_518196_RUNTIME_CERTIFIED_HEAD}:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(sha256(current), sha256(certified), `Current runtime source differs from the Review 5181962020 repair: ${file}`);
    inputs.push({ file, sha256: sha256(current) });
    const prior = execFileSync("git", ["show", `${REVIEW_518196_RUNTIME_PRIOR_HEAD}:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    priorSources.set(file, prior.toString("utf8"));
    if (current.equals(prior)) continue;
    const expected = expectedByFile.get(file);
    assert(expected !== undefined, `Unclassified Review 5181962020 runtime source change: ${file}`);
    assert.equal(sha256(prior), expected.priorSha256, `Review 5181962020 prior source drifted: ${file}`);
    assert.equal(sha256(current), expected.currentSha256, `Review 5181962020 current source drifted: ${file}`);
    const patch = execFileSync("git", ["diff", "--no-ext-diff", "--unified=0", REVIEW_518196_RUNTIME_PRIOR_HEAD, REVIEW_518196_RUNTIME_CERTIFIED_HEAD, "--", file], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(sha256(patch), expected.patchSha256, `Review 5181962020 exact source patch drifted: ${file}`);
    transitions.push({ ...expected });
  }
  assert.equal(transitions.length, REVIEW_518196_RUNTIME_PATCH.length, "Review 5181962020 transition coverage is incomplete.");
  return {
    priorCertifiedHead: REVIEW_518196_RUNTIME_PRIOR_HEAD,
    certifiedRepairHead: REVIEW_518196_RUNTIME_CERTIFIED_HEAD,
    exactChangedRuntimeFiles: changed,
    transitions,
    inputs,
    priorSources,
    laws: [
      "Normalized dimensionless stock-position keys are copied before retention so later caller mutation cannot rewrite content behind an already-computed durable position identity.",
      "The exact one-file runtime patch is hash-bound above the compact-certified reviewed predecessor; every other runtime module remains byte-identical.",
    ],
  };
}

/** Prove Full Review 5181132010 as one immutable exact source transition above the prior compact-certified PR head. */
export function verifyReview518113RuntimeTransport(root, currentSourceMap) {
  execFileSync("git", ["merge-base", "--is-ancestor", REVIEW_518113_RUNTIME_PRIOR_HEAD, REVIEW_518113_RUNTIME_CERTIFIED_HEAD], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["merge-base", "--is-ancestor", REVIEW_518113_RUNTIME_CERTIFIED_HEAD, "HEAD"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["merge-base", "--is-ancestor", REVIEW_518113_PRIOR_COMPACT_PIN, REVIEW_518113_RUNTIME_PRIOR_HEAD], { cwd: root, stdio: "ignore" });
  const priorFiles = execFileSync("git", ["ls-tree", "-r", "--name-only", REVIEW_518113_RUNTIME_PRIOR_HEAD, "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n");
  const currentFiles = currentSourceMap === undefined
    ? execFileSync("git", ["ls-tree", "-r", "--name-only", REVIEW_518113_RUNTIME_CERTIFIED_HEAD, "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n")
    : [...currentSourceMap.keys()];
  assert.deepEqual(currentFiles, priorFiles, "Review 5181132010 changed the runtime module domain.");
  for (const file of ["final-head-transport.json", "final-v309.json", "final-a121-b58.json", "final-surface-bindings.json", "final-binder-report.json"]) {
    const relative = `experiments/tla-conformance/final-convergence/${file}`;
    const certified = execFileSync("git", ["show", `${REVIEW_518113_PRIOR_COMPACT_CERTIFIED_HEAD}:${relative}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    const priorHead = execFileSync("git", ["show", `${REVIEW_518113_RUNTIME_PRIOR_HEAD}:${relative}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(sha256(priorHead), sha256(certified), `Prior compact-certified artifact drifted before Review 5181132010: ${file}`);
  }
  const changed = execFileSync("git", ["diff", "--name-only", REVIEW_518113_RUNTIME_PRIOR_HEAD, REVIEW_518113_RUNTIME_CERTIFIED_HEAD, "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  assert.deepEqual(changed, REVIEW_518113_RUNTIME_PATCH.map(row => row.file), "Review 5181132010 runtime patch escaped its audited position-ownership family.");
  if (currentSourceMap === undefined) {
    const laterRuntimeDelta = execFileSync("git", ["diff", "--name-only", REVIEW_518113_RUNTIME_CERTIFIED_HEAD, "HEAD", "--", "src"], { cwd: root, encoding: "utf8" }).trim();
    assert.equal(laterRuntimeDelta, "", "Runtime source changed after the Review 5181132010 repair candidate.");
  }
  const expectedByFile = new Map(REVIEW_518113_RUNTIME_PATCH.map(row => [row.file, row]));
  const inputs = [], priorSources = new Map(), transitions = [];
  for (const file of currentFiles) {
    const currentText = currentSourceMap === undefined ? readAssuranceFile(root, file).toString("utf8") : currentSourceMap.get(file);
    assert.equal(typeof currentText, "string", `Missing Review 5181132010 current runtime source: ${file}`);
    const current = Buffer.from(currentText);
    const certified = execFileSync("git", ["show", `${REVIEW_518113_RUNTIME_CERTIFIED_HEAD}:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(sha256(current), sha256(certified), `Current runtime source differs from the Review 5181132010 repair: ${file}`);
    inputs.push({ file, sha256: sha256(current) });
    const prior = execFileSync("git", ["show", `${REVIEW_518113_RUNTIME_PRIOR_HEAD}:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    priorSources.set(file, prior.toString("utf8"));
    if (current.equals(prior)) continue;
    const expected = expectedByFile.get(file);
    assert(expected !== undefined, `Unclassified Review 5181132010 runtime source change: ${file}`);
    assert.equal(sha256(prior), expected.priorSha256, `Review 5181132010 prior source drifted: ${file}`);
    assert.equal(sha256(current), expected.currentSha256, `Review 5181132010 current source drifted: ${file}`);
    const patch = execFileSync("git", ["diff", "--no-ext-diff", "--unified=0", REVIEW_518113_RUNTIME_PRIOR_HEAD, REVIEW_518113_RUNTIME_CERTIFIED_HEAD, "--", file], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(sha256(patch), expected.patchSha256, `Review 5181132010 exact source patch drifted: ${file}`);
    transitions.push({ ...expected });
  }
  assert.equal(transitions.length, REVIEW_518113_RUNTIME_PATCH.length, "Review 5181132010 transition coverage is incomplete.");
  return {
    priorCertifiedHead: REVIEW_518113_RUNTIME_PRIOR_HEAD,
    certifiedRepairHead: REVIEW_518113_RUNTIME_CERTIFIED_HEAD,
    exactChangedRuntimeFiles: changed,
    transitions,
    inputs,
    priorSources,
    laws: [
      "Normalized stock-position qualified dimensions are copied element-by-element so later caller mutation cannot rewrite retained content behind an already-computed durable position identity.",
      "The exact one-file runtime patch is hash-bound above the compact-certified reviewed predecessor; every other runtime module remains byte-identical.",
    ],
  };
}

/** Prove Full Review 5180096971 as one immutable exact source transition above the prior compact-certified PR head. */
export function verifyReview518009RuntimeTransport(root, currentSourceMap) {
  execFileSync("git", ["merge-base", "--is-ancestor", REVIEW_518009_RUNTIME_PRIOR_HEAD, REVIEW_518009_RUNTIME_CERTIFIED_HEAD], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["merge-base", "--is-ancestor", REVIEW_518009_RUNTIME_CERTIFIED_HEAD, "HEAD"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["merge-base", "--is-ancestor", REVIEW_518009_PRIOR_COMPACT_PIN, REVIEW_518009_RUNTIME_PRIOR_HEAD], { cwd: root, stdio: "ignore" });
  const priorFiles = execFileSync("git", ["ls-tree", "-r", "--name-only", REVIEW_518009_RUNTIME_PRIOR_HEAD, "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n");
  const currentFiles = currentSourceMap === undefined
    ? execFileSync("git", ["ls-tree", "-r", "--name-only", REVIEW_518009_RUNTIME_CERTIFIED_HEAD, "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n")
    : [...currentSourceMap.keys()];
  assert.deepEqual(currentFiles, priorFiles, "Review 5180096971 changed the runtime module domain.");
  for (const file of ["final-head-transport.json", "final-v309.json", "final-a121-b58.json", "final-surface-bindings.json", "final-binder-report.json"]) {
    const relative = `experiments/tla-conformance/final-convergence/${file}`;
    const certified = execFileSync("git", ["show", `${REVIEW_518009_PRIOR_COMPACT_CERTIFIED_HEAD}:${relative}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    const priorHead = execFileSync("git", ["show", `${REVIEW_518009_RUNTIME_PRIOR_HEAD}:${relative}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(sha256(priorHead), sha256(certified), `Prior compact-certified artifact drifted before Review 5180096971: ${file}`);
  }
  const changed = execFileSync("git", ["diff", "--name-only", REVIEW_518009_RUNTIME_PRIOR_HEAD, REVIEW_518009_RUNTIME_CERTIFIED_HEAD, "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  assert.deepEqual(changed, REVIEW_518009_RUNTIME_PATCH.map(row => row.file), "Review 5180096971 runtime patch escaped its audited command family.");
  if (currentSourceMap === undefined) {
    const laterRuntimeDelta = execFileSync("git", ["diff", "--name-only", REVIEW_518009_RUNTIME_CERTIFIED_HEAD, "HEAD", "--", "src"], { cwd: root, encoding: "utf8" }).trim();
    assert.equal(laterRuntimeDelta, "", "Runtime source changed after the independently certified Review 5180096971 repair.");
  }
  const expectedByFile = new Map(REVIEW_518009_RUNTIME_PATCH.map(row => [row.file, row]));
  const inputs = [], priorSources = new Map(), transitions = [];
  for (const file of currentFiles) {
    const current = currentSourceMap === undefined
      ? readAssuranceFile(root, file)
      : Buffer.from(currentSourceMap.get(file), "utf8");
    const certified = execFileSync("git", ["show", `${REVIEW_518009_RUNTIME_CERTIFIED_HEAD}:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(sha256(current), sha256(certified), `Current runtime source differs from the certified Review 5180096971 repair: ${file}`);
    inputs.push({ file, sha256: sha256(current) });
    const prior = execFileSync("git", ["show", `${REVIEW_518009_RUNTIME_PRIOR_HEAD}:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    priorSources.set(file, prior.toString("utf8"));
    if (current.equals(prior)) continue;
    const expected = expectedByFile.get(file);
    assert(expected !== undefined, `Unclassified Review 5180096971 runtime source change: ${file}`);
    assert.equal(sha256(prior), expected.priorSha256, `Review 5180096971 prior source drifted: ${file}`);
    assert.equal(sha256(current), expected.currentSha256, `Review 5180096971 current source drifted: ${file}`);
    const patch = execFileSync("git", ["diff", "--no-ext-diff", "--unified=0", REVIEW_518009_RUNTIME_PRIOR_HEAD, REVIEW_518009_RUNTIME_CERTIFIED_HEAD, "--", file], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(sha256(patch), expected.patchSha256, `Review 5180096971 exact source patch drifted: ${file}`);
    transitions.push({ ...expected });
  }
  assert.equal(transitions.length, REVIEW_518009_RUNTIME_PATCH.length, "Review 5180096971 transition coverage is incomplete.");
  return {
    priorCertifiedHead: REVIEW_518009_RUNTIME_PRIOR_HEAD,
    certifiedRepairHead: REVIEW_518009_RUNTIME_CERTIFIED_HEAD,
    exactChangedRuntimeFiles: changed,
    transitions,
    inputs,
    priorSources,
    laws: [
      "Typed duplicate exact batch movement lines are grouped by exact physical route/position identity using exact quantity addition and deterministic ordering before event construction.",
      "Ambiguous non-disjoint transfer/reclassification graphs fail explicitly rather than depending on incidental duplicate-position rejection or inventing provenance pairing.",
      "The exact one-file runtime patch is independently full-assurance certified at the named repair commit; every other runtime module remains byte-identical to the reviewed predecessor.",
    ],
  };
}

/** Prove Full Review 5178499142 as one immutable exact source transition above Review 5177225566. */
export function verifyReview517849RuntimeTransport(root, currentSourceMap) {
  execFileSync("git", ["merge-base", "--is-ancestor", REVIEW_517849_RUNTIME_PRIOR_HEAD, REVIEW_517849_RUNTIME_CERTIFIED_HEAD], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["merge-base", "--is-ancestor", REVIEW_517849_RUNTIME_CERTIFIED_HEAD, "HEAD"], { cwd: root, stdio: "ignore" });
  const priorFiles = execFileSync("git", ["ls-tree", "-r", "--name-only", REVIEW_517849_RUNTIME_PRIOR_HEAD, "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n");
  const currentFiles = currentSourceMap === undefined
    ? execFileSync("git", ["ls-tree", "-r", "--name-only", REVIEW_517849_RUNTIME_CERTIFIED_HEAD, "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n")
    : [...currentSourceMap.keys()];
  assert.deepEqual(currentFiles, priorFiles, "Review 5178499142 changed the runtime module domain.");
  const changed = execFileSync("git", ["diff", "--name-only", REVIEW_517849_RUNTIME_PRIOR_HEAD, REVIEW_517849_RUNTIME_CERTIFIED_HEAD, "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  assert.deepEqual(changed, REVIEW_517849_RUNTIME_PATCH.map(row => row.file), "Review 5178499142 runtime patch escaped its audited two-file family.");
  if (currentSourceMap === undefined) {
    const laterRuntimeDelta = execFileSync("git", ["diff", "--name-only", REVIEW_517849_RUNTIME_CERTIFIED_HEAD, "HEAD", "--", "src"], { cwd: root, encoding: "utf8" }).trim();
    assert.equal(laterRuntimeDelta, "", "Runtime source changed after the independently certified Review 5178499142 repair.");
  }
  const expectedByFile = new Map(REVIEW_517849_RUNTIME_PATCH.map(row => [row.file, row]));
  const inputs = [], priorSources = new Map(), transitions = [];
  for (const file of currentFiles) {
    const currentText = currentSourceMap === undefined ? readAssuranceFile(root, file).toString("utf8") : currentSourceMap.get(file);
    assert.equal(typeof currentText, "string", `Missing Review 5178499142 current runtime source: ${file}`);
    const current = Buffer.from(currentText);
    const certified = execFileSync("git", ["show", `${REVIEW_517849_RUNTIME_CERTIFIED_HEAD}:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(sha256(current), sha256(certified), `Current runtime source differs from the certified Review 5178499142 repair: ${file}`);
    inputs.push({ file, sha256: sha256(current) });
    const prior = execFileSync("git", ["show", `${REVIEW_517849_RUNTIME_PRIOR_HEAD}:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    priorSources.set(file, prior.toString("utf8"));
    if (current.equals(prior)) continue;
    const expected = expectedByFile.get(file);
    assert(expected !== undefined, `Unclassified Review 5178499142 runtime source change: ${file}`);
    assert.equal(sha256(prior), expected.priorSha256, `Review 5178499142 prior source drifted: ${file}`);
    assert.equal(sha256(current), expected.currentSha256, `Review 5178499142 current source drifted: ${file}`);
    const patch = execFileSync("git", ["diff", "--no-ext-diff", "--unified=0", REVIEW_517849_RUNTIME_PRIOR_HEAD, REVIEW_517849_RUNTIME_CERTIFIED_HEAD, "--", file], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(sha256(patch), expected.patchSha256, `Review 5178499142 exact source patch drifted: ${file}`);
    restoreReview517849Runtime(file, current.toString("utf8"), prior.toString("utf8"));
    transitions.push({ ...expected });
  }
  assert.equal(transitions.length, REVIEW_517849_RUNTIME_PATCH.length, "Review 5178499142 transition coverage is incomplete.");
  return {
    priorCertifiedHead: REVIEW_517849_RUNTIME_PRIOR_HEAD,
    certifiedRepairHead: REVIEW_517849_RUNTIME_CERTIFIED_HEAD,
    exactChangedRuntimeFiles: changed,
    transitions,
    inputs,
    priorSources,
    laws: [
      "One event may assert at most one action per exact traceability kind/from/to edge; exact duplicate diagnostics remain separately fail-closed.",
      "Fungibility summary member ordering changes only the deterministic permutation comparator from locale-sensitive collation to the package canonical identity comparator.",
      "Both runtime changes reproduce red-before, are independently full-assurance certified at the named repair commit, and reverse exactly to the reviewed predecessor in emitted-runtime and typed-AST form.",
    ],
  };
}

/** Prove Full Review 5177225566 as one immutable exact source transition above the previous compact certificate. */
export function verifyReview517722RuntimeTransport(root, currentSourceMap) {
  execFileSync("git", ["merge-base", "--is-ancestor", REVIEW_517722_RUNTIME_PRIOR_HEAD, REVIEW_517722_RUNTIME_CERTIFIED_HEAD], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["merge-base", "--is-ancestor", REVIEW_517722_RUNTIME_CERTIFIED_HEAD, "HEAD"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["merge-base", "--is-ancestor", REVIEW_517722_PRIOR_COMPACT_CERTIFICATE, REVIEW_517722_RUNTIME_PRIOR_HEAD], { cwd: root, stdio: "ignore" });
  assert.equal(execFileSync("git", ["rev-parse", `${REVIEW_517722_PRIOR_COMPACT_CERTIFICATE}^`], { cwd: root, encoding: "utf8" }).trim(), REVIEW_517722_PRIOR_COMPACT_CERTIFIED_HEAD, "Prior compact evidence is not the direct child of its certified tree.");
  const priorCertificateManifest = JSON.parse(execFileSync("git", ["show", `${REVIEW_517722_PRIOR_COMPACT_CERTIFICATE}:experiments/tla-conformance/final-convergence/compact-support-manifest.json`], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  assert.equal(priorCertificateManifest.certification?.certifiedHead, REVIEW_517722_PRIOR_COMPACT_CERTIFIED_HEAD, "Prior compact certificate names the wrong tested tree.");
  assert.deepEqual(priorCertificateManifest.certification.processes.map(row => [row.mode, row.report.status]).sort(), [
    ["registry", "FINAL_535_REGISTRY_BUILT"],
    ["selftest", "FINAL_CONVERGENCE_ADVERSARIAL_PASS"],
    ["verify", "FINAL_BINDER_GREEN"],
  ], "Prior compact certificate does not contain the three required green modes.");
  for (const file of ["final-head-transport.json", "final-v309.json", "final-a121-b58.json", "final-surface-bindings.json", "final-binder-report.json"]) {
    const relative = `experiments/tla-conformance/final-convergence/${file}`;
    const certified = execFileSync("git", ["show", `${REVIEW_517722_PRIOR_COMPACT_CERTIFIED_HEAD}:${relative}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    const priorHead = execFileSync("git", ["show", `${REVIEW_517722_RUNTIME_PRIOR_HEAD}:${relative}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(sha256(priorHead), sha256(certified), `Prior compact-certified artifact drifted before Review 5177225566: ${file}`);
  }
  if (currentSourceMap === undefined) {
    const laterRuntimeDelta = execFileSync("git", ["diff", "--name-only", REVIEW_517722_RUNTIME_CERTIFIED_HEAD, "HEAD", "--", "src"], { cwd: root, encoding: "utf8" }).trim();
    assert.equal(laterRuntimeDelta, "", "Runtime source changed after the independently certified Review 5177225566 repair.");
  }
  const priorFiles = execFileSync("git", ["ls-tree", "-r", "--name-only", REVIEW_517722_RUNTIME_PRIOR_HEAD, "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n");
  const currentFiles = currentSourceMap === undefined
    ? execFileSync("git", ["ls-tree", "-r", "--name-only", REVIEW_517722_RUNTIME_CERTIFIED_HEAD, "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n")
    : [...currentSourceMap.keys()];
  assert.deepEqual(currentFiles, priorFiles, "Review 5177225566 changed the runtime module domain.");
  const expectedByFile = new Map(REVIEW_517722_RUNTIME_PATCH.map(row => [row.file, row]));
  const changed = execFileSync("git", ["diff", "--name-only", REVIEW_517722_RUNTIME_PRIOR_HEAD, REVIEW_517722_RUNTIME_CERTIFIED_HEAD, "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  assert.deepEqual(changed, REVIEW_517722_RUNTIME_PATCH.map(row => row.file), "Review 5177225566 runtime patch escaped its audited seven-file family.");
  const inputs = [], priorSources = new Map(), transitions = [];
  for (const file of currentFiles) {
    const currentText = currentSourceMap === undefined ? readAssuranceFile(root, file).toString("utf8") : currentSourceMap.get(file);
    assert.equal(typeof currentText, "string", `Missing Review 5177225566 current runtime source: ${file}`);
    const current = Buffer.from(currentText);
    const certified = execFileSync("git", ["show", `${REVIEW_517722_RUNTIME_CERTIFIED_HEAD}:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(sha256(current), sha256(certified), `Current runtime source differs from the certified Review 5177225566 repair: ${file}`);
    inputs.push({ file, sha256: sha256(current) });
    const prior = readReview517722PriorFile(root, file);
    priorSources.set(file, prior.toString("utf8"));
    if (current.equals(prior)) continue;
    const expected = expectedByFile.get(file);
    assert(expected !== undefined, `Unclassified Review 5177225566 runtime source change: ${file}`);
    assert.equal(sha256(prior), expected.priorSha256, `Review 5177225566 prior source drifted: ${file}`);
    assert.equal(sha256(current), expected.currentSha256, `Review 5177225566 current source drifted: ${file}`);
    const patch = execFileSync("git", ["diff", "--no-ext-diff", "--unified=0", REVIEW_517722_RUNTIME_PRIOR_HEAD, REVIEW_517722_RUNTIME_CERTIFIED_HEAD, "--", file], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(sha256(patch), expected.patchSha256, `Review 5177225566 exact source patch drifted: ${file}`);
    transitions.push({ ...expected });
  }
  assert.equal(transitions.length, REVIEW_517722_RUNTIME_PATCH.length, "Review 5177225566 transition coverage is incomplete.");
  return {
    priorCertifiedHead: REVIEW_517722_RUNTIME_PRIOR_HEAD,
    certifiedRepairHead: REVIEW_517722_RUNTIME_CERTIFIED_HEAD,
    exactChangedRuntimeFiles: changed,
    transitions,
    inputs,
    priorSources,
    laws: [
      "The correction transition changes only metadata-root replay classification to use the effective replacement kind; retained history and all unrelated correction equations remain byte-identical.",
      "Event/model/projection changes are fail-closed admission strengthenings over runtime values outside the declared enum/safe-integer domains; admitted typed-domain behavior is preserved.",
      "Traceability live/replay changes copy caller node records before durable retention; the copied value identity is unchanged while post-call caller alias mutation can no longer rewrite stored truth.",
      "Fungibility summary sorting is a deterministic permutation of the already-computed member rows by itemRevisionId; every member object and all physical/deficit/common-basis totals are preserved.",
      "The exact seven-file patch is independently full-assurance certified at the named repair commit; no later runtime source drift is admitted.",
    ],
  };
}

/** Reverse only the reviewed malformed-input guards to the prior certified PR runtime. */
function restoreCurrentReviewRuntimeGuards(file, current, prior) {
  let text = current;
  if (file === "src/commands.ts") {
    text = replaceOnce(text, "if (!Array.isArray(lines) || lines.length === 0)", "if (lines.length === 0)", "movement-line malformed-array admission");
    text = replaceOnce(text, 'if (typeof operationId !== "string" || operationId.trim().length === 0)', "if (operationId.trim().length === 0)", "operation-id malformed-string admission");
  }
  if (file === "src/model.ts") {
    text = replaceOnce(text, '  if (typeof value !== "string") throw new Error(`${label} must be a string.`);\n', "", "inventory identity type admission");
    text = replaceOnce(text, '  if (node === null || typeof node !== "object" || Array.isArray(node)) {\n    throw new Error("Traceability node must be an object.");\n  }\n', "", "traceability node shape admission");
  }
  if (file === "src/facade.ts") {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const edits = [];
    const edit = (node, replacement) => edits.push([node.getStart(source), node.getEnd(), replacement]);
    const guardedOwners = new Set([
      "changeStatus", "clearStatus", "changeOwner", "clearOwner", "changeCustodian", "clearCustodian",
      "changeDispositionAuthority", "clearDispositionAuthority", "placeInContainer", "removeFromContainer",
      "createPositionWithChangedQualifiedDimension", "createPositionWithoutQualifiedDimension",
    ]);
    const ownerName = node => {
      if ((ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name !== undefined) return node.name.getText(source);
      return undefined;
    };
    const isReferenceIdentifier = node => {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
      if ((ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent)) && parent.name === node) return false;
      if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
      return true;
    };
    const normalizedOwners = new Set();
    function normalizeGuardedOwner(node) {
      if (!node.body || !guardedOwners.has(ownerName(node))) return;
      const declarations = node.body.statements.filter(statement => {
        if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) return false;
        const declaration = statement.declarationList.declarations[0];
        return ts.isIdentifier(declaration.name) && declaration.name.text === "from" &&
          declaration.initializer !== undefined && ts.isCallExpression(declaration.initializer) &&
          ts.isIdentifier(declaration.initializer.expression) && declaration.initializer.expression.text === "requireStockPositionInput" &&
          declaration.initializer.arguments[0]?.getText(source) === "input.from";
      });
      if (declarations.length === 0) return;
      assert.equal(declarations.length, 1, `Expected at most one reviewed source-position guard in ${ownerName(node)}.`);
      assert(!normalizedOwners.has(ownerName(node)), `Duplicate reviewed source-position guard owner: ${ownerName(node)}`);
      normalizedOwners.add(ownerName(node));
      const declaration = declarations[0];
      edit(declaration, "");
      function replaceReferences(child) {
        if (child === declaration) return;
        if (ts.isIdentifier(child) && child.text === "from" && isReferenceIdentifier(child)) edit(child, "input.from");
        ts.forEachChild(child, replaceReferences);
      }
      ts.forEachChild(node.body, replaceReferences);
    }
    function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === "requireStockPositionInput") { edit(node, ""); return; }
      if (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) normalizeGuardedOwner(node);
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.deepEqual([...normalizedOwners].sort(), [...guardedOwners].sort(), "Reviewed source-position guard family changed.");
    for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) text = text.slice(0, start) + replacement + text.slice(end);
    text = replaceOnce(text, 'if (typeof next !== "string" || next.trim().length === 0)', "if (next.trim().length === 0)", "changed-identity malformed-string admission");
    text = replaceOnce(text, 'if (typeof value !== "string" || value.length === 0)', "if (value === undefined)", "clear-identity malformed-string admission");
  }
  assert.equal(syntax(text), syntax(prior), `Review runtime transport changed executable semantics outside validated guards: ${file}`);
  assert.equal(syntax(text, false), syntax(prior, false), `Review runtime transport changed typed source outside validated guards: ${file}`);
  return text;
}

/** Prove the current review runtime delta is exactly the audited guard-only family. */
function verifyCurrentReviewRuntimeTransport(root, currentSourceMap) {
  execFileSync("git", ["merge-base", "--is-ancestor", CURRENT_REVIEW_RUNTIME_PRIOR_HEAD, REVIEW_517722_RUNTIME_PRIOR_HEAD], { cwd: root, stdio: "ignore" });
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", CURRENT_REVIEW_RUNTIME_PRIOR_HEAD, "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n");
  const currentFiles = currentSourceMap === undefined ? execFileSync("git", ["ls-files", "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n") : [...currentSourceMap.keys()];
  assert.deepEqual(currentFiles, files, "Current review changed the runtime module domain.");
  const expectedChanged = ["src/commands.ts", "src/events.ts", "src/facade.ts", "src/model.ts"];
  const changed = [], inputs = [], priorSources = new Map();
  for (const file of files) {
    const current = currentSourceMap === undefined ? readAssuranceFile(root, file).toString("utf8") : currentSourceMap.get(file);
    assert.equal(typeof current, "string", `Missing reviewed prior runtime source: ${file}`);
    const prior = readCurrentReviewPriorFile(root, file).toString("utf8");
    inputs.push({ file, sha256: sha256(current) });
    priorSources.set(file, prior);
    if (current === prior) continue;
    restoreCurrentReviewRuntimeGuards(file, current, prior);
    changed.push(file);
  }
  assert.deepEqual(changed, expectedChanged, "Current review runtime delta escaped the audited malformed-input family.");
  return {
    priorCertifiedHead: CURRENT_REVIEW_RUNTIME_PRIOR_HEAD,
    exactChangedRuntimeFiles: changed,
    inputs,
    priorSources,
    laws: [
      "The reviewed runtime delta adds only fail-closed malformed-input admission before existing valid-domain logic.",
      "Every changed runtime module reverses exactly to the prior certified PR source in both emitted-runtime and typed AST form.",
      "No runtime module may be added, removed, or changed outside the four audited review files.",
    ],
  };
}

/** Reverse only the declared temporal representation changes, rejecting any unrelated runtime delta. */
export function verifyEpochRuntimeTransport(root) {
  execFileSync("git", ["merge-base", "--is-ancestor", EPOCH_PRIOR_PROOF_HEAD, CURRENT_REVIEW_RUNTIME_PRIOR_HEAD], { cwd: root, stdio: "ignore" });
  const review518196Transition = verifyReview518196RuntimeTransport(root);
  const review518113Transition = verifyReview518113RuntimeTransport(root, review518196Transition.priorSources);
  const review518009Transition = verifyReview518009RuntimeTransport(root, review518113Transition.priorSources);
  const latestReviewTransition = verifyReview517849RuntimeTransport(root, review518009Transition.priorSources);
  const review517722Transition = verifyReview517722RuntimeTransport(root, latestReviewTransition.priorSources);
  const reviewTransition = verifyCurrentReviewRuntimeTransport(root, review517722Transition.priorSources);
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", EPOCH_PRIOR_PROOF_HEAD, "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n");
  assert.deepEqual([...reviewTransition.priorSources.keys()], files, "Epoch transport changed the runtime module domain before the reviewed guard delta.");
  const inputs = review518196Transition.inputs, changes = [];
  for (const file of files) {
    const current = reviewTransition.priorSources.get(file), prior = readEpochPriorFile(root, file).toString("utf8");
    assert.equal(typeof current, "string", `Missing prior certified runtime source: ${file}`);
    if (current === prior) continue;
    let text = restoreNumericHelpers(file, current, prior);
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const edits = [];
    const edit = (node, replacement) => edits.push([node.getStart(source), node.getEnd(), replacement]);
    const temporal = node => ts.isPropertyAccessExpression(node) && nullableTimes.has(node.name.text);
    function restoreType(type, removeNull = false) {
      if (removeNull && ts.isUnionTypeNode(type)) {
        const retained = type.types.filter(child => !(ts.isLiteralTypeNode(child) && child.literal.kind === ts.SyntaxKind.NullKeyword));
        edit(type, retained.map(child => child.getText(source).replace(/\bnumber\b/gu, "string")).join(" | "));
      } else {
        const walk = child => { if(child.kind === ts.SyntaxKind.NumberKeyword) edit(child, "string"); else ts.forEachChild(child, walk); };
        walk(type);
      }
    }
    function visit(node) {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === "./events.js" && !prior.includes('from "./events.js"')) { edit(node, ""); return; }
      if (ts.isImportSpecifier(node) && node.name.text === "assertInventoryEpochMilliseconds" && !prior.includes("assertCanonicalInventoryTime")) { edit(node, ""); return; }
      // Additional boundary guards narrow only the declared numeric time domain and never manufacture state/effects.
      if (ts.isIfStatement(node) && node.elseStatement === undefined) {
        const guarded = ts.isBlock(node.thenStatement) && node.thenStatement.statements.length === 1 ? node.thenStatement.statements[0] : node.thenStatement;
        if (guardStatement(guarded) && !priorGuard(guarded)) {
          assert(ts.isBinaryExpression(node.expression) && (ts.isIdentifier(node.expression.left) || ts.isPropertyAccessExpression(node.expression.left)) && ts.isIdentifier(node.expression.right) && node.expression.right.text === "undefined" && node.expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken, "Unproved conditional temporal admission.");
          edit(node, ""); return;
        }
      }
      if (guardStatement(node) && !priorGuard(node)) { edit(node, ""); return; }
      if (ts.isBinaryExpression(node) && temporal(node.left) && node.right.kind === ts.SyntaxKind.NullKeyword) {
        if (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
          edit(node, `${node.left.getText(source)}.length ${node.operatorToken.getText(source)} 0`); return;
        }
      }
      if (ts.isPropertyAssignment(node) && nullableTimes.has(node.name.getText(source))) {
        if(node.initializer.kind === ts.SyntaxKind.NullKeyword) { edit(node.initializer, '""'); }
        if(ts.isStringLiteral(node.initializer) && node.initializer.text === "Number") edit(node.initializer, '"String"');
      }
      if(ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "requireNullableEpochMilliseconds") edit(node.expression,"requireString");
      if(ts.isBinaryExpression(node) && ts.isTypeOfExpression(node.left) && node.left.expression.getText(source).endsWith(".recordedAtEpochMs") && ts.isStringLiteral(node.right) && node.right.text === "number") edit(node.right,'"string"');
      const name = node.name !== undefined && ts.isIdentifier(node.name) ? node.name.text : undefined;
      if (node.type !== undefined) {
        if (name?.endsWith("EpochMs") || name === "positiveLayerStartedAtEpochMsByPositionId") restoreType(node.type, nullableTimes.has(name));
        else if (ts.isArrowFunction(node) && ts.isPropertyAssignment(node.parent) && node.parent.name.getText(source) === "nowEpochMs") restoreType(node.type);
        else if (ts.isParameter(node) && ((ownerName(node) === "compareOptionalExpiry") || (ownerName(node) === "resolveInventoryCutoverAtEpochMs" && name === "explicit"))) restoreType(node.type);
        else if (ts.isFunctionDeclaration(node) && name === "captureConservedPositiveLayerStarts") restoreType(node.type);
        else if (ts.isFunctionDeclaration(node) && ["lotDefinitionFingerprintParts", "containerDefinitionFingerprintParts"].includes(name)) edit(node.type, node.type.getText(source).replace(" | number", ""));
      }
      if (ts.isAsExpression(node) && node.expression.getText(source).includes("positiveLayerStartedAtEpochMsByPositionId")) restoreType(node.type);
      if (ts.isNewExpression(node) && node.expression.getText(source) === "Map" && ownerName(node) === "captureConservedPositiveLayerStarts") for(const type of node.typeArguments ?? []) restoreType(type);
      ts.forEachChild(node, visit);
    }
    function guardStatement(node) {
      const expression = ts.isExpressionStatement(node) ? node.expression : undefined;
      if (expression === undefined || !ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression) || expression.expression.text !== "assertInventoryEpochMilliseconds") return false;
      if (priorGuard(node)) return true;
      const pureReference = value => ts.isIdentifier(value) || (ts.isPropertyAccessExpression(value) && pureReference(value.expression));
      assert.equal(expression.arguments.length, 2, "Temporal guards must retain their exact arity.");
      assert(pureReference(expression.arguments[0]), "Temporal guard argument may not introduce an effect.");
      assert(ts.isStringLiteral(expression.arguments[1]) || ts.isIdentifier(expression.arguments[1]), "Temporal diagnostic may not introduce an effect.");
      return true;
    }
    function priorGuard(node) {
      const expression = node.expression;
      const key = ownerName(node) + ":" + expression.arguments[0]?.getText(source).replace(/[A-Za-z_$][A-Za-z0-9_$]*/gu, word => inverse.get(word) ?? word).replace(/\s+/gu, "");
      return previousGuardKeys.has(key);
    }
    function ownerName(node) {
      for(let parent=node.parent;parent;parent=parent.parent) {
        if(ts.isFunctionDeclaration(parent))return parent.name?.text ?? "<anonymous>";
      }
      return "<module>";
    }
    const previousGuardKeys = new Set();
    const previousSource = ts.createSourceFile(file, prior, ts.ScriptTarget.Latest, true);
    function collectPrior(node) {
      if(ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "assertCanonicalInventoryTime") previousGuardKeys.add(ownerName(node) + ":" + node.arguments[0]?.getText(previousSource).replace(/\s+/gu,""));
      ts.forEachChild(node,collectPrior);
    }
    collectPrior(previousSource);

    visit(source);
    for(const [start,end,replacement] of edits.sort((a,b)=>b[0]-a[0])) text=text.slice(0,start)+replacement+text.slice(end);
    text = text.replace(/[A-Za-z_$][A-Za-z0-9_$]*/gu, word => inverse.get(word) ?? word);
    text = text.replace(/\{\s*,/gu, "{").replace(/,\s*,/gu, ",");
    if (syntax(text) !== syntax(prior) || syntax(text, false) !== syntax(prior, false)) {
      fs.mkdirSync(path.join(root,".chatgpt/epoch-incremental"),{recursive:true});
      fs.writeFileSync(path.join(root,".chatgpt/epoch-incremental/restored-"+path.basename(file)),text);
      throw new Error(`Epoch transport contains an unproved runtime change: ${file}`);
    }
    changes.push(file);
  }
  return { priorProofHead: EPOCH_PRIOR_PROOF_HEAD, review518196RuntimeTransport: {
    priorCertifiedHead: review518196Transition.priorCertifiedHead,
    certifiedRepairHead: review518196Transition.certifiedRepairHead,
    exactChangedRuntimeFiles: review518196Transition.exactChangedRuntimeFiles,
    transitions: review518196Transition.transitions,
    laws: review518196Transition.laws,
  }, review518113RuntimeTransport: {
    priorCertifiedHead: review518113Transition.priorCertifiedHead,
    certifiedRepairHead: review518113Transition.certifiedRepairHead,
    exactChangedRuntimeFiles: review518113Transition.exactChangedRuntimeFiles,
    transitions: review518113Transition.transitions,
    laws: review518113Transition.laws,
  }, review518009RuntimeTransport: {
    priorCertifiedHead: review518009Transition.priorCertifiedHead,
    certifiedRepairHead: review518009Transition.certifiedRepairHead,
    exactChangedRuntimeFiles: review518009Transition.exactChangedRuntimeFiles,
    transitions: review518009Transition.transitions,
    laws: review518009Transition.laws,
  }, latestReviewRuntimeTransport: {
    priorCertifiedHead: latestReviewTransition.priorCertifiedHead,
    certifiedRepairHead: latestReviewTransition.certifiedRepairHead,
    exactChangedRuntimeFiles: latestReviewTransition.exactChangedRuntimeFiles,
    transitions: latestReviewTransition.transitions,
    laws: latestReviewTransition.laws,
  }, review517722RuntimeTransport: {
    priorCertifiedHead: review517722Transition.priorCertifiedHead,
    certifiedRepairHead: review517722Transition.certifiedRepairHead,
    exactChangedRuntimeFiles: review517722Transition.exactChangedRuntimeFiles,
    transitions: review517722Transition.transitions,
    laws: review517722Transition.laws,
  }, currentReviewRuntimeTransport: {
    priorCertifiedHead: reviewTransition.priorCertifiedHead,
    exactChangedRuntimeFiles: reviewTransition.exactChangedRuntimeFiles,
    laws: reviewTransition.laws,
  }, exactChangedRuntimeFiles: changes, inputs, laws: [
    "Safe-integer epoch milliseconds form an exact totally ordered instant domain including zero and negative values.",
    "Relational numeric comparison preserves chronology; expiry is inclusive and absence is not a numeric sentinel.",
    "Canonical JSON encodes safe integers injectively up to signed zero, which denotes the same instant; intent arrays retain their field order.",
    "Every remaining runtime statement and identity operation is preserved by the checked whole-module reverse transformation."
  ] };
}
