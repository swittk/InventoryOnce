import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { readAssuranceFile } from "./assurance-files.mjs";

/** Independently established pre-epoch proof head; historical proof bytes never authenticate themselves. */
export const EPOCH_PRIOR_PROOF_HEAD = "6983219e13295b8f6b073daefc3cbcd90b32ac35";
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

/** Reverse only the declared temporal representation changes, rejecting any unrelated runtime delta. */
export function verifyEpochRuntimeTransport(root) {
  execFileSync("git", ["merge-base", "--is-ancestor", EPOCH_PRIOR_PROOF_HEAD, "HEAD"], { cwd: root, stdio: "ignore" });
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", EPOCH_PRIOR_PROOF_HEAD, "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n");
  const currentFiles = execFileSync("git", ["ls-files", "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n");
  assert.deepEqual(currentFiles, files, "Epoch transport changed the runtime module domain.");
  const inputs = [], changes = [];
  for (const file of files) {
    const current = readAssuranceFile(root, file).toString("utf8"), prior = readEpochPriorFile(root, file).toString("utf8");
    if (current === prior) { inputs.push({ file, sha256: sha256(current) }); continue; }
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
    changes.push(file); inputs.push({ file, sha256: sha256(current) });
  }
  return { priorProofHead: EPOCH_PRIOR_PROOF_HEAD, exactChangedRuntimeFiles: changes, inputs, laws: [
    "Safe-integer epoch milliseconds form an exact totally ordered instant domain including zero and negative values.",
    "Relational numeric comparison preserves chronology; expiry is inclusive and absence is not a numeric sentinel.",
    "Canonical JSON encodes safe integers injectively up to signed zero, which denotes the same instant; intent arrays retain their field order.",
    "Every remaining runtime statement and identity operation is preserved by the checked whole-module reverse transformation."
  ] };
}
