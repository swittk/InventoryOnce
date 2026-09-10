import path from "node:path";
import { fileURLToPath } from "node:url";

/** Return the InventoryOnce repository root for a module stored in final-convergence. */
export function finalConvergenceRepositoryRoot(moduleUrl) {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), "../../..");
}

/** Return one absolute repository path without consulting the caller working directory. */
export function finalConvergenceRepositoryPath(repositoryRoot, repositoryRelativePath) {
  return path.resolve(repositoryRoot, repositoryRelativePath);
}

/** Return whether this module is the process entrypoint independent of the caller working directory. */
export function isDirectFinalConvergenceInvocation(moduleUrl, argvPath = process.argv[1]) {
  return argvPath !== undefined && path.resolve(argvPath) === fileURLToPath(moduleUrl);
}

/** Reject a repository root that does not belong to the importing final-convergence module. */
export function assertFinalConvergenceRepositoryRoot(repositoryRoot, moduleUrl) {
  const expected = finalConvergenceRepositoryRoot(moduleUrl);
  const actual = path.resolve(repositoryRoot);
  if (actual !== expected) {
    throw new Error(`InventoryOnce final assurance repository root mismatch: expected '${expected}', received '${actual}'.`);
  }
  return actual;
}
