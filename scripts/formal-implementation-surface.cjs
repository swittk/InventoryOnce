const ts = require("typescript");
const path = require("node:path");
const crypto = require("node:crypto");

/** Derive the implementation census from one shared compiler snapshot or a standalone command. */
function discoverImplementationSurface({ repositoryRoot = path.resolve(__dirname, ".."), program: suppliedProgram } = {}) {
/** InventoryOnce package/source roots. */
const root = path.resolve(repositoryRoot);
const sourceRoot = path.resolve(root, "src");
const normalizedSourceRoot = path.normalize(sourceRoot);
const normalizedSourcePrefix = `${normalizedSourceRoot}${path.sep}`;
const program = suppliedProgram ?? (() => {
const configPath = path.join(root, "tsconfig.test.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error !== undefined) {
  throw new Error(
    ts.flattenDiagnosticMessageText(config.error.messageText, "\n")
  );
}
const parsed = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  root,
  undefined,
  configPath
);
if (parsed.errors.length > 0) {
  throw new Error(
    parsed.errors
      .map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n"))
      .join("\n")
  );
}
return ts.createProgram({
  rootNames: parsed.fileNames,
  options: parsed.options,
});
})();
const semanticDiagnostics = program.getSemanticDiagnostics();
if (semanticDiagnostics.length > 0) {
  throw new Error(
    ts.formatDiagnostics(semanticDiagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    })
  );
}
const checker = program.getTypeChecker();
const formatFlags =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

/** Compare generated identities by exact UTF-16 code units, independent of host locale. */
function compareExact(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Return one repository-independent declaration source identity while binding external compiler bytes. */
function stableDeclarationSource(source) {
  const resolved = path.resolve(source.fileName);
  const normalized = resolved.split(path.sep).join("/");
  const nodeModulesMarker = "/node_modules/";
  const nodeModulesIndex = normalized.lastIndexOf(nodeModulesMarker);
  if (nodeModulesIndex >= 0) {
    const externalPath = normalized.slice(
      nodeModulesIndex + nodeModulesMarker.length
    );
    return `external:${externalPath}#${shortHash(source.text)}`;
  }
  const relative = path.relative(root, resolved);
  if (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  ) {
    return relative.split(path.sep).join("/");
  }
  return `external-file:${path.basename(resolved)}#${shortHash(source.text)}`;
}

/** Grouped public APIs and package entrypoint modules. */
const facadeInterfaces = [
  ["InventoryOnceCatalogApi", "catalog"],
  ["InventoryOnceCompositionsApi", "compositions"],
  ["InventoryOnceTransformationsApi", "transformations"],
  ["InventoryOnceCollectionsApi", "collections"],
  ["InventoryOnceFungibilityApi", "fungibility"],
  ["InventoryOnceStockApi", "stock"],
  ["InventoryOncePlacementApi", "placement"],
  ["InventoryOnceLotsApi", "lots"],
  ["InventoryOnceTransfersApi", "transfers"],
  ["InventoryOnceReservationsApi", "reservations"],
  ["InventoryOnceCountsApi", "counts"],
  ["InventoryOnceTraceabilityApi", "traceability"],
  ["InventoryOnceReadSnapshotApi", "snapshot"],
  ["InventoryOnceReadApi", "read"],
];
const entrypointSources = {
  root: "src/index.ts",
  storage: "src/storage-api.ts",
  migrations: "src/migrations-api.ts",
  kernel: "src/kernel.ts",
};

/** Require one source or interface declaration. */
function sourceFile(relativePath) {
  const result = program.getSourceFile(path.join(root, relativePath));
  if (result === undefined)
    throw new Error(`Missing source '${relativePath}'.`);
  return result;
}
/** Require one named interface declaration from a package source file. */
function interfaceDeclaration(relativePath, name) {
  const result = sourceFile(relativePath).statements.find(
    (statement) =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === name
  );
  if (result === undefined) throw new Error(`Missing interface '${name}'.`);
  return result;
}
/** Return a symbol declaration, falling back to the surrounding module/interface node for type queries. */
function declarationOf(symbol, fallback) {
  return symbol.valueDeclaration ?? symbol.declarations?.[0] ?? fallback;
}
/** Render one compiler type deterministically at the declaration node that gives it context. */
function typeText(type, node) {
  return checker.typeToString(type, node, formatFlags);
}

/** Preserve every public overload rather than selecting the first one. */
function signatureShape(signature, fallback) {
  const declaration = signature.declaration ?? fallback;
  return {
    parameters: signature.getParameters().map((parameter) => {
      const parameterDeclaration = declarationOf(parameter, declaration);
      return {
        name: parameter.name,
        type: typeText(
          checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration),
          parameterDeclaration
        ),
        optional: (parameter.flags & ts.SymbolFlags.Optional) !== 0,
      };
    }),
    result: typeText(checker.getReturnTypeOfSignature(signature), declaration),
  };
}
/** Enumerate callable method signatures for one exported interface surface. */
function methodsOfInterface(relativePath, name, prefix) {
  const declaration = interfaceDeclaration(relativePath, name);
  const rows = [];
  for (const member of checker.getPropertiesOfType(
    checker.getTypeAtLocation(declaration)
  )) {
    const memberDeclaration = declarationOf(member, declaration);
    const memberType = checker.getTypeOfSymbolAtLocation(
      member,
      memberDeclaration
    );
    const signatures = checker
      .getSignaturesOfType(memberType, ts.SignatureKind.Call)
      .map((signature) => signatureShape(signature, memberDeclaration));
    if (signatures.length === 0) continue;
    rows.push({
      key: `${prefix}.${member.name}`,
      interface: name,
      method: member.name,
      signatures,
      parameters: signatures[0].parameters,
      result: signatures[0].result,
    });
  }
  return rows.sort((left, right) => compareExact(left.key, right.key));
}

