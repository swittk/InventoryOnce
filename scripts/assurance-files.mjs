import fs from "node:fs";
import path from "node:path";

/** Resolve a proof input/output inside one repository, rejecting links at every existing path component. */
export function assuranceRepositoryPath(repositoryRoot, relativePath) {
  const root = path.resolve(repositoryRoot);
  if (typeof relativePath !== "string" || relativePath.length === 0 || relativePath.includes("\0") || relativePath.includes("\\") || path.isAbsolute(relativePath)) throw new Error(`Invalid repository-relative assurance path: ${String(relativePath)}.`);
  const components = relativePath.split("/");
  if (components.some(part => part === "" || part === "." || part === "..")) throw new Error(`Assurance path escapes repository root: ${relativePath}.`);
  let current = root;
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Assurance repository root is not an ordinary directory.");
  for (let index = 0; index < components.length; index += 1) {
    current = path.join(current, components[index]);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Assurance path crosses a symbolic link: ${relativePath}.`);
    if (index < components.length - 1 && !stat.isDirectory()) throw new Error(`Assurance path ancestor is not a directory: ${relativePath}.`);
  }
  return current;
}

/** Open proof bytes without following a replaced leaf link, then require an ordinary file. */
function readOrdinaryAssuranceFile(repositoryRoot, relativePath) {
  const target = assuranceRepositoryPath(repositoryRoot, relativePath);
  if (!fs.lstatSync(target).isFile()) throw new Error(`Assurance input is not a regular file: ${relativePath}.`);
  const descriptor = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    if (!fs.fstatSync(descriptor).isFile()) throw new Error(`Assurance input is not a regular file: ${relativePath}.`);
    return fs.readFileSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}

/** Read one contained ordinary assurance input. */
export function readAssuranceFile(repositoryRoot, relativePath) {
  return readOrdinaryAssuranceFile(repositoryRoot, relativePath);
}
