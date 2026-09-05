const ts = require("typescript");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  vitestCallbackExecutes,
  vitestRegistrationName,
  vitestSuiteChildrenExecute,
} = require("./formal-implementation-vitest-semantics.cjs");

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

/** Return one compiler source path relative to the repository root. */
function relativeFile(source) {
  return path.relative(root, source.fileName).replaceAll("\\", "/");
}
/** Return the repository-relative source location for one compiler node. */
function locationOf(node) {
  const source = node.getSourceFile();
  const location = source.getLineAndCharacterOfPosition(node.getStart(source));
  return {
    file: relativeFile(source),
    line: location.line + 1,
    column: location.character + 1,
  };
}
/** Derive a stable human-readable name for one callable compiler node. */
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
/** Derive the stable call-graph identity for one callable compiler node. */
function callableId(node) {
  return `${relativeFile(
    node.getSourceFile()
  )}:${node.getStart()}:${callableName(node)}`;
}
/** Describe one callable with its stable identity and source location. */
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
/** Return whether one compiler node represents a callable declaration or body. */
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

/** Stable callable descriptions keyed by compiler-derived callable id. */
const callables = new Map();
/** Compiler callable nodes keyed by the same stable callable id. */
const callableNodeById = new Map();
/** Callable ids keyed by their declaration/compiler node. */
const declarationToCallable = new Map();
/** Register one callable node in the compiler-resolved call graph. */
function registerCallable(node) {
  const id = callableId(node);
  callables.set(id, callables.get(id) ?? callableDescription(node));
  callableNodeById.set(id, node);
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

/** Outbound call-graph targets retained for every discovered caller. */
const edges = new Map();
/** Edge provenance keyed by caller/target identity. */
const edgeReasons = new Map();
/** Add one directed call-graph edge with its resolution reason. */
function addEdge(from, to, reason) {
  if (from === undefined || to === undefined || from === to) return;
  const targets = edges.get(from) ?? new Set();
  targets.add(to);
  edges.set(from, targets);
  edgeReasons.set(`${from}\n${to}`, reason);
}
/** Find the nearest registered callable that lexically encloses one node. */
function enclosingCallable(node) {
  let current = node.parent;
  while (current !== undefined) {
    const id = declarationToCallable.get(current);
    if (id !== undefined) return id;
    current = current.parent;
  }
  return undefined;
}
/** Resolve one declaration to package-owned callable targets. */
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
/** Resolve one expression symbol to package-owned callable targets. */
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
/** Callable ids indexed by resolved TypeScript symbol. */
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
/** Concrete implementation ids indexed by interface member identity. */
const implementationsByInterfaceMember = new Map();
/** Class method ids indexed by class and method name. */
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
/** Return the synthetic executable-test root for one source file. */
function testRootFor(source) {
  return roots.get(`test-root:${relativeFile(source)}`)?.id;
}
/** Return a statically known boolean, or undefined when runtime evaluation would be required. */
function staticBooleanValue(node) {
  if (node === undefined) return undefined;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isParenthesizedExpression(node)) return staticBooleanValue(node.expression);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const value = staticBooleanValue(node.operand);
    return value === undefined ? undefined : !value;
  }
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) {
    return staticBooleanValue(node.expression);
  }
  return undefined;
}

/** Return whether one chained Vitest registration expression contains an exact property modifier. */
function vitestExpressionHasProperty(expression, propertyName) {
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text === propertyName || vitestExpressionHasProperty(expression.expression, propertyName);
  }
  if (ts.isCallExpression(expression)) {
    return vitestExpressionHasProperty(expression.expression, propertyName);
  }
  return false;
}

/** Return the nearest skipIf/runIf condition carried by one chained registration expression. */
function vitestConditionalMetadata(expression) {
  if (ts.isCallExpression(expression)) {
    if (ts.isPropertyAccessExpression(expression.expression)) {
      const name = expression.expression.name.text;
      if (name === "skipIf" || name === "runIf") {
        return {
          conditionKind: name,
          conditionValue: staticBooleanValue(expression.arguments[0]),
        };
      }
    }
    return vitestConditionalMetadata(expression.expression);
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return vitestConditionalMetadata(expression.expression);
  }
  return {};
}

/** Read a boolean skip/todo option from one object literal without executing test code. */
function vitestObjectBooleanOptions(object) {
  let skip = false;
  let todo = false;
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      skip = undefined;
      todo = undefined;
      continue;
    }
    let name;
    if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
      name = property.name.getText(object.getSourceFile()).replace(/^['"]|['"]$/gu, "");
    } else {
      continue;
    }
    if (name !== "skip" && name !== "todo") continue;
    const value = ts.isPropertyAssignment(property)
      ? staticBooleanValue(property.initializer)
      : undefined;
    if (name === "skip") skip = value;
    else todo = value;
  }
  return { skip, todo };
}

