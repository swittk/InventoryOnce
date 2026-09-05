/** Return the Vitest registration primitive named by one call expression string. */
function vitestRegistrationName(callee) {
  const match = /(?:^|\.)(it|test|describe|beforeAll|beforeEach|afterAll|afterEach)(?:\.|$)/u.exec(callee);
  return match?.[1];
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
  // Suite factories always execute during collection, even when their suite is skipped/todo.
  if (registration === "describe") return true;
  if (metadata.insideNonExecutingSuite === true) return false;
  if (
    registration === "beforeAll" ||
    registration === "beforeEach" ||
    registration === "afterAll" ||
    registration === "afterEach"
  ) {
    return true;
  }
  return vitestRegistrationRuns(metadata);
}

/** Return whether tests/hooks registered inside this suite can execute after collection. */
function vitestSuiteChildrenExecute(metadata) {
  return metadata.registration === "describe" && vitestRegistrationRuns(metadata);
}

module.exports = {
  vitestCallbackExecutes,
  vitestRegistrationName,
  vitestSuiteChildrenExecute,
};
