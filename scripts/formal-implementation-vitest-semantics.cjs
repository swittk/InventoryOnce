/** Return the syntactic Vitest primitive after the caller has established Vitest symbol ownership. */
function vitestRegistrationName(callee) {
  const match = /(?:^|\.)(it|test|describe|beforeAll|beforeEach|afterAll|afterEach)(?:\.|$)/u.exec(callee);
  return match?.[1];
}

/** Return whether one chained registration expression contains an exact property modifier. */
function expressionHasProperty(ts, expression, propertyName) {
  if (ts.isPropertyAccessExpression(expression)) {
    return (
      expression.name.text === propertyName ||
      expressionHasProperty(ts, expression.expression, propertyName)
    );
  }
  if (ts.isCallExpression(expression)) {
    return expressionHasProperty(ts, expression.expression, propertyName);
  }
  return false;
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

/** Return one readable static object-property name, or undefined when the key requires runtime evaluation. */
function staticObjectPropertyName(ts, property, sourceFile) {
  if (
    (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) ||
    ts.isComputedPropertyName(property.name)
  ) {
    return undefined;
  }
  return property.name.getText(sourceFile).replace(/^['"]|['"]$/gu, "");
}

/** Read statically known boolean skip/todo options and fail closed on unreadable keys or spreads. */
function vitestObjectBooleanOptions(ts, object) {
  let skip = false;
  let todo = false;
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      skip = undefined;
      todo = undefined;
      continue;
    }
    const name = staticObjectPropertyName(ts, property, object.getSourceFile());
    if (name === undefined) {
      skip = undefined;
      todo = undefined;
      continue;
    }
    if (name !== "skip" && name !== "todo") continue;
    const value = ts.isPropertyAssignment(property)
      ? staticBooleanValue(ts, property.initializer)
      : undefined;
    if (name === "skip") skip = value;
    else todo = value;
  }
  return { skip, todo };
}

/** Return the exact node that makes one Vitest registration focused, or a conservative unknown option node. */
function vitestFocusedRegistrationNode(ts, node) {
  if (expressionHasProperty(ts, node.expression, "only")) return node;
  for (const argument of node.arguments) {
    if (!ts.isObjectLiteralExpression(argument)) continue;
    for (const property of argument.properties) {
      if (ts.isSpreadAssignment(property)) return property;
      const name = staticObjectPropertyName(ts, property, node.getSourceFile());
      if (name === undefined) return property;
      if (name !== "only") continue;
      const value = ts.isPropertyAssignment(property)
        ? staticBooleanValue(ts, property.initializer)
        : undefined;
      if (value !== false) return property;
    }
  }
  return undefined;
}

/** Return one conditional modifier, but fail closed when multiple skipIf/runIf modifiers are chained. */
function vitestConditionalMetadata(ts, expression) {
  if (ts.isCallExpression(expression)) {
    if (ts.isPropertyAccessExpression(expression.expression)) {
      const name = expression.expression.name.text;
      if (name === "skipIf" || name === "runIf") {
        const earlier = vitestConditionalMetadata(ts, expression.expression.expression);
        if (earlier.conditionKind !== undefined) {
          return { conditionKind: name, conditionValue: undefined };
        }
        return {
          conditionKind: name,
          conditionValue: staticBooleanValue(ts, expression.arguments[0]),
        };
      }
    }
    return vitestConditionalMetadata(ts, expression.expression);
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return vitestConditionalMetadata(ts, expression.expression);
  }
  return {};
}

/** Return whether a statically described registration is runnable rather than skipped/todo/unknown. */
function vitestRegistrationRuns(metadata) {
  if (metadata.mode !== "run") return false;
  if (metadata.conditionKind === undefined) return true;
  if (typeof metadata.conditionValue !== "boolean") return false;
  return metadata.conditionKind === "skipIf"
    ? metadata.conditionValue === false
    : metadata.conditionValue === true;
}

/** Return whether Vitest executes this registration callback in the current suite context. */
function vitestCallbackExecutes(metadata) {
  const registration = metadata.registration;
  if (registration === undefined) return false;
  // Todo-suite factories and their descendants never execute; skipped suites still collect nested describe callbacks.
  if (registration === "describe") {
    if (metadata.insideTodoSuite === true) return false;
    return metadata.mode !== "todo";
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

module.exports = {
  expressionHasProperty,
  staticBooleanValue,
  vitestCallbackExecutes,
  vitestObjectBooleanOptions,
  vitestConditionalMetadata,
  vitestFocusedRegistrationNode,
  vitestRegistrationName,
  vitestRegistrationRuns,
  vitestSuiteChildrenExecute,
};
