/** Return the syntactic Vitest primitive after the caller has established Vitest symbol ownership. */
function vitestRegistrationName(callee) {
  const match = /(?:^|\.)(it|test|describe|beforeAll|beforeEach|afterAll|afterEach)(?:\.|$)/u.exec(callee);
  return match?.[1];
}

/** Remove wrappers that do not change a JavaScript expression's runtime value. */
function unwrappedExpression(ts, expression) {
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression;
  return expression;
}

/** Decode both dotted and literal-indexed property access; dynamic keys stay unknown. */
function staticAccessName(ts, expression) {
  expression = unwrappedExpression(ts, expression);
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression)) {
    const key = unwrappedExpression(ts, expression.argumentExpression);
    if (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key) || ts.isNumericLiteral(key)) return key.text;
  }
  return undefined;
}

/** Visit a registration chain in evaluation order using one shared access/wrapper interpretation. */
function registrationChain(ts, expression) {
  expression = unwrappedExpression(ts, expression);
  if (ts.isCallExpression(expression)) {
    const chain = registrationChain(ts, expression.expression);
    chain.push({ kind: "call", name: staticAccessName(ts, expression.expression), node: expression });
    return chain;
  }
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const chain = registrationChain(ts, expression.expression);
    chain.push({ kind: "access", name: staticAccessName(ts, expression), node: expression });
    return chain;
  }
  if (ts.isTaggedTemplateExpression(expression)) {
    const chain = registrationChain(ts, expression.tag);
    chain.push({ kind: "template", name: staticAccessName(ts, expression.tag), node: expression });
    return chain;
  }
  return [{ kind: "root", name: ts.isIdentifier(expression) ? expression.text : undefined, node: expression }];
}

/** Resolve registration names from decoded syntax after the caller has proved Vitest ownership. */
function vitestRegistrationNameFromExpression(ts, expression) {
  for (const part of registrationChain(ts, expression)) {
    if (part.name !== undefined && /^(?:it|test|describe|beforeAll|beforeEach|afterAll|afterEach)$/u.test(part.name)) return part.name;
  }
  return undefined;
}

/** Return whether a registration chain has a statically named modifier. */
function expressionHasProperty(ts, expression, propertyName) {
  return registrationChain(ts, expression).some(part => part.kind === "access" && part.name === propertyName);
}