/** Preserve callable and constructable export signatures. */
function moduleExports(relativePath) {
  const source = sourceFile(relativePath);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined)
    throw new Error(`Missing module '${relativePath}'.`);
  const rows = [];
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const declaration = declarationOf(exported, source);
    const exportedType = checker.getTypeOfSymbolAtLocation(
      exported,
      declaration
    );
    const callSignatures = checker
      .getSignaturesOfType(exportedType, ts.SignatureKind.Call)
      .map((signature) => signatureShape(signature, declaration));
    const constructSignatures = checker
      .getSignaturesOfType(exportedType, ts.SignatureKind.Construct)
      .map((signature) => signatureShape(signature, declaration));
    if (callSignatures.length === 0 && constructSignatures.length === 0)
      continue;
    rows.push({
      name: exported.name,
      declaration: stableDeclarationSource(declaration.getSourceFile()),
      callable: callSignatures.length > 0,
      constructable: constructSignatures.length > 0,
      callSignatures,
      constructSignatures,
    });
  }
  return rows.sort((left, right) => compareExact(left.name, right.name));
}

/** Return every public callable instance member plus statics declared directly on one exported class. */
function publicClassMembers(exported, constructorType) {
  const instanceMembers = checker.getPropertiesOfType(
    checker.getDeclaredTypeOfSymbol(exported)
  );
  const members = [...instanceMembers];
  const memberNames = new Set(instanceMembers.map((member) => member.name));
  for (const member of checker.getPropertiesOfType(constructorType)) {
    const memberDeclaration = member.valueDeclaration ?? member.declarations?.[0];
    if (memberDeclaration === undefined) continue;
    const staticFlags = ts.getCombinedModifierFlags(memberDeclaration);
    if ((staticFlags & ts.ModifierFlags.Static) === 0) continue;
    if (
      (staticFlags & ts.ModifierFlags.Private) !== 0 ||
      (staticFlags & ts.ModifierFlags.Protected) !== 0
    ) {
      continue;
    }
    if (memberNames.has(member.name)) {
      throw new Error(
        `Exported class '${exported.name}' has both static and instance member '${member.name}'; surface keys must distinguish them before that API can be certified.`
      );
    }
    memberNames.add(member.name);
    members.push(member);
  }
  return members;
}

