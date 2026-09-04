const ts = require("typescript");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
/** Normalize compiler paths before comparing Windows and POSIX source roots. */
function normalizedPath(value) {
  return value.replaceAll("\\", "/");
}
const sourceRoot = normalizedPath(path.join(root, "src"));
const testRoot = normalizedPath(path.join(root, "test"));
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
const program = ts.createProgram({
  rootNames: parsed.fileNames,
  options: parsed.options,
});
const checker = program.getTypeChecker();
const surface = JSON.parse(
  execFileSync(
    process.execPath,
    [path.join(__dirname, "formal-implementation-surface.cjs")],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  )
);

const packageSources = program.getSourceFiles().filter((source) => {
  const fileName = normalizedPath(source.fileName);
  return (
    !source.isDeclarationFile &&
    (fileName.startsWith(`${sourceRoot}/`) || fileName.startsWith(`${testRoot}/`))
  );
});
const productionSources = packageSources.filter((source) =>
  normalizedPath(source.fileName).startsWith(`${sourceRoot}/`)
);
const executableTestSources = packageSources.filter((source) => {
  const fileName = normalizedPath(source.fileName);
  return (
    fileName.startsWith(`${testRoot}/`) && /\.(?:test|spec)\.tsx?$/u.test(fileName)
  );
});
if (productionSources.length === 0) {
  throw new Error(`Compiler call graph found no production sources below '${sourceRoot}'.`);
}
if (executableTestSources.length === 0) {
  throw new Error(`Compiler call graph found no executable tests below '${testRoot}'.`);
}

