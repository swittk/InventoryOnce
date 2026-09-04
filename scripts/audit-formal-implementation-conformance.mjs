import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  formalConfigCheckNames,
  formalModels,
  statefulOperationFamilyIds,
} from "./formal-models.mjs";

/** InventoryOnce package root. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Repository root used for package and later adapter evidence paths. */
const repositoryRoot = packageRoot;
/** Checked conformance manifest directory. */
const manifestRoot = resolve(packageRoot, "formal/implementation-conformance");
/** Allowed field classifications required by the owner assurance gate. */
const classifications = new Set([
  "abstract-semantic",
  "identity/retry-semantic",
  "observational/audit-only",
  "application decoration",
  "unsupported/unmodelled",
]);
/** Required resolved assurance properties for every public API entry. */
const requiredAssuranceProperties = [
  "models",
  "invariants",
  "inputMapping",
  "stateProjection",
  "resultMapping",
  "retryRelation",
  "rejectionRelation",
  "executableEvidence",
  "adapterCoverage",
  "status",
  "gaps",
];
/** Kernel reference calls requiring memory plus all-operation-failpoint evidence. */
const kernelReferenceCalls = [
  "facade.counts.replaceAbsolute",
  "facade.stock.receiveMany",
  "facade.stock.issueManyByPolicy",
  "facade.stock.transferManyByPolicy",
];

/** Read one checked JSON file. */
function readJson(name) {
  return JSON.parse(readFileSync(resolve(manifestRoot, name), "utf8"));
}

/** Canonical JSON used by both the generated manifest and this audit. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Discover the real TypeScript surface using the package compiler program. */
function discoverSurface() {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [resolve(packageRoot, "scripts/formal-implementation-surface.cjs")],
      {
        cwd: packageRoot,
        encoding: "utf8",
        env: process.env,
        maxBuffer: 32 * 1024 * 1024,
      }
    )
  );
}

/** Discover compiler-resolved tested call chains to exact implementation bodies. */
function discoverCompilerCallGraph() {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [resolve(packageRoot, "scripts/formal-implementation-callgraph.cjs")],
      {
        cwd: packageRoot,
        encoding: "utf8",
        env: process.env,
        maxBuffer: 64 * 1024 * 1024,
      }
    )
  );
}

/** Convert one package-relative call-graph test to repository-relative evidence. */
function repositoryCallGraphTest(path) {
  return relative(repositoryRoot, resolve(packageRoot, path)).replaceAll(
    "\\",
    "/"
  );
}

/** Normalize one live call-graph entry to the exact API manifest witness shape. */
function normalizedCallGraphWitnesses(entry) {
  return entry.witnesses.map((row) => ({
    target: row.target,
    test: repositoryCallGraphTest(row.witness.test),
    chain: row.witness.chain,
  }));
}

/** Convert raw discovery output to the exact checked method-key map. */
function discoveredMethodMap(surface) {
  const entries = new Map();
  for (const row of surface.facade) entries.set(`facade.${row.key}`, row);
  for (const row of surface.authority)
    entries.set(`authority-port.${row.method}`, row);
  for (const row of surface.storage)
    entries.set(`storage-port.${row.method}`, row);
  for (const [entrypoint, rows] of Object.entries(surface.entrypoints)) {
    for (const row of rows)
      entries.set(`entrypoint.${entrypoint}.${row.name}`, row);
  }
  for (const row of surface.classes) entries.set(`class.${row.key}`, row);
  return entries;
}

/** Convert raw discovery output to the exact checked field-key map. */
function discoveredFieldMap(surface) {
  const entries = new Map();
  for (const type of surface.types) {
    for (const field of type.fields) {
      entries.set(`${type.name}.${field.name}`, field);
    }
  }
  return entries;
}

/** Require exact equality of two key sets with actionable diagnostics. */
function requireExactKeys(label, actual, expected) {
  const missing = [...actual].filter((key) => !expected.has(key)).sort();
  const stale = [...expected].filter((key) => !actual.has(key)).sort();
  if (missing.length > 0 || stale.length > 0) {
    throw new Error(
      `${label} mismatch. Missing classifications/assurance: ${
        missing.join(", ") || "none"
      }. ` + `Stale manifest entries: ${stale.join(", ") || "none"}.`
    );
  }
}

/** Read registered model names and every configured invariant/property. */
function readFormalVocabulary() {
  const modelNames = new Set(formalModels);
  const invariantNames = new Set();
  for (const name of modelNames) {
    const modulePath = resolve(packageRoot, `formal/${name}.tla`);
    const configPath = resolve(packageRoot, `formal/${name}.cfg`);
    if (!existsSync(modulePath)) {
      throw new Error(
        `Registered formal model '${name}' is missing '${modulePath}'.`
      );
    }
    if (!existsSync(configPath)) {
      throw new Error(
        `Registered formal model '${name}' is missing '${configPath}'.`
      );
    }
    for (const check of formalConfigCheckNames(readFileSync(configPath, "utf8"))) {
      invariantNames.add(check);
    }
  }
  return { modelNames, invariantNames };
}

/** Resolve one evidence path from a package-relative or repository-relative declaration. */
function evidencePath(path) {
  return path.startsWith("apps/") || path.startsWith("packages/")
    ? resolve(repositoryRoot, path)
    : resolve(packageRoot, path);
}