/** Preserve every overload on every public exported class method. */
function classMethods(relativePath, entrypoint) {
  const source = sourceFile(relativePath);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined) return [];
  const rows = [];
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const declaration = declarationOf(exported, source);
    const constructorType = checker.getTypeOfSymbolAtLocation(
      exported,
      declaration
    );
    if (
      checker.getSignaturesOfType(constructorType, ts.SignatureKind.Construct)
        .length === 0
    ) {
      continue;
    }
    for (const member of publicClassMembers(exported, constructorType)) {
      const memberDeclaration = declarationOf(member, declaration);
      const flags = ts.getCombinedModifierFlags(memberDeclaration);
      if (
        (flags & ts.ModifierFlags.Private) !== 0 ||
        (flags & ts.ModifierFlags.Protected) !== 0
      ) {
        continue;
      }
      const memberType = checker.getTypeOfSymbolAtLocation(
        member,
        memberDeclaration
      );
      const signatures = checker
        .getSignaturesOfType(memberType, ts.SignatureKind.Call)
        .map((signature) => signatureShape(signature, memberDeclaration));
      if (signatures.length === 0) continue;
      rows.push({
        key: `${entrypoint}.${exported.name}.${member.name}`,
        className: exported.name,
        method: member.name,
        declaration: stableDeclarationSource(memberDeclaration.getSourceFile()),
        signatures,
        parameters: signatures[0].parameters,
        result: signatures[0].result,
      });
    }
  }
  return rows.sort((left, right) => compareExact(left.key, right.key));
}

/** Return package-owned declarations and a stable type identity. */
function sourceOwnedDeclarations(symbol) {
  return (symbol?.getDeclarations() ?? []).filter((declaration) => {
    const normalizedFileName = path.normalize(
      path.resolve(declaration.getSourceFile().fileName)
    );
    return normalizedFileName.startsWith(normalizedSourcePrefix);
  });
}
/** Return a compact stable hash used only to disambiguate generated type identities. */
function shortHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}
/** Derive one stable package-owned type identity from its declaration and rendered generic shape. */
function packageTypeIdentity(type) {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  const declarations = sourceOwnedDeclarations(symbol).filter(
    (declaration) =>
      ts.isInterfaceDeclaration(declaration) ||
      ts.isTypeAliasDeclaration(declaration) ||
      ts.isClassDeclaration(declaration) ||
      ts.isTypeLiteralNode(declaration) ||
      ts.isMappedTypeNode(declaration)
  );
  if (declarations.length === 0) return undefined;
  const declaration = declarations[0];
  const file = stableDeclarationSource(declaration.getSourceFile());
  const location = declaration
    .getSourceFile()
    .getLineAndCharacterOfPosition(declaration.getStart());
  const rendered = typeText(type, declaration);
  const baseName =
    symbol.name === "__type" || symbol.name === "__object"
      ? `anonymous@${file}:${location.line + 1}:${location.character + 1}`
      : symbol.name;
  const genericSuffix =
    (checker.getTypeArguments?.(type) ?? []).length > 0
      ? `<${shortHash(rendered)}>`
      : "";
  const name = `${baseName}${genericSuffix}`;
  return {
    identity: `${name}|${file}|${declaration.pos}|${shortHash(rendered)}`,
    name,
    declaration,
  };
}

/** Traversal diagnostics and package-owned public type records. */
const typeRecords = new Map();
const visitedDirections = new Map();
const recursiveTypeReferences = new Set();
const truncatedTypes = new Set();
const externalTypeIdentities = new WeakMap();
let maximumTypeDepth = 0;
/** Return one traversal-order-independent identity for a compiler type outside this package. */
function externalTypeIdentity(type, renderedType) {
  const existing = externalTypeIdentities.get(type);
  if (existing !== undefined) return existing;
  const symbol = type.aliasSymbol ?? type.getSymbol?.();
  const declaration = symbol?.declarations?.[0];
  const declarationAnchor = declaration === undefined
    ? "no-declaration"
    : `${stableDeclarationSource(declaration.getSourceFile())}:${declaration.pos}:${declaration.end}`;
  const identity = `external:${shortHash(`${type.flags}|${type.objectFlags ?? 0}|${declarationAnchor}|${renderedType}`)}`;
  externalTypeIdentities.set(type, identity);
  return identity;
}
/** Add one input/output reachability direction to a discovered public type row. */
function addDirection(row, direction) {
  const directions = new Set(row.directions);
  directions.add(direction);
  row.directions = [...directions].sort();
}

/** Return whether one union explicitly permits one primitive member. */
function typeIncludesFlag(type, flag) {
  return type.isUnion()
    ? type.types.some((member) => (member.flags & flag) !== 0)
    : (type.flags & flag) !== 0;
}