/** Return a statically known boolean, or undefined when runtime evaluation would be required. */
function staticBooleanValue(ts, valueNode) {
  if (valueNode === undefined) return undefined;
  if (valueNode.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (valueNode.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isParenthesizedExpression(valueNode)) {
    return staticBooleanValue(ts, valueNode.expression);
  }
  if (
    ts.isPrefixUnaryExpression(valueNode) &&
    valueNode.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const value = staticBooleanValue(ts, valueNode.operand);
    return value === undefined ? undefined : !value;
  }
  if (
    ts.isAsExpression(valueNode) ||
    ts.isTypeAssertionExpression(valueNode) ||
    ts.isNonNullExpression(valueNode)
  ) {
    return staticBooleanValue(ts, valueNode.expression);
  }
  return undefined;
}

/** Return an exact primitive literal value when runtime evaluation is statically decidable. */
function staticPrimitiveValue(ts, expression) {
  expression = unwrappedExpression(ts, expression);
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return { known: true, value: true };
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return { known: true, value: false };
  if (expression.kind === ts.SyntaxKind.NullKeyword) return { known: true, value: null };
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return { known: true, value: expression.text };
  if (ts.isNumericLiteral(expression)) return { known: true, value: Number(expression.text) };
  if (ts.isBigIntLiteral(expression)) return { known: true, value: BigInt(expression.text.slice(0, -1)) };
  if (ts.isVoidExpression(expression)) return { known: true, value: undefined };
  if (ts.isPrefixUnaryExpression(expression) && (expression.operator === ts.SyntaxKind.PlusToken || expression.operator === ts.SyntaxKind.MinusToken)) {
    const operand = staticPrimitiveValue(ts, expression.operand);
    if (!operand.known || typeof operand.value !== "number") return { known: false };
    return { known: true, value: expression.operator === ts.SyntaxKind.MinusToken ? -operand.value : operand.value };
  }
  return { known: false };
}

/** Return whether one statement statically prevents later statements in the same block from executing. */
function statementDefinitelyTerminates(ts, statement) {
  if (
    ts.isReturnStatement(statement) ||
    ts.isThrowStatement(statement) ||
    ts.isBreakStatement(statement) ||
    ts.isContinueStatement(statement)
  ) return true;
  if (ts.isBlock(statement)) {
    for (const child of statement.statements) {
      if (statementDefinitelyTerminates(ts, child)) return true;
    }
    return false;
  }
  if (ts.isIfStatement(statement)) {
    const condition = staticBooleanValue(ts, statement.expression);
    if (condition === true) return statementDefinitelyTerminates(ts, statement.thenStatement);
    if (condition === false) return statement.elseStatement !== undefined && statementDefinitelyTerminates(ts, statement.elseStatement);
    return statement.elseStatement !== undefined && statementDefinitelyTerminates(ts, statement.thenStatement) && statementDefinitelyTerminates(ts, statement.elseStatement);
  }
  return false;
}

/** Return whether a loop body can reach its increment/condition phase on at least one static path. */
function statementMayReachLoopNextPhase(ts, statement) {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement) || ts.isBreakStatement(statement)) return false;
  if (ts.isContinueStatement(statement)) return true;
  if (ts.isBlock(statement)) {
    for (const child of statement.statements) {
      if (!statementDefinitelyTerminates(ts, child)) continue;
      return statementMayReachLoopNextPhase(ts, child);
    }
    return true;
  }
  if (ts.isIfStatement(statement)) {
    const condition = staticBooleanValue(ts, statement.expression);
    if (condition === true) return statementMayReachLoopNextPhase(ts, statement.thenStatement);
    if (condition === false) return statement.elseStatement === undefined || statementMayReachLoopNextPhase(ts, statement.elseStatement);
    if (statement.elseStatement === undefined) return true;
    return statementMayReachLoopNextPhase(ts, statement.thenStatement) || statementMayReachLoopNextPhase(ts, statement.elseStatement);
  }
  return true;
}