/** Recursively list TypeScript evidence sources under one directory. */
function listTypeScriptSources(root) {
  if (!existsSync(root)) return [];
  const result = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory())
      result.push(...listTypeScriptSources(path));
    else if (/\.tsx?$/u.test(name)) result.push(path);
  }
  return result;
}

/** Compute compiler-resolved test call sites that directly invoke one public target. */
function expectedDirectExecutableEvidence(callGraphEntry) {
  const sources = new Set();
  const entrypoints = new Set();
  for (const row of callGraphEntry.witnesses) {
    const chain = row.witness.chain;
    if (chain.length < 2) continue;
    const caller = chain[chain.length - 2];
    if (typeof caller.file !== "string" || !caller.file.startsWith("test/")) {
      continue;
    }
    sources.add(repositoryCallGraphTest(caller.file));
    entrypoints.add(repositoryCallGraphTest(row.witness.test));
  }
  return {
    sources: [...sources].sort(),
    entrypoints: [...entrypoints].sort(),
  };
}

/** Discover every machine-declared bounded trace identity and its source files. */
function discoverTraceDeclarations() {
  const declarations = new Map();
  const files = listTypeScriptSources(resolve(packageRoot, "test"));
  for (const path of files) {
    const source = readFileSync(path, "utf8");
    for (const block of source.matchAll(
      /FORMAL_IMPLEMENTATION_TRACE_IDS\s*=\s*\[([\s\S]*?)\]\s*as const/gu
    )) {
      for (const match of block[1].matchAll(/["'](TRACE-[A-Z0-9-]+)["']/gu)) {
        const traceId = match[1];
        const rows = declarations.get(traceId) ?? [];
        rows.push(relative(repositoryRoot, path).replaceAll("\\", "/"));
        declarations.set(traceId, rows);
      }
    }
  }
  return declarations;
}

/** Operation families whose concrete mutations require an explicit bounded trace/property witness. */
const statefulOperationFamilies = new Set(statefulOperationFamilyIds);

/** Validate exact bounded trace declarations, models, evidence, and adapter scope. */
function validateTraceAssurance(traceManifest, apiManifest, vocabulary) {
  const declarations = discoverTraceDeclarations();
  const tracedApiEntries = new Set();
  requireExactKeys(
    "Bounded trace assurance",
    new Set(declarations.keys()),
    new Set(Object.keys(traceManifest.entries))
  );
  for (const [traceId, entry] of Object.entries(traceManifest.entries)) {
    if (entry.status !== "covered") {
      throw new Error(`${traceId} is not marked covered.`);
    }
    if (
      ![
        "state-result-refinement",
        "bounded-property",
        "direct-property",
      ].includes(entry.refinementMode)
    ) {
      throw new Error(
        `${traceId} has unknown refinement mode '${entry.refinementMode}'.`
      );
    }
    for (const model of entry.models) {
      if (!vocabulary.modelNames.has(model)) {
        throw new Error(`${traceId} names unregistered model '${model}'.`);
      }
    }
    for (const invariant of entry.invariants) {
      if (!vocabulary.invariantNames.has(invariant)) {
        throw new Error(`${traceId} names unknown invariant '${invariant}'.`);
      }
    }
    for (const family of entry.operationFamilies) {
      if (!(family in apiManifest.families)) {
        throw new Error(
          `${traceId} names unknown operation family '${family}'.`
        );
      }
    }
    const expectedApiEntries = Object.entries(apiManifest.entries)
      .filter(
        ([, apiEntry]) =>
          apiEntry.status !== "explicit-gap" &&
          entry.operationFamilies.includes(apiEntry.family)
      )
      .map(([apiKey]) => apiKey)
      .sort();
    if (!Array.isArray(entry.apiEntries) || entry.apiEntries.length === 0) {
      throw new Error(`${traceId} lacks generated public API correspondence.`);
    }
    if (canonicalJson(entry.apiEntries) !== canonicalJson(expectedApiEntries)) {
      throw new Error(`${traceId} public API correspondence is stale.`);
    }
    for (const apiKey of entry.apiEntries) tracedApiEntries.add(apiKey);
    if (!Array.isArray(entry.adapters) || entry.adapters.length === 0) {
      throw new Error(`${traceId} lacks adapter scope.`);
    }
    if (
      typeof entry.finiteDomain !== "string" ||
      entry.finiteDomain.trim().length < 20
    ) {
      throw new Error(`${traceId} lacks a bounded-domain statement.`);
    }
    if (
      !Array.isArray(entry.stateProjection) ||
      entry.stateProjection.length === 0
    ) {
      throw new Error(`${traceId} lacks executable state projection.`);
    }
    if (
      typeof entry.resultProjection !== "string" ||
      entry.resultProjection.trim().length < 20
    ) {
      throw new Error(`${traceId} lacks result refinement.`);
    }
    const actualSources = new Set(declarations.get(traceId));
    let declarationCovered = false;
    let executableTestCovered = false;
    const evidenceSources = [];
    for (const evidence of entry.evidence) {
      const path = evidencePath(evidence);
      if (!existsSync(path)) {
        throw new Error(`${traceId} cites missing evidence '${evidence}'.`);
      }
      const normalized = relative(repositoryRoot, path).replaceAll("\\", "/");
      if (actualSources.has(normalized)) declarationCovered = true;
      const source = readFileSync(path, "utf8");
      if (
        /\b(?:it|test)\s*\(/u.test(source) ||
        source.includes("runInventoryFormalStorageRefinementSuite(")
      ) {
        executableTestCovered = true;
      }
      evidenceSources.push(source);
    }
    if (!declarationCovered) {
      throw new Error(
        `${traceId} evidence omits its declaring executable test.`
      );
    }
    if (!executableTestCovered) {
      throw new Error(
        `${traceId} evidence contains no executable test or suite registration.`
      );
    }
    if (entry.refinementMode === "state-result-refinement") {
      for (const projection of entry.stateProjection) {
        if (!evidenceSources.some((source) => source.includes(projection))) {
          throw new Error(
            `${traceId} claims state/result refinement without executing projection '${projection}'.`
          );
        }
      }
    }
  }
  const tracedFamilies = new Set(
    Object.values(traceManifest.entries).flatMap(
      (entry) => entry.operationFamilies
    )
  );
  for (const family of statefulOperationFamilies) {
    if (!tracedFamilies.has(family)) {
      throw new Error(
        `Stateful operation family '${family}' lacks a bounded trace/property witness.`
      );
    }
  }
  for (const [apiKey, apiEntry] of Object.entries(apiManifest.entries)) {
    if (apiEntry.status === "explicit-gap") continue;
    if (!tracedApiEntries.has(apiKey)) {
      throw new Error(
        `Covered public API '${apiKey}' is not assigned to any bounded trace/property witness.`
      );
    }
  }
  return { declarations, tracedApiEntries };
}

/** Validate one expanded API assurance entry. */
function validateApiEntry(
  key,
  entry,
  discovered,
  vocabulary,
  gaps,
  callGraphEntry
) {
  if (canonicalJson(entry.signature) !== canonicalJson(discovered)) {
    throw new Error(
      `Public API signature changed without assurance update: ${key}.`
    );
  }
  for (const property of requiredAssuranceProperties) {
    if (!(property in entry)) throw new Error(`${key} lacks '${property}'.`);
  }
  if (typeof entry.family !== "string" || entry.family.length === 0) {
    throw new Error(`${key} lacks an assurance family.`);
  }
  if (!Array.isArray(entry.models) || entry.models.length === 0) {
    throw new Error(`${key} does not name a formal model.`);
  }
  for (const model of entry.models) {
    if (!vocabulary.modelNames.has(model)) {
      throw new Error(`${key} names unregistered formal model '${model}'.`);
    }
  }
  if (!Array.isArray(entry.invariants) || entry.invariants.length === 0) {
    throw new Error(`${key} does not name a configured invariant/property.`);
  }
  for (const invariant of entry.invariants) {
    if (!vocabulary.invariantNames.has(invariant)) {
      throw new Error(
        `${key} names unknown invariant/property '${invariant}'.`
      );
    }
  }
  for (const textProperty of [
    "inputMapping",
    "resultMapping",
    "retryRelation",
    "rejectionRelation",
  ]) {
    if (
      typeof entry[textProperty] !== "string" ||
      entry[textProperty].trim() === ""
    ) {
      throw new Error(`${key} lacks a concrete ${textProperty}.`);
    }
  }
  if (
    !Array.isArray(entry.stateProjection) ||
    entry.stateProjection.length === 0
  ) {
    throw new Error(
      `${key} lacks an explicit concrete-world abstraction helper.`
    );
  }
  if (
    !Array.isArray(entry.executableEvidence) ||
    entry.executableEvidence.length === 0
  ) {
    throw new Error(`${key} lacks executable refinement evidence.`);
  }
  for (const evidence of entry.executableEvidence) {
    if (!existsSync(evidencePath(evidence))) {
      throw new Error(
        `${key} cites missing executable evidence '${evidence}'.`
      );
    }
  }
  if (
    !Array.isArray(entry.adapterCoverage) ||
    entry.adapterCoverage.length === 0
  ) {
    throw new Error(`${key} lacks adapter/failpoint coverage classification.`);
  }
  if (!Array.isArray(entry.gaps)) throw new Error(`${key} has malformed gaps.`);
  for (const gap of entry.gaps) {
    if (!(gap in gaps)) throw new Error(`${key} cites unknown gap '${gap}'.`);
  }
  if (entry.status === "explicit-gap" && entry.gaps.length === 0) {
    throw new Error(`${key} is marked explicit-gap without a checked gap ID.`);
  }
  if (
    ![
      "direct-executable",
      "indirect-call-chain",
      "explicit-gap",
      "unreferenced-public-gap",
    ].includes(entry.evidenceMode)
  ) {
    throw new Error(
      `${key} has unknown evidence mode '${entry.evidenceMode}'.`
    );
  }
  const symbol = entry.signature.method ?? entry.signature.name;
  if (typeof symbol !== "string" || symbol.length === 0) {
    throw new Error(`${key} has no public symbol for evidence auditing.`);
  }
  if (callGraphEntry === undefined) {
    throw new Error(`${key} is absent from the compiler-resolved call graph.`);
  }
  if (!Array.isArray(entry.directExecutableEvidence)) {
    throw new Error(`${key} lacks executable evidence inventory.`);
  }
  if (!Array.isArray(entry.directExecutableEntrypoints)) {
    throw new Error(`${key} lacks executable test-entrypoint inventory.`);
  }
  if (!Array.isArray(entry.internalReferences)) {
    throw new Error(`${key} lacks diagnostic internal reference inventory.`);
  }
  if (!Array.isArray(entry.implementationTargets)) {
    throw new Error(`${key} lacks exact implementation target inventory.`);
  }
  if (!Array.isArray(entry.callChainWitnesses)) {
    throw new Error(`${key} lacks compiler-resolved call-chain witnesses.`);
  }

  const expectedWitnesses = normalizedCallGraphWitnesses(callGraphEntry);
  const expectedDirect = expectedDirectExecutableEvidence(callGraphEntry);
  if (
    canonicalJson(entry.implementationTargets) !==
    canonicalJson(callGraphEntry.targets)
  ) {
    throw new Error(`${key} implementation target inventory is stale.`);
  }
  if (
    canonicalJson(entry.callChainWitnesses) !== canonicalJson(expectedWitnesses)
  ) {
    throw new Error(`${key} compiler-resolved tested call chain is stale.`);
  }
  if (
    canonicalJson(entry.directExecutableEvidence) !==
      canonicalJson(expectedDirect.sources) ||
    canonicalJson(entry.directExecutableEntrypoints) !==
      canonicalJson(expectedDirect.entrypoints)
  ) {
    throw new Error(`${key} executable test inventory is stale.`);
  }

  const expectedMode =
    entry.status === "explicit-gap"
      ? "explicit-gap"
      : expectedWitnesses.length === 0
      ? "unreferenced-public-gap"
      : expectedDirect.sources.length > 0
      ? "direct-executable"
      : "indirect-call-chain";
  if (entry.evidenceMode !== expectedMode) {
    throw new Error(
      `${key} evidence mode '${entry.evidenceMode}' disagrees with compiler call graph '${expectedMode}'.`
    );
  }

  for (const witness of expectedWitnesses) {
    if (!/\.(?:test|spec)\.tsx?$/u.test(witness.test)) {
      throw new Error(
        `${key} witness '${witness.test}' is not a test entrypoint.`
      );
    }
    const testPath = evidencePath(witness.test);
    if (!existsSync(testPath)) {
      throw new Error(`${key} witness test '${witness.test}' is missing.`);
    }
    if (witness.chain.length < 2 || witness.chain[0]?.kind !== "TestRoot") {
      throw new Error(
        `${key} witness does not begin at a registered test root.`
      );
    }
    const finalNode = witness.chain.at(-1);
    if (finalNode?.id !== witness.target?.id) {
      throw new Error(
        `${key} witness does not terminate at its exact implementation body.`
      );
    }
    for (let index = 0; index < witness.chain.length; index += 1) {
      const node = witness.chain[index];
      if (typeof node?.file !== "string" || node.file.length === 0) {
        throw new Error(
          `${key} witness contains a node without a source file.`
        );
      }
      if (!existsSync(resolve(packageRoot, node.file))) {
        throw new Error(`${key} witness source '${node.file}' is missing.`);
      }
      if (
        index > 0 &&
        (typeof node.reason !== "string" || node.reason.length === 0)
      ) {
        throw new Error(
          `${key} witness edge ${index} lacks a compiler-resolution reason.`
        );
      }
      if (
        node.reason === "callback-argument" ||
        node.reason === "callback-reference"
      ) {
        throw new Error(
          `${key} witness uses unsound generic callback evidence '${node.reason}'.`
        );
      }
    }
  }

  if (
    entry.status !== "explicit-gap" &&
    (callGraphEntry.targets.length === 0 || expectedWitnesses.length === 0)
  ) {
    throw new Error(
      `${key} lacks a compiler-resolved tested path to an exact implementation body.`
    );
  }

  if (
    entry.evidenceMode === "explicit-gap" &&
    entry.status !== "explicit-gap"
  ) {
    throw new Error(`${key} has an evidence gap without explicit-gap status.`);
  }
  if (entry.evidenceMode === "unreferenced-public-gap") {
    throw new Error(
      `${key} is public but has neither direct executable evidence nor an internal tested call chain.`
    );
  }
}

/** Validate every reachable public input/output field classification. */
function validateFieldEntry(key, entry, discovered, vocabulary, gaps) {
  if (!classifications.has(entry.classification)) {
    throw new Error(
      `${key} has invalid field classification '${entry.classification}'.`
    );
  }
  if (entry.discoveredType !== discovered.type) {
    throw new Error(
      `${key} type changed from '${entry.discoveredType}' to '${discovered.type}'.`
    );
  }
  if (entry.declaration !== discovered.source) {
    throw new Error(
      `${key} declaration moved from '${entry.declaration}' to '${discovered.source}'.`
    );
  }
  if (
    canonicalJson(entry.directions) !==
    canonicalJson(discovered.directions ?? [])
  ) {
    throw new Error(
      `${key} input/output direction changed from '${entry.directions}' to '${
        discovered.directions ?? []
      }'.`
    );
  }
  if (entry.optional !== Boolean(discovered.optional)) {
    throw new Error(`${key} optionality changed.`);
  }
  if (entry.allowsUndefined !== Boolean(discovered.allowsUndefined)) {
    throw new Error(`${key} explicit undefined-union membership changed.`);
  }
  if (entry.allowsNull !== Boolean(discovered.allowsNull)) {
    throw new Error(`${key} explicit null-union membership changed.`);
  }
  if (
    canonicalJson(entry.callSignatures) !==
    canonicalJson(discovered.callSignatures ?? [])
  ) {
    throw new Error(`${key} callable overload surface changed.`);
  }
  if (entry.callable !== Boolean(discovered.callable)) {
    throw new Error(`${key} callable-field classification changed.`);
  }
  if (!Array.isArray(entry.directions) || entry.directions.length === 0) {
    throw new Error(`${key} is not classified as input, output, or both.`);
  }
  if (typeof entry.rationale !== "string" || entry.rationale.trim() === "") {
    throw new Error(`${key} lacks classification rationale.`);
  }
  if (!Array.isArray(entry.formalModels) || entry.formalModels.length === 0) {
    throw new Error(`${key} lacks field-to-model mapping.`);
  }
  for (const model of entry.formalModels) {
    if (!vocabulary.modelNames.has(model)) {
      throw new Error(`${key} names unregistered model '${model}'.`);
    }
  }
  if (
    !Array.isArray(entry.executableEvidence) ||
    entry.executableEvidence.length === 0
  ) {
    throw new Error(`${key} lacks field-level executable evidence.`);
  }
  for (const evidence of entry.executableEvidence) {
    if (!existsSync(evidencePath(evidence))) {
      throw new Error(`${key} cites missing field evidence '${evidence}'.`);
    }
  }
  if (!Array.isArray(entry.gaps)) throw new Error(`${key} has malformed gaps.`);
  for (const gap of entry.gaps) {
    if (!(gap in gaps)) throw new Error(`${key} cites unknown gap '${gap}'.`);
  }
  if (
    entry.classification === "unsupported/unmodelled" &&
    entry.gaps.length === 0
  ) {
    throw new Error(
      `${key} is unsupported/unmodelled without an explicit gap.`
    );
  }
}

/** Render the checked human-readable coverage summary from machine manifests. */
function coverageReport(apiManifest, fieldManifest, gaps) {
  const familyCounts = new Map();
  for (const entry of Object.values(apiManifest.entries)) {
    familyCounts.set(entry.family, (familyCounts.get(entry.family) ?? 0) + 1);
  }
  const classificationCounts = new Map();
  for (const entry of Object.values(fieldManifest.entries)) {
    classificationCounts.set(
      entry.classification,
      (classificationCounts.get(entry.classification) ?? 0) + 1
    );
  }
  const lines = [
    "# InventoryOnce formal implementation conformance",
    "",
    "This file is generated from the exact TypeScript surface plus the checked API, field, and gap manifests. Edit the manifests and executable evidence, then run `pnpm assurance --write-report`.",
    "",
    `Surface SHA-256: \`${apiManifest.surfaceSha256}\``,
    "",
    "## Mechanically covered surface",
    "",
    `- Grouped façade/read methods: ${apiManifest.counts.facadeMethods}`,
    `- Authority-port methods: ${apiManifest.counts.authorityMethods}`,
    `- Durable-storage-port methods: ${apiManifest.counts.storageMethods}`,
    `- Public exported class methods: ${apiManifest.counts.classMethods}`,
    `- Root callable exports: ${apiManifest.counts.rootCallables}`,
    `- Storage callable exports: ${apiManifest.counts.storageCallables}`,
    `- Migration callable exports: ${apiManifest.counts.migrationCallables}`,
    `- Kernel callable exports: ${apiManifest.counts.kernelCallables}`,
    `- Reachable public data types: ${apiManifest.counts.reachableTypes}`,
    `- Classified public fields: ${apiManifest.counts.reachableFields}`,
    `- Input-reachable fields: ${fieldManifest.counts.inputFields}`,
    `- Output-reachable fields: ${fieldManifest.counts.outputFields}`,
    `- Callback-argument-reachable fields: ${fieldManifest.counts.callbackArgumentFields}`,
    `- Callback-result-reachable fields: ${fieldManifest.counts.callbackResultFields}`,
    `- Callable-field overload signatures: ${fieldManifest.counts.callableFieldSignatures}`,
    `- Optional fields: ${fieldManifest.counts.optionalFields}`,
    `- Explicit undefined-union fields: ${fieldManifest.counts.undefinedFields}`,
    `- Explicit nullable fields: ${fieldManifest.counts.nullableFields}`,
    `- Public call/construct overload signatures: ${apiManifest.counts.callAndConstructSignatures}`,
    `- Directly executed public APIs: ${apiManifest.counts.directExecutableApis}`,
    `- Public APIs exercised through tested internal call chains: ${apiManifest.counts.indirectCallChainApis}`,
    `- Explicit-gap public APIs: ${apiManifest.counts.explicitGapApis}`,
    `- Unreferenced public APIs: ${apiManifest.counts.unreferencedPublicApis}`,
    `- Explicit recursive type edges: ${apiManifest.counts.recursiveTypeReferences}`,
    `- Silently truncated types: ${apiManifest.counts.truncatedTypes}`,
    "",
    "Any added/removed method, callable export, class method, type field, field type, or declaration location fails the audit until the checked correspondence is updated.",
    "",
    "## Assurance families",
    "",
    "| Family | API entries | Formal models | Status | Gaps |",
    "|---|---:|---|---|---|",
  ];
  for (const [family, count] of [...familyCounts].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const assurance = apiManifest.families[family];
    lines.push(
      `| ${family} | ${count} | ${assurance.models.join(", ")} | ${
        assurance.status
      } | ${assurance.gaps.join(", ") || "—"} |`
    );
  }
  lines.push(
    "",
    "## Field classification",
    "",
    "| Classification | Fields |",
    "|---|---:|"
  );
  for (const [classification, count] of [...classificationCounts].sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    lines.push(`| ${classification} | ${count} |`);
  }
  lines.push(
    "",
    "## Kernel reference-adapter seam",
    "",
    "The finite refinement suite runs the core façade against the memory reference adapter. Mongo/SQLite adapter and Shinebright application-call evidence belong to downstream integration repositories and are not executed here.",
    "",
    "| Kernel call | Family | Required evidence |",
    "|---|---|---|"
  );
  for (const key of kernelReferenceCalls) {
    const entry = apiManifest.entries[key];
    lines.push(
      `| \`${key.replace("facade.", "inventory.")}\` | ${
        entry.family
      } | memory + all operation failpoints |`
    );
  }
  lines.push(
    "",
    "## Explicit gaps and non-claims",
    "",
    "| Gap | Status | Production impact | Required mitigation |",
    "|---|---|---|---|"
  );
  for (const [gap, detail] of Object.entries(gaps).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    lines.push(
      `| ${gap} | ${detail.status} | ${detail.productionImpact} | ${detail.requiredMitigation} |`
    );
  }
  lines.push(
    "",
    "## Proof boundary",
    "",
    "The audit proves correspondence completeness and executes finite refinement/conformance evidence. TLC remains bounded model checking; JavaScript and database engines are tested, not theorem-proved. Migration publication/replay does not prove one clinic's legacy interpretation. Distributed/offline multiwriter rights remain unsupported. Arbitrary audit metadata and application decoration are excluded from conserved physical state and tested metamorphically."
  );
  return `${lines.join("\n")}\n`;
}

const surface = discoverSurface();
const callGraph = discoverCompilerCallGraph();
const apiManifest = readJson("API_ASSURANCE.json");
const fieldManifest = readJson("FIELD_CLASSIFICATION.json");
const callGraphManifest = readJson("CALL_CHAIN_ASSURANCE.json");
const gapManifest = readJson("FORMAL_COVERAGE_GAPS.json");
const traceManifest = readJson("TRACE_REPLAY_ASSURANCE.json");
const gaps = gapManifest.gaps;
const methodMap = discoveredMethodMap(surface);
const fieldMap = discoveredFieldMap(surface);
const surfaceSha256 = createHash("sha256")
  .update(canonicalJson(surface))
  .digest("hex");
if (apiManifest.surfaceSha256 !== surfaceSha256) {
  throw new Error(
    `Public surface hash changed from ${apiManifest.surfaceSha256} to ${surfaceSha256}.`
  );
}
if (fieldManifest.surfaceSha256 !== surfaceSha256) {
  throw new Error(
    "API and field manifests were not generated from the same public surface."
  );
}
if (callGraphManifest.surfaceSha256 !== surfaceSha256) {
  throw new Error(
    "Call-chain and API manifests were not generated from the same public surface."
  );
}
if (
  canonicalJson(callGraphManifest.counts) !== canonicalJson(callGraph.counts) ||
  canonicalJson(callGraphManifest.entries) !== canonicalJson(callGraph.entries)
) {
  throw new Error("Compiler-resolved tested call-chain manifest is stale.");
}
requireExactKeys(
  "Compiler call-chain assurance",
  new Set(methodMap.keys()),
  new Set(Object.keys(callGraph.entries))
);
requireExactKeys(
  "Public API assurance",
  new Set(methodMap.keys()),
  new Set(Object.keys(apiManifest.entries))
);
requireExactKeys(
  "Public field classification",
  new Set(fieldMap.keys()),
  new Set(Object.keys(fieldManifest.entries))
);
const vocabulary = readFormalVocabulary();
const traceAssurance = validateTraceAssurance(
  traceManifest,
  apiManifest,
  vocabulary
);
const traceDeclarations = traceAssurance.declarations;
for (const [key, discovered] of methodMap) {
  const entry = apiManifest.entries[key];
  validateApiEntry(
    key,
    entry,
    discovered,
    vocabulary,
    gaps,
    callGraph.entries[key]
  );
  const family = apiManifest.families[entry.family];
  if (family === undefined)
    throw new Error(`${key} names missing family '${entry.family}'.`);
  for (const property of requiredAssuranceProperties) {
    if (canonicalJson(entry[property]) !== canonicalJson(family[property])) {
      throw new Error(
        `${key} drifted from checked family '${entry.family}' at '${property}'.`
      );
    }
  }
}
for (const [key, discovered] of fieldMap) {
  validateFieldEntry(
    key,
    fieldManifest.entries[key],
    discovered,
    vocabulary,
    gaps
  );
}

const methodRows = [
  ...surface.facade,
  ...surface.authority,
  ...surface.storage,
  ...surface.classes,
];
const exportRows = Object.values(surface.entrypoints).flat();
const signatureCount = (row) =>
  Array.isArray(row.signatures)
    ? row.signatures.length
    : (row.callSignatures?.length ?? 0) +
      (row.constructSignatures?.length ?? 0);
const diagnostics = surface.diagnostics ?? {};
if ((diagnostics.truncatedTypes ?? []).length !== 0) {
  throw new Error(
    "Public type discovery silently truncated one or more types."
  );
}
const expectedCounts = {
  facadeMethods: surface.facade.length,
  authorityMethods: surface.authority.length,
  storageMethods: surface.storage.length,
  classMethods: surface.classes.length,
  rootCallables: surface.entrypoints.root.length,
  storageCallables: surface.entrypoints.storage.length,
  migrationCallables: surface.entrypoints.migrations.length,
  kernelCallables: surface.entrypoints.kernel.length,
  callAndConstructSignatures: [...methodRows, ...exportRows].reduce(
    (count, row) => count + signatureCount(row),
    0
  ),
  directExecutableApis: Object.values(apiManifest.entries).filter(
    (entry) => entry.evidenceMode === "direct-executable"
  ).length,
  indirectCallChainApis: Object.values(apiManifest.entries).filter(
    (entry) => entry.evidenceMode === "indirect-call-chain"
  ).length,
  explicitGapApis: Object.values(apiManifest.entries).filter(
    (entry) => entry.evidenceMode === "explicit-gap"
  ).length,
  unreferencedPublicApis: Object.values(apiManifest.entries).filter(
    (entry) => entry.evidenceMode === "unreferenced-public-gap"
  ).length,
  compilerCallGraphCallables: callGraph.counts.callables,
  compilerCallGraphEdges: callGraph.counts.edges,
  compilerCallGraphTestRoots: callGraph.counts.testRoots,
  compilerCallGraphWitnessedApis: callGraph.counts.publicEntriesWithWitnesses,
  compilerCallGraphUnresolvedApis: callGraph.counts.unresolvedPublicEntries,
  reachableTypes: surface.types.length,
  reachableFields: fieldMap.size,
  recursiveTypeReferences: (diagnostics.recursiveTypeReferences ?? []).length,
  maximumTypeDepth: diagnostics.maximumTypeDepth ?? 0,
  truncatedTypes: (diagnostics.truncatedTypes ?? []).length,
};
if (canonicalJson(apiManifest.counts) !== canonicalJson(expectedCounts)) {
  throw new Error(
    "Checked public-surface counts do not match the TypeScript program."
  );
}
const expectedFieldCounts = {
  types: surface.types.length,
  fields: fieldMap.size,
  inputFields: Object.values(fieldManifest.entries).filter((entry) =>
    entry.directions.includes("input")
  ).length,
  outputFields: Object.values(fieldManifest.entries).filter((entry) =>
    entry.directions.includes("output")
  ).length,
  optionalFields: Object.values(fieldManifest.entries).filter(
    (entry) => entry.optional
  ).length,
  undefinedFields: Object.values(fieldManifest.entries).filter(
    (entry) => entry.allowsUndefined
  ).length,
  nullableFields: Object.values(fieldManifest.entries).filter(
    (entry) => entry.allowsNull
  ).length,
  callableFields: Object.values(fieldManifest.entries).filter(
    (entry) => entry.callable
  ).length,
  callableFieldSignatures: Object.values(fieldManifest.entries).reduce(
    (count, entry) => count + entry.callSignatures.length,
    0
  ),
  callbackArgumentFields: Object.values(fieldManifest.entries).filter((entry) =>
    entry.directions.includes("callback-argument")
  ).length,
  callbackResultFields: Object.values(fieldManifest.entries).filter((entry) =>
    entry.directions.includes("callback-result")
  ).length,
  recursiveTypeReferences: (diagnostics.recursiveTypeReferences ?? []).length,
  truncatedTypes: (diagnostics.truncatedTypes ?? []).length,
};
if (
  canonicalJson(fieldManifest.counts) !== canonicalJson(expectedFieldCounts)
) {
  throw new Error("Checked field counts do not match the TypeScript program.");
}
if (
  canonicalJson(apiManifest.surfaceDiagnostics) !==
    canonicalJson(diagnostics) ||
  canonicalJson(fieldManifest.surfaceDiagnostics) !== canonicalJson(diagnostics)
) {
  throw new Error("Checked diagnostics do not match public type discovery.");
}

const abstractionSourcePath = resolve(
  packageRoot,
  "test/formal-implementation-abstraction.ts"
);
if (!existsSync(abstractionSourcePath)) {
  throw new Error(
    "Missing executable formal implementation abstraction helpers."
  );
}
const abstractionSource = readFileSync(abstractionSourcePath, "utf8");
for (const helper of [
  "abstractInventoryState",
  "abstractReservationState",
  "abstractCountState",
  "abstractTraceabilityState",
  "abstractOperationResult",
  "abstractAuthorityState",
  "abstractMigrationState",
]) {
  if (!abstractionSource.includes(`function ${helper}`)) {
    throw new Error(
      `Missing required executable abstraction helper '${helper}'.`
    );
  }
}

for (const key of kernelReferenceCalls) {
  const entry = apiManifest.entries[key];
  if (entry === undefined || entry.status !== "covered") {
    throw new Error(
      `Kernel reference call '${key}' is not fully covered.`
    );
  }
  for (const adapter of ["memory", "all-operation-failpoints"]) {
    if (!entry.adapterCoverage.includes(adapter)) {
      throw new Error(`${key} lacks '${adapter}' refinement coverage.`);
    }
  }
  for (const evidence of ["test/formal-storage-refinement.test.ts"]) {
    if (!entry.executableEvidence.includes(evidence)) {
      throw new Error(
        `${key} lacks required end-to-end evidence '${evidence}'.`
      );
    }
  }
}

if (!("GAP-DISTRIBUTED-RIGHTS-NOT-IMPLEMENTED" in gaps)) {
  throw new Error(
    "DistributedRights implementation gap disappeared from the checked report."
  );
}
if (!("GAP-LEGACY-SOURCE-INTERPRETATION" in gaps)) {
  throw new Error(
    "Legacy migration interpretation gap disappeared from the checked report."
  );
}
if (
  Object.values(apiManifest.entries).some((entry) =>
    entry.models.includes("DistributedRights")
  )
) {
  throw new Error(
    "Current APIs must not claim DistributedRights implementation refinement before code exists."
  );
}

const report = coverageReport(apiManifest, fieldManifest, gaps);
const reportPath = resolve(manifestRoot, "IMPLEMENTATION_CONFORMANCE.md");
if (process.argv.includes("--write-report")) {
  writeFileSync(reportPath, report);
} else if (
  !existsSync(reportPath) ||
  readFileSync(reportPath, "utf8") !== report
) {
  throw new Error(
    "Generated IMPLEMENTATION_CONFORMANCE.md is stale; run `pnpm assurance --write-report` after intentional manifest changes."
  );
}

const fieldClassCounts = Object.values(fieldManifest.entries).reduce(
  (counts, entry) => ({
    ...counts,
    [entry.classification]: (counts[entry.classification] ?? 0) + 1,
  }),
  {}
);
console.log(
  JSON.stringify(
    {
      surfaceSha256,
      apiEntries: methodMap.size,
      fieldEntries: fieldMap.size,
      inputFields: fieldManifest.counts.inputFields,
      outputFields: fieldManifest.counts.outputFields,
      callbackArgumentFields: fieldManifest.counts.callbackArgumentFields,
      callbackResultFields: fieldManifest.counts.callbackResultFields,
      callableFieldSignatures: fieldManifest.counts.callableFieldSignatures,
      optionalFields: fieldManifest.counts.optionalFields,
      undefinedFields: fieldManifest.counts.undefinedFields,
      nullableFields: fieldManifest.counts.nullableFields,
      callAndConstructSignatures: apiManifest.counts.callAndConstructSignatures,
      directExecutableApis: apiManifest.counts.directExecutableApis,
      indirectCallChainApis: apiManifest.counts.indirectCallChainApis,
      explicitGapApis: apiManifest.counts.explicitGapApis,
      unreferencedPublicApis: apiManifest.counts.unreferencedPublicApis,
      compilerCallGraphCallables: apiManifest.counts.compilerCallGraphCallables,
      compilerCallGraphEdges: apiManifest.counts.compilerCallGraphEdges,
      compilerCallGraphTestRoots: apiManifest.counts.compilerCallGraphTestRoots,
      compilerCallGraphWitnessedApis:
        apiManifest.counts.compilerCallGraphWitnessedApis,
      compilerCallGraphUnresolvedApis:
        apiManifest.counts.compilerCallGraphUnresolvedApis,
      recursiveTypeReferences: apiManifest.counts.recursiveTypeReferences,
      truncatedTypes: apiManifest.counts.truncatedTypes,
      families: Object.keys(apiManifest.families).length,
      fieldClassCounts,
      registeredModels: vocabulary.modelNames.size,
      configuredInvariantsAndProperties: vocabulary.invariantNames.size,
      criticalKernelCalls: kernelReferenceCalls.length,
      boundedTraceEntries: traceDeclarations.size,
      stateResultTraceEntries: Object.values(traceManifest.entries).filter(
        (entry) => entry.refinementMode === "state-result-refinement"
      ).length,
      boundedPropertyTraceEntries: Object.values(traceManifest.entries).filter(
        (entry) => entry.refinementMode === "bounded-property"
      ).length,
      directPropertyTraceEntries: Object.values(traceManifest.entries).filter(
        (entry) => entry.refinementMode === "direct-property"
      ).length,
      statefulOperationFamilies: statefulOperationFamilies.size,
      tracedPublicApis: traceAssurance.tracedApiEntries.size,
      explicitGaps: Object.keys(gaps).length,
    },
    undefined,
    2
  )
);
