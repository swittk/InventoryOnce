import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";

/** Discover every TypeScript source file so new modules cannot evade checks. */
function findTypeScriptSourceFiles(directory: string): string[] {
  const sourceFiles: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      sourceFiles.push(...findTypeScriptSourceFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      sourceFiles.push(path);
    }
  }
  return sourceFiles;
}

/** Source files whose public and internal declarations require purpose docs. */
const sourceFiles = findTypeScriptSourceFiles("src");

/** Declaration kinds covered by the repository's mandatory JSDoc rule. */
function declarationNeedsPurposeDoc(node: ts.Node): boolean {
  return (
    ts.isTypeAliasDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isEnumMember(node) ||
    ts.isClassDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isIndexSignatureDeclaration(node)
  );
}

/** Return a readable declaration name for one missing-doc failure. */
function createDeclarationName(node: ts.Node): string {
  if (
    ts.isTypeAliasDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isEnumMember(node)
  ) {
    return node.name?.getText() ?? "(anonymous)";
  }
  if (ts.isArrowFunction(node)) return "arrow function";
  if (ts.isFunctionExpression(node)) return "function expression";
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isIndexSignatureDeclaration(node)) return "index signature";
  return ts.SyntaxKind[node.kind] ?? "declaration";
}

/** Return whether TypeScript attached a JSDoc block to this declaration. */
function declarationHasPurposeDoc(node: ts.Node): boolean {
  return ts.getJSDocCommentsAndTags(node).length > 0;
}

/** Parsed source cache shared by both repository-source guards. */
const parsedSourceFiles = new Map<string, ts.SourceFile>();

/** Parse one repository source file once so both guards share the same AST work. */
function parseSourceFile(fileName: string): ts.SourceFile {
  const absolutePath = resolve(fileName);
  const existing = parsedSourceFiles.get(absolutePath);
  if (existing !== undefined) return existing;
  const sourceFile = ts.createSourceFile(
    absolutePath,
    readFileSync(absolutePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  parsedSourceFiles.set(absolutePath, sourceFile);
  return sourceFile;
}

/** Walk one source file and return every undocumented declaration location. */
function findUndocumentedDeclarations(fileName: string): string[] {
  const sourceFile = parseSourceFile(fileName);
  const failures: string[] = [];

  /** Check this node, then visit every nested declaration once. */
  function visit(node: ts.Node): void {
    if (declarationNeedsPurposeDoc(node) && !declarationHasPurposeDoc(node)) {
      const line =
        sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      failures.push(
        `${relative(process.cwd(), sourceFile.fileName)}:${line} ` +
        `${createDeclarationName(node)}`,
      );
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return failures;
}

/** Array methods which should not be chained into repeated full walks. */
const repeatedArrayWalkMethods = new Set([
  "filter",
  "includes",
  "map",
  "sort",
]);

/** Return the called property name when one call has a literal method name. */
function findCalledMethodName(node: ts.CallExpression): string | undefined {
  return ts.isPropertyAccessExpression(node.expression)
    ? node.expression.name.text
    : undefined;
}

/** Return every repeated array-walk chain or temporary-array membership check. */
function findInefficientArrayWalks(fileName: string): string[] {
  const sourceFile = parseSourceFile(fileName);
  const failures: string[] = [];

  /** Check one call and then visit its nested expressions. */
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const methodName = findCalledMethodName(node);
      if (
        methodName !== undefined &&
        repeatedArrayWalkMethods.has(methodName) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const receiver = node.expression.expression;
        const chainedMethodName = ts.isCallExpression(receiver)
          ? findCalledMethodName(receiver)
          : undefined;
        const isRepeatedWalkChain =
          chainedMethodName !== undefined &&
          repeatedArrayWalkMethods.has(chainedMethodName);
        const isTemporaryArrayIncludes =
          methodName === "includes" && ts.isArrayLiteralExpression(receiver);
        if (isRepeatedWalkChain || isTemporaryArrayIncludes) {
          const line =
            sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          failures.push(
            `${relative(process.cwd(), sourceFile.fileName)}:${line} ` +
            `${chainedMethodName ?? "array"}.${methodName}`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return failures;
}

test("every declared type, field, enum value, function, and method has purpose JSDoc", () => {
  const failures: string[] = [];
  for (const fileName of sourceFiles) {
    failures.push(...findUndocumentedDeclarations(fileName));
  }
  expect(failures).toEqual([]);
});

test("source avoids chained repeated array walks", () => {
  const failures: string[] = [];
  for (const fileName of sourceFiles) {
    failures.push(...findInefficientArrayWalks(fileName));
  }
  expect(failures).toEqual([]);
});