/** Enumerate package-owned fields, callback boundaries, and index values with explicit recursive edges. */
function visitType(type, direction, lineage = new Set(), depth = 0) {
  maximumTypeDepth = Math.max(maximumTypeDepth, depth);
  if (depth > 128) {
    truncatedTypes.add(typeText(type));
    return;
  }
  const owned = packageTypeIdentity(type);
  const renderedType = typeText(type);
  if (/\.\.\. [0-9]+ more \.\.\./u.test(renderedType)) {
    truncatedTypes.add(owned?.identity ?? renderedType);
  }
  const traversalIdentity = owned?.identity ?? externalTypeIdentity(type, renderedType);
  if (lineage.has(traversalIdentity)) {
    recursiveTypeReferences.add(traversalIdentity);
    return;
  }
  const visited = visitedDirections.get(traversalIdentity) ?? new Set();
  if (visited.has(direction)) return;
  visited.add(direction);
  visitedDirections.set(traversalIdentity, visited);
  const nextLineage = new Set(lineage);
  nextLineage.add(traversalIdentity);

  if (type.isUnionOrIntersection()) {
    for (const member of type.types) {
      visitType(member, direction, nextLineage, depth + 1);
    }
  }
  for (const argument of checker.getTypeArguments?.(type) ?? []) {
    visitType(argument, direction, nextLineage, depth + 1);
  }
  // A caller-supplied callback has semantic arguments and a semantic return even when its function node is anonymous.
  for (const signature of checker.getSignaturesOfType(
    type,
    ts.SignatureKind.Call
  )) {
    for (const parameter of signature.getParameters()) {
      const parameterDeclaration = declarationOf(
        parameter,
        signature.declaration ?? sourceFile("src/index.ts")
      );
      visitType(
        checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration),
        "callback-argument",
        nextLineage,
        depth + 1
      );
    }
    visitType(
      checker.getReturnTypeOfSignature(signature),
      "callback-result",
      nextLineage,
      depth + 1
    );
  }
  const stringIndexType = checker.getIndexTypeOfType(type, ts.IndexKind.String);
  if (stringIndexType !== undefined) {
    visitType(stringIndexType, direction, nextLineage, depth + 1);
  }
  const numberIndexType = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
  if (numberIndexType !== undefined && numberIndexType !== stringIndexType) {
    visitType(numberIndexType, direction, nextLineage, depth + 1);
  }
  if (owned === undefined) return;

  let record = typeRecords.get(owned.identity);
  if (record === undefined) {
    record = {
      name: owned.name,
      identity: owned.identity,
      source: stableDeclarationSource(owned.declaration.getSourceFile()),
      directions: [],
      fields: [],
    };
    typeRecords.set(owned.identity, record);
  }
  addDirection(record, direction);
  const byName = new Map(record.fields.map((field) => [field.name, field]));
  for (const property of checker.getPropertiesOfType(type)) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (
      declaration === undefined ||
      ts.isMethodDeclaration(declaration) ||
      ts.isMethodSignature(declaration)
    ) {
      continue;
    }
    const propertyType = checker.getTypeOfSymbolAtLocation(
      property,
      declaration
    );
    const rendered = typeText(propertyType, declaration);
    let field = byName.get(property.name);
    if (field === undefined) {
      field = {
        name: property.name,
        type: rendered,
        optional: (property.flags & ts.SymbolFlags.Optional) !== 0,
        allowsUndefined: typeIncludesFlag(propertyType, ts.TypeFlags.Undefined),
        allowsNull: typeIncludesFlag(propertyType, ts.TypeFlags.Null),
        callable:
          checker.getSignaturesOfType(propertyType, ts.SignatureKind.Call)
            .length > 0,
        callSignatures: checker
          .getSignaturesOfType(propertyType, ts.SignatureKind.Call)
          .map((signature) => signatureShape(signature, declaration)),
        source: stableDeclarationSource(declaration.getSourceFile()),
        directions: [],
      };
      record.fields.push(field);
      byName.set(property.name, field);
    } else if (field.type !== rendered) {
      throw new Error(
        `Public field '${record.name}.${property.name}' has two resolved types.`
      );
    }
    addDirection(field, direction);
    visitType(propertyType, direction, nextLineage, depth + 1);
  }
  record.fields.sort((left, right) => compareExact(left.name, right.name));
}