/** Visit only compiler children that can execute under statically decidable control flow. */
function forEachStaticallyReachableChild(ts, node, visit) {
  if (ts.isSourceFile(node) || ts.isBlock(node)) {
    let terminated = false;
    for (const statement of node.statements) {
      // Function declarations are hoisted and may be called before a preceding abrupt completion.
      if (terminated) {
        if (ts.isFunctionDeclaration(statement)) visit(statement);
        continue;
      }
      visit(statement);
      if (statementDefinitelyTerminates(ts, statement)) terminated = true;
    }
    return;
  }
  if (ts.isIfStatement(node)) {
    visit(node.expression);
    const condition = staticBooleanValue(ts, node.expression);
    if (condition !== false) visit(node.thenStatement);
    if (condition !== true && node.elseStatement !== undefined) visit(node.elseStatement);
    return;
  }
  if (ts.isConditionalExpression(node)) {
    visit(node.condition);
    const condition = staticBooleanValue(ts, node.condition);
    if (condition !== false) visit(node.whenTrue);
    if (condition !== true) visit(node.whenFalse);
    return;
  }
  if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
    visit(node.left);
    const left = staticBooleanValue(ts, node.left);
    if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? left !== false : left !== true) visit(node.right);
    return;
  }
  if (ts.isForOfStatement(node)) {
    visit(node.expression);
    const iterable = unwrappedExpression(ts, node.expression);
    if (ts.isArrayLiteralExpression(iterable) && iterable.elements.length === 0) return;
    visit(node.initializer);
    visit(node.statement);
    return;
  }
  if (ts.isForInStatement(node)) {
    visit(node.expression);
    const enumerable = unwrappedExpression(ts, node.expression);
    if (ts.isObjectLiteralExpression(enumerable) && enumerable.properties.length === 0) return;
    visit(node.initializer);
    visit(node.statement);
    return;
  }
  if (ts.isSwitchStatement(node)) {
    visit(node.expression);
    const discriminant = staticPrimitiveValue(ts, node.expression);
    const clauses = [...node.caseBlock.clauses];
    const caseValues = clauses.map(clause => ts.isCaseClause(clause) ? staticPrimitiveValue(ts, clause.expression) : undefined);
    if (!discriminant.known || caseValues.some(value => value !== undefined && !value.known)) {
      visit(node.caseBlock);
      return;
    }
    let start = -1, fallback = -1;
    for (let index = 0; index < clauses.length; index += 1) {
      const clause = clauses[index];
      if (ts.isDefaultClause(clause)) { fallback = index; continue; }
      if (Object.is(caseValues[index]?.value, discriminant.value)) { start = index; break; }
    }
    if (start < 0) start = fallback;
    if (start < 0) return;
    for (let index = start; index < clauses.length; index += 1) {
      const clause = clauses[index];
      for (const statement of clause.statements) {
        visit(statement);
        if (statementDefinitelyTerminates(ts, statement)) return;
      }
    }
    return;
  }
  if (ts.isWhileStatement(node)) {
    visit(node.expression);
    if (staticBooleanValue(ts, node.expression) !== false) visit(node.statement);
    return;
  }
  if (ts.isForStatement(node)) {
    if (node.initializer !== undefined) visit(node.initializer);
    if (node.condition !== undefined) visit(node.condition);
    if (node.condition === undefined || staticBooleanValue(ts, node.condition) !== false) {
      visit(node.statement);
      if (node.incrementor !== undefined && statementMayReachLoopNextPhase(ts, node.statement)) visit(node.incrementor);
    }
    return;
  }
  if (ts.isDoStatement(node)) {
    visit(node.statement);
    if (statementMayReachLoopNextPhase(ts, node.statement)) visit(node.expression);
    return;
  }
  ts.forEachChild(node, visit);
}

/** Return one readable static object-property name, or undefined when the key requires runtime evaluation. */
function staticObjectPropertyName(ts, property) {
  if (
    (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) ||
    ts.isComputedPropertyName(property.name)
  ) {
    return undefined;
  }
  const decodedName = property.name.text;
  return typeof decodedName === "string" ? decodedName : undefined;
}

/** Interpret only the execution-control flags; later own properties replace earlier spread uncertainty. */
function executionOptions(ts, object) {
  const flags = { skip: false, todo: false, only: false };
  for (const property of object.properties) {
    const name = staticObjectPropertyName(ts, property);
    if (ts.isSpreadAssignment(property) || name === undefined) {
      flags.skip = undefined; flags.todo = undefined; flags.only = undefined;
    } else if (name === "skip" || name === "todo" || name === "only") {
      flags[name] = ts.isPropertyAssignment(property) ? staticBooleanValue(ts, property.initializer) : undefined;
    }
  }
  return flags;
}

/** Read statically known boolean skip/todo options through the same interpreter used for focus. */
function vitestObjectBooleanOptions(ts, object) {
  const flags = executionOptions(ts, object);
  return { skip: flags.skip, todo: flags.todo };
}

/** Reject focused or dynamically selected registrations instead of crediting tests that may be excluded. */
function vitestFocusedRegistrationNode(ts, node) {
  const chain = registrationChain(ts, node.expression);
  if (chain.some(part => part.kind === "access" && (part.name === "only" || part.name === undefined))) return node;
  for (let index = 1; index < node.arguments.length; index += 1) {
    const argument = unwrappedExpression(ts, node.arguments[index]);
    if (ts.isObjectLiteralExpression(argument) && executionOptions(ts, argument).only !== false) return argument;
  }
  return undefined;
}