/** Resolve the effective static mode for a test/suite registration callback argument. */
function vitestRegistrationMode(node, callbackArgumentIndex) {
  if (vitestExpressionHasProperty(node.expression, "skip")) return "skip";
  if (vitestExpressionHasProperty(node.expression, "todo")) return "todo";
  if (callbackArgumentIndex !== 2) return "run";
  const options = node.arguments[1];
  if (options === undefined || (ts.isIdentifier(options) && options.text === "undefined")) {
    return "run";
  }
  if (!ts.isObjectLiteralExpression(options)) return "unknown";
  const flags = vitestObjectBooleanOptions(options);
  if (flags.skip === true) return "skip";
  if (flags.todo === true) return "todo";
  if (flags.skip === undefined || flags.todo === undefined) return "unknown";
  return "run";
}

/** Return whether one call resolves to the installed Vitest registration contract. */
function isVitestRegistrationCall(node) {
  const declaration = checker.getResolvedSignature(node)?.declaration;
  if (declaration === undefined) return false;
  const declarationPath = normalizedPath(declaration.getSourceFile().fileName);
  return /\/node_modules\/(?:vitest|@vitest\/runner)\//u.test(declarationPath);
}

/** Build conservative static execution metadata for one Vitest registration callback. */
function vitestRegistrationMetadata(node, callbackArgumentIndex, insideNonExecutingSuite) {
  const callee = node.expression.getText(node.getSourceFile());
  const registration = isVitestRegistrationCall(node)
    ? vitestRegistrationName(callee)
    : undefined;
  return {
    registration,
    mode: vitestRegistrationMode(node, callbackArgumentIndex),
    ...vitestConditionalMetadata(node.expression),
    insideNonExecutingSuite,
  };
}

/** Return whether this node is lexically nested in a suite whose tests/hooks cannot execute. */
function isInsideNonExecutingSuite(node) {
  let current = node.parent;
  while (current !== undefined) {
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && ts.isCallExpression(current.parent)) {
      const callbackIndex = current.parent.arguments.indexOf(current);
      if (callbackIndex >= 0) {
        const metadata = vitestRegistrationMetadata(current.parent, callbackIndex, false);
        if (metadata.registration === "describe" && !vitestSuiteChildrenExecute(metadata)) {
          return true;
        }
      }
    }
    current = current.parent;
  }
  return false;
}

/** Return the nearest enclosing Vitest suite callback, or the whole file for top-level hooks. */
function vitestSuiteExecutionRoot(node) {
  let current = node.parent;
  while (current !== undefined) {
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && ts.isCallExpression(current.parent)) {
      const callbackIndex = current.parent.arguments.indexOf(current);
      if (callbackIndex >= 0) {
        const metadata = vitestRegistrationMetadata(current.parent, callbackIndex, false);
        if (metadata.registration === "describe") return current;
      }
    }
    current = current.parent;
  }
  return node.getSourceFile();
}

/** Cache suite/file runnable-test decisions because multiple hooks share one execution root. */
const vitestRunnableSuiteCache = new WeakMap();

/** Return the callback argument index for one test registration, or -1 when no callable argument exists. */
function vitestTestCallbackArgumentIndex(node) {
  for (let index = 1; index < node.arguments.length; index += 1) {
    const argument = node.arguments[index];
    if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) return index;
    const argumentType = checker.getTypeAtLocation(argument);
    if (checker.getSignaturesOfType(argumentType, ts.SignatureKind.Call).length > 0) {
      return index;
    }
  }
  return -1;
}

/** Return whether the hook's suite/file contains any statically runnable test. */
function vitestSuiteHasRunnableTest(node) {
  const root = vitestSuiteExecutionRoot(node);
  const cached = vitestRunnableSuiteCache.get(root);
  if (cached !== undefined) return cached;
  let found = false;
  const visit = (current) => {
    if (found) return;
    if (ts.isCallExpression(current) && isVitestRegistrationCall(current)) {
      const registration = vitestRegistrationName(
        current.expression.getText(current.getSourceFile())
      );
      if (registration === "it" || registration === "test") {
        const callbackIndex = vitestTestCallbackArgumentIndex(current);
        if (callbackIndex >= 0) {
          const metadata = vitestRegistrationMetadata(
            current,
            callbackIndex,
            isInsideNonExecutingSuite(current)
          );
          if (!metadata.insideNonExecutingSuite && vitestRegistrationRuns(metadata)) {
            found = true;
            return;
          }
        }
      }
    }
    ts.forEachChild(current, visit);
  };
  ts.forEachChild(root, visit);
  vitestRunnableSuiteCache.set(root, found);
  return found;
}