function relativeFile(source) {
  return path.relative(root, source.fileName).replaceAll("\\", "/");
}
function locationOf(node) {
  const source = node.getSourceFile();
  const location = source.getLineAndCharacterOfPosition(node.getStart(source));
  return {
    file: relativeFile(source),
    line: location.line + 1,
    column: location.character + 1,
  };
}
function callableName(node) {
  if (node.name !== undefined && typeof node.name.getText === "function") {
    return node.name.getText(node.getSourceFile());
  }
  if (ts.isConstructorDeclaration(node)) {
    return node.parent?.name?.getText(node.getSourceFile()) ?? "constructor";
  }
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent)) {
    return parent.name.getText(node.getSourceFile());
  }
  return `<anonymous@${locationOf(node).line}>`;
}
function callableId(node) {
  return `${relativeFile(
    node.getSourceFile()
  )}:${node.getStart()}:${callableName(node)}`;
}
function callableDescription(node) {
  const location = locationOf(node);
  return {
    id: callableId(node),
    name: callableName(node),
    ...location,
    kind: ts.SyntaxKind[node.kind],
    hasBody: node.body !== undefined,
  };
}
function isCallable(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

const callables = new Map();
const declarationToCallable = new Map();
function registerCallable(node) {
  const id = callableId(node);
  callables.set(id, callables.get(id) ?? callableDescription(node));
  declarationToCallable.set(node, id);
  return id;
}
for (const source of packageSources) {
  function visit(node) {
    if (isCallable(node)) registerCallable(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
}

const edges = new Map();
const edgeReasons = new Map();
function addEdge(from, to, reason) {
  if (from === undefined || to === undefined || from === to) return;
  const targets = edges.get(from) ?? new Set();
  targets.add(to);
  edges.set(from, targets);
  edgeReasons.set(`${from}\n${to}`, reason);
}
function enclosingCallable(node) {
  let current = node.parent;
  while (current !== undefined) {
    const id = declarationToCallable.get(current);
    if (id !== undefined) return id;
    current = current.parent;
  }
  return undefined;
}
function resolvedCallableTargets(declaration) {
  if (declaration === undefined) return [];
  const direct = declarationToCallable.get(declaration);
  if (direct !== undefined) return [direct];
  if (
    (ts.isVariableDeclaration(declaration) ||
      ts.isPropertyDeclaration(declaration)) &&
    declaration.initializer !== undefined
  ) {
    const target = declarationToCallable.get(declaration.initializer);
    return target === undefined ? [] : [target];
  }
  if (ts.isClassDeclaration(declaration)) {
    return declaration.members
      .filter(ts.isConstructorDeclaration)
      .map((member) => declarationToCallable.get(member))
      .filter((value) => value !== undefined);
  }
  return [];
}
function resolvedTargetsOfExpression(expression) {
  const symbol = checker.getSymbolAtLocation(expression);
  if (symbol === undefined) return [];
  const resolved =
    (symbol.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  return (resolved.getDeclarations() ?? []).flatMap(resolvedCallableTargets);
}

/** Link overload/interface declarations to package-owned bodies sharing one symbol. */
const callableIdsBySymbol = new Map();
for (const source of packageSources) {
  function visit(node) {
    const id = declarationToCallable.get(node);
    if (id !== undefined && node.name !== undefined) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol !== undefined) {
        const resolved =
          (symbol.flags & ts.SymbolFlags.Alias) !== 0
            ? checker.getAliasedSymbol(symbol)
            : symbol;
        const ids = callableIdsBySymbol.get(resolved) ?? new Set();
        ids.add(id);
        callableIdsBySymbol.set(resolved, ids);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
for (const ids of callableIdsBySymbol.values()) {
  const concrete = [...ids].filter((id) => callables.get(id)?.hasBody === true);
  for (const id of ids) {
    if (callables.get(id)?.hasBody === true) continue;
    for (const target of concrete) addEdge(id, target, "overload-to-body");
  }
}

/** Link interface method signatures to package classes explicitly implementing them. */
const implementationsByInterfaceMember = new Map();
const classMethodsByClassAndName = new Map();
for (const source of productionSources) {
  function visit(node) {
    if (ts.isClassDeclaration(node)) {
      const className = node.name?.text;
      if (className !== undefined) {
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member) || member.name === undefined) continue;
          const methodName = member.name.getText(source);
          const implementationId = declarationToCallable.get(member);
          if (implementationId === undefined) continue;
          const key = `${className}.${methodName}`;
          const values = classMethodsByClassAndName.get(key) ?? new Set();
          values.add(implementationId);
          classMethodsByClassAndName.set(key, values);
        }
      }
      const interfaces = (node.heritageClauses ?? [])
        .filter((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword)
        .flatMap((clause) => clause.types)
        .map((typeNode) => checker.getTypeAtLocation(typeNode));
      for (const interfaceType of interfaces) {
        const interfaceSymbol =
          interfaceType.aliasSymbol ?? interfaceType.getSymbol();
        if (interfaceSymbol === undefined) continue;
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member) || member.name === undefined)
            continue;
          const methodName = member.name.getText(source);
          const implementationId = declarationToCallable.get(member);
          const interfaceMember = checker.getPropertyOfType(
            interfaceType,
            methodName
          );
          if (implementationId === undefined || interfaceMember === undefined)
            continue;
          for (const declaration of interfaceMember.getDeclarations() ?? []) {
            const interfaceId = declarationToCallable.get(declaration);
            if (interfaceId === undefined) continue;
            addEdge(
              interfaceId,
              implementationId,
              "interface-to-implementation"
            );
            const key = `${interfaceSymbol.name}.${methodName}`;
            const values =
              implementationsByInterfaceMember.get(key) ?? new Set();
            values.add(implementationId);
            implementationsByInterfaceMember.set(key, values);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

/** Every executable test file is one root; only registered test/hook callbacks start execution. */
const roots = new Map();
for (const source of executableTestSources) {
  const rootId = `test-root:${relativeFile(source)}`;
  const rootDescription = {
    id: rootId,
    name: relativeFile(source),
    file: relativeFile(source),
    line: 1,
    column: 1,
    kind: "TestRoot",
    hasBody: true,
  };
  roots.set(rootId, rootDescription);
  callables.set(rootId, rootDescription);
}
function testRootFor(source) {
  return roots.get(`test-root:${relativeFile(source)}`)?.id;
}
function isTestCallback(node) {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return false;
  if (!ts.isCallExpression(node.parent)) return false;
  const callee = node.parent.expression.getText(node.getSourceFile());
  return /(?:^|\.)(?:it|test|describe|beforeAll|beforeEach|afterAll|afterEach)(?:\.|\(|$)/u.test(
    callee
  );
}

/** Add statically resolved calls and callback dispatch from tests and production bodies. */
for (const source of packageSources) {
  function visit(node) {
    if (
      isTestCallback(node) &&
      normalizedPath(source.fileName).startsWith(`${testRoot}/`)
    ) {
      addEdge(
        testRootFor(source),
        declarationToCallable.get(node),
        "test-callback"
      );
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const caller =
        enclosingCallable(node) ??
        (normalizedPath(source.fileName).startsWith(`${testRoot}/`)
          ? testRootFor(source)
          : undefined);
      const signature = checker.getResolvedSignature(node);
      for (const target of resolvedCallableTargets(signature?.declaration)) {
        addEdge(caller, target, "resolved-call");
      }
      for (const argument of node.arguments ?? []) {
        if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
          addEdge(
            caller,
            declarationToCallable.get(argument),
            "callback-argument"
          );
        } else {
          for (const target of resolvedTargetsOfExpression(argument)) {
            addEdge(caller, target, "callback-reference");
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

/** Multi-root breadth-first tested call-chain reachability. */
const predecessor = new Map();
const rootOf = new Map();
const pending = [];
for (const rootId of roots.keys()) {
  predecessor.set(rootId, undefined);
  rootOf.set(rootId, rootId);
  pending.push(rootId);
}
for (let index = 0; index < pending.length; index += 1) {
  const current = pending[index];
  for (const target of edges.get(current) ?? []) {
    if (predecessor.has(target)) continue;
    predecessor.set(target, current);
    rootOf.set(target, rootOf.get(current));
    pending.push(target);
  }
}
function witnessFor(target) {
  if (!predecessor.has(target)) return undefined;
  const ids = [];
  let current = target;
  while (current !== undefined) {
    ids.push(current);
    current = predecessor.get(current);
  }
  ids.reverse();
  return {
    test: callables.get(rootOf.get(target))?.file,
    chain: ids.map((id, index) => ({
      ...callables.get(id),
      ...(index === 0
        ? {}
        : { reason: edgeReasons.get(`${ids[index - 1]}\n${id}`) }),
    })),
  };
}

/** Resolve concrete declarations behind one module export. */
function moduleExportTargets(entrypoint, exportName) {
  const relativePath = {
    root: "src/index.ts",
    storage: "src/storage-api.ts",
    migrations: "src/migrations-api.ts",
    kernel: "src/kernel.ts",
  }[entrypoint];
  if (relativePath === undefined) {
    throw new Error(`Unknown InventoryOnce entrypoint '${entrypoint}'.`);
  }
  const source = program.getSourceFile(path.join(root, relativePath));
  const moduleSymbol =
    source === undefined ? undefined : checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined) return [];
  const exported = checker
    .getExportsOfModule(moduleSymbol)
    .find((symbol) => symbol.name === exportName);
  if (exported === undefined) return [];
  const resolved =
    (exported.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(exported)
      : exported;
  return (resolved.getDeclarations() ?? []).flatMap(resolvedCallableTargets);
}
function classMethodTargets(className, methodName) {
  return [...(classMethodsByClassAndName.get(`${className}.${methodName}`) ?? [])];
}

function interfaceImplementationTargets(interfaceName, methodName) {
  return [
    ...(implementationsByInterfaceMember.get(
      `${interfaceName}.${methodName}`
    ) ?? []),
  ];
}

/** Public API keys exactly match API_ASSURANCE.json generation. */
const publicTargets = new Map();
for (const row of surface.facade) {
  publicTargets.set(
    `facade.${row.key}`,
    interfaceImplementationTargets(row.interface, row.method)
  );
}
for (const row of surface.authority) {
  publicTargets.set(
    `authority-port.${row.method}`,
    interfaceImplementationTargets(row.interface, row.method)
  );
}
for (const row of surface.storage) {
  publicTargets.set(
    `storage-port.${row.method}`,
    interfaceImplementationTargets(row.interface, row.method)
  );
}
for (const [entrypoint, rows] of Object.entries(surface.entrypoints)) {
  for (const row of rows) {
    publicTargets.set(
      `entrypoint.${entrypoint}.${row.name}`,
      moduleExportTargets(entrypoint, row.name)
    );
  }
}
for (const row of surface.classes) {
  publicTargets.set(
    `class.${row.key}`,
    classMethodTargets(row.className, row.method)
  );
}

const entries = {};
for (const [key, targets] of [...publicTargets].sort(([left], [right]) =>
  left.localeCompare(right)
)) {
  const uniqueTargets = [...new Set(targets)];
  const witnesses = uniqueTargets
    .map((target) => ({
      target: callables.get(target),
      witness: witnessFor(target),
    }))
    .filter((row) => row.witness !== undefined);
  entries[key] = {
    targets: uniqueTargets.map((target) => callables.get(target)),
    witnesses,
    unresolvedTargets: uniqueTargets
      .filter((target) => !predecessor.has(target))
      .map((target) => callables.get(target)),
  };
}

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      counts: {
        callables: callables.size,
        edges: [...edges.values()].reduce(
          (sum, values) => sum + values.size,
          0
        ),
        testRoots: roots.size,
        publicEntries: Object.keys(entries).length,
        publicEntriesWithTargets: Object.values(entries).filter(
          (entry) => entry.targets.length > 0
        ).length,
        publicEntriesWithWitnesses: Object.values(entries).filter(
          (entry) => entry.witnesses.length > 0
        ).length,
        unresolvedPublicEntries: Object.values(entries).filter(
          (entry) => entry.witnesses.length === 0
        ).length,
      },
      entries,
    },
    undefined,
    2
  )
);