/** Resolve literal tables or const Object.freeze tables without granting credit to mutable/dynamic case arrays. */
function staticCaseTable(ts, expression, checker, seen = new Set()) {
  expression = unwrappedExpression(ts, expression);
  if (ts.isArrayLiteralExpression(expression)) return expression;
  if (checker === undefined || !ts.isIdentifier(expression)) return undefined;
  const symbol = checker.getSymbolAtLocation(expression);
  const declaration = symbol?.valueDeclaration;
  if (declaration === undefined || !ts.isVariableDeclaration(declaration) || seen.has(declaration) || (declaration.parent.flags & ts.NodeFlags.Const) === 0 || declaration.initializer === undefined) return undefined;
  seen.add(declaration);
  const initializer = unwrappedExpression(ts, declaration.initializer);
  if (!ts.isCallExpression(initializer) || staticAccessName(ts, initializer.expression) !== "freeze" || initializer.arguments.length !== 1) return undefined;
  const access = unwrappedExpression(ts, initializer.expression);
  if (!ts.isPropertyAccessExpression(access) && !ts.isElementAccessExpression(access)) return undefined;
  const object = checker.getSymbolAtLocation(access.expression);
  if (!object?.declarations?.some(row => row.getSourceFile().isDeclarationFile && row.getSourceFile().fileName.replaceAll("\\", "/").endsWith("/typescript/lib/lib.es5.d.ts"))) return undefined;
  const table = unwrappedExpression(ts, initializer.arguments[0]);
  return ts.isArrayLiteralExpression(table) ? table : undefined;
}

/** Interpret registration modes centrally so the call graph and direct controls cannot diverge. */
function vitestRegistrationMode(ts, node, callbackArgumentIndex, checker) {
  const chain = registrationChain(ts, node.expression);
  if (chain.some(part => part.name === undefined)) return "unknown";
  // Nonempty literal tables prove registration; unknown dynamic tables cannot promise that any callback is reached.
  for (const part of chain) {
    if (part.name !== "each" && part.name !== "for") continue;
    if (part.kind === "template") return "unknown";
    if (part.kind !== "call") continue;
    const cases = part.node.arguments[0];
    const table = cases === undefined ? undefined : staticCaseTable(ts, cases, checker);
    if (table === undefined) return "unknown";
    const elements = table.elements;
    if (elements.length === 0) return "empty";
    if (elements.every(element => ts.isSpreadElement(element))) return "unknown";
  }
  // A table that registers nothing overrides skip: even skipped suite factories cannot run without a case.
  if (expressionHasProperty(ts, node.expression, "todo")) return "todo";
  if (expressionHasProperty(ts, node.expression, "skip")) return "skip";
  if (callbackArgumentIndex !== 1 && callbackArgumentIndex !== 2) return "unknown";
  if (callbackArgumentIndex === 1) {
    const third = node.arguments[2];
    // Vitest 4 removed the fn/options overload; malformed registrations cannot earn execution credit.
    return third === undefined || ts.isNumericLiteral(unwrappedExpression(ts, third)) ? "run" : "unknown";
  }
  let options = node.arguments[1];
  if (options === undefined) return "run";
  options = unwrappedExpression(ts, options);
  if (ts.isIdentifier(options) && options.text === "undefined") return "run";
  if (!ts.isObjectLiteralExpression(options)) return "unknown";
  const flags = executionOptions(ts, options);
  if (flags.skip === true) return "skip";
  if (flags.todo === true) return "todo";
  return flags.skip === false && flags.todo === false && flags.only === false ? "run" : "unknown";
}