/** Add suite-level execution evidence needed to decide whether hooks actually run. */
function vitestExecutionMetadata(node, callbackArgumentIndex, insideNonExecutingSuite) {
  const metadata = vitestRegistrationMetadata(
    node,
    callbackArgumentIndex,
    insideNonExecutingSuite
  );
  if (
    metadata.registration !== "beforeAll" &&
    metadata.registration !== "beforeEach" &&
    metadata.registration !== "afterAll" &&
    metadata.registration !== "afterEach"
  ) {
    return metadata;
  }
  return {
    ...metadata,
    suiteHasRunnableTest:
      insideNonExecutingSuite === true ? false : vitestSuiteHasRunnableTest(node),
  };
}

/** Return whether one test-runner callback is actually executed by Vitest. */
function isTestCallback(node) {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return false;
  if (!ts.isCallExpression(node.parent)) return false;
  const callbackIndex = node.parent.arguments.indexOf(node);
  if (callbackIndex < 0) return false;
  return vitestCallbackExecutes(
    vitestExecutionMetadata(
      node.parent,
      callbackIndex,
      isInsideNonExecutingSuite(node)
    )
  );
}

/** Resolve an aliased compiler symbol without changing package ownership. */
function resolvedSymbolAt(node) {
  const symbol = checker.getSymbolAtLocation(node);
  if (symbol === undefined) return undefined;
  return (symbol.flags & ts.SymbolFlags.Alias) !== 0
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

/** Resolve concrete package bodies behind one call signature declaration. */
function concreteCallableTargets(declaration) {
  const result = new Set();
  const pending = [...resolvedCallableTargets(declaration)];
  const visited = new Set();
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || visited.has(id)) continue;
    visited.add(id);
    if (callables.get(id)?.hasBody === true) {
      result.add(id);
      continue;
    }
    for (const target of edges.get(id) ?? []) {
      const reason = edgeReasons.get(`${id}\n${target}`);
      if (
        reason === "overload-to-body" ||
        reason === "interface-to-implementation"
      ) {
        pending.push(target);
      }
    }
  }
  return [...result];
}

/** Resolve callable package targets carried by one argument expression. */
function callbackTargets(argument) {
  if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
    const target = declarationToCallable.get(argument);
    return target === undefined ? [] : [target];
  }
  return resolvedTargetsOfExpression(argument);
}

/** Standard-library methods whose first argument is synchronously dispatched as a callback. */
const arrayCallbackMethods = new Set([
  "map", "flatMap", "filter", "forEach", "some", "every", "find",
  "findIndex", "findLast", "findLastIndex", "reduce", "reduceRight",
  "sort", "toSorted",
]);

/** Return callback argument indexes whose external contract is known to invoke them. */
function externalCallbackArgumentIndexes(node) {
  const indexes = new Set();
  const sourcePath = normalizedPath(node.getSourceFile().fileName);
  const expressionText = node.expression.getText(node.getSourceFile());
  if (
    sourcePath.startsWith(`${testRoot}/`) &&
    isVitestRegistrationCall(node) &&
    vitestRegistrationName(expressionText) !== undefined
  ) {
    const insideNonExecutingSuite = isInsideNonExecutingSuite(node);
    for (let index = 0; index < (node.arguments?.length ?? 0); index += 1) {
      if (callbackTargets(node.arguments[index]).length === 0) continue;
      if (
        vitestCallbackExecutes(
          vitestExecutionMetadata(node, index, insideNonExecutingSuite)
        )
      ) {
        indexes.add(index);
      }
    }
  }
  const signature = checker.getResolvedSignature(node);
  const declaration = signature?.declaration;
  const declarationPath = declaration === undefined ? "" : normalizedPath(declaration.getSourceFile().fileName);
  const typescriptLibrary = /\/typescript\/lib\/lib\..*\.d\.ts$/u.test(declarationPath);
  if (!typescriptLibrary) return indexes;
  let methodName;
  if (ts.isPropertyAccessExpression(node.expression)) methodName = node.expression.name.text;
  else if (ts.isIdentifier(node.expression)) methodName = node.expression.text;
  if (arrayCallbackMethods.has(methodName)) indexes.add(0);
  else if (methodName === "then") { indexes.add(0); indexes.add(1); }
  else if (methodName === "catch" || methodName === "finally") indexes.add(0);
  else if (methodName === "from") indexes.add(1);
  if (ts.isNewExpression(node) && node.expression.getText(node.getSourceFile()) === "Promise") indexes.add(0);
  return indexes;
}

