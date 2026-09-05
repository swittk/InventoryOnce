/** Return the Vitest registration primitive named by one call expression string. */
function vitestRegistrationName(callee) {
  const match = /(?:^|\.)(it|test|describe|beforeAll|beforeEach|afterAll|afterEach)(?:\.|$)/u.exec(callee);
  return match?.[1];
}

/** Return whether Vitest executes this registration callback in the current suite context. */
function vitestCallbackExecutes(callee, insideSkippedSuite = false) {
  const registration = vitestRegistrationName(callee);
  if (registration === undefined) return false;
  if ((registration === "it" || registration === "test") && /(?:^|\.)skip(?:\.|$)/u.test(callee)) {
    return false;
  }
  if (insideSkippedSuite && registration !== "describe") return false;
  return true;
}

module.exports = { vitestCallbackExecutes, vitestRegistrationName };