/** Return one conditional modifier, but fail closed when multiple skipIf/runIf modifiers are chained. */
function vitestConditionalMetadata(ts, expression) {
  let conditionKind, conditionValue;
  for (const part of registrationChain(ts, expression)) {
    if (part.kind !== "call" || (part.name !== "skipIf" && part.name !== "runIf")) continue;
    const earlier = conditionKind;
    conditionKind = part.name;
    conditionValue = earlier === undefined ? staticBooleanValue(ts, part.node.arguments[0]) : undefined;
  }
  return conditionKind === undefined ? {} : { conditionKind, conditionValue };
}

/** Return whether a statically described registration is runnable rather than skipped/todo/unknown. */
function vitestRegistrationRuns(metadata) {
  if (metadata.mode !== "run") return false;
  if (metadata.conditionKind === undefined) return true;
  if (typeof metadata.conditionValue !== "boolean") return false;
  return metadata.conditionKind === "skipIf"
    ? metadata.conditionValue === false
    : metadata.conditionKind === "runIf" && metadata.conditionValue === true;
}

/** Return whether Vitest executes this registration callback in the current suite context. */
function vitestCallbackExecutes(metadata) {
  const registration = metadata.registration;
  if (registration === undefined) return false;
  // Registered skip/todo suite factories collect nested suites; empty tables register no factory at all.
  if (registration === "describe") {
    if (metadata.insideUncollectedSuite === true) return false;
    return metadata.mode === "run" || metadata.mode === "skip" || metadata.mode === "todo";
  }
  if (metadata.insideNonExecutingSuite === true) return false;
  if (
    registration === "beforeAll" ||
    registration === "beforeEach" ||
    registration === "afterAll" ||
    registration === "afterEach"
  ) {
    return metadata.suiteHasRunnableTest === true;
  }
  return vitestRegistrationRuns(metadata);
}

/** Return whether tests/hooks registered inside this suite can execute after collection. */
function vitestSuiteChildrenExecute(metadata) {
  return metadata.registration === "describe" && vitestRegistrationRuns(metadata);
}

/** Exclude literal array calls that cannot dispatch a callback, including sparse and singleton reductions/sorts. */
function standardLibraryCallbackCanExecute(ts, node, methodName, checker) {
  const access = unwrappedExpression(ts, node.expression);
  const receiver = methodName === "from"
    ? node.arguments[0]
    : ts.isPropertyAccessExpression(access) || ts.isElementAccessExpression(access) ? access.expression : undefined;
  if (receiver === undefined) return true;
  const array = unwrappedExpression(ts, receiver);
  if (!ts.isArrayLiteralExpression(array)) return true;
  if (array.elements.some(element => ts.isSpreadElement(element))) return true;
  const visitsHoles = ["find", "findIndex", "findLast", "findLastIndex", "from"].includes(methodName);
  let present = 0;
  for (const element of array.elements) if (!ts.isOmittedExpression(element)) present += 1;
  const cardinality = visitsHoles ? array.elements.length : present;
  if (methodName === "sort" || methodName === "toSorted") {
    let comparable = 0;
    for (const element of array.elements) {
      if (ts.isOmittedExpression(element)) continue;
      const value = unwrappedExpression(ts, element);
      if (ts.isVoidExpression(value) || checker !== undefined && (checker.getTypeAtLocation(value).flags & ts.TypeFlags.Undefined) !== 0) continue;
      comparable += 1;
    }
    return comparable >= 2;
  }
  if (methodName === "reduce" || methodName === "reduceRight") return cardinality >= (node.arguments.length >= 2 ? 1 : 2);
  return cardinality > 0;
}

module.exports = {
  standardLibraryCallbackCanExecute,
  expressionHasProperty,
  vitestRegistrationMode,
  vitestRegistrationNameFromExpression,
  staticBooleanValue,
  forEachStaticallyReachableChild,
  statementDefinitelyTerminates,
  vitestCallbackExecutes,
  vitestObjectBooleanOptions,
  vitestConditionalMetadata,
  vitestFocusedRegistrationNode,
  vitestRegistrationName,
  vitestRegistrationRuns,
  vitestSuiteChildrenExecute,
};