/** Memoized proof that a concrete callable invokes a parameter as a callback. */
const parameterInvocationMemo = new Map();
/** Active parameter-invocation proofs used to break recursive analysis cycles. */
const parameterInvocationActive = new Set();

/** Return whether one concrete package callable executes the named parameter. */
function callableInvokesParameter(callableId, parameterIndex) {
  const key = `${callableId}:${parameterIndex}`;
  if (parameterInvocationMemo.has(key)) return parameterInvocationMemo.get(key);
  if (parameterInvocationActive.has(key)) return false;
  const callable = callableNodeById.get(callableId);
  const parameter = callable?.parameters?.[parameterIndex];
  if (callable === undefined || parameter === undefined || !ts.isIdentifier(parameter.name)) {
    parameterInvocationMemo.set(key, false);
    return false;
  }
  const parameterSymbol = resolvedSymbolAt(parameter.name);
  if (parameterSymbol === undefined) {
    parameterInvocationMemo.set(key, false);
    return false;
  }
  parameterInvocationActive.add(key);
  const inspectedCallbacks = new Set();
  function scan(current, callableRoot) {
    if (current !== callableRoot && isCallable(current)) return false;
    if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
      if (resolvedSymbolAt(current.expression) === parameterSymbol) return true;
      for (let index = 0; index < (current.arguments?.length ?? 0); index += 1) {
        if (!callInvokesArgument(current, index)) continue;
        const argument = current.arguments[index];
        if (resolvedSymbolAt(argument) === parameterSymbol) return true;
        for (const target of callbackTargets(argument)) {
          if (inspectedCallbacks.has(target)) continue;
          inspectedCallbacks.add(target);
          const targetNode = callableNodeById.get(target);
          if (targetNode !== undefined && scan(targetNode, targetNode)) return true;
        }
      }
    }
    let found = false;
    ts.forEachChild(current, (child) => { if (!found && scan(child, callableRoot)) found = true; });
    return found;
  }
  const result = scan(callable, callable);
  parameterInvocationActive.delete(key);
  parameterInvocationMemo.set(key, result);
  return result;
}

/** Return whether this call contract executes one argument as a callback. */
function callInvokesArgument(node, argumentIndex) {
  if (externalCallbackArgumentIndexes(node).has(argumentIndex)) return true;
  const signature = checker.getResolvedSignature(node);
  const targets = concreteCallableTargets(signature?.declaration);
  return targets.length > 0 && targets.every((target) => callableInvokesParameter(target, argumentIndex));
}

/** Add statically resolved calls and only contract-proven callback dispatch. */
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
      const concreteCallees = concreteCallableTargets(signature?.declaration);
      for (let index = 0; index < (node.arguments?.length ?? 0); index += 1) {
        if (!callInvokesArgument(node, index)) continue;
        const targets = callbackTargets(node.arguments[index]);
        if (targets.length === 0) continue;
        if (concreteCallees.length === 0) {
          for (const target of targets) addEdge(caller, target, "external-callback-dispatch");
          continue;
        }
        for (const callee of concreteCallees) {
          if (!callableInvokesParameter(callee, index)) continue;
          for (const target of targets) addEdge(callee, target, "callback-dispatch");
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

/** Multi-root breadth-first tested call-chain reachability. */
/** First predecessor retained for each callable reached from an executable test root. */
const predecessor = new Map();
/** Originating executable test root retained for each reached callable. */
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
/** Reconstruct one executable-test call-chain witness to a target callable. */
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
/** Return concrete callable targets for one public class method. */
function classMethodTargets(className, methodName) {
  return [...(classMethodsByClassAndName.get(`${className}.${methodName}`) ?? [])];
}

/** Return concrete implementations for one public interface method. */
function interfaceImplementationTargets(interfaceName, methodName) {
  return [
    ...(implementationsByInterfaceMember.get(
      `${interfaceName}.${methodName}`
    ) ?? []),
  ];
}

/** Public API keys exactly match API_ASSURANCE.json generation. */
/** Concrete callable targets indexed by public assurance API key. */
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
  left < right ? -1 : left > right ? 1 : 0
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