/** Traverse all overloads on one public interface. */
function visitInterfaceTypes(relativePath, name) {
  const declaration = interfaceDeclaration(relativePath, name);
  const interfaceType = checker.getTypeAtLocation(declaration);
  for (const member of checker.getPropertiesOfType(interfaceType)) {
    const memberDeclaration = declarationOf(member, declaration);
    const memberType = checker.getTypeOfSymbolAtLocation(
      member,
      memberDeclaration
    );
    for (const signature of checker.getSignaturesOfType(
      memberType,
      ts.SignatureKind.Call
    )) {
      for (const parameter of signature.getParameters()) {
        const parameterDeclaration = declarationOf(
          parameter,
          memberDeclaration
        );
        visitType(
          checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration),
          "input"
        );
      }
      visitType(checker.getReturnTypeOfSignature(signature), "output");
    }
  }
}

/** Traverse exported functions/constructors and exported class methods. */
function visitEntrypointTypes(relativePath) {
  const source = sourceFile(relativePath);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined) return;
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const declaration = declarationOf(exported, source);
    const exportedType = checker.getTypeOfSymbolAtLocation(
      exported,
      declaration
    );
    for (const signature of [
      ...checker.getSignaturesOfType(exportedType, ts.SignatureKind.Call),
      ...checker.getSignaturesOfType(exportedType, ts.SignatureKind.Construct),
    ]) {
      for (const parameter of signature.getParameters()) {
        const parameterDeclaration = declarationOf(parameter, declaration);
        visitType(
          checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration),
          "input"
        );
      }
      visitType(checker.getReturnTypeOfSignature(signature), "output");
    }
    if (
      checker.getSignaturesOfType(exportedType, ts.SignatureKind.Construct)
        .length === 0
    ) {
      continue;
    }
    for (const member of publicClassMembers(exported, exportedType)) {
      const memberDeclaration = declarationOf(member, declaration);
      const flags = ts.getCombinedModifierFlags(memberDeclaration);
      if (
        (flags & ts.ModifierFlags.Private) !== 0 ||
        (flags & ts.ModifierFlags.Protected) !== 0
      ) {
        continue;
      }
      const memberType = checker.getTypeOfSymbolAtLocation(
        member,
        memberDeclaration
      );
      for (const signature of checker.getSignaturesOfType(
        memberType,
        ts.SignatureKind.Call
      )) {
        for (const parameter of signature.getParameters()) {
          const parameterDeclaration = declarationOf(
            parameter,
            memberDeclaration
          );
          visitType(
            checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration),
            "input"
          );
        }
        visitType(checker.getReturnTypeOfSignature(signature), "output");
      }
    }
  }
}

const facade = facadeInterfaces.flatMap(([name, prefix]) =>
  methodsOfInterface("src/facade.ts", name, prefix)
);
const authority = methodsOfInterface(
  "src/authority.ts",
  "InventoryAuthorityControlPort",
  "authority"
);
const storage = methodsOfInterface(
  "src/storage.ts",
  "InventoryDurableStorage",
  "storage"
);
const entrypoints = Object.fromEntries(
  Object.entries(entrypointSources).map(([name, relativePath]) => [
    name,
    moduleExports(relativePath),
  ])
);
const classes = Object.entries(entrypointSources)
  .flatMap(([name, relativePath]) => classMethods(relativePath, name))
  .sort((left, right) => compareExact(left.key, right.key));

for (const [name] of facadeInterfaces) {
  visitInterfaceTypes("src/facade.ts", name);
}
visitInterfaceTypes("src/authority.ts", "InventoryAuthorityControlPort");
visitInterfaceTypes("src/storage.ts", "InventoryDurableStorage");
for (const relativePath of Object.values(entrypointSources)) {
  visitEntrypointTypes(relativePath);
}

const types = [...typeRecords.values()]
  .map((record) => ({
    ...record,
    directions: [...record.directions].sort(),
    fields: record.fields.map((field) => ({
      ...field,
      directions: [...field.directions].sort(),
    })),
  }))
  .sort((left, right) => compareExact(left.identity, right.identity));

return {
      facade,
      authority,
      storage,
      entrypoints,
      classes,
      types,
      diagnostics: {
        maximumTypeDepth,
        recursiveTypeReferences: [...recursiveTypeReferences].sort(),
        truncatedTypes: [...truncatedTypes].sort(),
      },
    };
}

module.exports = { discoverImplementationSurface };
if (require.main === module) console.log(JSON.stringify(discoverImplementationSurface(), undefined, 2));
