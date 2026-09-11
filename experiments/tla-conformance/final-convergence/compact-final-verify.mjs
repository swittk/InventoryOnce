import { createRequire as __compactCreateRequire } from "node:module"; const require = __compactCreateRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/formal-implementation-surface.cjs
var require_formal_implementation_surface = __commonJS({
  "scripts/formal-implementation-surface.cjs"(exports, module) {
    "use strict";
    var ts4 = __require("typescript");
    var path45 = __require("node:path");
    var crypto5 = __require("node:crypto");
    function discoverImplementationSurface({ repositoryRoot = path45.resolve(__dirname, ".."), program: suppliedProgram } = {}) {
      const root3 = path45.resolve(repositoryRoot);
      const sourceRoot = path45.resolve(root3, "src");
      const normalizedSourceRoot = path45.normalize(sourceRoot);
      const normalizedSourcePrefix = `${normalizedSourceRoot}${path45.sep}`;
      const program = suppliedProgram ?? (() => {
        const configPath = path45.join(root3, "tsconfig.test.json");
        const config = ts4.readConfigFile(configPath, ts4.sys.readFile);
        if (config.error !== void 0) {
          throw new Error(
            ts4.flattenDiagnosticMessageText(config.error.messageText, "\n")
          );
        }
        const parsed = ts4.parseJsonConfigFileContent(
          config.config,
          ts4.sys,
          root3,
          void 0,
          configPath
        );
        if (parsed.errors.length > 0) {
          throw new Error(
            parsed.errors.map((error) => ts4.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n")
          );
        }
        return ts4.createProgram({
          rootNames: parsed.fileNames,
          options: parsed.options
        });
      })();
      const semanticDiagnostics = program.getSemanticDiagnostics();
      if (semanticDiagnostics.length > 0) {
        throw new Error(
          ts4.formatDiagnostics(semanticDiagnostics, {
            getCanonicalFileName: (fileName) => fileName,
            getCurrentDirectory: () => root3,
            getNewLine: () => "\n"
          })
        );
      }
      const checker = program.getTypeChecker();
      const formatFlags = ts4.TypeFormatFlags.NoTruncation | ts4.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;
      function compareExact(left, right) {
        return left < right ? -1 : left > right ? 1 : 0;
      }
      function stableDeclarationSource(source7) {
        const resolved = path45.resolve(source7.fileName);
        const normalized = resolved.split(path45.sep).join("/");
        const nodeModulesMarker = "/node_modules/";
        const nodeModulesIndex = normalized.lastIndexOf(nodeModulesMarker);
        if (nodeModulesIndex >= 0) {
          const externalPath = normalized.slice(
            nodeModulesIndex + nodeModulesMarker.length
          );
          return `external:${externalPath}#${shortHash(source7.text)}`;
        }
        const relative = path45.relative(root3, resolved);
        if (relative !== ".." && !relative.startsWith(`..${path45.sep}`) && !path45.isAbsolute(relative)) {
          return relative.split(path45.sep).join("/");
        }
        return `external-file:${path45.basename(resolved)}#${shortHash(source7.text)}`;
      }
      const facadeInterfaces = [
        ["InventoryOnceCatalogApi", "catalog"],
        ["InventoryOnceCompositionsApi", "compositions"],
        ["InventoryOnceTransformationsApi", "transformations"],
        ["InventoryOnceCollectionsApi", "collections"],
        ["InventoryOnceFungibilityApi", "fungibility"],
        ["InventoryOnceStockApi", "stock"],
        ["InventoryOnceContainersApi", "containers"],
        ["InventoryOnceLotsApi", "lots"],
        ["InventoryOnceTransfersApi", "transfers"],
        ["InventoryOnceReservationsApi", "reservations"],
        ["InventoryOnceCountsApi", "counts"],
        ["InventoryOnceTraceabilityApi", "traceability"],
        ["InventoryOnceReadSnapshotApi", "snapshot"],
        ["InventoryOnceReadApi", "read"]
      ];
      const entrypointSources = {
        root: "src/index.ts",
        storage: "src/storage-api.ts",
        migrations: "src/migrations-api.ts",
        kernel: "src/kernel.ts"
      };
      function sourceFile3(relativePath4) {
        const result = program.getSourceFile(path45.join(root3, relativePath4));
        if (result === void 0)
          throw new Error(`Missing source '${relativePath4}'.`);
        return result;
      }
      function interfaceDeclaration(relativePath4, name) {
        const result = sourceFile3(relativePath4).statements.find(
          (statement) => ts4.isInterfaceDeclaration(statement) && statement.name.text === name
        );
        if (result === void 0) throw new Error(`Missing interface '${name}'.`);
        return result;
      }
      function declarationOf(symbol, fallback) {
        return symbol.valueDeclaration ?? symbol.declarations?.[0] ?? fallback;
      }
      function typeText2(type, node) {
        return checker.typeToString(type, node, formatFlags);
      }
      function signatureShape2(signature, fallback) {
        const declaration = signature.declaration ?? fallback;
        return {
          parameters: signature.getParameters().map((parameter) => {
            const parameterDeclaration = declarationOf(parameter, declaration);
            return {
              name: parameter.name,
              type: typeText2(
                checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration),
                parameterDeclaration
              ),
              optional: (parameter.flags & ts4.SymbolFlags.Optional) !== 0
            };
          }),
          result: typeText2(checker.getReturnTypeOfSignature(signature), declaration)
        };
      }
      function methodsOfInterface(relativePath4, name, prefix) {
        const declaration = interfaceDeclaration(relativePath4, name);
        const rows = [];
        for (const member2 of checker.getPropertiesOfType(
          checker.getTypeAtLocation(declaration)
        )) {
          const memberDeclaration = declarationOf(member2, declaration);
          const memberType = checker.getTypeOfSymbolAtLocation(
            member2,
            memberDeclaration
          );
          const signatures = checker.getSignaturesOfType(memberType, ts4.SignatureKind.Call).map((signature) => signatureShape2(signature, memberDeclaration));
          if (signatures.length === 0) continue;
          rows.push({
            key: `${prefix}.${member2.name}`,
            interface: name,
            method: member2.name,
            signatures,
            parameters: signatures[0].parameters,
            result: signatures[0].result
          });
        }
        return rows.sort((left, right) => compareExact(left.key, right.key));
      }
      function moduleExports(relativePath4) {
        const source7 = sourceFile3(relativePath4);
        const moduleSymbol = checker.getSymbolAtLocation(source7);
        if (moduleSymbol === void 0)
          throw new Error(`Missing module '${relativePath4}'.`);
        const rows = [];
        for (const exported of checker.getExportsOfModule(moduleSymbol)) {
          const declaration = declarationOf(exported, source7);
          const exportedType = checker.getTypeOfSymbolAtLocation(
            exported,
            declaration
          );
          const callSignatures = checker.getSignaturesOfType(exportedType, ts4.SignatureKind.Call).map((signature) => signatureShape2(signature, declaration));
          const constructSignatures = checker.getSignaturesOfType(exportedType, ts4.SignatureKind.Construct).map((signature) => signatureShape2(signature, declaration));
          if (callSignatures.length === 0 && constructSignatures.length === 0)
            continue;
          rows.push({
            name: exported.name,
            declaration: stableDeclarationSource(declaration.getSourceFile()),
            callable: callSignatures.length > 0,
            constructable: constructSignatures.length > 0,
            callSignatures,
            constructSignatures
          });
        }
        return rows.sort((left, right) => compareExact(left.name, right.name));
      }
      function publicClassMembers(exported, constructorType) {
        const instanceMembers = checker.getPropertiesOfType(
          checker.getDeclaredTypeOfSymbol(exported)
        );
        const members = [...instanceMembers];
        const memberNames = new Set(instanceMembers.map((member2) => member2.name));
        for (const member2 of checker.getPropertiesOfType(constructorType)) {
          const memberDeclaration = member2.valueDeclaration ?? member2.declarations?.[0];
          if (memberDeclaration === void 0) continue;
          const staticFlags = ts4.getCombinedModifierFlags(memberDeclaration);
          if ((staticFlags & ts4.ModifierFlags.Static) === 0) continue;
          if ((staticFlags & ts4.ModifierFlags.Private) !== 0 || (staticFlags & ts4.ModifierFlags.Protected) !== 0) {
            continue;
          }
          if (memberNames.has(member2.name)) {
            throw new Error(
              `Exported class '${exported.name}' has both static and instance member '${member2.name}'; surface keys must distinguish them before that API can be certified.`
            );
          }
          memberNames.add(member2.name);
          members.push(member2);
        }
        return members;
      }
      function classMethods(relativePath4, entrypoint) {
        const source7 = sourceFile3(relativePath4);
        const moduleSymbol = checker.getSymbolAtLocation(source7);
        if (moduleSymbol === void 0) return [];
        const rows = [];
        for (const exported of checker.getExportsOfModule(moduleSymbol)) {
          const declaration = declarationOf(exported, source7);
          const constructorType = checker.getTypeOfSymbolAtLocation(
            exported,
            declaration
          );
          if (checker.getSignaturesOfType(constructorType, ts4.SignatureKind.Construct).length === 0) {
            continue;
          }
          for (const member2 of publicClassMembers(exported, constructorType)) {
            const memberDeclaration = declarationOf(member2, declaration);
            const flags = ts4.getCombinedModifierFlags(memberDeclaration);
            if ((flags & ts4.ModifierFlags.Private) !== 0 || (flags & ts4.ModifierFlags.Protected) !== 0) {
              continue;
            }
            const memberType = checker.getTypeOfSymbolAtLocation(
              member2,
              memberDeclaration
            );
            const signatures = checker.getSignaturesOfType(memberType, ts4.SignatureKind.Call).map((signature) => signatureShape2(signature, memberDeclaration));
            if (signatures.length === 0) continue;
            rows.push({
              key: `${entrypoint}.${exported.name}.${member2.name}`,
              className: exported.name,
              method: member2.name,
              declaration: stableDeclarationSource(memberDeclaration.getSourceFile()),
              signatures,
              parameters: signatures[0].parameters,
              result: signatures[0].result
            });
          }
        }
        return rows.sort((left, right) => compareExact(left.key, right.key));
      }
      function sourceOwnedDeclarations(symbol) {
        return (symbol?.getDeclarations() ?? []).filter((declaration) => {
          const normalizedFileName = path45.normalize(
            path45.resolve(declaration.getSourceFile().fileName)
          );
          return normalizedFileName.startsWith(normalizedSourcePrefix);
        });
      }
      function shortHash(value) {
        return crypto5.createHash("sha256").update(value).digest("hex").slice(0, 12);
      }
      function packageTypeIdentity(type) {
        const symbol = type.aliasSymbol ?? type.getSymbol();
        const declarations = sourceOwnedDeclarations(symbol).filter(
          (declaration2) => ts4.isInterfaceDeclaration(declaration2) || ts4.isTypeAliasDeclaration(declaration2) || ts4.isClassDeclaration(declaration2) || ts4.isTypeLiteralNode(declaration2) || ts4.isMappedTypeNode(declaration2)
        );
        if (declarations.length === 0) return void 0;
        const declaration = declarations[0];
        const file = stableDeclarationSource(declaration.getSourceFile());
        const location = declaration.getSourceFile().getLineAndCharacterOfPosition(declaration.getStart());
        const rendered3 = typeText2(type, declaration);
        const baseName = symbol.name === "__type" || symbol.name === "__object" ? `anonymous@${file}:${location.line + 1}:${location.character + 1}` : symbol.name;
        const genericSuffix = (checker.getTypeArguments?.(type) ?? []).length > 0 ? `<${shortHash(rendered3)}>` : "";
        const name = `${baseName}${genericSuffix}`;
        return {
          identity: `${name}|${file}|${declaration.pos}|${shortHash(rendered3)}`,
          name,
          declaration
        };
      }
      const typeRecords = /* @__PURE__ */ new Map();
      const visitedDirections = /* @__PURE__ */ new Map();
      const recursiveTypeReferences = /* @__PURE__ */ new Set();
      const truncatedTypes = /* @__PURE__ */ new Set();
      const externalTypeIdentities = /* @__PURE__ */ new WeakMap();
      let maximumTypeDepth = 0;
      function externalTypeIdentity(type, renderedType) {
        const existing = externalTypeIdentities.get(type);
        if (existing !== void 0) return existing;
        const symbol = type.aliasSymbol ?? type.getSymbol?.();
        const declaration = symbol?.declarations?.[0];
        const declarationAnchor = declaration === void 0 ? "no-declaration" : `${stableDeclarationSource(declaration.getSourceFile())}:${declaration.pos}:${declaration.end}`;
        const identity = `external:${shortHash(`${type.flags}|${type.objectFlags ?? 0}|${declarationAnchor}|${renderedType}`)}`;
        externalTypeIdentities.set(type, identity);
        return identity;
      }
      function addDirection(row, direction) {
        const directions = new Set(row.directions);
        directions.add(direction);
        row.directions = [...directions].sort();
      }
      function typeIncludesFlag(type, flag) {
        return type.isUnion() ? type.types.some((member2) => (member2.flags & flag) !== 0) : (type.flags & flag) !== 0;
      }
      function visitType(type, direction, lineage = /* @__PURE__ */ new Set(), depth = 0) {
        maximumTypeDepth = Math.max(maximumTypeDepth, depth);
        if (depth > 128) {
          truncatedTypes.add(typeText2(type));
          return;
        }
        const owned = packageTypeIdentity(type);
        const renderedType = typeText2(type);
        if (/\.\.\. [0-9]+ more \.\.\./u.test(renderedType)) {
          truncatedTypes.add(owned?.identity ?? renderedType);
        }
        const traversalIdentity2 = owned?.identity ?? externalTypeIdentity(type, renderedType);
        if (lineage.has(traversalIdentity2)) {
          recursiveTypeReferences.add(traversalIdentity2);
          return;
        }
        const visited = visitedDirections.get(traversalIdentity2) ?? /* @__PURE__ */ new Set();
        if (visited.has(direction)) return;
        visited.add(direction);
        visitedDirections.set(traversalIdentity2, visited);
        const nextLineage = new Set(lineage);
        nextLineage.add(traversalIdentity2);
        if (type.isUnionOrIntersection()) {
          for (const member2 of type.types) {
            visitType(member2, direction, nextLineage, depth + 1);
          }
        }
        for (const argument of checker.getTypeArguments?.(type) ?? []) {
          visitType(argument, direction, nextLineage, depth + 1);
        }
        for (const signature of checker.getSignaturesOfType(
          type,
          ts4.SignatureKind.Call
        )) {
          for (const parameter of signature.getParameters()) {
            const parameterDeclaration = declarationOf(
              parameter,
              signature.declaration ?? sourceFile3("src/index.ts")
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
        const stringIndexType = checker.getIndexTypeOfType(type, ts4.IndexKind.String);
        if (stringIndexType !== void 0) {
          visitType(stringIndexType, direction, nextLineage, depth + 1);
        }
        const numberIndexType = checker.getIndexTypeOfType(type, ts4.IndexKind.Number);
        if (numberIndexType !== void 0 && numberIndexType !== stringIndexType) {
          visitType(numberIndexType, direction, nextLineage, depth + 1);
        }
        if (owned === void 0) return;
        let record = typeRecords.get(owned.identity);
        if (record === void 0) {
          record = {
            name: owned.name,
            identity: owned.identity,
            source: stableDeclarationSource(owned.declaration.getSourceFile()),
            directions: [],
            fields: []
          };
          typeRecords.set(owned.identity, record);
        }
        addDirection(record, direction);
        const byName = new Map(record.fields.map((field) => [field.name, field]));
        for (const property of checker.getPropertiesOfType(type)) {
          const declaration = property.valueDeclaration ?? property.declarations?.[0];
          if (declaration === void 0 || ts4.isMethodDeclaration(declaration) || ts4.isMethodSignature(declaration)) {
            continue;
          }
          const propertyType = checker.getTypeOfSymbolAtLocation(
            property,
            declaration
          );
          const rendered3 = typeText2(propertyType, declaration);
          let field = byName.get(property.name);
          if (field === void 0) {
            field = {
              name: property.name,
              type: rendered3,
              optional: (property.flags & ts4.SymbolFlags.Optional) !== 0,
              allowsUndefined: typeIncludesFlag(propertyType, ts4.TypeFlags.Undefined),
              allowsNull: typeIncludesFlag(propertyType, ts4.TypeFlags.Null),
              callable: checker.getSignaturesOfType(propertyType, ts4.SignatureKind.Call).length > 0,
              callSignatures: checker.getSignaturesOfType(propertyType, ts4.SignatureKind.Call).map((signature) => signatureShape2(signature, declaration)),
              source: stableDeclarationSource(declaration.getSourceFile()),
              directions: []
            };
            record.fields.push(field);
            byName.set(property.name, field);
          } else if (field.type !== rendered3) {
            throw new Error(
              `Public field '${record.name}.${property.name}' has two resolved types.`
            );
          }
          addDirection(field, direction);
          visitType(propertyType, direction, nextLineage, depth + 1);
        }
        record.fields.sort((left, right) => compareExact(left.name, right.name));
      }
      function visitInterfaceTypes(relativePath4, name) {
        const declaration = interfaceDeclaration(relativePath4, name);
        const interfaceType = checker.getTypeAtLocation(declaration);
        for (const member2 of checker.getPropertiesOfType(interfaceType)) {
          const memberDeclaration = declarationOf(member2, declaration);
          const memberType = checker.getTypeOfSymbolAtLocation(
            member2,
            memberDeclaration
          );
          for (const signature of checker.getSignaturesOfType(
            memberType,
            ts4.SignatureKind.Call
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
      function visitEntrypointTypes(relativePath4) {
        const source7 = sourceFile3(relativePath4);
        const moduleSymbol = checker.getSymbolAtLocation(source7);
        if (moduleSymbol === void 0) return;
        for (const exported of checker.getExportsOfModule(moduleSymbol)) {
          const declaration = declarationOf(exported, source7);
          const exportedType = checker.getTypeOfSymbolAtLocation(
            exported,
            declaration
          );
          for (const signature of [
            ...checker.getSignaturesOfType(exportedType, ts4.SignatureKind.Call),
            ...checker.getSignaturesOfType(exportedType, ts4.SignatureKind.Construct)
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
          if (checker.getSignaturesOfType(exportedType, ts4.SignatureKind.Construct).length === 0) {
            continue;
          }
          for (const member2 of publicClassMembers(exported, exportedType)) {
            const memberDeclaration = declarationOf(member2, declaration);
            const flags = ts4.getCombinedModifierFlags(memberDeclaration);
            if ((flags & ts4.ModifierFlags.Private) !== 0 || (flags & ts4.ModifierFlags.Protected) !== 0) {
              continue;
            }
            const memberType = checker.getTypeOfSymbolAtLocation(
              member2,
              memberDeclaration
            );
            for (const signature of checker.getSignaturesOfType(
              memberType,
              ts4.SignatureKind.Call
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
      const facade = facadeInterfaces.flatMap(
        ([name, prefix]) => methodsOfInterface("src/facade.ts", name, prefix)
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
        Object.entries(entrypointSources).map(([name, relativePath4]) => [
          name,
          moduleExports(relativePath4)
        ])
      );
      const classes = Object.entries(entrypointSources).flatMap(([name, relativePath4]) => classMethods(relativePath4, name)).sort((left, right) => compareExact(left.key, right.key));
      for (const [name] of facadeInterfaces) {
        visitInterfaceTypes("src/facade.ts", name);
      }
      visitInterfaceTypes("src/authority.ts", "InventoryAuthorityControlPort");
      visitInterfaceTypes("src/storage.ts", "InventoryDurableStorage");
      for (const relativePath4 of Object.values(entrypointSources)) {
        visitEntrypointTypes(relativePath4);
      }
      const types = [...typeRecords.values()].map((record) => ({
        ...record,
        directions: [...record.directions].sort(),
        fields: record.fields.map((field) => ({
          ...field,
          directions: [...field.directions].sort()
        }))
      })).sort((left, right) => compareExact(left.identity, right.identity));
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
          truncatedTypes: [...truncatedTypes].sort()
        }
      };
    }
    module.exports = { discoverImplementationSurface };
    if (__require.main === module) console.log(JSON.stringify(discoverImplementationSurface(), void 0, 2));
  }
});

// experiments/tla-conformance/final-convergence/run-final-verifier.mjs
import assert43 from "node:assert/strict";
import path44 from "node:path";
import ts3 from "typescript";

// scripts/assurance-files.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
function assuranceRepositoryPath(repositoryRoot, relativePath4) {
  const root3 = path.resolve(repositoryRoot);
  if (typeof relativePath4 !== "string" || relativePath4.length === 0 || relativePath4.includes("\0") || relativePath4.includes("\\") || path.isAbsolute(relativePath4)) throw new Error(`Invalid repository-relative assurance path: ${String(relativePath4)}.`);
  const components = relativePath4.split("/");
  if (components.some((part) => part === "" || part === "." || part === "..")) throw new Error(`Assurance path escapes repository root: ${relativePath4}.`);
  let current = root3;
  const rootStat = fs.lstatSync(root3);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Assurance repository root is not an ordinary directory.");
  for (let index = 0; index < components.length; index += 1) {
    current = path.join(current, components[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Assurance path crosses a symbolic link: ${relativePath4}.`);
    if (index < components.length - 1 && !stat.isDirectory()) throw new Error(`Assurance path ancestor is not a directory: ${relativePath4}.`);
  }
  return current;
}
function readOrdinaryAssuranceFile(repositoryRoot, relativePath4) {
  const target = assuranceRepositoryPath(repositoryRoot, relativePath4);
  if (!fs.lstatSync(target).isFile()) throw new Error(`Assurance input is not a regular file: ${relativePath4}.`);
  const descriptor = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    if (!fs.fstatSync(descriptor).isFile()) throw new Error(`Assurance input is not a regular file: ${relativePath4}.`);
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
function assuranceBytesSha256(bytes2) {
  return crypto.createHash("sha256").update(bytes2).digest("hex");
}
var proofReadSessions = /* @__PURE__ */ new Map();
function readAssuranceFile(repositoryRoot, relativePath4) {
  const session = proofReadSessions.get(path.resolve(repositoryRoot));
  return session === void 0 ? readOrdinaryAssuranceFile(repositoryRoot, relativePath4) : session.read(relativePath4);
}
function assuranceFileSha256(repositoryRoot, relativePath4) {
  const session = proofReadSessions.get(path.resolve(repositoryRoot));
  return session === void 0 ? assuranceBytesSha256(readOrdinaryAssuranceFile(repositoryRoot, relativePath4)) : session.hash(relativePath4);
}
function assuranceCompilerSourceSha256(repositoryRoot, file, text) {
  const session = proofReadSessions.get(path.resolve(repositoryRoot));
  return session === void 0 ? assuranceBytesSha256(text) : session.compilerHash(file, text);
}

// experiments/tla-conformance/surface-bindings/lib/compiler-surface.mjs
import crypto2 from "node:crypto";
import fs2 from "node:fs";
import path2 from "node:path";
import ts from "typescript";
var SURFACE_SCHEMA_VERSION = 1;
var TYPE_FORMAT_FLAGS = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;
function compareCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
function sha256(value) {
  return crypto2.createHash("sha256").update(value).digest("hex");
}
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(
      ([left], [right]) => compareCodeUnits(left, right)
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function normalizeRelativePath(repositoryRoot, fileName) {
  return path2.relative(repositoryRoot, fileName).replaceAll("\\", "/");
}
function readJson(fileName) {
  try {
    return JSON.parse(fs2.readFileSync(fileName, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read JSON '${fileName}': ${message}`);
  }
}
function exportedTypesTarget(exportKey, exportDeclaration) {
  if (typeof exportDeclaration === "string") return exportDeclaration;
  if (exportDeclaration !== null && typeof exportDeclaration === "object" && typeof exportDeclaration.types === "string") {
    return exportDeclaration.types;
  }
  throw new Error(
    `Package export '${exportKey}' has no exact string 'types' target.`
  );
}
function sourceForTypesTarget({
  repositoryRoot,
  rootDirectory,
  outputDirectory,
  exportKey,
  typesTarget
}) {
  const absoluteTarget = path2.resolve(repositoryRoot, typesTarget);
  const relativeOutput = path2.relative(outputDirectory, absoluteTarget);
  if (relativeOutput.startsWith(`..${path2.sep}`) || path2.isAbsolute(relativeOutput) || !relativeOutput.endsWith(".d.ts")) {
    throw new Error(
      `Package export '${exportKey}' types target '${typesTarget}' is not a declaration below compiler outDir.`
    );
  }
  return path2.join(rootDirectory, relativeOutput.slice(0, -".d.ts".length) + ".ts");
}
function throwDiagnostics(repositoryRoot, diagnostics) {
  if (diagnostics.length === 0) return;
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => repositoryRoot,
      getNewLine: () => "\n"
    })
  );
}
function loadCompilerContext(repositoryRoot, suppliedProgram) {
  const absoluteRoot = path2.resolve(repositoryRoot);
  const packageJsonPath = path2.join(absoluteRoot, "package.json");
  const packageJson = readJson(packageJsonPath);
  const configPath = path2.join(absoluteRoot, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error !== void 0) throwDiagnostics(absoluteRoot, [config.error]);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    absoluteRoot,
    void 0,
    configPath
  );
  throwDiagnostics(absoluteRoot, parsed.errors);
  const program = suppliedProgram ?? ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options
  });
  throwDiagnostics(absoluteRoot, ts.getPreEmitDiagnostics(program));
  const rootDirectory = path2.resolve(
    absoluteRoot,
    parsed.options.rootDir ?? "src"
  );
  const outputDirectory = path2.resolve(
    absoluteRoot,
    parsed.options.outDir ?? "dist"
  );
  if (packageJson.exports === null || typeof packageJson.exports !== "object" || Array.isArray(packageJson.exports)) {
    throw new Error("package.json#exports must be an object.");
  }
  const entrypoints = Object.entries(packageJson.exports).map(([exportKey, exportDeclaration]) => {
    const typesTarget = exportedTypesTarget(exportKey, exportDeclaration);
    const sourcePath = sourceForTypesTarget({
      repositoryRoot: absoluteRoot,
      rootDirectory,
      outputDirectory,
      exportKey,
      typesTarget
    });
    const source7 = program.getSourceFile(sourcePath);
    if (source7 === void 0) {
      throw new Error(
        `Package export '${exportKey}' maps to missing compiler source '${normalizeRelativePath(
          absoluteRoot,
          sourcePath
        )}'.`
      );
    }
    return { exportKey, typesTarget, source: source7 };
  }).sort((left, right) => compareCodeUnits(left.exportKey, right.exportKey));
  return {
    repositoryRoot: absoluteRoot,
    packageJson,
    packageJsonPath,
    configPath,
    parsed,
    program,
    checker: program.getTypeChecker(),
    rootDirectory,
    entrypoints
  };
}
function isPackageDeclaration(context, declaration) {
  if (declaration === void 0) return false;
  const relative = path2.relative(
    context.rootDirectory,
    path2.resolve(declaration.getSourceFile().fileName)
  );
  return !relative.startsWith(`..${path2.sep}`) && !path2.isAbsolute(relative);
}
function isPublicDeclaration(context, declaration) {
  if (!isPackageDeclaration(context, declaration)) return false;
  const flags = ts.getCombinedModifierFlags(declaration);
  return (flags & ts.ModifierFlags.Private) === 0 && (flags & ts.ModifierFlags.Protected) === 0;
}
function resolveSymbol(checker, symbol) {
  return (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
}
function firstDeclaration(symbol) {
  return [...symbol.declarations ?? []].sort((left, right) => {
    const fileComparison = compareCodeUnits(
      left.getSourceFile().fileName,
      right.getSourceFile().fileName
    );
    return fileComparison !== 0 ? fileComparison : left.getStart() - right.getStart();
  })[0];
}
function typeOfExport(context, exportedSymbol, source7) {
  const resolved = resolveSymbol(context.checker, exportedSymbol);
  const declaration = firstDeclaration(resolved) ?? source7;
  if ((resolved.flags & ts.SymbolFlags.Interface) !== 0 || (resolved.flags & ts.SymbolFlags.TypeAlias) !== 0) {
    return context.checker.getDeclaredTypeOfSymbol(resolved);
  }
  return context.checker.getTypeOfSymbolAtLocation(resolved, declaration);
}
function spanOf(context, node) {
  const source7 = node.getSourceFile();
  const startOffset = node.getStart(source7);
  const endOffset = node.getEnd();
  const start = source7.getLineAndCharacterOfPosition(startOffset);
  const end = source7.getLineAndCharacterOfPosition(endOffset);
  const sourceText5 = source7.getFullText();
  const astText = sourceText5.slice(startOffset, endOffset);
  return {
    file: normalizeRelativePath(context.repositoryRoot, source7.fileName),
    start: {
      offset: startOffset,
      line: start.line + 1,
      column: start.character + 1
    },
    end: {
      offset: endOffset,
      line: end.line + 1,
      column: end.character + 1
    },
    sourceHash: sha256(sourceText5),
    astHash: sha256(astText)
  };
}
function symbolDeclarationSpans(context, symbol) {
  if (symbol === void 0) return [];
  return [...resolveSymbol(context.checker, symbol).declarations ?? []].filter((declaration) => isPackageDeclaration(context, declaration)).map((declaration) => spanOf(context, declaration)).sort((left, right) => {
    const fileComparison = compareCodeUnits(left.file, right.file);
    return fileComparison !== 0 ? fileComparison : left.start.offset - right.start.offset;
  });
}
function symbolForDeclaration(context, declaration) {
  let current = declaration;
  while (isPackageDeclaration(context, current)) {
    if (current.name !== void 0) {
      const symbol = context.checker.getSymbolAtLocation(current.name);
      if (symbol !== void 0) return symbol;
    }
    current = current.parent;
  }
  return void 0;
}
function typeText(context, type, node) {
  const rendered3 = context.checker.typeToString(
    type,
    node,
    TYPE_FORMAT_FLAGS
  );
  if (/\.\.\. [0-9]+ more \.\.\./u.test(rendered3)) {
    throw new Error(`Compiler truncated public type '${rendered3}'.`);
  }
  return rendered3;
}
function signatureShape(context, signature, fallback) {
  const declaration = signature.declaration ?? fallback;
  const typeParameters = (signature.typeParameters ?? []).map((parameter) => ({
    name: parameter.symbol?.name ?? typeText(context, parameter, declaration),
    constraint: parameter.getConstraint() === void 0 ? null : typeText(context, parameter.getConstraint(), declaration),
    default: parameter.getDefault() === void 0 ? null : typeText(context, parameter.getDefault(), declaration)
  }));
  const parameters = signature.getParameters().map((parameter) => {
    const parameterDeclaration = firstDeclaration(parameter) ?? declaration;
    return {
      name: parameter.name,
      type: typeText(
        context,
        context.checker.getTypeOfSymbolAtLocation(
          parameter,
          parameterDeclaration
        ),
        parameterDeclaration
      ),
      optional: (parameter.flags & ts.SymbolFlags.Optional) !== 0,
      rest: ts.isParameter(parameterDeclaration) && parameterDeclaration.dotDotDotToken !== void 0
    };
  });
  const result = typeText(
    context,
    context.checker.getReturnTypeOfSignature(signature),
    declaration
  );
  return { typeParameters, parameters, result };
}
function traversalIdentity(context, type) {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  const declaration = symbol === void 0 ? void 0 : firstDeclaration(symbol);
  if (declaration !== void 0 && isPackageDeclaration(context, declaration)) {
    const span = spanOf(context, declaration);
    return `package:${span.file}:${span.start.offset}:${typeText(
      context,
      type,
      declaration
    )}`;
  }
  return `compiler:${type.id ?? typeText(context, type, context.entrypoints[0].source)}`;
}
function namedTypeAnchor(context, type) {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  if (symbol === void 0) return void 0;
  const declaration = firstDeclaration(symbol);
  if (declaration === void 0 || !isPackageDeclaration(context, declaration)) {
    return void 0;
  }
  if (!ts.isInterfaceDeclaration(declaration) && !ts.isTypeAliasDeclaration(declaration) && !ts.isClassDeclaration(declaration)) {
    return void 0;
  }
  const rendered3 = typeText(context, type, declaration);
  const typeSuffix = rendered3 === symbol.name ? "" : `<${sha256(rendered3)}>`;
  return `type:${normalizeRelativePath(
    context.repositoryRoot,
    declaration.getSourceFile().fileName
  )}#${symbol.name}${typeSuffix}`;
}
function propertySegment(propertyName) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(propertyName) ? propertyName : `[${JSON.stringify(propertyName)}]`;
}
function addReachability(row, reachabilityPath) {
  if (!row.reachabilityPaths.includes(reachabilityPath)) {
    row.reachabilityPaths.push(reachabilityPath);
    row.reachabilityPaths.sort();
  }
}
function discoverCompilerSurface(repositoryRoot, context = loadCompilerContext(repositoryRoot)) {
  if (path2.resolve(repositoryRoot) !== context.repositoryRoot) throw new Error("Compiler surface context belongs to another repository.");
  const callableByKey = /* @__PURE__ */ new Map();
  const typeByKey = /* @__PURE__ */ new Map();
  const recursiveReferences = /* @__PURE__ */ new Set();
  const expandedTypeAnchors = /* @__PURE__ */ new Set();
  let maximumDepth = 0;
  function registerSignatures(type, kind, anchor, reachabilityPath, fallback) {
    const signatureKind = kind === "call" ? ts.SignatureKind.Call : ts.SignatureKind.Construct;
    const signatures = context.checker.getSignaturesOfType(type, signatureKind);
    for (const [index, signature] of signatures.entries()) {
      const declaration = signature.declaration ?? fallback;
      if (!isPublicDeclaration(context, declaration)) continue;
      const signatureData = signatureShape(context, signature, declaration);
      const key = `${anchor}::${kind}[${index}]`;
      const existing = callableByKey.get(key);
      if (existing !== void 0) {
        if (existing.signatureHash !== sha256(canonicalJson(signatureData))) {
          throw new Error(`Callable key '${key}' resolved to two signatures.`);
        }
        addReachability(existing, reachabilityPath);
        continue;
      }
      const declarationSymbol = symbolForDeclaration(context, declaration);
      callableByKey.set(key, {
        key,
        kind,
        overloadIndex: index,
        signature: signatureData,
        signatureHash: sha256(canonicalJson(signatureData)),
        declaration: spanOf(context, declaration),
        symbolDeclarations: symbolDeclarationSpans(
          context,
          declarationSymbol
        ),
        reachabilityPaths: [reachabilityPath]
      });
    }
  }
  function visitType(type, anchor, reachabilityPath, lineage, depth, keepAnchor) {
    maximumDepth = Math.max(maximumDepth, depth);
    if (depth > 128) {
      throw new Error(`Public type traversal exceeded depth 128 at '${anchor}'.`);
    }
    const identity = traversalIdentity(context, type);
    if (lineage.has(identity)) {
      recursiveReferences.add(`${anchor} -> ${identity}`);
      return;
    }
    const nextLineage = new Set(lineage);
    nextLineage.add(identity);
    const namedAnchor = keepAnchor ? void 0 : namedTypeAnchor(context, type);
    const semanticAnchor = namedAnchor ?? anchor;
    if (namedAnchor !== void 0) {
      const namedSymbol = type.aliasSymbol ?? type.getSymbol();
      const namedDeclaration = firstDeclaration(namedSymbol);
      if (namedDeclaration === void 0) {
        throw new Error(`Named public type '${namedAnchor}' has no declaration.`);
      }
      const typeRow = typeByKey.get(namedAnchor) ?? {
        key: namedAnchor,
        rendered: typeText(
          context,
          type,
          namedDeclaration
        ),
        declaration: spanOf(context, namedDeclaration),
        reachabilityPaths: []
      };
      addReachability(typeRow, reachabilityPath);
      typeByKey.set(namedAnchor, typeRow);
    }
    const expansionKey = `${identity}|${semanticAnchor}`;
    if (expandedTypeAnchors.has(expansionKey)) return;
    expandedTypeAnchors.add(expansionKey);
    registerSignatures(
      type,
      "call",
      semanticAnchor,
      reachabilityPath,
      context.entrypoints[0].source
    );
    registerSignatures(
      type,
      "construct",
      semanticAnchor,
      reachabilityPath,
      context.entrypoints[0].source
    );
    for (const kind of [ts.SignatureKind.Call, ts.SignatureKind.Construct]) {
      const label = kind === ts.SignatureKind.Call ? "call" : "construct";
      for (const [index, signature] of context.checker.getSignaturesOfType(type, kind).entries()) {
        const declaration = signature.declaration ?? context.entrypoints[0].source;
        if (!isPublicDeclaration(context, declaration)) continue;
        for (const parameter of signature.getParameters()) {
          const parameterDeclaration = firstDeclaration(parameter) ?? declaration;
          const parameterType = context.checker.getTypeOfSymbolAtLocation(
            parameter,
            parameterDeclaration
          );
          visitType(
            parameterType,
            `${semanticAnchor}::${label}[${index}]/parameter:${propertySegment(
              parameter.name
            )}`,
            `${reachabilityPath}::${label}[${index}]/parameter:${propertySegment(
              parameter.name
            )}`,
            nextLineage,
            depth + 1,
            false
          );
        }
        visitType(
          context.checker.getReturnTypeOfSignature(signature),
          `${semanticAnchor}::${label}[${index}]/return`,
          `${reachabilityPath}::${label}[${index}]/return`,
          nextLineage,
          depth + 1,
          false
        );
      }
    }
    if (type.isUnionOrIntersection()) {
      for (const [index, member2] of type.types.entries()) {
        visitType(
          member2,
          `${semanticAnchor}/member:${index}`,
          `${reachabilityPath}/member:${index}`,
          nextLineage,
          depth + 1,
          false
        );
      }
    }
    const typeArguments = context.checker.getTypeArguments?.(type) ?? [];
    for (const [index, argument] of typeArguments.entries()) {
      visitType(
        argument,
        `${semanticAnchor}/typeArgument:${index}`,
        `${reachabilityPath}/typeArgument:${index}`,
        nextLineage,
        depth + 1,
        false
      );
    }
    for (const property of context.checker.getPropertiesOfType(type)) {
      const declaration = firstDeclaration(property);
      if (declaration === void 0 || !isPublicDeclaration(context, declaration)) {
        continue;
      }
      const propertyType = context.checker.getTypeOfSymbolAtLocation(
        property,
        declaration
      );
      const segment = propertySegment(property.name);
      visitType(
        propertyType,
        `${semanticAnchor}.${segment}`,
        `${reachabilityPath}.${segment}`,
        nextLineage,
        depth + 1,
        false
      );
    }
    for (const indexInfo of context.checker.getIndexInfosOfType(type)) {
      const declaration = indexInfo.declaration;
      if (declaration === void 0 || !isPublicDeclaration(context, declaration)) {
        continue;
      }
      const indexKey = propertySegment(typeText(context, indexInfo.keyType, declaration));
      visitType(
        indexInfo.type,
        `${semanticAnchor}[index:${indexKey}]`,
        `${reachabilityPath}[index:${indexKey}]`,
        nextLineage,
        depth + 1,
        false
      );
    }
  }
  const entrypointRows = [];
  for (const entrypoint of context.entrypoints) {
    const moduleSymbol = context.checker.getSymbolAtLocation(entrypoint.source);
    if (moduleSymbol === void 0) {
      throw new Error(`Compiler has no module symbol for '${entrypoint.exportKey}'.`);
    }
    const exportRows = [];
    for (const exportedSymbol of context.checker.getExportsOfModule(moduleSymbol).sort((left, right) => compareCodeUnits(left.name, right.name))) {
      const resolved = resolveSymbol(context.checker, exportedSymbol);
      const declaration = firstDeclaration(resolved) ?? entrypoint.source;
      const exportedType = typeOfExport(context, exportedSymbol, entrypoint.source);
      const exportAnchor = `export:${entrypoint.exportKey}#${exportedSymbol.name}`;
      const declarations = symbolDeclarationSpans(context, resolved);
      const renderedType = typeText(context, exportedType, declaration);
      const exportRow = {
        key: exportAnchor,
        name: exportedSymbol.name,
        type: renderedType,
        typeHash: sha256(renderedType),
        flags: resolved.flags,
        declarations
      };
      exportRows.push(exportRow);
      visitType(
        exportedType,
        exportAnchor,
        exportAnchor,
        /* @__PURE__ */ new Set(),
        0,
        // Type-only callable aliases are one named semantic callback, not a second runtime export.
        (resolved.flags & ts.SymbolFlags.Value) !== 0
      );
    }
    entrypointRows.push({
      key: entrypoint.exportKey,
      typesTarget: entrypoint.typesTarget,
      source: normalizeRelativePath(
        context.repositoryRoot,
        entrypoint.source.fileName
      ),
      sourceHash: sha256(entrypoint.source.getFullText()),
      exports: exportRows
    });
  }
  const manifestWithoutDigest = {
    schemaVersion: SURFACE_SCHEMA_VERSION,
    package: {
      name: context.packageJson.name,
      version: context.packageJson.version,
      packageJsonHash: sha256(fs2.readFileSync(context.packageJsonPath)),
      tsconfigHash: sha256(fs2.readFileSync(context.configPath))
    },
    entrypoints: entrypointRows,
    callables: [...callableByKey.values()].sort(
      (left, right) => compareCodeUnits(left.key, right.key)
    ),
    reachableTypes: [...typeByKey.values()].sort(
      (left, right) => compareCodeUnits(left.key, right.key)
    ),
    diagnostics: {
      maximumDepth,
      recursiveReferences: [...recursiveReferences].sort()
    },
    counts: {
      entrypoints: entrypointRows.length,
      exports: entrypointRows.reduce(
        (total, entrypoint) => total + entrypoint.exports.length,
        0
      ),
      callables: callableByKey.size,
      reachableTypes: typeByKey.size
    }
  };
  return {
    ...manifestWithoutDigest,
    digest: sha256(canonicalJson(manifestWithoutDigest))
  };
}
function nodeAtExactSpan(source7, startOffset, endOffset) {
  let result;
  function visit(node) {
    if (result !== void 0) return;
    if (node.getStart(source7) === startOffset && node.getEnd() === endOffset) {
      result = node;
      return;
    }
    if (node.getStart(source7) <= startOffset && node.getEnd() >= endOffset) {
      ts.forEachChild(node, visit);
    }
  }
  visit(source7);
  return result;
}

// experiments/tla-conformance/surface-bindings/lib/binding-checker.mjs
import fs37 from "node:fs";
import path41 from "node:path";

// experiments/tla-conformance/value-contracts/surface-binding.mjs
import fs36 from "node:fs";
import path39 from "node:path";
import { fileURLToPath as fileURLToPath16 } from "node:url";

// experiments/tla-conformance/value-contracts/verify.mjs
import fs3 from "node:fs";
import path3 from "node:path";
import { fileURLToPath } from "node:url";
var contractPath = fileURLToPath(new URL("./contracts.json", import.meta.url));
var verifierPath = fileURLToPath(import.meta.url);
function fail(code, detail) {
  const error = new Error(detail);
  error.code = code;
  throw error;
}
function dependencyBody(context, call) {
  if (!ts.isIdentifier(call.expression) || call.questionDotToken !== void 0) {
    fail("VALUE_SEMANTIC_UNBOUND_CALL", "Only direct source-identifier calls are admitted.");
  }
  const signature = context.checker.getResolvedSignature(call);
  const body = signature?.declaration;
  if (body === void 0 || !ts.isFunctionDeclaration(body) || body.body === void 0 || body.getSourceFile().isDeclarationFile) {
    fail("VALUE_SEMANTIC_UNBOUND_CALL", "Called value helper has no unique resolved source body.");
  }
  const relative = path3.relative(context.repositoryRoot, body.getSourceFile().fileName).replaceAll("\\", "/");
  if (!relative.startsWith("src/")) fail("VALUE_SEMANTIC_UNBOUND_CALL", "Dependency is not package source.");
  return body;
}
function deriveValueReturnTerm(context, implementation) {
  const dependencies = /* @__PURE__ */ new Map();
  const standardDependencies = /* @__PURE__ */ new Map();
  const active = /* @__PURE__ */ new Set();
  function expand(body, arguments_) {
    if (active.has(body)) fail("VALUE_SEMANTIC_RECURSION", "Recursive value helper is not a closed term.");
    if (!ts.isFunctionDeclaration(body) || body.body === void 0 || body.asteriskToken !== void 0 || (ts.getCombinedModifierFlags(body) & ts.ModifierFlags.Async) !== 0) {
      fail("VALUE_SEMANTIC_BODY", "Value contract requires a synchronous ordinary source function.");
    }
    if (body.parameters.length !== arguments_.length) fail("VALUE_SEMANTIC_ARITY", "Value function arity differs from its call.");
    const environment = /* @__PURE__ */ new Map();
    for (let index = 0; index < body.parameters.length; index += 1) {
      const parameter = body.parameters[index];
      if (!ts.isIdentifier(parameter.name) || parameter.initializer !== void 0 || parameter.dotDotDotToken !== void 0) {
        fail("VALUE_SEMANTIC_PARAMETER", "Parameters must be simple, non-defaulted identifiers.");
      }
      const symbol = context.checker.getSymbolAtLocation(parameter.name);
      if (symbol === void 0) fail("VALUE_SEMANTIC_PARAMETER", "Parameter has no compiler identity.");
      environment.set(symbol, arguments_[index]);
    }
    if (body.body.statements.length !== 1 || !ts.isReturnStatement(body.body.statements[0]) || body.body.statements[0].expression === void 0) {
      fail("VALUE_SEMANTIC_BODY", "One explicit return expression is required; no hidden statements are allowed.");
    }
    active.add(body);
    const source7 = spanOf(context, body);
    dependencies.set(`${source7.file}:${source7.start.offset}:${source7.end.offset}`, source7);
    function sparseEmptyRecordTerm(dependency2, call) {
      const relative = path3.relative(context.repositoryRoot, dependency2.getSourceFile().fileName).replaceAll("\\", "/");
      if (relative !== "src/sparse-record.ts" || dependency2.name?.text !== "createInventorySparseRecord") return void 0;
      if (call.arguments.length !== 0 || dependency2.parameters.length !== 0 || dependency2.body === void 0 || dependency2.body.statements.length !== 1 || !ts.isReturnStatement(dependency2.body.statements[0]) || dependency2.body.statements[0].expression === void 0) {
        fail("VALUE_SEMANTIC_SPARSE_RECORD", "Sparse-record construction must remain one zero-argument return expression.");
      }
      let runtimeExpression = dependency2.body.statements[0].expression;
      while (ts.isParenthesizedExpression(runtimeExpression) || ts.isAsExpression(runtimeExpression) || ts.isTypeAssertionExpression(runtimeExpression) || ts.isSatisfiesExpression(runtimeExpression)) {
        runtimeExpression = runtimeExpression.expression;
      }
      if (!ts.isCallExpression(runtimeExpression) || runtimeExpression.arguments.length !== 1 || runtimeExpression.arguments[0].kind !== ts.SyntaxKind.NullKeyword || runtimeExpression.questionDotToken !== void 0 || !ts.isPropertyAccessExpression(runtimeExpression.expression) || runtimeExpression.expression.questionDotToken !== void 0 || !ts.isIdentifier(runtimeExpression.expression.expression) || runtimeExpression.expression.expression.text !== "Object" || runtimeExpression.expression.name.text !== "create") {
        fail("VALUE_SEMANTIC_SPARSE_RECORD", "Sparse-record construction must be exact global Object.create(null).");
      }
      const objectSymbol = context.checker.getSymbolAtLocation(runtimeExpression.expression.expression);
      const objectDeclarations = objectSymbol?.declarations ?? [];
      if (objectSymbol?.getName() !== "Object" || (objectSymbol.flags & ts.SymbolFlags.Alias) !== 0 || objectDeclarations.length === 0 || objectDeclarations.some((candidate) => !candidate.getSourceFile().isDeclarationFile) || !objectDeclarations.some((candidate) => ts.isVariableDeclaration(candidate) && candidate.name.getText(candidate.getSourceFile()) === "Object")) {
        fail("VALUE_SEMANTIC_SPARSE_RECORD", "Sparse-record construction must use the standard global Object intrinsic.");
      }
      const signature = context.checker.getResolvedSignature(runtimeExpression);
      const declaration = signature?.declaration;
      if (declaration === void 0 || !declaration.getSourceFile().isDeclarationFile || declaration.getText(declaration.getSourceFile()) !== "create(o: object | null): any;") {
        fail("VALUE_SEMANTIC_SPARSE_RECORD", "Object.create must resolve to the reviewed standard declaration.");
      }
      const source8 = spanOf(context, dependency2);
      dependencies.set(`${source8.file}:${source8.start.offset}:${source8.end.offset}`, source8);
      const standard = spanOf(context, declaration);
      standardDependencies.set("Object.create", {
        operation: "Object.create",
        file: "typescript/lib/lib.es5.d.ts",
        start: standard.start,
        end: standard.end,
        sourceHash: standard.sourceHash,
        astHash: standard.astHash
      });
      return ["sparse-record", []];
    }
    function term4(node) {
      if (ts.isParenthesizedExpression(node)) return term4(node.expression);
      if (ts.isIdentifier(node)) {
        const symbol = context.checker.getSymbolAtLocation(node);
        if (!environment.has(symbol)) fail("VALUE_SEMANTIC_NONLOCAL", `Non-parameter value '${node.text}'.`);
        return environment.get(symbol);
      }
      if (ts.isNumericLiteral(node)) return ["number", String(Number(node.text))];
      if (ts.isStringLiteral(node)) return ["string", node.text];
      if (node.kind === ts.SyntaxKind.TrueKeyword) return ["boolean", true];
      if (node.kind === ts.SyntaxKind.FalseKeyword) return ["boolean", false];
      if (node.kind === ts.SyntaxKind.NullKeyword) return ["null"];
      if (ts.isPropertyAccessExpression(node)) {
        if (node.questionDotToken !== void 0) fail("VALUE_SEMANTIC_FIELD", "Optional field reads are not admitted.");
        const symbol = context.checker.getSymbolAtLocation(node.name);
        if (symbol === void 0 || (symbol.flags & ts.SymbolFlags.Optional) !== 0 || (symbol.declarations ?? []).some((declaration) => ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration))) {
          fail("VALUE_SEMANTIC_FIELD", "Only required declared data fields may be projected.");
        }
        return ["get", term4(node.expression), node.name.text];
      }
      if (ts.isObjectLiteralExpression(node)) {
        const fields2 = /* @__PURE__ */ new Map();
        for (const property of node.properties) {
          if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
            fail("VALUE_SEMANTIC_RECORD", "Record fields must be explicit data properties, without spreads or methods.");
          }
          const name = property.name.text;
          if (name === "__proto__" || fields2.has(name)) fail("VALUE_SEMANTIC_RECORD", "Prototype-changing or duplicate fields are not admitted.");
          fields2.set(name, term4(property.initializer));
        }
        return ["record", [...fields2].sort(([left], [right]) => compareCodeUnits(left, right))];
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.MinusToken) {
        for (const operand of [node.left, node.right]) {
          if ((context.checker.getTypeAtLocation(operand).flags & ts.TypeFlags.NumberLike) === 0) {
            fail("VALUE_SEMANTIC_NUMBER", "Subtraction requires declared number operands, not object coercion or bigint.");
          }
        }
        return ["subtract", term4(node.left), term4(node.right)];
      }
      if (ts.isCallExpression(node)) {
        const dependency2 = dependencyBody(context, node);
        const sparse = sparseEmptyRecordTerm(dependency2, node);
        if (sparse !== void 0) return sparse;
        return expand(dependency2, node.arguments.map(term4));
      }
      fail("VALUE_SEMANTIC_SYNTAX", `Unproved expression kind '${ts.SyntaxKind[node.kind]}'.`);
    }
    try {
      return term4(body.body.statements[0].expression);
    } finally {
      active.delete(body);
    }
  }
  const result = expand(implementation, implementation.parameters.map((_, index) => ["parameter", index]));
  return {
    term: result,
    dependencies: [...dependencies.values()].sort((left, right) => compareCodeUnits(`${left.file}:${left.start.offset}`, `${right.file}:${right.start.offset}`)),
    standardDependencies: [...standardDependencies.values()].sort((left, right) => compareCodeUnits(left.operation, right.operation))
  };
}
function verifyValueSemantics(context, surfaceKey, implementation) {
  try {
    const bytes2 = fs3.readFileSync(contractPath);
    const document = JSON.parse(bytes2);
    if (document.schemaVersion !== 2 || document.domain !== "DECLARED_IMMUTABLE_DATA_VALUES_V2" || !Array.isArray(document.contracts)) {
      fail("VALUE_SEMANTIC_CONTRACT_SCHEMA", "Independent value specification schema is invalid.");
    }
    const matches = document.contracts.filter((contract2) => contract2.surfaceKeys.includes(surfaceKey));
    if (matches.length !== 1) fail("VALUE_SEMANTIC_CONTRACT_MISSING", `Exactly one reviewed value contract is required for '${surfaceKey}'.`);
    const contract = matches[0];
    if (implementation.parameters.length !== contract.arity) fail("VALUE_SEMANTIC_ARITY", "Source arity differs from the independent value specification.");
    const derived = deriveValueReturnTerm(context, implementation);
    if (canonicalJson(derived.term) !== canonicalJson(contract.term)) {
      fail("VALUE_SEMANTIC_RESULT_MISMATCH", `Returned value does not implement independent contract '${contract.id}'.`);
    }
    return {
      status: "PROVED",
      proof: {
        contractId: contract.id,
        domain: document.domain,
        engine: "closed-return-term-identity-v2",
        allAdmittedInputs: true,
        sampledInputs: 0,
        independentContract: true,
        contractFile: path3.relative(context.repositoryRoot, contractPath).replaceAll("\\", "/"),
        contractSha256: sha256(bytes2),
        verifierFile: path3.relative(context.repositoryRoot, verifierPath).replaceAll("\\", "/"),
        verifierSha256: sha256(fs3.readFileSync(verifierPath)),
        equationSha256: sha256(canonicalJson(contract.term)),
        dependencies: derived.dependencies,
        standardDependencies: derived.standardDependencies
      }
    };
  } catch (error) {
    return { status: "REJECTED", diagnostics: [{ code: error.code ?? "VALUE_SEMANTIC_VERIFICATION_FAILED", detail: error.message }] };
  }
}

// experiments/tla-conformance/value-contracts/catalog-family.mjs
import assert2 from "node:assert/strict";
import fs5 from "node:fs";
import path5 from "node:path";

// experiments/tla-conformance/authority-r5/catalog-published-source-equations.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs4 from "node:fs";
import path4 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// experiments/tla-conformance/authority-r5/catalog-published-source-contracts.mjs
var CATALOG_PUBLISHED_SOURCE_DOMAIN = "ALL_VALIDATED_CATALOGS_AND_FROZEN_PUBLISHED_SNAPSHOTS_V1";
function member(surfaceKey, sourceFile3, className, methodName, equation3, law) {
  return Object.freeze({
    surfaceKey,
    sourceFile: sourceFile3,
    className,
    methodName,
    equation: equation3,
    law: Object.freeze(law)
  });
}
function requiredLookup(surfaceKey, methodName, mapField, errorPrefix, errorSuffix) {
  return member(
    surfaceKey,
    "src/catalog.ts",
    "InventoryCatalog",
    methodName,
    `result = ${mapField}[key] when present; otherwise throw the declared key-specific error`,
    {
      kind: "required-map-lookup",
      mapField,
      errorPrefix,
      errorSuffix
    }
  );
}
function publishedCatalogDelegate(surfaceKey, methodName) {
  return member(
    surfaceKey,
    "src/facade.ts",
    "InventoryOnceCatalogImplementation",
    methodName,
    `result = catalogFor(storage.readWorld(), configuredCatalog).${methodName}(argument)`,
    { kind: "published-catalog-delegate", targetMethod: methodName }
  );
}
function snapshotReturn(surfaceKey, methodName, parameterCount, expression, defaults = [], optionalParameters = []) {
  return member(
    surfaceKey,
    "src/facade.ts",
    "InventoryOnceReadSnapshotImplementation",
    methodName,
    `result = ${expression}`,
    {
      kind: "direct-return",
      parameterCount,
      defaults: Object.freeze(defaults),
      optionalParameters: Object.freeze(optionalParameters),
      expression
    }
  );
}
var CATALOG_PUBLISHED_SOURCE_CONTRACTS = Object.freeze([
  requiredLookup(
    "type:src/catalog.ts#InventoryCatalog.activeItem::call[0]",
    "activeItem",
    "activeItemById",
    "Unknown active inventory item '",
    "'."
  ),
  requiredLookup(
    "type:src/catalog.ts#InventoryCatalog.itemRevision::call[0]",
    "itemRevision",
    "itemByRevisionId",
    "Unknown inventory item revision '",
    "'."
  ),
  member(
    "type:src/catalog.ts#InventoryCatalog.itemRevisionsForItem::call[0]",
    "src/catalog.ts",
    "InventoryCatalog",
    "itemRevisionsForItem",
    "result = freeze(itemRevisions filtered by exact stable itemId)",
    { kind: "retained-item-filter" }
  ),
  member(
    "type:src/catalog.ts#InventoryCatalog.measurementAxis::call[0]",
    "src/catalog.ts",
    "InventoryCatalog",
    "measurementAxis",
    "result = primary axis when ids match, else first matching independent axis, else throw",
    { kind: "measurement-axis-lookup" }
  ),
  requiredLookup(
    "type:src/catalog.ts#InventoryCatalog.packagingRevision::call[0]",
    "packagingRevision",
    "packagingByRevisionId",
    "Unknown inventory packaging revision '",
    "'."
  ),
  requiredLookup(
    "type:src/catalog.ts#InventoryCatalog.activeComposition::call[0]",
    "activeComposition",
    "activeCompositionById",
    "Unknown active inventory composition '",
    "'."
  ),
  requiredLookup(
    "type:src/catalog.ts#InventoryCatalog.compositionRevision::call[0]",
    "compositionRevision",
    "compositionByRevisionId",
    "Unknown inventory composition revision '",
    "'."
  ),
  requiredLookup(
    "type:src/catalog.ts#InventoryCatalog.compositionForSourcePackagingRevision::call[0]",
    "compositionForSourcePackagingRevision",
    "compositionBySourcePackagingRevisionId",
    "Inventory packaging revision '",
    "' has no heterogeneous composition."
  ),
  requiredLookup(
    "type:src/catalog.ts#InventoryCatalog.activeTransformation::call[0]",
    "activeTransformation",
    "activeTransformationById",
    "Unknown active inventory transformation '",
    "'."
  ),
  requiredLookup(
    "type:src/catalog.ts#InventoryCatalog.transformationRevision::call[0]",
    "transformationRevision",
    "transformationByRevisionId",
    "Unknown inventory transformation revision '",
    "'."
  ),
  member(
    "type:src/catalog.ts#InventoryCatalog.transformationsForItem::call[0]",
    "src/catalog.ts",
    "InventoryCatalog",
    "transformationsForItem",
    "result = freeze(all retained transformations with any input/output revision owned by itemId)",
    { kind: "retained-transformation-item-filter" }
  ),
  member(
    "type:src/catalog.ts#InventoryCatalog.transformationsFromRevision::call[0]",
    "src/catalog.ts",
    "InventoryCatalog",
    "transformationsFromRevision",
    "result = freeze(sorted active transformations with an input matching the exact revision)",
    { kind: "active-transformation-revision-filter", side: "inputs" }
  ),
  member(
    "type:src/catalog.ts#InventoryCatalog.transformationsToRevision::call[0]",
    "src/catalog.ts",
    "InventoryCatalog",
    "transformationsToRevision",
    "result = freeze(sorted active transformations with an output matching the exact revision)",
    { kind: "active-transformation-revision-filter", side: "outputs" }
  ),
  member(
    "type:src/catalog.ts#InventoryCatalog.transformationsBetweenRevisions::call[0]",
    "src/catalog.ts",
    "InventoryCatalog",
    "transformationsBetweenRevisions",
    "result = freeze(transformationsFromRevision(from) filtered by an exact matching output revision)",
    { kind: "between-transformation-filter" }
  ),
  requiredLookup(
    "type:src/catalog.ts#InventoryCatalog.activeCollection::call[0]",
    "activeCollection",
    "activeCollectionById",
    "Unknown active inventory collection '",
    "'."
  ),
  requiredLookup(
    "type:src/catalog.ts#InventoryCatalog.collectionRevision::call[0]",
    "collectionRevision",
    "collectionByRevisionId",
    "Unknown inventory collection revision '",
    "'."
  ),
  requiredLookup(
    "type:src/catalog.ts#InventoryCatalog.collectionItemRevisionIds::call[0]",
    "collectionItemRevisionIds",
    "collectionItemRevisionIdsByRevisionId",
    "Unknown inventory collection revision '",
    "'."
  ),
  publishedCatalogDelegate(
    "type:src/facade.ts#InventoryOnceCatalogApi.activeItem::call[0]",
    "activeItem"
  ),
  publishedCatalogDelegate(
    "type:src/facade.ts#InventoryOnceCatalogApi.itemRevision::call[0]",
    "itemRevision"
  ),
  publishedCatalogDelegate(
    "type:src/facade.ts#InventoryOnceCatalogApi.itemRevisionsForItem::call[0]",
    "itemRevisionsForItem"
  ),
  snapshotReturn(
    "type:src/facade.ts#InventoryOnceReadSnapshotApi.positions::call[0]",
    "positions",
    1,
    "findInventoryPositions(this.world.projection, p0)"
  ),
  snapshotReturn(
    "type:src/facade.ts#InventoryOnceReadSnapshotApi.summary::call[0]",
    "summary",
    1,
    "summarizeInventoryStock({ catalog: this.catalog, projection: this.world.projection, selector: p0 })"
  ),
  snapshotReturn(
    "type:src/facade.ts#InventoryOnceReadSnapshotApi.availability::call[0]",
    "availability",
    2,
    "summarizeInventoryAvailability({ catalog: this.catalog, projection: this.world.projection, reservations: this.world.reservations, selector: p0, at: p1 })",
    [null, "this.defaultAt"]
  ),
  snapshotReturn(
    "type:src/facade.ts#InventoryOnceReadSnapshotApi.planAllocation::call[0]",
    "planAllocation",
    1,
    "planInventoryAllocation({ catalog: this.catalog, world: this.world, selector: p0.selector, amount: p0.amount, method: p0.method, at: p0.at ?? this.defaultAt, ...(p0.reservationAt === undefined ? {} : { reservationAt: p0.reservationAt }), ...(p0.itemRevisionId === undefined ? {} : { itemRevisionId: p0.itemRevisionId }), ...(p0.allowExpiredLots === undefined ? {} : { allowExpiredLots: p0.allowExpiredLots }), ...(p0.reservationId === undefined ? {} : { reservationId: p0.reservationId }), ...(p0.allowAllocatedStock === undefined ? {} : { allowAllocatedStock: p0.allowAllocatedStock }) })"
  ),
  snapshotReturn(
    "type:src/facade.ts#InventoryOnceReadSnapshotApi.packagingRevisions::call[0]",
    "packagingRevisions",
    1,
    "listInventoryPackagingRevisions({ catalog: this.catalog, ...p0 })"
  ),
  snapshotReturn(
    "type:src/facade.ts#InventoryOnceReadSnapshotApi.container::call[0]",
    "container",
    1,
    "this.world.projection.containers[inventoryContainerIdentity(p0)]"
  ),
  member(
    "type:src/facade.ts#InventoryOnceReadSnapshotApi.containers::call[0]",
    "src/facade.ts",
    "InventoryOnceReadSnapshotImplementation",
    "containers",
    "result = Object.values(frozen projection containers) sorted by exact container identity",
    {
      kind: "projection-values-sort",
      expression: "this.world.projection.containers",
      comparator: "compareProjectedContainerDefinition"
    }
  ),
  snapshotReturn(
    "type:src/facade.ts#InventoryOnceReadSnapshotApi.lot::call[0]",
    "lot",
    2,
    "this.world.projection.lots[inventoryLotIdentity(p0, p1)]"
  ),
  snapshotReturn(
    "type:src/facade.ts#InventoryOnceReadSnapshotApi.lots::call[0]",
    "lots",
    1,
    "inventoryProjectedLots(this.world.projection, p0)",
    [],
    [0]
  ),
  member(
    "type:src/facade.ts#InventoryOnceReadSnapshotApi.compositionRevisionsForItem::call[0]",
    "src/facade.ts",
    "InventoryOnceReadSnapshotImplementation",
    "compositionRevisionsForItem",
    "result = exact catalog compositions whose source package belongs to itemId, sorted by revision identity",
    { kind: "snapshot-composition-filter" }
  ),
  snapshotReturn(
    "type:src/facade.ts#InventoryOnceReadSnapshotApi.collectionSummary::call[0]",
    "collectionSummary",
    1,
    "summarizeInventoryCollection({ catalog: this.catalog, projection: this.world.projection, collectionRevisionId: p0.collectionRevisionId, ...(p0.scope === undefined ? {} : { scope: p0.scope }) })"
  ),
  snapshotReturn(
    "type:src/facade.ts#InventoryOnceReadSnapshotApi.event::call[0]",
    "event",
    1,
    "inventorySparseRecordValue(this.world.projection.events, p0)"
  ),
  snapshotReturn(
    "type:src/facade.ts#InventoryOnceReadSnapshotApi.count::call[0]",
    "count",
    1,
    "inventorySparseRecordValue(this.world.counts.counts, p0)"
  )
]);
var CATALOG_PUBLISHED_SUPPORTING_CONTRACTS = Object.freeze([
  Object.freeze({
    sourceFile: "src/facade.ts",
    functionName: "inventoryCatalogForPublishedWorld",
    equation: "result = configured catalog exactly at revision zero; otherwise reconstruct the exact published catalog snapshot",
    law: Object.freeze({ kind: "published-catalog-selection" })
  }),
  Object.freeze({
    sourceFile: "src/facade.ts",
    functionName: "inventoryProjectedLots",
    equation: "result = all lot identities or the exact item index, rejecting missing/foreign index rows, sorted by item-scoped identity",
    law: Object.freeze({ kind: "projected-lot-index" })
  })
]);
function catalogSnapshotMember(sourceFile3, declarationKind, declarationName, surfaceKeys, equation3, law, className) {
  return Object.freeze({
    sourceFile: sourceFile3,
    declarationKind,
    declarationName,
    surfaceKeys: Object.freeze(surfaceKeys),
    equation: equation3,
    law: Object.freeze(law),
    ...className === void 0 ? {} : { className }
  });
}
var CATALOG_SNAPSHOT_SOURCE_CONTRACTS = Object.freeze([
  catalogSnapshotMember(
    "src/catalog.ts",
    "method",
    "define",
    [
      "export:.#InventoryCatalog.define::call[0]",
      "export:./kernel#InventoryCatalog.define::call[0]"
    ],
    "result = new InventoryCatalog(createInventoryCatalogParts(input))",
    { kind: "catalog-static-define" },
    "InventoryCatalog"
  ),
  catalogSnapshotMember(
    "src/catalog.ts",
    "function",
    "defineInventoryCatalog",
    [
      "export:.#defineInventoryCatalog::call[0]",
      "export:./kernel#defineInventoryCatalog::call[0]"
    ],
    "result = InventoryCatalog.define(input)",
    { kind: "catalog-define-delegate" }
  ),
  catalogSnapshotMember(
    "src/catalog.ts",
    "function",
    "emptyInventoryCatalogSnapshot",
    [
      "export:.#emptyInventoryCatalogSnapshot::call[0]",
      "export:./kernel#emptyInventoryCatalogSnapshot::call[0]"
    ],
    "result = the complete empty retained snapshot with digest computed from the same empty definition input",
    { kind: "empty-catalog-snapshot" }
  ),
  catalogSnapshotMember(
    "src/catalog.ts",
    "function",
    "inventoryCatalogFromSnapshot",
    [
      "export:.#inventoryCatalogFromSnapshot::call[0]",
      "export:./kernel#inventoryCatalogFromSnapshot::call[0]"
    ],
    "result = normalized snapshot catalog only when its recomputed digest equals the retained digest; otherwise throw",
    { kind: "catalog-from-snapshot" }
  ),
  catalogSnapshotMember(
    "src/catalog.ts",
    "function",
    "assertInventoryCatalogRetainsSnapshot",
    [
      "export:.#assertInventoryCatalogRetainsSnapshot::call[0]",
      "export:./kernel#assertInventoryCatalogRetainsSnapshot::call[0]"
    ],
    "for every retained item, package, composition, transformation, collection, and fungibility revision, require an equal digest at the same exact revision identity",
    { kind: "retained-catalog-digest-equality" }
  ),
  catalogSnapshotMember(
    "src/integrity.ts",
    "function",
    "inventoryCatalogSnapshotDigest",
    ["export:./storage#inventoryCatalogSnapshotDigest::call[0]"],
    "result = inventoryCatalogFromSnapshot(snapshot).digest",
    { kind: "catalog-snapshot-digest" }
  )
]);
var PUBLISHED_READ_STATEFUL_BINDING_BLOCKER = Object.freeze({
  family: "PUBLISHED_WORLD_STORAGE_ACQUISITION",
  reason: "Source equations prove exact delegation after readWorld, but this lane does not substitute them for checkpoint-derived storage causality.",
  surfaceKeys: Object.freeze([
    "export:.#readPublishedInventoryCatalog::call[0]",
    "export:.#readPublishedInventorySnapshot::call[0]",
    "type:src/facade.ts#InventoryOnceCatalogApi.activeItem::call[0]",
    "type:src/facade.ts#InventoryOnceCatalogApi.itemRevision::call[0]",
    "type:src/facade.ts#InventoryOnceCatalogApi.itemRevisionsForItem::call[0]"
  ]),
  checkpointCausalityProvedHere: false,
  localAdmissionCreditGranted: false
});
var CATALOG_PUBLICATION_STATEFUL_BLOCKER = Object.freeze({
  gapId: "CATALOG_PUBLICATION_REDUNDANT_SWITCH_ACTIVE_GAP",
  family: "STATEFUL_CATALOG_PUBLICATION_COMMANDS",
  reason: "Original CatalogPublication permits redundant SwitchActive occurrences that the native publication command rejects or stutters.",
  originalMismatchOccurrences: 1080,
  sourceEquationCreditGranted: false
});

// experiments/tla-conformance/authority-r5/catalog-published-source-equations.mjs
var FAMILY_DIRECTORY = path4.dirname(fileURLToPath2(import.meta.url));
var REPOSITORY_ROOT = path4.resolve(FAMILY_DIRECTORY, "../../..");
var CERTIFICATE_PATH = path4.join(
  FAMILY_DIRECTORY,
  "catalog-published-source-equations.json"
);
var BOUNDED_FIXTURE_CERTIFICATE_PATH = path4.join(
  FAMILY_DIRECTORY,
  "catalog-published-value-certificate.json"
);
var BOUNDED_FIXTURE_DOMAIN = "RICH_SCALAR_CATALOG_AND_ONE_RECEIPT_SNAPSHOT_V1";
var BOUNDED_FIXTURE_SHA256 = "c0860eda3406691b84924d56c7cea1b0625a55cd75ba594ce79f2480608a1869";
var BOUNDED_FIXTURE_CERTIFICATE_ID = "VALUE_CERTIFICATE_FAMILY:sha256:b22005aec0d6a076d71d3686773b0366e4560bba04af3b728a25f7e5cd49942e";
var SOURCE_FAMILY_ID = "inventoryonce.catalog-published.source-equations.v1";
function sha2562(value) {
  return createHash("sha256").update(value).digest("hex");
}
function requireExactKeys(value, expected, label) {
  assert.equal(
    value !== null && typeof value === "object" && !Array.isArray(value),
    true,
    `${label} must be an object.`
  );
  assert.deepEqual(
    Object.keys(value).sort(compareCodeUnits),
    [...expected].sort(compareCodeUnits),
    `${label} fields changed.`
  );
}
function findClassMethod(source7, className, methodName) {
  const matchingClasses = source7.statements.filter(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === className
  );
  assert.equal(
    matchingClasses.length,
    1,
    `Expected one class '${className}' in ${source7.fileName}.`
  );
  const methods = matchingClasses[0].members.filter(
    (declaration) => ts.isMethodDeclaration(declaration) && ts.isIdentifier(declaration.name) && declaration.name.text === methodName && declaration.body !== void 0
  );
  assert.equal(
    methods.length,
    1,
    `Expected one concrete method '${className}.${methodName}'.`
  );
  return methods[0];
}
function findFunction(source7, functionName) {
  const functions2 = source7.statements.filter(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === functionName && statement.body !== void 0
  );
  assert.equal(
    functions2.length,
    1,
    `Expected one concrete function '${functionName}' in ${source7.fileName}.`
  );
  return functions2[0];
}
function binaryOperator(token) {
  return ts.tokenToString(token.kind) ?? ts.SyntaxKind[token.kind];
}
function normalizeCallable(declaration) {
  assert.notEqual(declaration.body, void 0, "Callable needs one concrete body.");
  const environment = /* @__PURE__ */ new Map();
  const counters = { local: 0, lambda: 0 };
  function bind(name, identity) {
    assert.equal(ts.isIdentifier(name), true, "Only simple source bindings are admitted.");
    environment.set(name.text, identity);
  }
  for (const [index, parameter] of declaration.parameters.entries()) {
    bind(parameter.name, `parameter:${index}`);
  }
  function propertyName(name) {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
      return name.text;
    }
    throw new Error(`Unsupported computed property '${name.getText()}'.`);
  }
  function expression(node, scopedEnvironment = environment) {
    if (ts.isParenthesizedExpression(node)) return expression(node.expression, scopedEnvironment);
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) {
      return expression(node.expression, scopedEnvironment);
    }
    if (node.kind === ts.SyntaxKind.ThisKeyword) return ["this"];
    if (ts.isIdentifier(node)) {
      return ["reference", scopedEnvironment.get(node.text) ?? `source:${node.text}`];
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return ["string", node.text];
    }
    if (ts.isNumericLiteral(node)) return ["number", node.text];
    if (node.kind === ts.SyntaxKind.TrueKeyword) return ["boolean", true];
    if (node.kind === ts.SyntaxKind.FalseKeyword) return ["boolean", false];
    if (node.kind === ts.SyntaxKind.NullKeyword) return ["null"];
    if (ts.isPropertyAccessExpression(node)) {
      return [
        "property",
        expression(node.expression, scopedEnvironment),
        node.name.text,
        node.questionDotToken === void 0 ? "required" : "optional"
      ];
    }
    if (ts.isElementAccessExpression(node)) {
      assert.notEqual(node.argumentExpression, void 0);
      return [
        "element",
        expression(node.expression, scopedEnvironment),
        expression(node.argumentExpression, scopedEnvironment),
        node.questionDotToken === void 0 ? "required" : "optional"
      ];
    }
    if (ts.isCallExpression(node)) {
      return [
        "call",
        expression(node.expression, scopedEnvironment),
        node.arguments.map((argument) => expression(argument, scopedEnvironment)),
        node.questionDotToken === void 0 ? "required" : "optional"
      ];
    }
    if (ts.isNewExpression(node)) {
      return [
        "new",
        expression(node.expression, scopedEnvironment),
        (node.arguments ?? []).map((argument) => expression(argument, scopedEnvironment))
      ];
    }
    if (ts.isAwaitExpression(node)) return ["await", expression(node.expression, scopedEnvironment)];
    if (ts.isBinaryExpression(node)) {
      return [
        "binary",
        binaryOperator(node.operatorToken),
        expression(node.left, scopedEnvironment),
        expression(node.right, scopedEnvironment)
      ];
    }
    if (ts.isConditionalExpression(node)) {
      return [
        "conditional",
        expression(node.condition, scopedEnvironment),
        expression(node.whenTrue, scopedEnvironment),
        expression(node.whenFalse, scopedEnvironment)
      ];
    }
    if (ts.isPrefixUnaryExpression(node)) {
      return [
        "prefix",
        ts.tokenToString(node.operator) ?? ts.SyntaxKind[node.operator],
        expression(node.operand, scopedEnvironment)
      ];
    }
    if (ts.isVoidExpression(node)) return ["void", expression(node.expression, scopedEnvironment)];
    if (ts.isSpreadElement(node)) return ["spread", expression(node.expression, scopedEnvironment)];
    if (ts.isArrayLiteralExpression(node)) {
      return [
        "array",
        node.elements.map(
          (element) => ts.isOmittedExpression(element) ? ["omitted"] : expression(element, scopedEnvironment)
        )
      ];
    }
    if (ts.isObjectLiteralExpression(node)) {
      return [
        "record",
        node.properties.map((property) => {
          if (ts.isPropertyAssignment(property)) {
            return [
              "field",
              propertyName(property.name),
              expression(property.initializer, scopedEnvironment)
            ];
          }
          if (ts.isShorthandPropertyAssignment(property)) {
            return [
              "field",
              property.name.text,
              expression(property.name, scopedEnvironment)
            ];
          }
          if (ts.isSpreadAssignment(property)) {
            return ["spread", expression(property.expression, scopedEnvironment)];
          }
          throw new Error(`Unsupported object member '${property.getText()}'.`);
        })
      ];
    }
    if (ts.isArrowFunction(node)) {
      const childEnvironment = new Map(scopedEnvironment);
      const lambdaId = counters.lambda;
      counters.lambda += 1;
      for (const [index, parameter] of node.parameters.entries()) {
        assert.equal(ts.isIdentifier(parameter.name), true, "Lambda parameters must be simple.");
        childEnvironment.set(parameter.name.text, `lambda:${lambdaId}:${index}`);
      }
      return [
        "lambda",
        node.parameters.length,
        ts.isBlock(node.body) ? statement(node.body, childEnvironment) : expression(node.body, childEnvironment)
      ];
    }
    if (ts.isTemplateExpression(node)) {
      return [
        "template",
        node.head.text,
        node.templateSpans.map((span) => [
          expression(span.expression, scopedEnvironment),
          span.literal.text
        ])
      ];
    }
    throw new Error(
      `Unsupported source-equation expression '${ts.SyntaxKind[node.kind]}': ${node.getText()}`
    );
  }
  function branch(node, scopedEnvironment) {
    if (!ts.isBlock(node)) return statement(node, scopedEnvironment);
    const normalized = statements(node.statements, new Map(scopedEnvironment));
    return normalized.length === 1 ? normalized[0] : ["sequence", normalized];
  }
  function statements(sourceStatements, scopedEnvironment) {
    const result = [];
    for (const sourceStatement of sourceStatements) {
      result.push(statement(sourceStatement, scopedEnvironment));
    }
    return result;
  }
  function statement(node, scopedEnvironment = environment) {
    if (ts.isBlock(node)) {
      return ["sequence", statements(node.statements, new Map(scopedEnvironment))];
    }
    if (ts.isVariableStatement(node)) {
      assert.equal(node.declarationList.declarations.length, 1, "One local per declaration is required.");
      const declaration2 = node.declarationList.declarations[0];
      assert.equal(ts.isIdentifier(declaration2.name), true, "Locals must use simple identifiers.");
      const initializer = declaration2.initializer === void 0 ? ["undefined"] : expression(declaration2.initializer, scopedEnvironment);
      const identity = `local:${counters.local}`;
      counters.local += 1;
      scopedEnvironment.set(declaration2.name.text, identity);
      return ["bind", identity, initializer];
    }
    if (ts.isIfStatement(node)) {
      return [
        "if",
        expression(node.expression, scopedEnvironment),
        branch(node.thenStatement, new Map(scopedEnvironment)),
        node.elseStatement === void 0 ? ["no-else"] : branch(node.elseStatement, new Map(scopedEnvironment))
      ];
    }
    if (ts.isReturnStatement(node)) {
      return [
        "return",
        node.expression === void 0 ? ["undefined"] : expression(node.expression, scopedEnvironment)
      ];
    }
    if (ts.isThrowStatement(node)) return ["throw", expression(node.expression, scopedEnvironment)];
    if (ts.isExpressionStatement(node)) {
      return ["expression", expression(node.expression, scopedEnvironment)];
    }
    if (ts.isForOfStatement(node)) {
      assert.equal(
        ts.isVariableDeclarationList(node.initializer),
        true,
        "For-of source equations require one declared iterator."
      );
      assert.equal(node.initializer.declarations.length, 1);
      const iterator = node.initializer.declarations[0];
      assert.equal(ts.isIdentifier(iterator.name), true);
      const iterable = expression(node.expression, scopedEnvironment);
      const childEnvironment = new Map(scopedEnvironment);
      const identity = `local:${counters.local}`;
      counters.local += 1;
      childEnvironment.set(iterator.name.text, identity);
      return [
        "for-of",
        identity,
        iterable,
        branch(node.statement, childEnvironment)
      ];
    }
    if (ts.isContinueStatement(node)) return ["continue"];
    throw new Error(
      `Unsupported source-equation statement '${ts.SyntaxKind[node.kind]}': ${node.getText()}`
    );
  }
  const parameters = declaration.parameters.map((parameter) => ({
    optional: parameter.questionToken !== void 0,
    rest: parameter.dotDotDotToken !== void 0,
    default: parameter.initializer === void 0 ? null : expression(parameter.initializer, environment)
  }));
  return {
    async: declaration.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword
    ) ?? false,
    parameters,
    body: ["sequence", statements(declaration.body.statements, environment)]
  };
}
function templateText(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("`", "\\`");
}
function expectedMethodSource(contract) {
  const law = contract.law;
  switch (law.kind) {
    case "required-map-lookup": {
      const error = "`" + templateText(law.errorPrefix) + "${p0}" + templateText(law.errorSuffix) + "`";
      return `class Expected { sample(p0) {
        const found = this.${law.mapField}.get(p0);
        if (found === undefined) throw new Error(${error});
        return found;
      } }`;
    }
    case "retained-item-filter":
      return `class Expected { sample(p0) {
        const result = this.itemRevisions.filter((item) => item.itemId === p0);
        return Object.freeze(result);
      } }`;
    case "measurement-axis-lookup":
      return `class Expected { sample(p0, p1) {
        if (p0.primaryAxis.axisId === p1) return p0.primaryAxis;
        for (const axis of p0.independentAxes) {
          if (axis.axisId === p1) return axis;
        }
        throw new Error(\`Item revision '${"${p0.revisionId}"}' has no measurement axis '${"${p1}"}'.\`);
      } }`;
    case "retained-transformation-item-filter":
      return `class Expected { sample(p0) {
        const result = this.transformationRevisions.filter(
          (definition) => [...definition.inputs, ...definition.outputs].some(
            (line) => this.itemRevision(line.itemRevisionId).itemId === p0
          )
        );
        return Object.freeze(result);
      } }`;
    case "active-transformation-revision-filter":
      return `class Expected { sample(p0) {
        const result = [];
        for (const definition of this.activeTransformationById.values()) {
          if (definition.${law.side}.some((line) => line.itemRevisionId === p0)) result.push(definition);
        }
        result.sort(compareTransformationRevision);
        return Object.freeze(result);
      } }`;
    case "between-transformation-filter":
      return `class Expected { sample(p0, p1) {
        return Object.freeze(
          this.transformationsFromRevision(p0).filter(
            (definition) => definition.outputs.some(
              (line) => line.itemRevisionId === p1
            )
          )
        );
      } }`;
    case "published-catalog-delegate":
      return `class Expected { async sample(p0) {
        const internals = requireInventoryOnceInternals(this.owner);
        const world = await internals.storage.readWorld();
        return inventoryCatalogForPublishedWorld(world, internals.catalog).${law.targetMethod}(p0);
      } }`;
    case "direct-return": {
      const parameters = Array.from({ length: law.parameterCount }, (_, index) => {
        const defaultExpression = law.defaults[index];
        const optional = law.optionalParameters.includes(index) ? "?" : "";
        return defaultExpression === void 0 || defaultExpression === null ? `p${index}${optional}` : `p${index} = ${defaultExpression}`;
      });
      return `class Expected { sample(${parameters.join(", ")}) { return ${law.expression}; } }`;
    }
    case "projection-values-sort":
      return `class Expected { sample() {
        const result = Object.values(${law.expression});
        result.sort(${law.comparator});
        return result;
      } }`;
    case "snapshot-composition-filter":
      return `class Expected { sample(p0) {
        const result = [];
        for (const composition of this.catalog.compositionRevisions) {
          const packaging = this.catalog.packagingRevision(composition.sourcePackagingRevisionId);
          if (packaging.itemId === p0) result.push(composition);
        }
        result.sort(compareInventoryCompositionRevision);
        return result;
      } }`;
    default:
      throw new Error(`Unknown source-equation law '${law.kind}'.`);
  }
}
function expectedSupportingSource(contract) {
  switch (contract.law.kind) {
    case "published-catalog-selection":
      return `function expected(p0, p1) {
        return p0.revision === 0 ? p1 : inventoryCatalogFromSnapshot(p0.catalog);
      }`;
    case "projected-lot-index":
      return `function expected(p0, p1?: string) {
        const identities = p1 === undefined ? Object.keys(p0.lots) : inventorySparseRecordValue(p0.lotIdentitiesByItemId, p1) ?? [];
        const result = [];
        for (const identity of identities) {
          const projected = p0.lots[identity];
          if (projected === undefined) {
            throw new Error(\`Inventory lot index references missing lot '${"${identity}"}'.\`);
          }
          if (p1 !== undefined && projected.definition.itemId !== p1) {
            throw new Error(\`Inventory lot index '${"${p1}"}' contains foreign lot '${"${identity}"}'.\`);
          }
          result.push(projected);
        }
        result.sort(compareProjectedLotDefinition);
        return result;
      }`;
    default:
      throw new Error(`Unknown supporting source-equation law '${contract.law.kind}'.`);
  }
}
function emptyCatalogRecordSource(includeDigest) {
  const emptyIndex = includeDigest ? "createInventorySparseRecord()" : "{}";
  return `{
    ${includeDigest ? "digest: inventoryCatalogDigest(input)," : ""}
    itemRevisions: [],
    activeItemRevisionIds: ${emptyIndex},
    packagingRevisions: [],
    compositionRevisions: [],
    activeCompositionRevisionIds: ${emptyIndex},
    transformationRevisions: [],
    activeTransformationRevisionIds: ${emptyIndex},
    collectionRevisions: [],
    activeCollectionRevisionIds: ${emptyIndex},
    fungibilityRevisions: [],
    activeFungibilityRevisionIds: ${emptyIndex},
  }`;
}
function retainedRevisionLoop({
  retainedName,
  collection,
  lookup,
  identity,
  digest,
  errorPrefix
}) {
  return `for (const ${retainedName} of retainedCatalog.${collection}) {
    const supplied = p0.${lookup}(${retainedName}.${identity});
    if (${digest}(supplied) !== ${digest}(${retainedName})) {
      throw new Error(\`${errorPrefix}'${"${" + retainedName + "." + identity + "}"}' changed after it entered durable truth.\`);
    }
  }`;
}
function expectedCatalogSnapshotSource(contract) {
  switch (contract.law.kind) {
    case "catalog-static-define":
      return "class Expected { static sample(p0) { return new InventoryCatalog(createInventoryCatalogParts(p0)); } }";
    case "catalog-define-delegate":
      return "function expected(p0) { return InventoryCatalog.define(p0); }";
    case "empty-catalog-snapshot":
      return `function expected() {
        const input = ${emptyCatalogRecordSource(false)};
        return ${emptyCatalogRecordSource(true)};
      }`;
    case "catalog-from-snapshot":
      return `function expected(p0) {
        const catalog = defineInventoryCatalog(p0);
        if (catalog.digest !== p0.digest) {
          throw new Error("Durable inventory catalogue snapshot digest does not match its definitions.");
        }
        return catalog;
      }`;
    case "retained-catalog-digest-equality": {
      const loops = [
        {
          retainedName: "retainedItem",
          collection: "itemRevisions",
          lookup: "itemRevision",
          identity: "revisionId",
          digest: "inventoryItemRevisionDigest",
          errorPrefix: "Inventory item revision "
        },
        {
          retainedName: "retainedPackaging",
          collection: "packagingRevisions",
          lookup: "packagingRevision",
          identity: "revisionId",
          digest: "inventoryPackagingRevisionDigest",
          errorPrefix: "Inventory packaging revision "
        },
        {
          retainedName: "retainedComposition",
          collection: "compositionRevisions",
          lookup: "compositionRevision",
          identity: "revisionId",
          digest: "inventoryCompositionRevisionDigest",
          errorPrefix: "Inventory composition revision "
        },
        {
          retainedName: "retainedTransformation",
          collection: "transformationRevisions",
          lookup: "transformationRevision",
          identity: "revisionId",
          digest: "inventoryTransformationRevisionDigest",
          errorPrefix: "Inventory transformation revision "
        },
        {
          retainedName: "retainedCollection",
          collection: "collectionRevisions",
          lookup: "collectionRevision",
          identity: "revisionId",
          digest: "inventoryCollectionRevisionDigest",
          errorPrefix: "Inventory collection revision "
        },
        {
          retainedName: "retainedPool",
          collection: "fungibilityRevisions",
          lookup: "fungibilityRevision",
          identity: "revisionId",
          digest: "inventoryFungibilityRevisionDigest",
          errorPrefix: "Inventory fungibility revision "
        }
      ].map(retainedRevisionLoop);
      return `function expected(p0, p1) {
        const retainedCatalog = inventoryCatalogFromSnapshot(p1);
        ${loops.join("\n")}
      }`;
    }
    case "catalog-snapshot-digest":
      return "function expected(p0) { return inventoryCatalogFromSnapshot(p0).digest; }";
    default:
      throw new Error(`Unknown catalog snapshot source-equation law '${contract.law.kind}'.`);
  }
}
function expectedMethodTerm(contract) {
  const source7 = ts.createSourceFile(
    `expected-${contract.methodName}.ts`,
    expectedMethodSource(contract),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  return normalizeCallable(findClassMethod(source7, "Expected", "sample"));
}
function expectedSupportingTerm(contract) {
  const source7 = ts.createSourceFile(
    `expected-${contract.functionName}.ts`,
    expectedSupportingSource(contract),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  return normalizeCallable(findFunction(source7, "expected"));
}
function expectedCatalogSnapshotTerm(contract) {
  const source7 = ts.createSourceFile(
    `expected-${contract.declarationName}.ts`,
    expectedCatalogSnapshotSource(contract),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const declaration = contract.declarationKind === "method" ? findClassMethod(source7, "Expected", "sample") : findFunction(source7, "expected");
  return normalizeCallable(declaration);
}
function loadSource(sourceFile3, sourceOverrides) {
  const absolute = path4.join(REPOSITORY_ROOT, sourceFile3);
  const text = sourceOverrides.get(sourceFile3) ?? fs4.readFileSync(absolute, "utf8");
  return ts.createSourceFile(
    absolute,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}
function verifyCatalogPublishedSourceContracts(sourceOverrides = /* @__PURE__ */ new Map()) {
  const sourceCache = /* @__PURE__ */ new Map();
  const source7 = (sourceFile3) => {
    if (!sourceCache.has(sourceFile3)) {
      sourceCache.set(sourceFile3, loadSource(sourceFile3, sourceOverrides));
    }
    return sourceCache.get(sourceFile3);
  };
  const equations2 = CATALOG_PUBLISHED_SOURCE_CONTRACTS.map((contract) => {
    const declaration = findClassMethod(
      source7(contract.sourceFile),
      contract.className,
      contract.methodName
    );
    const actualTerm = normalizeCallable(declaration);
    const expectedTerm = expectedMethodTerm(contract);
    assert.deepEqual(
      actualTerm,
      expectedTerm,
      `${contract.surfaceKey} does not implement '${contract.equation}'.`
    );
    return { contract, declaration, term: actualTerm };
  });
  const supportingEquations = CATALOG_PUBLISHED_SUPPORTING_CONTRACTS.map(
    (contract) => {
      const declaration = findFunction(
        source7(contract.sourceFile),
        contract.functionName
      );
      const actualTerm = normalizeCallable(declaration);
      const expectedTerm = expectedSupportingTerm(contract);
      assert.deepEqual(
        actualTerm,
        expectedTerm,
        `${contract.functionName} does not implement '${contract.equation}'.`
      );
      return { contract, declaration, term: actualTerm };
    }
  );
  const catalogSnapshotEquations = CATALOG_SNAPSHOT_SOURCE_CONTRACTS.map(
    (contract) => {
      const declaration = contract.declarationKind === "method" ? findClassMethod(
        source7(contract.sourceFile),
        contract.className,
        contract.declarationName
      ) : findFunction(source7(contract.sourceFile), contract.declarationName);
      const actualTerm = normalizeCallable(declaration);
      const expectedTerm = expectedCatalogSnapshotTerm(contract);
      assert.deepEqual(
        actualTerm,
        expectedTerm,
        `${contract.declarationName} does not implement '${contract.equation}'.`
      );
      return { contract, declaration, term: actualTerm };
    }
  );
  assert.equal(equations2.length, 33);
  assert.equal(new Set(equations2.map(({ contract }) => contract.surfaceKey)).size, 33);
  assert.equal(catalogSnapshotEquations.length, 6);
  assert.equal(
    catalogSnapshotEquations.reduce(
      (total, { contract }) => total + contract.surfaceKeys.length,
      0
    ),
    11
  );
  return { equations: equations2, supportingEquations, catalogSnapshotEquations };
}
function isConcretePackageCallable(context, declaration) {
  if (declaration === void 0 || declaration.body === void 0 || !ts.isFunctionDeclaration(declaration) && !ts.isMethodDeclaration(declaration)) {
    return false;
  }
  return normalizeRelativePath(
    context.repositoryRoot,
    declaration.getSourceFile().fileName
  ).startsWith("src/");
}
function directSourceDependencies(context, declaration) {
  const dependencies = /* @__PURE__ */ new Map();
  const ownStart = declaration.getStart(declaration.getSourceFile());
  const ownKey = `${declaration.getSourceFile().fileName}:${ownStart}`;
  function addDependency(candidate) {
    if (!isConcretePackageCallable(context, candidate)) return;
    const key = `${candidate.getSourceFile().fileName}:${candidate.getStart(candidate.getSourceFile())}`;
    if (key === ownKey || dependencies.has(key)) return;
    const span = spanOf(context, candidate);
    dependencies.set(key, {
      declarationKind: ts.isMethodDeclaration(candidate) ? "method" : "function",
      name: candidate.name !== void 0 && ts.isIdentifier(candidate.name) ? candidate.name.text : "anonymous",
      sourceFile: span.file,
      sourceAstSha256: span.astHash
    });
  }
  function visit(node) {
    if (ts.isCallExpression(node)) {
      addDependency(context.checker.getResolvedSignature(node)?.declaration);
    } else if (ts.isIdentifier(node)) {
      const symbol = context.checker.getSymbolAtLocation(node);
      for (const candidate of symbol?.declarations ?? []) addDependency(candidate);
    }
    ts.forEachChild(node, visit);
  }
  visit(declaration.body);
  return [...dependencies.values()].sort(
    (left, right) => compareCodeUnits(
      `${left.sourceFile}:${left.name}:${left.sourceAstSha256}`,
      `${right.sourceFile}:${right.name}:${right.sourceAstSha256}`
    )
  );
}
function semanticDeclarationIdentity(context, declaration) {
  const span = spanOf(context, declaration);
  return { sourceFile: span.file, sourceAstSha256: span.astHash };
}
function compilerDeclaration(context, contract, kind) {
  const absolute = path4.join(REPOSITORY_ROOT, contract.sourceFile);
  const source7 = context.program.getSourceFile(absolute);
  assert.notEqual(source7, void 0, `Compiler omitted ${contract.sourceFile}.`);
  return kind === "method" ? findClassMethod(source7, contract.className, contract.methodName) : findFunction(source7, contract.functionName);
}
function equationEvidence(context, verified) {
  const declaration = compilerDeclaration(context, verified.contract, "method");
  return {
    producerMethod: `${verified.contract.className}.${verified.contract.methodName}`,
    sourceFile: verified.contract.sourceFile,
    className: verified.contract.className,
    methodName: verified.contract.methodName,
    equation: verified.contract.equation,
    law: verified.contract.law,
    completeBranchesChecked: true,
    allValidatedInputs: true,
    sampledInputs: 0,
    normalizedTerm: verified.term,
    normalizedTermSha256: sha2562(canonicalJson(verified.term)),
    declaration: semanticDeclarationIdentity(context, declaration),
    directSourceDependencies: directSourceDependencies(context, declaration)
  };
}
function supportingEquationEvidence(context, verified) {
  const declaration = compilerDeclaration(context, verified.contract, "function");
  return {
    sourceFile: verified.contract.sourceFile,
    functionName: verified.contract.functionName,
    equation: verified.contract.equation,
    law: verified.contract.law,
    completeBranchesChecked: true,
    normalizedTerm: verified.term,
    normalizedTermSha256: sha2562(canonicalJson(verified.term)),
    declaration: semanticDeclarationIdentity(context, declaration),
    directSourceDependencies: directSourceDependencies(context, declaration)
  };
}
function catalogSnapshotEquationEvidence(context, verified) {
  const source7 = context.program.getSourceFile(
    path4.join(REPOSITORY_ROOT, verified.contract.sourceFile)
  );
  assert.notEqual(source7, void 0, `Compiler omitted ${verified.contract.sourceFile}.`);
  const declaration = verified.contract.declarationKind === "method" ? findClassMethod(
    source7,
    verified.contract.className,
    verified.contract.declarationName
  ) : findFunction(source7, verified.contract.declarationName);
  return {
    sourceFile: verified.contract.sourceFile,
    declarationKind: verified.contract.declarationKind,
    declarationName: verified.contract.declarationName,
    equation: verified.contract.equation,
    law: verified.contract.law,
    completeBranchesChecked: true,
    allValidatedInputs: true,
    sampledInputs: 0,
    normalizedTerm: verified.term,
    normalizedTermSha256: sha2562(canonicalJson(verified.term)),
    declaration: semanticDeclarationIdentity(context, declaration),
    directSourceDependencies: directSourceDependencies(context, declaration)
  };
}
function boundedFixtureControl() {
  let fixtureSha256 = BOUNDED_FIXTURE_SHA256;
  let certificateId = BOUNDED_FIXTURE_CERTIFICATE_ID;
  if (fs4.existsSync(BOUNDED_FIXTURE_CERTIFICATE_PATH)) {
    const bytes2 = fs4.readFileSync(BOUNDED_FIXTURE_CERTIFICATE_PATH);
    const document = JSON.parse(bytes2.toString("utf8"));
    assert.equal(document.semanticCore.equationDomain, BOUNDED_FIXTURE_DOMAIN);
    assert.equal(document.semanticCore.proofCounts.producerEquations, 33);
    assert.equal(document.reviewEnvelope.globalBinderCreditGranted, false);
    fixtureSha256 = sha2562(bytes2);
    certificateId = document.contentAddress.certificateId;
    assert.equal(fixtureSha256, BOUNDED_FIXTURE_SHA256);
    assert.equal(certificateId, BOUNDED_FIXTURE_CERTIFICATE_ID);
  }
  return {
    file: normalizeRelativePath(REPOSITORY_ROOT, BOUNDED_FIXTURE_CERTIFICATE_PATH),
    sha256: fixtureSha256,
    certificateId,
    domain: BOUNDED_FIXTURE_DOMAIN,
    equationCount: 33,
    role: "BOUNDED_RUNTIME_REGRESSION_ONLY",
    universalCreditGranted: false
  };
}
function compilerBindingEnvelope() {
  const surface = discoverCompilerSurface(REPOSITORY_ROOT);
  const callableByKey = new Map(
    surface.callables.map((callable) => [callable.key, callable])
  );
  const requested = [
    ...CATALOG_PUBLISHED_SOURCE_CONTRACTS.map((contract) => ({
      surfaceKey: contract.surfaceKey,
      producerEquation: `${contract.className}.${contract.methodName}`
    })),
    ...CATALOG_SNAPSHOT_SOURCE_CONTRACTS.flatMap(
      (contract) => contract.surfaceKeys.map((surfaceKey) => ({
        surfaceKey,
        producerEquation: contract.declarationKind === "method" ? `${contract.className}.${contract.declarationName}` : contract.declarationName
      }))
    )
  ];
  assert.equal(requested.length, 44);
  assert.equal(new Set(requested.map(({ surfaceKey }) => surfaceKey)).size, 44);
  return requested.map(({ surfaceKey, producerEquation }) => {
    const callable = callableByKey.get(surfaceKey);
    assert.notEqual(callable, void 0, `Compiler surface omitted '${surfaceKey}'.`);
    return {
      surfaceKey,
      producerEquation,
      proposedRelation: "COMPILER_BINDING_TO_COMPLETE_SOURCE_EQUATION",
      callableIdentity: callable,
      creditGrantedByLane: false
    };
  });
}
function buildCatalogPublishedSourceEquationSemanticCore() {
  const context = loadCompilerContext(REPOSITORY_ROOT);
  const verified = verifyCatalogPublishedSourceContracts();
  const sourceEquations = verified.equations.map(
    (equation3) => equationEvidence(context, equation3)
  );
  const supportingEquations = verified.supportingEquations.map(
    (equation3) => supportingEquationEvidence(context, equation3)
  );
  const catalogSnapshotEquations = verified.catalogSnapshotEquations.map(
    (equation3) => catalogSnapshotEquationEvidence(context, equation3)
  );
  const lawCounts = {};
  for (const equation3 of sourceEquations) {
    lawCounts[equation3.law.kind] = (lawCounts[equation3.law.kind] ?? 0) + 1;
  }
  return {
    schemaVersion: 1,
    familyId: SOURCE_FAMILY_ID,
    familyVersion: 1,
    domain: CATALOG_PUBLISHED_SOURCE_DOMAIN,
    claim: "Every named read implements its independently declared complete source equation for all validated catalogs or all states of one already-frozen published snapshot.",
    proofCounts: {
      sourceEquations: sourceEquations.length,
      catalogLookupEquations: 17,
      publishedCatalogDelegationEquations: 3,
      frozenSnapshotEquations: 13,
      supportingHelperEquations: supportingEquations.length,
      catalogSnapshotImplementationEquations: catalogSnapshotEquations.length,
      catalogSnapshotCompilerBindings: CATALOG_SNAPSHOT_SOURCE_CONTRACTS.reduce(
        (total, contract) => total + contract.surfaceKeys.length,
        0
      ),
      sampledInputs: 0
    },
    lawCounts,
    sourceEquations,
    supportingEquations,
    catalogSnapshotEquations,
    statefulFamilyBlocker: CATALOG_PUBLICATION_STATEFUL_BLOCKER
  };
}
function buildReviewEnvelope() {
  const contractPath2 = path4.join(
    FAMILY_DIRECTORY,
    "catalog-published-source-contracts.mjs"
  );
  const verifierPath2 = fileURLToPath2(import.meta.url);
  return {
    status: "SOURCE_EQUATION_FAMILY_COMPLETE_AWAITING_SHARED_BINDER_REVIEW",
    independentContract: {
      file: normalizeRelativePath(REPOSITORY_ROOT, contractPath2),
      sha256: sha2562(fs4.readFileSync(contractPath2))
    },
    verifier: {
      file: normalizeRelativePath(REPOSITORY_ROOT, verifierPath2),
      sha256: sha2562(fs4.readFileSync(verifierPath2)),
      engine: "COMPLETE_SOURCE_CONTROL_FLOW_EQUATION_V1"
    },
    compilerBindings: compilerBindingEnvelope(),
    statefulReadBindingBlocker: PUBLISHED_READ_STATEFUL_BINDING_BLOCKER,
    boundedFixtureControl: boundedFixtureControl(),
    applicability: {
      binderOwner: "hub-global-binder",
      sharedGateReplacedOrBypassed: false,
      sourceEquationIsNotOriginalModelAdmission: true,
      helperDelegationRequiresExactDependencyIdentity: true,
      permitsAdditionalWrapperSemantics: false
    },
    authorityActionFamilyUsed: false,
    authorityFixtureScenariosPromotedToFormalCredit: 0,
    globalBinderCreditGranted: false
  };
}
function buildCatalogPublishedSourceEquationDocument() {
  const semanticCore = buildCatalogPublishedSourceEquationSemanticCore();
  const contentSha256 = sha2562(canonicalJson(semanticCore));
  return {
    certificateKind: "INVENTORYONCE_SOURCE_EQUATION_FAMILY",
    semanticCore,
    contentAddress: {
      algorithm: "sha256",
      contentSha256,
      certificateId: `SOURCE_EQUATION_FAMILY:sha256:${contentSha256}`
    },
    reviewEnvelope: buildReviewEnvelope()
  };
}
function verifyCatalogPublishedSourceEquationDocument(document) {
  requireExactKeys(
    document,
    ["certificateKind", "semanticCore", "contentAddress", "reviewEnvelope"],
    "Source-equation certificate"
  );
  const expected = buildCatalogPublishedSourceEquationDocument();
  assert.deepEqual(
    document,
    expected,
    "Source-equation certificate differs from current independent contracts or source truth."
  );
  return {
    certificateId: document.contentAddress.certificateId,
    sourceEquations: document.semanticCore.proofCounts.sourceEquations,
    supportingHelperEquations: document.semanticCore.proofCounts.supportingHelperEquations,
    catalogSnapshotImplementationEquations: document.semanticCore.proofCounts.catalogSnapshotImplementationEquations,
    catalogSnapshotCompilerBindings: document.semanticCore.proofCounts.catalogSnapshotCompilerBindings,
    compilerBindingCandidates: document.reviewEnvelope.compilerBindings.length,
    sampledInputs: document.semanticCore.proofCounts.sampledInputs,
    statefulReadBindingBlocker: document.reviewEnvelope.statefulReadBindingBlocker.family,
    statefulBlocker: document.semanticCore.statefulFamilyBlocker.gapId,
    globalBinderCreditGranted: document.reviewEnvelope.globalBinderCreditGranted
  };
}
function writeCatalogPublishedSourceEquationDocument() {
  const document = buildCatalogPublishedSourceEquationDocument();
  fs4.writeFileSync(CERTIFICATE_PATH, `${JSON.stringify(document, null, 2)}
`);
  return verifyCatalogPublishedSourceEquationDocument(document);
}
function verifyPersistedCatalogPublishedSourceEquationDocument() {
  return verifyCatalogPublishedSourceEquationDocument(
    JSON.parse(fs4.readFileSync(CERTIFICATE_PATH, "utf8"))
  );
}
function runCommandLine() {
  const mode = process.argv[2] ?? "--verify";
  if (mode !== "--write" && mode !== "--verify") {
    throw new Error(`Unknown source-equation mode '${mode}'.`);
  }
  const summary = mode === "--write" ? writeCatalogPublishedSourceEquationDocument() : verifyPersistedCatalogPublishedSourceEquationDocument();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}
`);
}
if (process.argv[1] !== void 0 && path4.resolve(process.argv[1]) === fileURLToPath2(import.meta.url)) {
  runCommandLine();
}

// experiments/tla-conformance/value-contracts/catalog-family.mjs
var catalogProofKind = "independent-catalog-snapshot-closed-equations-v1";
var snapshotMembers = /* @__PURE__ */ new Set(["container", "containers", "lot", "lots", "compositionRevisionsForItem", "event", "count"]);
var catalogContracts = CATALOG_PUBLISHED_SOURCE_CONTRACTS.filter((contract) => contract.className === "InventoryCatalog" || contract.className === "InventoryOnceReadSnapshotImplementation" && snapshotMembers.has(contract.methodName));
var sourceFiles = ["src/catalog.ts", "src/facade.ts", "src/model.ts", "src/ordering.ts", "src/sparse-record.ts"];
var helperContracts = [
  ["src/ordering.ts", "compareInventoryIdentityText", "function expected(p0,p1) { return p0 < p1 ? -1 : p0 > p1 ? 1 : 0; }"],
  ["src/catalog.ts", "compareTransformationRevision", `function expected(p0,p1) {
    const order = compareInventoryIdentityText(p0.transformationId,p1.transformationId);
    return order === 0 ? compareInventoryIdentityText(p0.revisionId,p1.revisionId) : order;
  }`],
  ["src/model.ts", "assertInventoryIdentity", `function expected(p0,p1) {
    const trimmed = p0.trim();
    if (trimmed.length === 0) throw new Error(\`\${p1} must not be empty.\`);
    if (trimmed !== p0) { throw new Error(\`\${p1} must not contain surrounding whitespace.\`); }
  }`],
  ["src/model.ts", "inventoryContainerIdentity", `function expected(p0) { assertInventoryIdentity(p0,"containerId"); return JSON.stringify([p0]); }`],
  ["src/model.ts", "inventoryLotIdentity", `function expected(p0,p1) { assertInventoryIdentity(p0,"lot itemId"); assertInventoryIdentity(p1,"lotId"); return JSON.stringify([p0,p1]); }`],
  ["src/facade.ts", "compareInventoryCompositionRevision", `function expected(p0,p1) { return compareInventoryIdentityText(p0.revisionId,p1.revisionId); }`],
  ["src/facade.ts", "compareProjectedContainerDefinition", `function expected(p0,p1) { return compareInventoryIdentityText(inventoryContainerIdentity(p0.definition.containerId),inventoryContainerIdentity(p1.definition.containerId)); }`],
  ["src/facade.ts", "compareProjectedLotDefinition", `function expected(p0,p1) { return compareInventoryIdentityText(inventoryLotIdentity(p0.definition.itemId,p0.definition.lotId),inventoryLotIdentity(p1.definition.itemId,p1.definition.lotId)); }`],
  ["src/sparse-record.ts", "inventorySparseRecordHas", `function expected(p0,p1) { return Object.prototype.hasOwnProperty.call(p0,p1); }`],
  ["src/sparse-record.ts", "inventorySparseRecordValue", `function expected(p0,p1) { return inventorySparseRecordHas(p0,p1) ? p0[p1] : undefined; }`]
];
var producerFiles = [
  "experiments/tla-conformance/value-contracts/catalog-family.mjs",
  "experiments/tla-conformance/value-contracts/surface-binding.mjs",
  "experiments/tla-conformance/authority-r5/catalog-published-source-contracts.mjs",
  "experiments/tla-conformance/authority-r5/catalog-published-source-equations.mjs",
  "experiments/tla-conformance/surface-bindings/lib/compiler-surface.mjs",
  "node_modules/typescript/package.json"
];
var passCache = /* @__PURE__ */ new WeakMap();
function parseSource(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function declarationKey(root3, declaration) {
  const file = path5.relative(root3, declaration.getSourceFile().fileName).replaceAll("\\", "/");
  const owner = ts.isMethodDeclaration(declaration) ? `${declaration.parent.name.text}.` : "";
  return `${file}#${owner}${declaration.name.text}`;
}
function validateCallableSyntax(declaration) {
  assert2.equal(declaration.asteriskToken, void 0, "Generator methods are outside the read equation domain.");
  assert2(!ts.canHaveDecorators(declaration) || (ts.getDecorators(declaration)?.length ?? 0) === 0, "Decorated method is not a plain read.");
  for (const parameter of declaration.parameters) {
    assert2.equal(parameter.dotDotDotToken, void 0, "Rest parameters require a separate equation.");
    assert2(ts.isIdentifier(parameter.name));
  }
}
function requirePublicRelation(context, callable, declaration, contract) {
  if (contract.className === "InventoryCatalog") {
    assert2.deepEqual(callable.declaration, spanOf(context, declaration));
    return { kind: "EXACT_CLASS_METHOD", implementation: spanOf(context, declaration) };
  }
  const source7 = declaration.getSourceFile();
  const publicOwner = source7.statements.find((node) => ts.isInterfaceDeclaration(node) && node.name.text === "InventoryOnceReadSnapshotApi");
  assert2(publicOwner !== void 0);
  const publicMembers = publicOwner.members.filter((node) => node.name?.getText(source7) === contract.methodName);
  assert2.equal(publicMembers.length, 1);
  assert2.deepEqual(callable.declaration, spanOf(context, publicMembers[0]));
  const implemented = declaration.parent.heritageClauses?.filter((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword).flatMap((clause) => clause.types) ?? [];
  const expectedSymbol = context.checker.getSymbolAtLocation(publicOwner.name);
  assert2(implemented.some((type) => context.checker.getSymbolAtLocation(type.expression) === expectedSymbol), "Snapshot class no longer implements its exact public interface.");
  const actualType = context.checker.getTypeAtLocation(declaration);
  const publicType = context.checker.getTypeAtLocation(publicMembers[0]);
  assert2(context.checker.isTypeAssignableTo(actualType, publicType), "Implementation is not assignable to the public method.");
  return { kind: "COMPILER_RESOLVED_IMPLEMENTS", interface: spanOf(context, publicMembers[0]), implementation: spanOf(context, declaration) };
}
function buildCatalogFamilyArtifact({ repositoryRoot, context, surface, sourceOverrides = /* @__PURE__ */ new Map() }) {
  assert2.equal(catalogContracts.length, 24);
  const inputFiles2 = [...sourceFiles, ...producerFiles];
  const inputs3 = inputFiles2.map((file) => ({ file, sha256: sha256(sourceOverrides.get(file) ?? fs5.readFileSync(path5.resolve(repositoryRoot, file))) }));
  const cacheKey = sha256(canonicalJson({ surface: surface.digest, inputs: inputs3 }));
  const old = sourceOverrides.size === 0 ? passCache.get(context) : void 0;
  if (old?.key === cacheKey) return old.value;
  const sources = new Map(sourceFiles.map((file) => [file, sourceOverrides.has(file) ? parseSource(path5.resolve(repositoryRoot, file), sourceOverrides.get(file)) : context.program.getSourceFile(path5.resolve(repositoryRoot, file))]));
  for (const [file, source7] of sources) assert2(source7 !== void 0, `Missing compiler source ${file}.`);
  const certified = /* @__PURE__ */ new Map();
  const proofs = [];
  const callableByKey = new Map(surface.callables.map((callable) => [callable.key, callable]));
  for (const contract of catalogContracts) {
    const declaration = findClassMethod(sources.get(contract.sourceFile), contract.className, contract.methodName);
    validateCallableSyntax(declaration);
    const term4 = normalizeCallable(declaration);
    assert2.deepEqual(term4, expectedMethodTerm(contract), `Read equation changed: ${contract.surfaceKey}`);
    const callable = callableByKey.get(contract.surfaceKey);
    assert2(callable !== void 0, `Compiler omitted ${contract.surfaceKey}.`);
    const relation = sourceOverrides.size === 0 ? requirePublicRelation(context, callable, declaration, contract) : { kind: "MUTATION_CONTROL_ONLY" };
    const key = declarationKey(repositoryRoot, declaration);
    certified.set(key, { declaration, term: term4 });
    proofs.push({
      surfaceKey: contract.surfaceKey,
      signatureHash: callable.signatureHash,
      declaration: callable.declaration,
      implementation: spanOf(context, declaration),
      relation,
      equation: contract.equation,
      term: term4,
      dependencies: []
    });
  }
  for (const [file, name, expected] of helperContracts) {
    const declaration = findFunction(sources.get(file), name);
    validateCallableSyntax(declaration);
    const term4 = normalizeCallable(declaration);
    assert2.deepEqual(term4, normalizeCallable(findFunction(parseSource("expected.ts", expected), "expected")), `Helper equation changed: ${name}`);
    certified.set(declarationKey(repositoryRoot, declaration), { declaration, term: term4 });
  }
  const lots = CATALOG_PUBLISHED_SUPPORTING_CONTRACTS.find((contract) => contract.functionName === "inventoryProjectedLots");
  assert2(lots !== void 0);
  const lotDeclaration = findFunction(sources.get(lots.sourceFile), lots.functionName);
  const lotTerm = normalizeCallable(lotDeclaration);
  assert2.deepEqual(lotTerm, expectedSupportingTerm(lots), "Lot index equation changed.");
  certified.set(declarationKey(repositoryRoot, lotDeclaration), { declaration: lotDeclaration, term: lotTerm });
  if (sourceOverrides.size === 0) {
    const helpers = /* @__PURE__ */ new Map();
    for (const [key, row] of certified) {
      let inspect2 = function(node) {
        let symbol = ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) ? context.checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node) : void 0;
        if (symbol !== void 0 && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = context.checker.getAliasedSymbol(symbol);
        for (const dependency2 of symbol?.declarations ?? []) {
          assert2(!ts.isGetAccessorDeclaration(dependency2) && !ts.isSetAccessorDeclaration(dependency2), "Accessor-backed reads are not ordinary immutable data.");
          if ((ts.isFunctionDeclaration(dependency2) || ts.isMethodDeclaration(dependency2)) && dependency2.body !== void 0) {
            const dependencyKey2 = declarationKey(repositoryRoot, dependency2);
            assert2(certified.has(dependencyKey2), `Unproved helper dependency: ${dependencyKey2}`);
            if (dependencyKey2 !== key) dependencies.add(dependencyKey2);
          }
        }
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
          const target = context.checker.getResolvedSignature(node)?.declaration;
          assert2(target !== void 0, `Unresolved call: ${node.getText()}`);
          if (target.getSourceFile().isDeclarationFile) {
            assert2(/[/\\]typescript[/\\]lib[/\\]lib\.[^/\\]+\.d\.ts$/u.test(target.getSourceFile().fileName), "Only exact standard-library calls may be assumed.");
          } else if (ts.isFunctionDeclaration(target) || ts.isMethodDeclaration(target)) {
            assert2(certified.has(declarationKey(repositoryRoot, target)), "Unproved resolved source call.");
          } else {
            assert2(ts.isArrowFunction(target), "Unproved dynamic callback.");
          }
        }
        ts.forEachChild(node, inspect2);
      };
      var inspect = inspect2;
      const dependencies = /* @__PURE__ */ new Set();
      const declaration = row.declaration;
      inspect2(declaration.body);
      helpers.set(key, [...dependencies].sort());
    }
    for (const proof of proofs) proof.dependencies = helpers.get(`${proof.implementation.file}#${catalogContracts.find((contract) => contract.surfaceKey === proof.surfaceKey).className}.${catalogContracts.find((contract) => contract.surfaceKey === proof.surfaceKey).methodName}`);
  }
  const result = {
    schemaVersion: 1,
    mode: "V",
    proofKind: catalogProofKind,
    surfaceDigest: surface.digest,
    domain: "Exact unmodified validated InventoryCatalog receivers and already-frozen native snapshot receivers; immutable plain data and standard unmodified ECMAScript built-ins.",
    excluded: "Storage acquisition, catalog construction/publication, unproved delegated summaries/allocation/packaging and mutable/proxied/custom receivers are not certified by these equations.",
    allAdmittedInputs: true,
    sampledInputs: 0,
    inputs: inputs3,
    helperEquations: [...certified.entries()].filter(([key]) => !key.includes("#Inventory")).map(([key, row]) => ({ key, declaration: spanOf(context, row.declaration), term: row.term })),
    proofs
  };
  if (sourceOverrides.size === 0) passCache.set(context, { key: cacheKey, value: result });
  return result;
}

// experiments/tla-conformance/throughput-r7/registered-value-family.mjs
import assert3 from "node:assert/strict";
import path6 from "node:path";
var passes = /* @__PURE__ */ new WeakMap();
var recordedPasses = /* @__PURE__ */ new WeakMap();
function ownedFile(root3, file) {
  return assuranceRepositoryPath(root3, file);
}
function verifyInputs(root3, context, inputs3) {
  assert3(Array.isArray(inputs3) && inputs3.length > 0, "A family needs its complete semantic input set.");
  const seen = /* @__PURE__ */ new Set();
  for (const input2 of inputs3) {
    assert3.equal(typeof input2.file, "string");
    assert3(!seen.has(input2.file), "A family input is duplicated.");
    seen.add(input2.file);
    assert3.match(input2.sha256, /^[0-9a-f]{64}$/u);
    const absolute = ownedFile(root3, input2.file);
    assert3.equal(assuranceFileSha256(root3, input2.file), input2.sha256, `Family input changed: ${input2.file}`);
    if (input2.file.startsWith("src/") && input2.file.endsWith(".ts")) {
      const source7 = context.program.getSourceFile(path6.resolve(root3, input2.file));
      assert3(source7 !== void 0, `Compiler omitted source input: ${input2.file}`);
      assert3.equal(assuranceCompilerSourceSha256(root3, input2.file, source7.text), input2.sha256, `Compiler snapshot is stale: ${input2.file}`);
    }
  }
}
function verifyRegisteredValueBinding({ repositoryRoot, context, surface, binding, registrations }) {
  try {
    assert3.equal(binding.mode, "V");
    const file = ownedFile(repositoryRoot, binding.evidence.file);
    const digest = assuranceFileSha256(repositoryRoot, binding.evidence.file);
    assert3.equal(digest, binding.evidence.sha256, "Family evidence changed.");
    let recordedPass = recordedPasses.get(context);
    if (recordedPass === void 0) {
      recordedPass = /* @__PURE__ */ new Map();
      recordedPasses.set(context, recordedPass);
    }
    const recordedKey = `${file}:${digest}`;
    let parsed = recordedPass.get(recordedKey);
    if (parsed === void 0) {
      const document = JSON.parse(readAssuranceFile(repositoryRoot, binding.evidence.file).toString("utf8"));
      parsed = { document, canonical: canonicalJson(document) };
      recordedPass.set(recordedKey, parsed);
    }
    const recorded = parsed.document;
    const matching = registrations.filter((registration2) => registration2.proofKind === recorded.proofKind);
    assert3.equal(matching.length, 1, "Exactly one reviewed family verifier must handle this proof kind.");
    const registration = matching[0];
    assert3.equal(typeof registration.buildFamilyArtifact, "function");
    assert3(Array.isArray(registration.supportedSurfaceKeys));
    assert3.equal(new Set(registration.supportedSurfaceKeys).size, registration.supportedSurfaceKeys.length);
    assert3(registration.supportedSurfaceKeys.includes(binding.surfaceKey), "Binding is outside the reviewed family.");
    let compilerPass = passes.get(context);
    if (compilerPass === void 0) {
      compilerPass = /* @__PURE__ */ new Map();
      passes.set(context, compilerPass);
    }
    let cached2 = compilerPass.get(registration);
    if (cached2 !== void 0 && cached2.surfaceDigest === surface.digest && cached2.builder === registration.buildFamilyArtifact && cached2.members === canonicalJson(registration.supportedSurfaceKeys)) {
      verifyInputs(repositoryRoot, context, cached2.artifact.inputs);
    } else {
      const artifact = registration.buildFamilyArtifact({ repositoryRoot, context, surface });
      assert3.equal(artifact.schemaVersion, 1);
      assert3.equal(artifact.proofKind, registration.proofKind);
      assert3.equal(artifact.sampledInputs, 0, "Sampled examples are not a complete source equation.");
      assert3.equal(artifact.allAdmittedInputs, true);
      assert3(typeof artifact.domain === "string" && artifact.domain.length > 0 || artifact.domain !== null && typeof artifact.domain === "object" && !Array.isArray(artifact.domain) && Object.keys(artifact.domain).length > 0, "A complete explicit domain is required.");
      assert3.equal(artifact.surfaceDigest, surface.digest);
      assert3(Array.isArray(artifact.proofs) && artifact.proofs.length > 0);
      verifyInputs(repositoryRoot, context, artifact.inputs);
      const proofKeys = artifact.proofs.map((proof) => proof.surfaceKey);
      assert3.equal(new Set(proofKeys).size, proofKeys.length, "Family repeats a proof key.");
      assert3(proofKeys.every((key) => registration.supportedSurfaceKeys.includes(key)));
      const live = new Map(surface.callables.map((callable) => [callable.key, callable]));
      for (const proof of artifact.proofs) {
        const callable = live.get(proof.surfaceKey);
        assert3(callable !== void 0, "Family claims a non-public callable.");
        assert3.equal(proof.signatureHash, callable.signatureHash);
        assert3.deepEqual(proof.declaration, callable.declaration);
      }
      cached2 = { surfaceDigest: surface.digest, builder: registration.buildFamilyArtifact, members: canonicalJson(registration.supportedSurfaceKeys), artifact, canonical: canonicalJson(artifact) };
      compilerPass.set(registration, cached2);
    }
    assert3.equal(parsed.canonical, cached2.canonical, "Recorded family differs from independently rederived current semantics.");
    assert3(cached2.artifact.proofs.some((proof) => proof.surfaceKey === binding.surfaceKey), "No complete source proof for this member.");
    return [];
  } catch (error) {
    return [{ code: "VALUE_FAMILY_PROOF_REJECTED", detail: error instanceof Error ? error.message : String(error) }];
  }
}

// experiments/tla-conformance/final-convergence/final-families.mjs
import assert7 from "node:assert/strict";

// scripts/immutable-assurance-inputs.mjs
import assert4 from "node:assert/strict";
import path7 from "node:path";
import { execFileSync } from "node:child_process";
var FROZEN_FINAL_EVIDENCE_HEAD = "0141b46c18c60b03983081175bbfb5cd074eb8b1";
function git(repositoryRoot, arguments_, encoding = "utf8") {
  const environment = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) delete environment[key];
  return execFileSync("git", arguments_, { cwd: path7.resolve(repositoryRoot), env: environment, encoding, maxBuffer: 128 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
}
function assertAssuranceCommitChain(repositoryRoot, commits) {
  if (!Array.isArray(commits) || commits.length < 2 || commits.some((commit) => typeof commit !== "string" || !/^[a-f0-9]{40}$/u.test(commit))) throw new Error("Malformed assurance ancestry chain.");
  for (let index = 1; index < commits.length; index += 1) {
    try {
      git(repositoryRoot, ["merge-base", "--is-ancestor", commits[index - 1], commits[index]]);
    } catch {
      throw new Error(`Assurance certified head does not descend through every required repair: ${commits[index - 1]} -> ${commits[index]}.`);
    }
  }
}
function freezeEvidence(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeEvidence(child);
    Object.freeze(value);
  }
  return value;
}
function createImmutableAssuranceReader(repositoryRoot, anchorHead = FROZEN_FINAL_EVIDENCE_HEAD) {
  const root3 = path7.resolve(repositoryRoot);
  assertAssuranceCommitChain(root3, [anchorHead, git(root3, ["rev-parse", "HEAD"]).trim()]);
  const tree = /* @__PURE__ */ new Map();
  for (const entry of git(root3, ["ls-tree", "-r", "-z", anchorHead]).split("\0")) {
    if (!entry) continue;
    const separator = entry.indexOf("	"), header = entry.slice(0, separator).split(" ");
    tree.set(entry.slice(separator + 1), { mode: header[0], type: header[1], object: header[2] });
  }
  const expectedHashes = /* @__PURE__ */ new Map(), parsed = /* @__PURE__ */ new Map();
  let archived;
  const committedBytes = (file) => {
    const entry = tree.get(file);
    if (entry === void 0 || entry.type !== "blob" || entry.mode !== "100644" && entry.mode !== "100755") throw new Error(`Frozen assurance evidence is not an ordinary committed file: ${file}.`);
    return git(root3, ["cat-file", "blob", entry.object], null);
  };
  const expectedHash = (file) => {
    if (expectedHashes.has(file)) return expectedHashes.get(file);
    let hash;
    if (tree.has(file)) hash = assuranceBytesSha256(committedBytes(file));
    else {
      if (archived === void 0) {
        const manifest = JSON.parse(committedBytes("experiments/tla-conformance/final-convergence/compact-support-manifest.json"));
        archived = new Map(manifest.archive.files.map((row) => [row.file, row.sha256]));
        assert4.equal(archived.size, manifest.archive.files.length, "Frozen archive contains duplicate evidence paths.");
      }
      hash = archived.get(file);
      if (hash === void 0) throw new Error(`Evidence is absent from the immutable proof closure: ${file}.`);
    }
    expectedHashes.set(file, hash);
    return hash;
  };
  const read = (file) => {
    const bytes2 = readAssuranceFile(root3, file);
    assert4.equal(assuranceBytesSha256(bytes2), expectedHash(file), `Frozen assurance evidence differs from immutable proof input: ${file}.`);
    return bytes2;
  };
  const json = (file) => {
    const bytes2 = read(file);
    if (!parsed.has(file)) parsed.set(file, freezeEvidence(JSON.parse(bytes2.toString("utf8"))));
    return parsed.get(file);
  };
  const transport = (file, expectedStatus, expectedHead, certifiedHead) => {
    const value = json(file);
    assert4.equal(value.status, expectedStatus);
    assert4.equal(value.currentHead, expectedHead);
    assertAssuranceCommitChain(root3, [value.priorHead, value.currentHead, certifiedHead]);
    return value;
  };
  return Object.freeze({ read, json, transport });
}

// scripts/inventory-epoch-contract.mjs
import assert5 from "node:assert/strict";
import fs6 from "node:fs";
import path8 from "node:path";
import crypto3 from "node:crypto";
import { execFileSync as execFileSync2 } from "node:child_process";
import ts2 from "typescript";
var EPOCH_PRIOR_PROOF_HEAD = "6983219e13295b8f6b073daefc3cbcd90b32ac35";
var CURRENT_REVIEW_RUNTIME_PRIOR_HEAD = "1f4858d81b4ea6ef5d983b4e57fd680519c1e833";
var REVIEW_517722_RUNTIME_PRIOR_HEAD = "63f520f3bb21fcbb5da51c31ef9e5d327f8de51f";
var REVIEW_517722_RUNTIME_CERTIFIED_HEAD = "3ea1626f6e42533b018bd532626c421e9f9aa2a9";
var REVIEW_517722_PRIOR_COMPACT_CERTIFICATE = "86056e5b16a928ac009ac6054a1ddfd71d9bb4dc";
var REVIEW_517722_PRIOR_COMPACT_CERTIFIED_HEAD = "9c95d79be6da37cd0db9245b9e59b7b29f908221";
var REVIEW_517722_RUNTIME_PATCH = Object.freeze([
  Object.freeze({ file: "src/corrections.ts", patchSha256: "5219153ea745b0e06a32dfdaaa4a010133db282e58ca44a8915564abec06cfa0", priorSha256: "4aa9c8adc2568fd4a6ea3d44f05691929a90e2dd7eb959278bd90c0f7c99b87e", currentSha256: "439e67f78ef3676d24e5981b80fa9b09f32336ab79808bcea44d6df2f374638c" }),
  Object.freeze({ file: "src/events.ts", patchSha256: "b1b1518929ce88eb8fd21fdea227e177e5db283864e32683916f547890e9310a", priorSha256: "b30214304cd638a305b3d2dfb6ab7992b6c90c25c2dcfc0a001df3c9c333ec77", currentSha256: "00155761783c7396c3c06e0756e70eb4fc96b6caa936ef7106344ab00d05705d" }),
  Object.freeze({ file: "src/fungibility.ts", patchSha256: "bf19f876e1814bfe1dd3f60c9ac5995db2e752dcff26d6d9b27caf7599c58579", priorSha256: "6a4000cb79131cd5390c76a4e1235e72bbbee746279d719463d70d72cb17ae75", currentSha256: "3c6de2a463fb57aee417b442cfba202e13277cc0de80a49ee2020f12c65d47b7" }),
  Object.freeze({ file: "src/model.ts", patchSha256: "f54cf15eb00fd11240a58af847ee145a9ba53d2b9e7dc3c38cbaab65e7f0aebf", priorSha256: "634096c43e1f05a1960f741c64140bbac92f9605fdef1d2cfcb8232c02ab8f66", currentSha256: "9c4b76f4dd92022eaaee93552765d0b09898651aea3de6f4bffa6c41786b9dd6" }),
  Object.freeze({ file: "src/projection.ts", patchSha256: "2a2df4aada41ccacfb6b82124307d88e4373a71f4d45935ae448a2a65853edde", priorSha256: "eb95c0ce59d87fe84bd150289b5edc50c3900340a3025ecd17d22013bcd67569", currentSha256: "0f302d058f13f6fd501fb7f58a99074b8440858e221e7852e104478742b7e24e" }),
  Object.freeze({ file: "src/traceability-replay.ts", patchSha256: "ac3b0323c9ff1b0629e917c0ca2fc0a707860817ec98a32d8e5c049c90fe6217", priorSha256: "b7d8ebf3f50317b2e9229adb0235e486ef1e192ea8a4127316ec3c786e485b2a", currentSha256: "c7ec98f5c927516faa0f44a64b7419126687cad69a43affb3438ee631a4eb536" }),
  Object.freeze({ file: "src/traceability.ts", patchSha256: "3c6730fa1a6b80131d06ae433d2c44264eee0b4ab7d5417a85f07a5533989175", priorSha256: "7db0c39cb3262339e76790a7ba10569d67d205ab84f1adb078b6b6d95e93a59c", currentSha256: "20f6de5a795095c3ec401e456c7318c9967ccc192ad88070597530de926e3403" })
]);
var epochNames = Object.freeze({
  "occurredAt": "occurredAtEpochMs",
  "recordedAt": "recordedAtEpochMs",
  "createdAt": "createdAtEpochMs",
  "expiresAt": "expiresAtEpochMs",
  "startedAt": "startedAtEpochMs",
  "statusAt": "statusAtEpochMs",
  "lastChangedAt": "lastChangedAtEpochMs",
  "observedAt": "observedAtEpochMs",
  "completedAt": "completedAtEpochMs",
  "manufacturedAt": "manufacturedAtEpochMs",
  "openedAt": "openedAtEpochMs",
  "useBy": "useByEpochMs",
  "cutoverAt": "cutoverAtEpochMs",
  "snapshotAt": "snapshotAtEpochMs",
  "layerStartedAt": "layerStartedAtEpochMs",
  "reservationAt": "reservationAtEpochMs",
  "receivedAt": "receivedAtEpochMs",
  "preparedAt": "preparedAtEpochMs",
  "dispatchedAt": "dispatchedAtEpochMs",
  "lastReceivedAt": "lastReceivedAtEpochMs",
  "releasedAt": "releasedAtEpochMs",
  "adapterCertifiedAt": "adapterCertifiedAtEpochMs",
  "dualRunStartedAt": "dualRunStartedAtEpochMs",
  "fenceStartedAt": "fenceStartedAtEpochMs",
  "activatedAt": "activatedAtEpochMs",
  "certifiedAt": "certifiedAtEpochMs",
  "defaultAt": "defaultAtEpochMs",
  "explicitCutoverAt": "explicitCutoverAtEpochMs",
  "replacementOccurredAt": "replacementOccurredAtEpochMs",
  "actualStartedAt": "actualStartedAtEpochMs",
  "desiredStartedAt": "desiredStartedAtEpochMs",
  "lastCountWorkAt": "lastCountWorkAtEpochMs",
  "sourceStartedAt": "sourceStartedAtEpochMs",
  "destinationStartedAt": "destinationStartedAtEpochMs",
  "effectiveUseBy": "effectiveUseByEpochMs",
  "allocationLayerStartedAt": "allocationLayerStartedAtEpochMs",
  "allocationEffectiveUseBy": "allocationEffectiveUseByEpochMs",
  "allocationLotExpiresAt": "allocationLotExpiresAtEpochMs",
  "containerUseBy": "containerUseByEpochMs",
  "lotExpiry": "lotExpiryEpochMs",
  "at": "atEpochMs",
  "now": "nowEpochMs",
  "positiveLayerStartedAtByPositionId": "positiveLayerStartedAtEpochMsByPositionId",
  "assertCanonicalInventoryTime": "assertInventoryEpochMilliseconds",
  "requireCanonicalTime": "requireEpochMilliseconds",
  "requireCanonicalStoredTime": "requireStoredEpochMilliseconds",
  "requireCanonicalCutoverTime": "requireCutoverEpochMilliseconds",
  "inventoryPositionEffectiveUseBy": "inventoryPositionEffectiveUseByEpochMs",
  "resolveInventoryCutoverAt": "resolveInventoryCutoverAtEpochMs"
});
var inverse = new Map(Object.entries(epochNames).map(([before, after]) => [after, before]));
var nullableTimes = /* @__PURE__ */ new Set(["adapterCertifiedAtEpochMs", "dualRunStartedAtEpochMs", "fenceStartedAtEpochMs", "activatedAtEpochMs"]);
var sha2563 = (bytes2) => crypto3.createHash("sha256").update(bytes2).digest("hex");
var historical = /* @__PURE__ */ new Map();
var currentReviewHistorical = /* @__PURE__ */ new Map();
var review517722Historical = /* @__PURE__ */ new Map();
function readReview517722PriorFile(root3, file) {
  const key = `${root3}:${file}`;
  if (!review517722Historical.has(key)) review517722Historical.set(key, execFileSync2("git", ["show", `${REVIEW_517722_RUNTIME_PRIOR_HEAD}:${file}`], { cwd: root3, maxBuffer: 64 * 1024 * 1024 }));
  return Buffer.from(review517722Historical.get(key));
}
function readCurrentReviewPriorFile(root3, file) {
  const key = `${root3}:${file}`;
  if (!currentReviewHistorical.has(key)) currentReviewHistorical.set(key, execFileSync2("git", ["show", `${CURRENT_REVIEW_RUNTIME_PRIOR_HEAD}:${file}`], { cwd: root3, maxBuffer: 64 * 1024 * 1024 }));
  return Buffer.from(currentReviewHistorical.get(key));
}
function readEpochPriorFile(root3, file) {
  const key = `${root3}:${file}`;
  if (!historical.has(key)) historical.set(key, execFileSync2("git", ["show", `${EPOCH_PRIOR_PROOF_HEAD}:${file}`], { cwd: root3, maxBuffer: 64 * 1024 * 1024 }));
  return Buffer.from(historical.get(key));
}
function epochSurfaceKey(key) {
  return key.replace(/[A-Za-z_$][A-Za-z0-9_$]*/gu, (name) => Object.hasOwn(epochNames, name) ? epochNames[name] : name);
}
function syntax(text, runtime = true) {
  const emitted = runtime ? ts2.transpileModule(text, { compilerOptions: { target: ts2.ScriptTarget.ES2022, module: ts2.ModuleKind.ES2022, removeComments: true } }).outputText : text;
  const source7 = ts2.createSourceFile("proof.ts", emitted, ts2.ScriptTarget.Latest, true, runtime ? ts2.ScriptKind.JS : ts2.ScriptKind.TS);
  assert5.equal(source7.parseDiagnostics.length, 0, "Epoch proof cannot compare unparsable source.");
  function visit(node) {
    if (!ts2.isSourceFile(node) && typeof node.text === "string") return [node.kind, node.text];
    const children = [];
    ts2.forEachChild(node, (child) => {
      children.push(visit(child));
    });
    return [node.kind, node.operator ?? null, ts2.isVariableDeclarationList(node) ? node.flags & ts2.NodeFlags.BlockScoped : null, ...children];
  }
  return JSON.stringify(visit(source7));
}
function functionSpan(text, name) {
  const source7 = ts2.createSourceFile("proof.ts", text, ts2.ScriptTarget.Latest, true);
  const found = source7.statements.filter((node) => ts2.isFunctionDeclaration(node) && node.name?.text === name);
  assert5.equal(found.length, 1, `Expected exactly one temporal helper ${name}.`);
  return { source: source7, node: found[0] };
}
function replaceFunction(text, name, replacement) {
  const { source: source7, node } = functionSpan(text, name);
  return text.slice(0, node.getStart(source7)) + replacement + text.slice(node.getEnd());
}
function checkFunction(text, name, expected) {
  assert5.equal(syntax(functionSpan(text, name).node.getText()), syntax(expected), `Unproved temporal helper body: ${name}`);
}
function replaceOnce(text, before, after, label) {
  assert5.equal(text.split(before).length, 2, `Temporal transformation must have one exact ${label}.`);
  return text.replace(before, after);
}
function restoreNumericHelpers(file, current, prior) {
  let text = current;
  if (file === "src/events.ts") {
    checkFunction(text, "assertInventoryEpochMilliseconds", `export function assertInventoryEpochMilliseconds(value, label) {
      if (!Number.isSafeInteger(value)) { throw new Error(\`\${label} must be safe-integer epoch milliseconds.\`); }
    }`);
    text = replaceFunction(text, "assertInventoryEpochMilliseconds", functionSpan(prior, "assertCanonicalInventoryTime").node.getText());
  }
  if (file === "src/authority.ts") {
    checkFunction(text, "requireEpochMilliseconds", `function requireEpochMilliseconds(value, label) {
      if (!Number.isSafeInteger(value)) { throw new Error(\`InventoryOnce authority \${label} must be safe-integer epoch milliseconds.\`); } return value;
    }`);
    checkFunction(text, "requireStoredEpochMilliseconds", `function requireStoredEpochMilliseconds(value, label) {
      if (value === null) { throw new Error(\`InventoryOnce authority \${label} must retain epoch milliseconds.\`); } return requireEpochMilliseconds(value, label);
    }`);
    checkFunction(text, "requireNullableEpochMilliseconds", `function requireNullableEpochMilliseconds(row, field) {
      const value = row[field]; if (value === null) return null;
      if (typeof value !== "number") { throw new Error(\`InventoryOnce authority field '\${field}' must be epoch milliseconds or null.\`); }
      return requireEpochMilliseconds(value, field);
    }`);
    text = replaceFunction(text, "requireEpochMilliseconds", functionSpan(prior, "requireCanonicalTime").node.getText());
    text = replaceFunction(text, "requireStoredEpochMilliseconds", functionSpan(prior, "requireCanonicalStoredTime").node.getText());
    text = replaceFunction(text, "requireNullableEpochMilliseconds", "");
    text = replaceOnce(text, `(left.recordedAtEpochMs < right.recordedAtEpochMs ? -1 : left.recordedAtEpochMs > right.recordedAtEpochMs ? 1 : 0)`, "compareCanonicalText(left.recordedAtEpochMs, right.recordedAtEpochMs)", "numeric mismatch comparison");
    text = replaceOnce(text, `const sourceParts = [
    state.sourceRoot.length !== 0,
    state.sourcePlanDigest.length !== 0,
    state.sourceCatalogDigest.length !== 0,
    state.dualRunStartedAtEpochMs !== null,
  ];`, `const sourceParts = [state.sourceRoot, state.sourcePlanDigest, state.sourceCatalogDigest, state.dualRunStartedAtEpochMs];`, "source-time presence tuple");
    text = replaceOnce(text, `for (const present of sourceParts) {
    if (present) sourcePartCount += 1;
  }`, `for (const value of sourceParts) { if (value.length !== 0) sourcePartCount += 1; }`, "source evidence completeness");
  }
  if (file === "src/authority-cutover.ts") {
    checkFunction(text, "requireCutoverEpochMilliseconds", `function requireCutoverEpochMilliseconds(value, label) {
      if (value === null || !Number.isSafeInteger(value)) { throw new Error(\`InventoryOnce cutover \${label} must be safe-integer epoch milliseconds.\`); }
    }`);
    text = replaceFunction(text, "requireCutoverEpochMilliseconds", functionSpan(prior, "requireCanonicalCutoverTime").node.getText());
    text = replaceOnce(text, `authority.dualRunStartedAtEpochMs ??
    authority.adapterCertifiedAtEpochMs ??
    authority.fenceStartedAtEpochMs`, `authority.dualRunStartedAtEpochMs || authority.adapterCertifiedAtEpochMs || authority.fenceStartedAtEpochMs`, "null-aware retained time selection");
    text = text.replaceAll("    requireCutoverEpochMilliseconds(value, label);", "    requireRetainedCutoverText(value, label);\n    requireCutoverEpochMilliseconds(value, label);".replace("\n", "\n"));
  }
  if (file === "src/allocation.ts") {
    text = replaceOnce(text, `(left.receivedAtEpochMs < right.receivedAtEpochMs ? -1 : left.receivedAtEpochMs > right.receivedAtEpochMs ? 1 : 0)`, "compareInventoryIdentityText(left.receivedAtEpochMs, right.receivedAtEpochMs)", "numeric FIFO comparison");
    text = replaceOnce(text, "return left < right ? -1 : left > right ? 1 : 0;", "return compareInventoryIdentityText(left, right);", "numeric optional expiry comparison");
  }
  if (file === "src/facade.ts") {
    checkFunction(text, "requirePolicyBatchEpochMilliseconds", `function requirePolicyBatchEpochMilliseconds(value, label) {
      const epochMs = requirePolicyBatchMetadataNumber(value, label); assertInventoryEpochMilliseconds(epochMs, label); return epochMs;
    }`);
    text = replaceFunction(text, "requirePolicyBatchEpochMilliseconds", "");
    text = text.replaceAll("requirePolicyBatchEpochMilliseconds(", "requirePolicyBatchMetadataString(");
    text = replaceOnce(text, "Date.now()", "new Date().toISOString()", "numeric system clock");
  }
  return text;
}
function verifyReview517722RuntimeTransport(root3) {
  execFileSync2("git", ["merge-base", "--is-ancestor", REVIEW_517722_RUNTIME_PRIOR_HEAD, REVIEW_517722_RUNTIME_CERTIFIED_HEAD], { cwd: root3, stdio: "ignore" });
  execFileSync2("git", ["merge-base", "--is-ancestor", REVIEW_517722_RUNTIME_CERTIFIED_HEAD, "HEAD"], { cwd: root3, stdio: "ignore" });
  execFileSync2("git", ["merge-base", "--is-ancestor", REVIEW_517722_PRIOR_COMPACT_CERTIFICATE, REVIEW_517722_RUNTIME_PRIOR_HEAD], { cwd: root3, stdio: "ignore" });
  assert5.equal(execFileSync2("git", ["rev-parse", `${REVIEW_517722_PRIOR_COMPACT_CERTIFICATE}^`], { cwd: root3, encoding: "utf8" }).trim(), REVIEW_517722_PRIOR_COMPACT_CERTIFIED_HEAD, "Prior compact evidence is not the direct child of its certified tree.");
  const priorCertificateManifest = JSON.parse(execFileSync2("git", ["show", `${REVIEW_517722_PRIOR_COMPACT_CERTIFICATE}:experiments/tla-conformance/final-convergence/compact-support-manifest.json`], { cwd: root3, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  assert5.equal(priorCertificateManifest.certification?.certifiedHead, REVIEW_517722_PRIOR_COMPACT_CERTIFIED_HEAD, "Prior compact certificate names the wrong tested tree.");
  assert5.deepEqual(priorCertificateManifest.certification.processes.map((row) => [row.mode, row.report.status]).sort(), [
    ["registry", "FINAL_535_REGISTRY_BUILT"],
    ["selftest", "FINAL_CONVERGENCE_ADVERSARIAL_PASS"],
    ["verify", "FINAL_BINDER_GREEN"]
  ], "Prior compact certificate does not contain the three required green modes.");
  for (const file of ["final-head-transport.json", "final-v309.json", "final-a121-b58.json", "final-surface-bindings.json", "final-binder-report.json"]) {
    const relative = `experiments/tla-conformance/final-convergence/${file}`;
    const certified = execFileSync2("git", ["show", `${REVIEW_517722_PRIOR_COMPACT_CERTIFIED_HEAD}:${relative}`], { cwd: root3, maxBuffer: 64 * 1024 * 1024 });
    const priorHead = execFileSync2("git", ["show", `${REVIEW_517722_RUNTIME_PRIOR_HEAD}:${relative}`], { cwd: root3, maxBuffer: 64 * 1024 * 1024 });
    assert5.equal(sha2563(priorHead), sha2563(certified), `Prior compact-certified artifact drifted before Review 5177225566: ${file}`);
  }
  const laterRuntimeDelta = execFileSync2("git", ["diff", "--name-only", REVIEW_517722_RUNTIME_CERTIFIED_HEAD, "HEAD", "--", "src"], { cwd: root3, encoding: "utf8" }).trim();
  assert5.equal(laterRuntimeDelta, "", "Runtime source changed after the independently certified Review 5177225566 repair.");
  const priorFiles = execFileSync2("git", ["ls-tree", "-r", "--name-only", REVIEW_517722_RUNTIME_PRIOR_HEAD, "--", "src"], { cwd: root3, encoding: "utf8" }).trim().split("\n");
  const currentFiles = execFileSync2("git", ["ls-tree", "-r", "--name-only", REVIEW_517722_RUNTIME_CERTIFIED_HEAD, "--", "src"], { cwd: root3, encoding: "utf8" }).trim().split("\n");
  assert5.deepEqual(currentFiles, priorFiles, "Review 5177225566 changed the runtime module domain.");
  const expectedByFile = new Map(REVIEW_517722_RUNTIME_PATCH.map((row) => [row.file, row]));
  const changed = execFileSync2("git", ["diff", "--name-only", REVIEW_517722_RUNTIME_PRIOR_HEAD, REVIEW_517722_RUNTIME_CERTIFIED_HEAD, "--", "src"], { cwd: root3, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  assert5.deepEqual(changed, REVIEW_517722_RUNTIME_PATCH.map((row) => row.file), "Review 5177225566 runtime patch escaped its audited seven-file family.");
  const inputs3 = [], priorSources = /* @__PURE__ */ new Map(), transitions = [];
  for (const file of currentFiles) {
    const current = readAssuranceFile(root3, file);
    const certified = execFileSync2("git", ["show", `${REVIEW_517722_RUNTIME_CERTIFIED_HEAD}:${file}`], { cwd: root3, maxBuffer: 64 * 1024 * 1024 });
    assert5.equal(sha2563(current), sha2563(certified), `Current runtime source differs from the certified Review 5177225566 repair: ${file}`);
    inputs3.push({ file, sha256: sha2563(current) });
    const prior = readReview517722PriorFile(root3, file);
    priorSources.set(file, prior.toString("utf8"));
    if (current.equals(prior)) continue;
    const expected = expectedByFile.get(file);
    assert5(expected !== void 0, `Unclassified Review 5177225566 runtime source change: ${file}`);
    assert5.equal(sha2563(prior), expected.priorSha256, `Review 5177225566 prior source drifted: ${file}`);
    assert5.equal(sha2563(current), expected.currentSha256, `Review 5177225566 current source drifted: ${file}`);
    const patch = execFileSync2("git", ["diff", "--no-ext-diff", "--unified=0", REVIEW_517722_RUNTIME_PRIOR_HEAD, REVIEW_517722_RUNTIME_CERTIFIED_HEAD, "--", file], { cwd: root3, maxBuffer: 64 * 1024 * 1024 });
    assert5.equal(sha2563(patch), expected.patchSha256, `Review 5177225566 exact source patch drifted: ${file}`);
    transitions.push({ ...expected });
  }
  assert5.equal(transitions.length, REVIEW_517722_RUNTIME_PATCH.length, "Review 5177225566 transition coverage is incomplete.");
  return {
    priorCertifiedHead: REVIEW_517722_RUNTIME_PRIOR_HEAD,
    certifiedRepairHead: REVIEW_517722_RUNTIME_CERTIFIED_HEAD,
    exactChangedRuntimeFiles: changed,
    transitions,
    inputs: inputs3,
    priorSources,
    laws: [
      "The correction transition changes only metadata-root replay classification to use the effective replacement kind; retained history and all unrelated correction equations remain byte-identical.",
      "Event/model/projection changes are fail-closed admission strengthenings over runtime values outside the declared enum/safe-integer domains; admitted typed-domain behavior is preserved.",
      "Traceability live/replay changes copy caller node records before durable retention; the copied value identity is unchanged while post-call caller alias mutation can no longer rewrite stored truth.",
      "Fungibility summary sorting is a deterministic permutation of the already-computed member rows by itemRevisionId; every member object and all physical/deficit/common-basis totals are preserved.",
      "The exact seven-file patch is independently full-assurance certified at the named repair commit; no later runtime source drift is admitted."
    ]
  };
}
function restoreCurrentReviewRuntimeGuards(file, current, prior) {
  let text = current;
  if (file === "src/commands.ts") {
    text = replaceOnce(text, "if (!Array.isArray(lines) || lines.length === 0)", "if (lines.length === 0)", "movement-line malformed-array admission");
    text = replaceOnce(text, 'if (typeof operationId !== "string" || operationId.trim().length === 0)', "if (operationId.trim().length === 0)", "operation-id malformed-string admission");
  }
  if (file === "src/model.ts") {
    text = replaceOnce(text, '  if (typeof value !== "string") throw new Error(`${label} must be a string.`);\n', "", "inventory identity type admission");
    text = replaceOnce(text, '  if (node === null || typeof node !== "object" || Array.isArray(node)) {\n    throw new Error("Traceability node must be an object.");\n  }\n', "", "traceability node shape admission");
  }
  if (file === "src/facade.ts") {
    let normalizeGuardedOwner2 = function(node) {
      if (!node.body || !guardedOwners.has(ownerName(node))) return;
      const declarations = node.body.statements.filter((statement) => {
        if (!ts2.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) return false;
        const declaration2 = statement.declarationList.declarations[0];
        return ts2.isIdentifier(declaration2.name) && declaration2.name.text === "from" && declaration2.initializer !== void 0 && ts2.isCallExpression(declaration2.initializer) && ts2.isIdentifier(declaration2.initializer.expression) && declaration2.initializer.expression.text === "requireStockPositionInput" && declaration2.initializer.arguments[0]?.getText(source7) === "input.from";
      });
      if (declarations.length === 0) return;
      assert5.equal(declarations.length, 1, `Expected at most one reviewed source-position guard in ${ownerName(node)}.`);
      assert5(!normalizedOwners.has(ownerName(node)), `Duplicate reviewed source-position guard owner: ${ownerName(node)}`);
      normalizedOwners.add(ownerName(node));
      const declaration = declarations[0];
      edit(declaration, "");
      function replaceReferences(child) {
        if (child === declaration) return;
        if (ts2.isIdentifier(child) && child.text === "from" && isReferenceIdentifier(child)) edit(child, "input.from");
        ts2.forEachChild(child, replaceReferences);
      }
      ts2.forEachChild(node.body, replaceReferences);
    }, visit2 = function(node) {
      if (ts2.isFunctionDeclaration(node) && node.name?.text === "requireStockPositionInput") {
        edit(node, "");
        return;
      }
      if (ts2.isMethodDeclaration(node) || ts2.isFunctionDeclaration(node)) normalizeGuardedOwner2(node);
      ts2.forEachChild(node, visit2);
    };
    var normalizeGuardedOwner = normalizeGuardedOwner2, visit = visit2;
    const source7 = ts2.createSourceFile(file, text, ts2.ScriptTarget.Latest, true);
    const edits = [];
    const edit = (node, replacement) => edits.push([node.getStart(source7), node.getEnd(), replacement]);
    const guardedOwners = /* @__PURE__ */ new Set([
      "changeStatus",
      "clearStatus",
      "changeOwner",
      "clearOwner",
      "changeCustodian",
      "clearCustodian",
      "changeDispositionAuthority",
      "clearDispositionAuthority",
      "placeInContainer",
      "removeFromContainer",
      "createPositionWithChangedQualifiedDimension",
      "createPositionWithoutQualifiedDimension"
    ]);
    const ownerName = (node) => {
      if ((ts2.isMethodDeclaration(node) || ts2.isFunctionDeclaration(node)) && node.name !== void 0) return node.name.getText(source7);
      return void 0;
    };
    const isReferenceIdentifier = (node) => {
      const parent = node.parent;
      if (ts2.isPropertyAccessExpression(parent) && parent.name === node) return false;
      if ((ts2.isPropertyAssignment(parent) || ts2.isShorthandPropertyAssignment(parent)) && parent.name === node) return false;
      if (ts2.isVariableDeclaration(parent) && parent.name === node) return false;
      return true;
    };
    const normalizedOwners = /* @__PURE__ */ new Set();
    visit2(source7);
    assert5.deepEqual([...normalizedOwners].sort(), [...guardedOwners].sort(), "Reviewed source-position guard family changed.");
    for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) text = text.slice(0, start) + replacement + text.slice(end);
    text = replaceOnce(text, 'if (typeof next !== "string" || next.trim().length === 0)', "if (next.trim().length === 0)", "changed-identity malformed-string admission");
    text = replaceOnce(text, 'if (typeof value !== "string" || value.length === 0)', "if (value === undefined)", "clear-identity malformed-string admission");
  }
  assert5.equal(syntax(text), syntax(prior), `Review runtime transport changed executable semantics outside validated guards: ${file}`);
  assert5.equal(syntax(text, false), syntax(prior, false), `Review runtime transport changed typed source outside validated guards: ${file}`);
  return text;
}
function verifyCurrentReviewRuntimeTransport(root3, currentSourceMap) {
  execFileSync2("git", ["merge-base", "--is-ancestor", CURRENT_REVIEW_RUNTIME_PRIOR_HEAD, REVIEW_517722_RUNTIME_PRIOR_HEAD], { cwd: root3, stdio: "ignore" });
  const files = execFileSync2("git", ["ls-tree", "-r", "--name-only", CURRENT_REVIEW_RUNTIME_PRIOR_HEAD, "--", "src"], { cwd: root3, encoding: "utf8" }).trim().split("\n");
  const currentFiles = currentSourceMap === void 0 ? execFileSync2("git", ["ls-files", "--", "src"], { cwd: root3, encoding: "utf8" }).trim().split("\n") : [...currentSourceMap.keys()];
  assert5.deepEqual(currentFiles, files, "Current review changed the runtime module domain.");
  const expectedChanged = ["src/commands.ts", "src/events.ts", "src/facade.ts", "src/model.ts"];
  const changed = [], inputs3 = [], priorSources = /* @__PURE__ */ new Map();
  for (const file of files) {
    const current = currentSourceMap === void 0 ? readAssuranceFile(root3, file).toString("utf8") : currentSourceMap.get(file);
    assert5.equal(typeof current, "string", `Missing reviewed prior runtime source: ${file}`);
    const prior = readCurrentReviewPriorFile(root3, file).toString("utf8");
    inputs3.push({ file, sha256: sha2563(current) });
    priorSources.set(file, prior);
    if (current === prior) continue;
    restoreCurrentReviewRuntimeGuards(file, current, prior);
    changed.push(file);
  }
  assert5.deepEqual(changed, expectedChanged, "Current review runtime delta escaped the audited malformed-input family.");
  return {
    priorCertifiedHead: CURRENT_REVIEW_RUNTIME_PRIOR_HEAD,
    exactChangedRuntimeFiles: changed,
    inputs: inputs3,
    priorSources,
    laws: [
      "The reviewed runtime delta adds only fail-closed malformed-input admission before existing valid-domain logic.",
      "Every changed runtime module reverses exactly to the prior certified PR source in both emitted-runtime and typed AST form.",
      "No runtime module may be added, removed, or changed outside the four audited review files."
    ]
  };
}
function verifyEpochRuntimeTransport(root3) {
  execFileSync2("git", ["merge-base", "--is-ancestor", EPOCH_PRIOR_PROOF_HEAD, CURRENT_REVIEW_RUNTIME_PRIOR_HEAD], { cwd: root3, stdio: "ignore" });
  const latestReviewTransition = verifyReview517722RuntimeTransport(root3);
  const reviewTransition = verifyCurrentReviewRuntimeTransport(root3, latestReviewTransition.priorSources);
  const files = execFileSync2("git", ["ls-tree", "-r", "--name-only", EPOCH_PRIOR_PROOF_HEAD, "--", "src"], { cwd: root3, encoding: "utf8" }).trim().split("\n");
  assert5.deepEqual([...reviewTransition.priorSources.keys()], files, "Epoch transport changed the runtime module domain before the reviewed guard delta.");
  const inputs3 = latestReviewTransition.inputs, changes = [];
  for (const file of files) {
    let restoreType2 = function(type, removeNull = false) {
      if (removeNull && ts2.isUnionTypeNode(type)) {
        const retained = type.types.filter((child) => !(ts2.isLiteralTypeNode(child) && child.literal.kind === ts2.SyntaxKind.NullKeyword));
        edit(type, retained.map((child) => child.getText(source7).replace(/\bnumber\b/gu, "string")).join(" | "));
      } else {
        const walk = (child) => {
          if (child.kind === ts2.SyntaxKind.NumberKeyword) edit(child, "string");
          else ts2.forEachChild(child, walk);
        };
        walk(type);
      }
    }, visit2 = function(node) {
      if (ts2.isImportDeclaration(node) && node.moduleSpecifier.text === "./events.js" && !prior.includes('from "./events.js"')) {
        edit(node, "");
        return;
      }
      if (ts2.isImportSpecifier(node) && node.name.text === "assertInventoryEpochMilliseconds" && !prior.includes("assertCanonicalInventoryTime")) {
        edit(node, "");
        return;
      }
      if (ts2.isIfStatement(node) && node.elseStatement === void 0) {
        const guarded = ts2.isBlock(node.thenStatement) && node.thenStatement.statements.length === 1 ? node.thenStatement.statements[0] : node.thenStatement;
        if (guardStatement2(guarded) && !priorGuard2(guarded)) {
          assert5(ts2.isBinaryExpression(node.expression) && (ts2.isIdentifier(node.expression.left) || ts2.isPropertyAccessExpression(node.expression.left)) && ts2.isIdentifier(node.expression.right) && node.expression.right.text === "undefined" && node.expression.operatorToken.kind === ts2.SyntaxKind.ExclamationEqualsEqualsToken, "Unproved conditional temporal admission.");
          edit(node, "");
          return;
        }
      }
      if (guardStatement2(node) && !priorGuard2(node)) {
        edit(node, "");
        return;
      }
      if (ts2.isBinaryExpression(node) && temporal(node.left) && node.right.kind === ts2.SyntaxKind.NullKeyword) {
        if (node.operatorToken.kind === ts2.SyntaxKind.EqualsEqualsEqualsToken || node.operatorToken.kind === ts2.SyntaxKind.ExclamationEqualsEqualsToken) {
          edit(node, `${node.left.getText(source7)}.length ${node.operatorToken.getText(source7)} 0`);
          return;
        }
      }
      if (ts2.isPropertyAssignment(node) && nullableTimes.has(node.name.getText(source7))) {
        if (node.initializer.kind === ts2.SyntaxKind.NullKeyword) {
          edit(node.initializer, '""');
        }
        if (ts2.isStringLiteral(node.initializer) && node.initializer.text === "Number") edit(node.initializer, '"String"');
      }
      if (ts2.isCallExpression(node) && ts2.isIdentifier(node.expression) && node.expression.text === "requireNullableEpochMilliseconds") edit(node.expression, "requireString");
      if (ts2.isBinaryExpression(node) && ts2.isTypeOfExpression(node.left) && node.left.expression.getText(source7).endsWith(".recordedAtEpochMs") && ts2.isStringLiteral(node.right) && node.right.text === "number") edit(node.right, '"string"');
      const name = node.name !== void 0 && ts2.isIdentifier(node.name) ? node.name.text : void 0;
      if (node.type !== void 0) {
        if (name?.endsWith("EpochMs") || name === "positiveLayerStartedAtEpochMsByPositionId") restoreType2(node.type, nullableTimes.has(name));
        else if (ts2.isArrowFunction(node) && ts2.isPropertyAssignment(node.parent) && node.parent.name.getText(source7) === "nowEpochMs") restoreType2(node.type);
        else if (ts2.isParameter(node) && (ownerName2(node) === "compareOptionalExpiry" || ownerName2(node) === "resolveInventoryCutoverAtEpochMs" && name === "explicit")) restoreType2(node.type);
        else if (ts2.isFunctionDeclaration(node) && name === "captureConservedPositiveLayerStarts") restoreType2(node.type);
        else if (ts2.isFunctionDeclaration(node) && ["lotDefinitionFingerprintParts", "containerDefinitionFingerprintParts"].includes(name)) edit(node.type, node.type.getText(source7).replace(" | number", ""));
      }
      if (ts2.isAsExpression(node) && node.expression.getText(source7).includes("positiveLayerStartedAtEpochMsByPositionId")) restoreType2(node.type);
      if (ts2.isNewExpression(node) && node.expression.getText(source7) === "Map" && ownerName2(node) === "captureConservedPositiveLayerStarts") for (const type of node.typeArguments ?? []) restoreType2(type);
      ts2.forEachChild(node, visit2);
    }, guardStatement2 = function(node) {
      const expression = ts2.isExpressionStatement(node) ? node.expression : void 0;
      if (expression === void 0 || !ts2.isCallExpression(expression) || !ts2.isIdentifier(expression.expression) || expression.expression.text !== "assertInventoryEpochMilliseconds") return false;
      if (priorGuard2(node)) return true;
      const pureReference = (value) => ts2.isIdentifier(value) || ts2.isPropertyAccessExpression(value) && pureReference(value.expression);
      assert5.equal(expression.arguments.length, 2, "Temporal guards must retain their exact arity.");
      assert5(pureReference(expression.arguments[0]), "Temporal guard argument may not introduce an effect.");
      assert5(ts2.isStringLiteral(expression.arguments[1]) || ts2.isIdentifier(expression.arguments[1]), "Temporal diagnostic may not introduce an effect.");
      return true;
    }, priorGuard2 = function(node) {
      const expression = node.expression;
      const key = ownerName2(node) + ":" + expression.arguments[0]?.getText(source7).replace(/[A-Za-z_$][A-Za-z0-9_$]*/gu, (word) => inverse.get(word) ?? word).replace(/\s+/gu, "");
      return previousGuardKeys.has(key);
    }, ownerName2 = function(node) {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (ts2.isFunctionDeclaration(parent)) return parent.name?.text ?? "<anonymous>";
      }
      return "<module>";
    }, collectPrior2 = function(node) {
      if (ts2.isCallExpression(node) && ts2.isIdentifier(node.expression) && node.expression.text === "assertCanonicalInventoryTime") previousGuardKeys.add(ownerName2(node) + ":" + node.arguments[0]?.getText(previousSource).replace(/\s+/gu, ""));
      ts2.forEachChild(node, collectPrior2);
    };
    var restoreType = restoreType2, visit = visit2, guardStatement = guardStatement2, priorGuard = priorGuard2, ownerName = ownerName2, collectPrior = collectPrior2;
    const current = reviewTransition.priorSources.get(file), prior = readEpochPriorFile(root3, file).toString("utf8");
    assert5.equal(typeof current, "string", `Missing prior certified runtime source: ${file}`);
    if (current === prior) continue;
    let text = restoreNumericHelpers(file, current, prior);
    const source7 = ts2.createSourceFile(file, text, ts2.ScriptTarget.Latest, true);
    const edits = [];
    const edit = (node, replacement) => edits.push([node.getStart(source7), node.getEnd(), replacement]);
    const temporal = (node) => ts2.isPropertyAccessExpression(node) && nullableTimes.has(node.name.text);
    const previousGuardKeys = /* @__PURE__ */ new Set();
    const previousSource = ts2.createSourceFile(file, prior, ts2.ScriptTarget.Latest, true);
    collectPrior2(previousSource);
    visit2(source7);
    for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) text = text.slice(0, start) + replacement + text.slice(end);
    text = text.replace(/[A-Za-z_$][A-Za-z0-9_$]*/gu, (word) => inverse.get(word) ?? word);
    text = text.replace(/\{\s*,/gu, "{").replace(/,\s*,/gu, ",");
    if (syntax(text) !== syntax(prior) || syntax(text, false) !== syntax(prior, false)) {
      fs6.mkdirSync(path8.join(root3, ".chatgpt/epoch-incremental"), { recursive: true });
      fs6.writeFileSync(path8.join(root3, ".chatgpt/epoch-incremental/restored-" + path8.basename(file)), text);
      throw new Error(`Epoch transport contains an unproved runtime change: ${file}`);
    }
    changes.push(file);
  }
  return { priorProofHead: EPOCH_PRIOR_PROOF_HEAD, latestReviewRuntimeTransport: {
    priorCertifiedHead: latestReviewTransition.priorCertifiedHead,
    certifiedRepairHead: latestReviewTransition.certifiedRepairHead,
    exactChangedRuntimeFiles: latestReviewTransition.exactChangedRuntimeFiles,
    transitions: latestReviewTransition.transitions,
    laws: latestReviewTransition.laws
  }, currentReviewRuntimeTransport: {
    priorCertifiedHead: reviewTransition.priorCertifiedHead,
    exactChangedRuntimeFiles: reviewTransition.exactChangedRuntimeFiles,
    laws: reviewTransition.laws
  }, exactChangedRuntimeFiles: changes, inputs: inputs3, laws: [
    "Safe-integer epoch milliseconds form an exact totally ordered instant domain including zero and negative values.",
    "Relational numeric comparison preserves chronology; expiry is inclusive and absence is not a numeric sentinel.",
    "Canonical JSON encodes safe integers injectively up to signed zero, which denotes the same instant; intent arrays retain their field order.",
    "Every remaining runtime statement and identity operation is preserved by the checked whole-module reverse transformation."
  ] };
}

// experiments/tla-conformance/final-convergence/final-head-transport.mjs
import assert6 from "node:assert/strict";

// experiments/tla-conformance/final-convergence/repository-root.mjs
import path9 from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
function finalConvergenceRepositoryRoot(moduleUrl) {
  return path9.resolve(path9.dirname(fileURLToPath3(moduleUrl)), "../../..");
}
function finalConvergenceRepositoryPath(repositoryRoot, repositoryRelativePath) {
  return assuranceRepositoryPath(repositoryRoot, repositoryRelativePath);
}
function assertFinalConvergenceRepositoryRoot(repositoryRoot, moduleUrl) {
  const expected = finalConvergenceRepositoryRoot(moduleUrl);
  const actual = path9.resolve(repositoryRoot);
  if (actual !== expected) {
    throw new Error(`InventoryOnce final assurance repository root mismatch: expected '${expected}', received '${actual}'.`);
  }
  return actual;
}

// experiments/tla-conformance/final-convergence/final-head-transport.mjs
var ROOT = finalConvergenceRepositoryRoot(import.meta.url);
var passes2 = /* @__PURE__ */ new WeakMap();
function buildFinalHeadTransport({ repositoryRoot = ROOT, context, surface } = {}) {
  const root3 = assertFinalConvergenceRepositoryRoot(repositoryRoot, import.meta.url);
  assert6(context !== void 0 && surface !== void 0 && context.repositoryRoot === root3, "Semantic transport requires the current shared compiler snapshot.");
  if (passes2.has(context)) return structuredClone(passes2.get(context));
  const transition = verifyEpochRuntimeTransport(root3);
  const oldRegistry = JSON.parse(readEpochPriorFile(root3, "experiments/tla-conformance/final-convergence/final-surface-bindings.json"));
  const mapped = oldRegistry.bindings.map((row) => epochSurfaceKey(row.surfaceKey));
  const immediatePriorRegistry = JSON.parse(readReview517722PriorFile(root3, "experiments/tla-conformance/final-convergence/final-surface-bindings.json"));
  assert6.equal(surface.callables.length, 535);
  assert6.equal(new Set(mapped).size, 535, "Temporal vocabulary mapping is not bijective.");
  assert6.deepEqual([...mapped].sort(), immediatePriorRegistry.bindings.map((row) => row.surfaceKey).sort(), "Prior compact registry diverged from the proven epoch ownership mapping.");
  assert6.deepEqual(immediatePriorRegistry.bindings.map((row) => row.surfaceKey).sort(), surface.callables.map((row) => row.key).sort(), "Review 517722 changed the public ownership domain.");
  const inputs3 = [...transition.inputs];
  for (const file of ["scripts/inventory-epoch-contract.mjs", "formal/UseByReservation.tla", "formal/UseByReservation.cfg", "formal/UseByReservationEpochZeroMutation.cfg"]) {
    inputs3.push({ file, sha256: sha256(readAssuranceFile(root3, file)) });
  }
  const core = {
    schemaVersion: 2,
    status: "FINAL_HEAD_TRANSPORT_PROVED",
    priorProofHead: EPOCH_PRIOR_PROOF_HEAD,
    immediatePriorProofHead: REVIEW_517722_RUNTIME_PRIOR_HEAD,
    finalSurfaceDigest: surface.digest,
    callables: 535,
    exactPrimitiveTransport: transition,
    publicKeyTransport: oldRegistry.bindings.filter((row) => epochSurfaceKey(row.surfaceKey) !== row.surfaceKey).map((row) => ({ before: row.surfaceKey, after: epochSurfaceKey(row.surfaceKey), mode: row.mode })),
    inputs: inputs3,
    creditExpansion: false
  };
  const artifact = { ...core, contentSha256: sha256(canonicalJson(core)) };
  passes2.set(context, artifact);
  return structuredClone(artifact);
}

// experiments/tla-conformance/final-convergence/final-families.mjs
var ROOT2 = finalConvergenceRepositoryRoot(import.meta.url);
var DIRECTORY = "experiments/tla-conformance/final-convergence/";
var TRANSPORT = DIRECTORY + "final-head-transport.json";
var frozen = createImmutableAssuranceReader(ROOT2);
var protectedInputs = ["authority-producer17.json", "authority-value3.json", "r137-v15.json", "readworld-producer24.json", "wrapper-producer11.json", "r170-pristine-repro-transport.json"];
var producerProofKind = "final-convergence-producer-a121-b58-v1";
var valueProofKind = "final-convergence-value-v309-v1";
function reviewPriorArtifact(root3, kind) {
  assert7(["value", "producer", "registry"].includes(kind), "Unknown prior proof domain.");
  const file = DIRECTORY + `review-517722-prior-${kind}.json`;
  const original = DIRECTORY + (kind === "value" ? "final-v309.json" : kind === "producer" ? "final-a121-b58.json" : "final-surface-bindings.json");
  const bytes2 = readAssuranceFile(root3, file);
  assert7.equal(sha256(bytes2), sha256(readReview517722PriorFile(root3, original)), "Review 517722 prior authority differs from the independently compact-certified predecessor.");
  return { artifact: JSON.parse(bytes2), reference: { file, sha256: sha256(bytes2), priorHead: REVIEW_517722_RUNTIME_PRIOR_HEAD } };
}
var priorRegistry = reviewPriorArtifact(ROOT2, "registry").artifact;
var epochRegistryRows = Object.freeze(priorRegistry.bindings.map((row) => Object.freeze({ ...row })));
var supportedValueKeys = Object.freeze(epochRegistryRows.filter((row) => row.mode === "V").map((row) => row.surfaceKey).sort());
var supportedProducerRows = Object.freeze(epochRegistryRows.filter((row) => row.mode === "A" || row.mode === "B").map((row) => Object.freeze({ surfaceKey: row.surfaceKey, mode: row.mode })).sort((a, b) => a.surfaceKey < b.surfaceKey ? -1 : a.surfaceKey > b.surfaceKey ? 1 : 0));
assert7.equal(epochRegistryRows.length, 535);
assert7.equal(new Set(epochRegistryRows.map((row) => row.surfaceKey)).size, 535);
assert7.equal(supportedValueKeys.length, 309);
assert7.equal(supportedProducerRows.length, 179);
function build(kind, { repositoryRoot = ROOT2, context, surface } = {}) {
  const root3 = assertFinalConvergenceRepositoryRoot(repositoryRoot, import.meta.url);
  assert7(context !== void 0 && surface !== void 0, "Final proof construction requires the shared compiler pass.");
  for (const input2 of protectedInputs) frozen.read(DIRECTORY + input2);
  const prior = reviewPriorArtifact(root3, kind);
  const currentTransport = buildFinalHeadTransport({ repositoryRoot: root3, context, surface });
  assert7.deepEqual(JSON.parse(readAssuranceFile(root3, TRANSPORT)), currentTransport, "Current semantic transport is stale.");
  const transport = { file: TRANSPORT, sha256: assuranceFileSha256(root3, TRANSPORT) };
  const callableByKey = new Map(surface.callables.map((callable) => [callable.key, callable]));
  const proofs = prior.artifact.proofs.map((proof) => {
    const surfaceKey = proof.surfaceKey, current = callableByKey.get(surfaceKey);
    assert7(current !== void 0, `Prior strict callable disappeared: ${proof.surfaceKey}`);
    return {
      ...proof,
      surfaceKey,
      signatureHash: current.signatureHash,
      declaration: current.declaration,
      semantics: { kind: "EXACT_REVIEW_517722_RUNTIME_TRANSITION", priorProof: proof.semantics, priorSignatureHash: proof.signatureHash, priorAuthority: prior.reference, runtimeTransport: transport, creditExpansion: false }
    };
  });
  const expected = kind === "value" ? supportedValueKeys : supportedProducerRows.map((row) => row.surfaceKey);
  assert7.deepEqual(proofs.map((row) => row.surfaceKey).sort(), [...expected].sort());
  return {
    schemaVersion: 1,
    ...kind === "producer" ? { route: "REGISTERED_CERTIFIED_PRODUCER" } : {},
    proofKind: kind === "value" ? valueProofKind : producerProofKind,
    family: kind === "value" ? "FinalConvergenceValueV309" : "FinalConvergenceProducerA121B58",
    surfaceDigest: surface.digest,
    domain: "The complete previously compact-certified 535-row ownership partition, with all 488 strict package-owned rows transported through the exact Review 517722 seven-file runtime transition. Invalid runtime discriminators/cuts are narrowed fail-closed; retained traceability values are copied without identity change; fungibility member ordering is a deterministic permutation; the correction replay patch is the exact independently full-assurance-certified source transition. External ownership remains excluded.",
    allAdmittedInputs: true,
    sampledInputs: 0,
    creditExpansion: false,
    ...kind === "producer" ? { producerGraphRuns: 0, producerReplayRuns: 0, reverseReruns: 0, externalSurfaceCreditGranted: false } : {},
    inputs: [prior.reference, transport, ...currentTransport.inputs],
    proofs
  };
}
function buildFinalValueArtifact(input2) {
  return build("value", input2);
}
function buildFinalProducerArtifact(input2) {
  return build("producer", input2);
}

// experiments/tla-conformance/boundary-adjudication-r18/family.mjs
import assert9 from "node:assert/strict";
import fs8 from "node:fs";
import path11 from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";

// experiments/tla-conformance/throughput-r7/strict-dependency-receipt.mjs
import assert8 from "node:assert/strict";
import fs7 from "node:fs";
import path10 from "node:path";
var registryFile = "experiments/tla-conformance/throughput-r7/evidence/surface-bindings.json";
var reportFile = "experiments/tla-conformance/throughput-r7/evidence/admission-report.json";
var expectedCheckerSha256 = "4dd6bbf135ebb5a5da86b714e0d9b9d3550547a7df7b39aec1a471bf1ef3f88e";
var cache;
function strictDependencyReceipt({ repositoryRoot, surface, requirements, label = "strict dependency" }) {
  assert8(Array.isArray(requirements) && requirements.length > 0);
  const registryBytes = fs7.readFileSync(path10.resolve(repositoryRoot, registryFile));
  const reportBytes = fs7.readFileSync(path10.resolve(repositoryRoot, reportFile));
  const identity = `${sha256(registryBytes)}:${sha256(reportBytes)}:${surface.digest}`;
  if (cache?.identity !== identity) {
    const registry = JSON.parse(registryBytes.toString("utf8"));
    const report = JSON.parse(reportBytes.toString("utf8"));
    assert8.equal(registry.schemaVersion, 1);
    assert8(Array.isArray(registry.bindings));
    assert8.equal(registry.bindings.length, surface.callables.length);
    assert8.equal(new Set(registry.bindings.map((row) => row.surfaceKey)).size, surface.callables.length);
    const liveKeys = new Set(surface.callables.map((row) => row.key));
    assert8(registry.bindings.every((row) => liveKeys.has(row.surfaceKey)), "Strict dependency registry is not the current compiler surface.");
    const strict = registry.bindings.filter((row) => row.mode !== "HARD_RED").length;
    assert8.equal(report.status, "CURRENT_STRICT_FAMILY_ADMISSION");
    assert8.equal(report.strictGatePassed, true);
    assert8.equal(report.claimedDiagnostics, 0);
    assert8.equal(report.surfaceDigest, surface.digest);
    assert8.equal(report.strictCallables, strict);
    assert8.equal(report.strictCheckerSha256, expectedCheckerSha256);
    cache = { identity, byKey: new Map(registry.bindings.map((row) => [row.surfaceKey, row])), strictCallables: strict };
  }
  const seen = /* @__PURE__ */ new Set();
  const dependencies = requirements.map((requirement) => {
    const normalized = typeof requirement === "string" ? { surfaceKey: requirement } : requirement;
    assert8.equal(typeof normalized.surfaceKey, "string");
    assert8(!seen.has(normalized.surfaceKey), `${label} repeats ${normalized.surfaceKey}`);
    seen.add(normalized.surfaceKey);
    const binding = cache.byKey.get(normalized.surfaceKey);
    assert8(binding !== void 0, `${label} missing ${normalized.surfaceKey}`);
    assert8.notEqual(binding.mode, "HARD_RED", `${label} remains red: ${normalized.surfaceKey}`);
    if (normalized.mode !== void 0) assert8.equal(binding.mode, normalized.mode, `${label} mode changed: ${normalized.surfaceKey}`);
    return { surfaceKey: normalized.surfaceKey, mode: binding.mode };
  });
  return { kind: "COMPOSED_CURRENT_STRICT_REGISTRY", globalStrictCallables: cache.strictCallables, dependencies };
}

// experiments/tla-conformance/throughput-r7/strict-dependency-semantic-receipt.mjs
function strictDependencySemanticReceipt(input2) {
  const receipt = strictDependencyReceipt(input2);
  return { kind: "COMPOSED_CURRENT_STRICT_DEPENDENCIES", dependencies: receipt.dependencies };
}

// experiments/tla-conformance/boundary-adjudication-r18/family.mjs
var proofKind = "inventoryonce-reservation-feasibility-guard-value-v1";
var supportedSurfaceKeys = Object.freeze(["export:./kernel#assertInventoryReservationsFeasible::call[0]"]);
var expectedFile = fileURLToPath4(new URL("./equations.expected.ts.txt", import.meta.url));
var dependencyKey = "export:./kernel#inspectInventoryReservationFeasibility::call[0]";
var inputFiles = Object.freeze([
  "src/reservations.ts",
  "experiments/tla-conformance/boundary-adjudication-r18/equations.expected.ts.txt",
  "experiments/tla-conformance/boundary-adjudication-r18/family.mjs",
  "experiments/tla-conformance/throughput-r7/registered-value-family.mjs",
  "experiments/tla-conformance/throughput-r7/strict-dependency-receipt.mjs",
  "experiments/tla-conformance/throughput-r7/strict-dependency-semantic-receipt.mjs"
]);
var printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
function parse(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function inputText(root3, overrides, file) {
  return overrides.get(file) ?? fs8.readFileSync(path11.resolve(root3, file), "utf8");
}
function source(root3, context, overrides, file) {
  if (overrides.has(file)) return parse(file, inputText(root3, overrides, file));
  const s = context.program.getSourceFile(path11.resolve(root3, file));
  assert9(s, `Compiler omitted '${file}'.`);
  return s;
}
function fn(s, name) {
  const xs = s.statements.filter((x) => ts.isFunctionDeclaration(x) && x.name?.text === name && x.body);
  assert9.equal(xs.length, 1, `Expected one function '${name}'.`);
  return xs[0];
}
function rendered(node, s) {
  return printer.printNode(ts.EmitHint.Unspecified, node, s).replaceAll(/\r\n/gu, "\n").trim();
}
function equation(id, actual, actualSource, expected, expectedSource3) {
  const a = rendered(actual, actualSource), e = rendered(expected, expectedSource3);
  assert9.equal(a, e, `Independent complete source equation changed for '${id}'.`);
  return { id, equationSha256: sha256(e), canonicalSource: e };
}
function dependency(root3, surface) {
  return strictDependencySemanticReceipt({ repositoryRoot: root3, surface, requirements: [{ surfaceKey: dependencyKey, mode: "B" }], label: "reservation feasibility guard dependency" });
}
function buildFamilyArtifact({ repositoryRoot, context, surface, sourceOverrides = /* @__PURE__ */ new Map() }) {
  const expected = parse(expectedFile, fs8.readFileSync(expectedFile, "utf8"));
  const reservations = source(repositoryRoot, context, sourceOverrides, "src/reservations.ts");
  const eq = equation("src/reservations.ts#assertInventoryReservationsFeasible", fn(reservations, "assertInventoryReservationsFeasible"), reservations, fn(expected, "assertInventoryReservationsFeasible"), expected);
  const callable = new Map(surface.callables.map((x) => [x.key, x])).get(supportedSurfaceKeys[0]);
  assert9(callable, "Compiler omitted reservation feasibility guard.");
  const inputs3 = [...new Set(inputFiles)].sort(compareCodeUnits).map((file) => ({ file, sha256: sha256(inputText(repositoryRoot, sourceOverrides, file)) }));
  return { schemaVersion: 1, mode: "V", proofKind, sourceBase: "82d95e976919966154ee163976d0c93defdb3a10", surfaceDigest: surface.digest, allAdmittedInputs: true, sampledInputs: 0, domain: { observableContract: "all reports produced by the already-strict ReservationSafety feasibility projection; exact feasible void return and deterministic sorted shortage error for every non-feasible report" }, strictDependencies: dependency(repositoryRoot, surface), equations: [eq], inputs: inputs3, proofs: [{ surfaceKey: supportedSurfaceKeys[0], signatureHash: callable.signatureHash, declaration: callable.declaration, equationId: eq.id }] };
}

// experiments/tla-conformance/surface-residual-r8/pure-residual5-r10/composition-open-family.mjs
import assert15 from "node:assert/strict";
import fs13 from "node:fs";
import path16 from "node:path";

// experiments/tla-conformance/identity-values-r7/family.mjs
import assert10 from "node:assert/strict";
import fs9 from "node:fs";
import path12 from "node:path";
import { fileURLToPath as fileURLToPath5 } from "node:url";

// experiments/tla-conformance/identity-values-r7/contracts.mjs
var IDENTITY_VALUES_FAMILY_ID = "inventoryonce.identity-values.closed-source-equations.v1";
var ASSIGNED_SURFACE_KEYS = Object.freeze([
  "export:.#assertInventoryAmountSum::call[0]",
  "export:.#everythingInInventoryStockSelector::call[0]",
  "export:.#inventoryAmountFromUnit::call[0]",
  "export:.#inventoryContainerIdentity::call[0]",
  "export:.#inventoryLotIdentity::call[0]",
  "export:.#inventoryMeasuredAmountFromVector::call[0]",
  "export:.#inventoryPositionEffectiveUseBy::call[0]",
  "export:.#inventoryPositionIsExpiredAt::call[0]",
  "export:.#inventoryStockSelector::call[0]",
  "export:.#measuredStockAmount::call[0]",
  "export:.#packageAmount::call[0]",
  "export:.#resolveInventoryAmount::call[0]",
  "export:.#stockAmount::call[0]",
  "export:./kernel#assertInventoryAmountSum::call[0]",
  "export:./kernel#assertInventoryIdentity::call[0]",
  "export:./kernel#assertPositionInsideSelector::call[0]",
  "export:./kernel#everythingInInventoryStockSelector::call[0]",
  "export:./kernel#inventoryAmountFromUnit::call[0]",
  "export:./kernel#inventoryContainerIdentity::call[0]",
  "export:./kernel#inventoryIntentFingerprint::call[0]",
  "export:./kernel#inventoryLotIdentity::call[0]",
  "export:./kernel#inventoryMeasuredAmountFromVector::call[0]",
  "export:./kernel#inventoryMetadataFingerprint::call[0]",
  "export:./kernel#inventoryMetadataValueFingerprint::call[0]",
  "export:./kernel#inventoryPositionEffectiveUseBy::call[0]",
  "export:./kernel#inventoryPositionIsExpiredAt::call[0]",
  "export:./kernel#inventorySerialIdentity::call[0]",
  "export:./kernel#inventoryStockPositionIdentity::call[0]",
  "export:./kernel#inventoryStockPositionMatchesNormalizedSelector::call[0]",
  "export:./kernel#inventoryStockPositionMatchesSelector::call[0]",
  "export:./kernel#inventoryStockSelector::call[0]",
  "export:./kernel#inventoryStockSelectorIdentity::call[0]",
  "export:./kernel#inventoryStockSelectorIsSubset::call[0]",
  "export:./kernel#inventoryTraceabilityNodeIdentity::call[0]",
  "export:./kernel#measuredStockAmount::call[0]",
  "export:./kernel#normalizeInventoryStockPositionKey::call[0]",
  "export:./kernel#normalizeInventoryStockSelector::call[0]",
  "export:./kernel#packageAmount::call[0]",
  "export:./kernel#resolveInventoryAmount::call[0]",
  "export:./kernel#stockAmount::call[0]"
]);
var EQUATION_IDS = Object.freeze([
  "src/amounts.ts#assertInventoryAmountSum",
  "src/amounts.ts#createMeasuredVector",
  "src/amounts.ts#inventoryAmountFromUnit",
  "src/amounts.ts#inventoryMeasuredAmountFromVector",
  "src/amounts.ts#measuredStockAmount",
  "src/amounts.ts#packageAmount",
  "src/amounts.ts#resolveInventoryAmount",
  "src/amounts.ts#stockAmount",
  "src/amounts.ts#validateIndependentAmountInputs",
  "src/canonical.ts#assertFiniteInventoryIntentFingerprintNumbers",
  "src/canonical.ts#inventoryIntentFingerprint",
  "src/canonical.ts#inventoryMetadataFingerprint",
  "src/canonical.ts#inventoryMetadataValueFingerprint",
  "src/canonical.ts#isInventoryMetadataArray",
  "src/catalog.ts#InventoryCatalog.itemRevision",
  "src/catalog.ts#InventoryCatalog.packagingRevision",
  "src/catalog.ts#assertMeasurementsMatchItem",
  "src/catalog.ts#findIndependentAxis",
  "src/measurements.ts#addInventoryMeasurements",
  "src/measurements.ts#assertSamePrimaryMeasurementAxis",
  "src/measurements.ts#compareMeasurementAxis",
  "src/measurements.ts#inventoryMeasurement",
  "src/measurements.ts#inventoryMeasurementVector",
  "src/measurements.ts#inventoryMeasurementsEqual",
  "src/measurements.ts#multiplyInventoryMeasurementsByWholeNumber",
  "src/measurements.ts#positiveInventoryMeasurements",
  "src/measurements.ts#zeroInventoryMeasurements",
  "src/model.ts#assertInventoryIdentity",
  "src/model.ts#compareQualifiedDimension",
  "src/model.ts#inventoryContainerIdentity",
  "src/model.ts#inventoryLotIdentity",
  "src/model.ts#inventorySerialIdentity",
  "src/model.ts#inventoryStockPositionIdentity",
  "src/model.ts#inventoryTraceabilityNodeIdentity",
  "src/model.ts#normalizeInventoryStockPositionKey",
  "src/model.ts#qualifiedDimensionIdentityTuple",
  "src/ordering.ts#compareInventoryIdentityText",
  "src/quantity.ts#addQuantity",
  "src/quantity.ts#assertDecimals",
  "src/quantity.ts#assertSafeInteger",
  "src/quantity.ts#assertSameUnit",
  "src/quantity.ts#compareQuantity",
  "src/quantity.ts#integerAtDecimals",
  "src/quantity.ts#multiplyQuantityByWholeNumber",
  "src/quantity.ts#parseQuantity",
  "src/quantity.ts#positiveQuantity",
  "src/quantity.ts#powerOfTen",
  "src/quantity.ts#quantity",
  "src/quantity.ts#quantityEq",
  "src/quantity.ts#quantityToDecimalString",
  "src/quantity.ts#quantityWholeMultipleCount",
  "src/quantity.ts#safeNumber",
  "src/quantity.ts#unitCode",
  "src/quantity.ts#zeroQuantity",
  "src/selectors.ts#assertPositionInsideSelector",
  "src/selectors.ts#compareQualifiedDimensionSelector",
  "src/selectors.ts#everythingInInventoryStockSelector",
  "src/selectors.ts#inventoryStockPositionMatchesNormalizedSelector",
  "src/selectors.ts#inventoryStockPositionMatchesSelector",
  "src/selectors.ts#inventoryStockSelector",
  "src/selectors.ts#inventoryStockSelectorIdentity",
  "src/selectors.ts#inventoryStockSelectorIsSubset",
  "src/selectors.ts#normalizeIdentitySet",
  "src/selectors.ts#normalizeInventoryStockSelector",
  "src/selectors.ts#normalizeOptionalIdentityConstraint",
  "src/selectors.ts#normalizeOptionalIdentitySet",
  "src/selectors.ts#normalizeQualifiedDimensionSelectors",
  "src/selectors.ts#optionalIdentityConstraintIsSubset",
  "src/selectors.ts#optionalIdentityConstraintMatches",
  "src/selectors.ts#optionalSetIsSubset",
  "src/selectors.ts#optionalSetMatches",
  "src/selectors.ts#qualifiedDimensionsMatch",
  "src/selectors.ts#qualifiedSelectorIsSubset",
  "src/usability.ts#inventoryPositionEffectiveUseBy",
  "src/usability.ts#inventoryPositionIsExpiredAt"
]);
var SUPPORTING_VALUE_IDS = Object.freeze([
  "src/amounts.ts#InventoryAmountKind",
  "src/catalog.ts#InventoryMeasurementRequirement",
  "src/model.ts#InventoryTraceabilityNodeKind",
  "src/quantity.ts#MAXIMUM_QUANTITY_DECIMALS",
  "src/selectors.ts#InventoryOptionalIdentityConstraintKind"
]);
var REUSED_CATALOG_EQUATION_IDS = Object.freeze([
  "src/catalog.ts#InventoryCatalog.itemRevision",
  "src/catalog.ts#InventoryCatalog.packagingRevision",
  "src/model.ts#assertInventoryIdentity",
  "src/model.ts#inventoryContainerIdentity",
  "src/model.ts#inventoryLotIdentity",
  "src/ordering.ts#compareInventoryIdentityText"
]);
var SOURCE_FILES = Object.freeze([
  "src/amounts.ts",
  "src/canonical.ts",
  "src/catalog.ts",
  "src/index.ts",
  "src/kernel.ts",
  "src/measurements.ts",
  "src/model.ts",
  "src/ordering.ts",
  "src/projection.ts",
  "src/quantity.ts",
  "src/selectors.ts",
  "src/usability.ts"
]);
var ALLOWED_STANDARD_OPERATIONS = Object.freeze([
  "Array.isArray",
  "BigInt",
  "Error",
  "JSON.stringify",
  "Map",
  "Math.abs",
  "Math.max",
  "Number",
  "Number.isFinite",
  "Number.isSafeInteger",
  "Object.keys",
  "RegExp.exec",
  "Set",
  "String",
  "Array.filter",
  "Array.includes",
  "Array.map",
  "Array.push",
  "Array.sort",
  "Map.get",
  "Map.set",
  "Set.add",
  "Set.has",
  "String.padStart",
  "String.slice",
  "String.trim"
]);
var FAMILY_LAWS = Object.freeze([
  {
    id: "exact-amount-resolution-v1",
    equation: "Measured inputs parse exact finite decimals, preserve axis/unit identity, reject duplicate or invalid axes, and resolve packages only through one exact retained revision; package multiplication and amount sums use aligned scaled-integer arithmetic and exact equality, with every membership, positivity, configured-axis, and whole-count guard preserved."
  },
  {
    id: "canonical-identity-v1",
    equation: "Identities reject empty or padded text, normalize qualified dimensions by code-unit order with duplicate rejection, and serialize fixed typed tuples; trace nodes enforce the lot-only item qualifier before serialization."
  },
  {
    id: "canonical-fingerprint-v1",
    equation: "Intent arrays reject undefined and non-finite numbers recursively before JSON serialization; metadata recursively emits key-sorted, delimiter-safe JSON fragments, rejects undefined and non-finite values, and preserves array order."
  },
  {
    id: "selector-normalization-v1",
    equation: "Selectors validate the item, sort/deduplicate every allowed identity set, reject empty/ambiguous constraints and duplicate qualified dimensions, then match or compare subsets independently for every fixed and qualified dimension with omitted constraints remaining broad."
  },
  {
    id: "effective-use-by-v1",
    equation: "Use-by is the lexicographically earlier defined value from the exact lot and container identities; expiry is inclusive and false when neither value exists."
  },
  {
    id: "exact-quantity-measurement-dependencies-v1",
    equation: "All supporting quantity and measurement helpers retain exact safe scaled-integer arithmetic, unit/precision guards, axis normalization, deterministic ordering, and fail-closed overflow or invalid-input behavior used by the amount laws."
  }
]);
function lawIdForEquation(equationId) {
  if (equationId.startsWith("src/amounts.ts#")) return "exact-amount-resolution-v1";
  if (equationId.startsWith("src/canonical.ts#")) return "canonical-fingerprint-v1";
  if (equationId.startsWith("src/selectors.ts#")) return "selector-normalization-v1";
  if (equationId.startsWith("src/usability.ts#")) return "effective-use-by-v1";
  if (equationId.startsWith("src/quantity.ts#") || equationId.startsWith("src/measurements.ts#") || equationId.startsWith("src/catalog.ts#")) {
    return "exact-quantity-measurement-dependencies-v1";
  }
  return "canonical-identity-v1";
}

// experiments/tla-conformance/identity-values-r7/family.mjs
var IDENTITY_VALUES_SOURCE_BASE = "2eea09471b3bf8fcb61f38256e1c6a362149dad4";
var identityValuesProofKind = "independent-identity-values-closed-equations-v1";
var equationProgramPath = fileURLToPath5(new URL("./equations.ts.txt", import.meta.url));
var producerFiles2 = Object.freeze([
  "experiments/tla-conformance/authority-r5/catalog-published-source-contracts.mjs",
  "experiments/tla-conformance/authority-r5/catalog-published-source-equations.mjs",
  "experiments/tla-conformance/identity-values-r7/contracts.mjs",
  "experiments/tla-conformance/identity-values-r7/equations.ts.txt",
  "experiments/tla-conformance/identity-values-r7/family.mjs",
  "experiments/tla-conformance/surface-bindings/lib/compiler-surface.mjs",
  "experiments/tla-conformance/value-contracts/catalog-family.mjs",
  "experiments/tla-conformance/value-contracts/surface-binding.mjs",
  "node_modules/typescript/lib/lib.es2015.collection.d.ts",
  "node_modules/typescript/lib/lib.es2015.core.d.ts",
  "node_modules/typescript/lib/lib.es2015.iterable.d.ts",
  "node_modules/typescript/lib/lib.es2016.array.include.d.ts",
  "node_modules/typescript/lib/lib.es2017.string.d.ts",
  "node_modules/typescript/lib/lib.es2020.bigint.d.ts",
  "node_modules/typescript/lib/lib.es2022.error.d.ts",
  "node_modules/typescript/lib/lib.es5.d.ts",
  "node_modules/typescript/package.json",
  "package.json",
  "tsconfig.json"
]);
var passCache2 = /* @__PURE__ */ new WeakMap();
function fail2(message) {
  throw new Error(`Identity/value equation rejected: ${message}`);
}
function operatorName(token) {
  return ts.tokenToString(token.kind) ?? ts.SyntaxKind[token.kind];
}
function isAssignmentOperator(kind) {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}
function normalizeIdentityValueCallable(declaration) {
  assert10(declaration.body !== void 0, "Equation callable needs a concrete body.");
  const counters = { local: 0, lambda: 0 };
  const environment = /* @__PURE__ */ new Map();
  function propertyName(name, scopedEnvironment) {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
      return ["fixed", name.text];
    }
    if (ts.isComputedPropertyName(name)) {
      return ["computed", expression(name.expression, scopedEnvironment)];
    }
    fail2(`unsupported property name '${name.getText()}'.`);
  }
  function bindingPattern(name, identity, scopedEnvironment) {
    if (ts.isIdentifier(name)) {
      scopedEnvironment.set(name.text, identity);
      return ["binding", identity];
    }
    if (ts.isObjectBindingPattern(name)) {
      return [
        "object-binding",
        name.elements.map((element, index) => {
          const property = element.propertyName === void 0 ? ts.isIdentifier(element.name) ? ["fixed", element.name.text] : ["position", index] : propertyName(element.propertyName, scopedEnvironment);
          const childIdentity = `${identity}.object:${index}`;
          const child = bindingPattern(element.name, childIdentity, scopedEnvironment);
          return [
            element.dotDotDotToken === void 0 ? "field" : "rest",
            property,
            child,
            element.initializer === void 0 ? ["no-default"] : expression(element.initializer, scopedEnvironment)
          ];
        })
      ];
    }
    if (ts.isArrayBindingPattern(name)) {
      return [
        "array-binding",
        name.elements.map((element, index) => {
          if (ts.isOmittedExpression(element)) return ["omitted", index];
          const childIdentity = `${identity}.array:${index}`;
          return [
            element.dotDotDotToken === void 0 ? "element" : "rest",
            bindingPattern(element.name, childIdentity, scopedEnvironment),
            element.initializer === void 0 ? ["no-default"] : expression(element.initializer, scopedEnvironment)
          ];
        })
      ];
    }
    fail2(`unsupported binding pattern '${name.getText()}'.`);
  }
  function expression(node, scopedEnvironment = environment) {
    if (ts.isParenthesizedExpression(node)) return expression(node.expression, scopedEnvironment);
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) {
      return expression(node.expression, scopedEnvironment);
    }
    if (node.kind === ts.SyntaxKind.ThisKeyword) return ["this"];
    if (ts.isIdentifier(node)) {
      return ["reference", scopedEnvironment.get(node.text) ?? `source:${node.text}`];
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return ["string", node.text];
    }
    if (ts.isNumericLiteral(node)) return ["number", node.text];
    if (ts.isBigIntLiteral(node)) return ["bigint", node.text];
    if (ts.isRegularExpressionLiteral(node)) return ["regexp", node.text];
    if (node.kind === ts.SyntaxKind.TrueKeyword) return ["boolean", true];
    if (node.kind === ts.SyntaxKind.FalseKeyword) return ["boolean", false];
    if (node.kind === ts.SyntaxKind.NullKeyword) return ["null"];
    if (ts.isPropertyAccessExpression(node)) {
      return [
        "property",
        expression(node.expression, scopedEnvironment),
        node.name.text,
        node.questionDotToken === void 0 ? "required" : "optional"
      ];
    }
    if (ts.isElementAccessExpression(node)) {
      assert10(node.argumentExpression !== void 0);
      return [
        "element",
        expression(node.expression, scopedEnvironment),
        expression(node.argumentExpression, scopedEnvironment),
        node.questionDotToken === void 0 ? "required" : "optional"
      ];
    }
    if (ts.isCallExpression(node)) {
      return [
        "call",
        expression(node.expression, scopedEnvironment),
        node.arguments.map((argument) => expression(argument, scopedEnvironment)),
        node.questionDotToken === void 0 ? "required" : "optional"
      ];
    }
    if (ts.isNewExpression(node)) {
      return [
        "new",
        expression(node.expression, scopedEnvironment),
        (node.arguments ?? []).map((argument) => expression(argument, scopedEnvironment))
      ];
    }
    if (ts.isBinaryExpression(node)) {
      return [
        "binary",
        operatorName(node.operatorToken),
        expression(node.left, scopedEnvironment),
        expression(node.right, scopedEnvironment)
      ];
    }
    if (ts.isConditionalExpression(node)) {
      return [
        "conditional",
        expression(node.condition, scopedEnvironment),
        expression(node.whenTrue, scopedEnvironment),
        expression(node.whenFalse, scopedEnvironment)
      ];
    }
    if (ts.isPrefixUnaryExpression(node)) {
      return [
        "prefix",
        ts.tokenToString(node.operator) ?? ts.SyntaxKind[node.operator],
        expression(node.operand, scopedEnvironment)
      ];
    }
    if (ts.isPostfixUnaryExpression(node)) {
      return [
        "postfix",
        ts.tokenToString(node.operator) ?? ts.SyntaxKind[node.operator],
        expression(node.operand, scopedEnvironment)
      ];
    }
    if (ts.isTypeOfExpression(node)) return ["typeof", expression(node.expression, scopedEnvironment)];
    if (ts.isVoidExpression(node)) return ["void", expression(node.expression, scopedEnvironment)];
    if (ts.isSpreadElement(node)) return ["spread", expression(node.expression, scopedEnvironment)];
    if (ts.isArrayLiteralExpression(node)) {
      return [
        "array",
        node.elements.map(
          (element) => ts.isOmittedExpression(element) ? ["omitted"] : expression(element, scopedEnvironment)
        )
      ];
    }
    if (ts.isObjectLiteralExpression(node)) {
      return [
        "record",
        node.properties.map((property) => {
          if (ts.isPropertyAssignment(property)) {
            return [
              "field",
              propertyName(property.name, scopedEnvironment),
              expression(property.initializer, scopedEnvironment)
            ];
          }
          if (ts.isShorthandPropertyAssignment(property)) {
            return [
              "field",
              ["fixed", property.name.text],
              expression(property.name, scopedEnvironment)
            ];
          }
          if (ts.isSpreadAssignment(property)) {
            return ["spread", expression(property.expression, scopedEnvironment)];
          }
          fail2(`unsupported object member '${property.getText()}'.`);
        })
      ];
    }
    if (ts.isArrowFunction(node)) {
      const childEnvironment = new Map(scopedEnvironment);
      const lambdaId = counters.lambda;
      counters.lambda += 1;
      const parameters2 = node.parameters.map((parameter, index) => ({
        pattern: bindingPattern(
          parameter.name,
          `lambda:${lambdaId}:${index}`,
          childEnvironment
        ),
        optional: parameter.questionToken !== void 0,
        rest: parameter.dotDotDotToken !== void 0,
        default: parameter.initializer === void 0 ? null : expression(parameter.initializer, childEnvironment)
      }));
      return [
        "lambda",
        parameters2,
        ts.isBlock(node.body) ? statement(node.body, childEnvironment) : expression(node.body, childEnvironment)
      ];
    }
    if (ts.isTemplateExpression(node)) {
      return [
        "template",
        node.head.text,
        node.templateSpans.map((span) => [
          expression(span.expression, scopedEnvironment),
          span.literal.text
        ])
      ];
    }
    fail2(`unsupported expression '${ts.SyntaxKind[node.kind]}': ${node.getText()}`);
  }
  function branch(node, scopedEnvironment) {
    return ts.isBlock(node) ? ["block", statements(node.statements, new Map(scopedEnvironment))] : ["single", statement(node, new Map(scopedEnvironment))];
  }
  function statements(sourceStatements, scopedEnvironment) {
    return sourceStatements.map(
      (sourceStatement) => statement(sourceStatement, scopedEnvironment)
    );
  }
  function variableDeclaration(declaration2, scopedEnvironment) {
    const initializer = declaration2.initializer === void 0 ? ["undefined"] : expression(declaration2.initializer, scopedEnvironment);
    const identity = `local:${counters.local}`;
    counters.local += 1;
    const pattern = bindingPattern(declaration2.name, identity, scopedEnvironment);
    return ["declaration", pattern, initializer];
  }
  function statement(node, scopedEnvironment = environment) {
    if (ts.isBlock(node)) {
      return ["block", statements(node.statements, new Map(scopedEnvironment))];
    }
    if (ts.isVariableStatement(node)) {
      const declarationKind = (node.declarationList.flags & ts.NodeFlags.Const) !== 0 ? "const" : (node.declarationList.flags & ts.NodeFlags.Let) !== 0 ? "let" : "var";
      return [
        "variables",
        declarationKind,
        node.declarationList.declarations.map(
          (declaration2) => variableDeclaration(declaration2, scopedEnvironment)
        )
      ];
    }
    if (ts.isIfStatement(node)) {
      return [
        "if",
        expression(node.expression, scopedEnvironment),
        branch(node.thenStatement, scopedEnvironment),
        node.elseStatement === void 0 ? ["no-else"] : branch(node.elseStatement, scopedEnvironment)
      ];
    }
    if (ts.isReturnStatement(node)) {
      return [
        "return",
        node.expression === void 0 ? ["undefined"] : expression(node.expression, scopedEnvironment)
      ];
    }
    if (ts.isThrowStatement(node)) {
      return ["throw", expression(node.expression, scopedEnvironment)];
    }
    if (ts.isExpressionStatement(node)) {
      return ["expression", expression(node.expression, scopedEnvironment)];
    }
    if (ts.isForOfStatement(node)) {
      const childEnvironment = new Map(scopedEnvironment);
      let initializer;
      if (ts.isVariableDeclarationList(node.initializer)) {
        const declarationKind = (node.initializer.flags & ts.NodeFlags.Const) !== 0 ? "const" : (node.initializer.flags & ts.NodeFlags.Let) !== 0 ? "let" : "var";
        initializer = [
          declarationKind,
          node.initializer.declarations.map(
            (declaration2) => variableDeclaration(declaration2, childEnvironment)
          )
        ];
      } else {
        initializer = ["assignment", expression(node.initializer, childEnvironment)];
      }
      return [
        "for-of",
        node.awaitModifier === void 0 ? "sync" : "await",
        initializer,
        expression(node.expression, scopedEnvironment),
        branch(node.statement, childEnvironment)
      ];
    }
    if (ts.isForStatement(node)) {
      const childEnvironment = new Map(scopedEnvironment);
      let initializer = ["none"];
      if (node.initializer !== void 0) {
        initializer = ts.isVariableDeclarationList(node.initializer) ? [
          (node.initializer.flags & ts.NodeFlags.Const) !== 0 ? "const" : (node.initializer.flags & ts.NodeFlags.Let) !== 0 ? "let" : "var",
          node.initializer.declarations.map(
            (declaration2) => variableDeclaration(declaration2, childEnvironment)
          )
        ] : ["expression", expression(node.initializer, childEnvironment)];
      }
      return [
        "for",
        initializer,
        node.condition === void 0 ? ["none"] : expression(node.condition, childEnvironment),
        node.incrementor === void 0 ? ["none"] : expression(node.incrementor, childEnvironment),
        branch(node.statement, childEnvironment)
      ];
    }
    if (ts.isContinueStatement(node)) return ["continue"];
    if (ts.isBreakStatement(node)) return ["break"];
    fail2(`unsupported statement '${ts.SyntaxKind[node.kind]}': ${node.getText()}`);
  }
  const parameters = declaration.parameters.map((parameter, index) => ({
    pattern: bindingPattern(parameter.name, `parameter:${index}`, environment),
    optional: parameter.questionToken !== void 0,
    rest: parameter.dotDotDotToken !== void 0,
    default: parameter.initializer === void 0 ? null : expression(parameter.initializer, environment)
  }));
  return {
    async: declaration.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword
    ) ?? false,
    generator: declaration.asteriskToken !== void 0,
    parameters,
    body: ["block", statements(declaration.body.statements, environment)]
  };
}
function declarationKey2(repositoryRoot, declaration) {
  const source7 = declaration.getSourceFile();
  const file = path12.relative(repositoryRoot, source7.fileName).replaceAll("\\", "/");
  const owner = ts.isMethodDeclaration(declaration) ? `${declaration.parent.name?.getText(source7)}.` : "";
  return `${file}#${owner}${declaration.name?.getText(source7)}`;
}
function findCallable(sourceByFile, specificationSource, equationId) {
  const [file, qualifiedName] = equationId.split("#");
  const source7 = specificationSource ?? sourceByFile.get(file);
  assert10(source7 !== void 0, `Missing equation source '${file}'.`);
  const pieces = qualifiedName.split(".");
  if (pieces.length === 1) {
    const matches = source7.statements.filter(
      (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === qualifiedName && statement.body !== void 0
    );
    assert10.equal(matches.length, 1, `Expected one function '${equationId}'.`);
    return matches[0];
  }
  const [className, methodName] = pieces;
  const classes = source7.statements.filter(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === className
  );
  assert10.equal(classes.length, 1, `Expected one class '${className}'.`);
  const methods = classes[0].members.filter(
    (member2) => ts.isMethodDeclaration(member2) && ts.isIdentifier(member2.name) && member2.name.text === methodName && member2.body !== void 0
  );
  assert10.equal(methods.length, 1, `Expected one method '${equationId}'.`);
  return methods[0];
}
function findSupportingValue(sourceByFile, specificationSource, valueId) {
  const [file, name] = valueId.split("#");
  const source7 = specificationSource ?? sourceByFile.get(file);
  assert10(source7 !== void 0, `Missing supporting-value source '${file}'.`);
  const matches = source7.statements.filter((statement) => {
    if (ts.isEnumDeclaration(statement)) return statement.name.text === name;
    if (!ts.isVariableStatement(statement)) return false;
    return statement.declarationList.declarations.some(
      (declaration2) => ts.isIdentifier(declaration2.name) && declaration2.name.text === name
    );
  });
  assert10.equal(matches.length, 1, `Expected one supporting value '${valueId}'.`);
  if (ts.isEnumDeclaration(matches[0])) return matches[0];
  const declaration = matches[0].declarationList.declarations.find(
    (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name
  );
  assert10(declaration !== void 0);
  return declaration;
}
function normalizeSupportingValue(declaration) {
  if (ts.isEnumDeclaration(declaration)) {
    return [
      "enum",
      declaration.members.map((member2) => [
        member2.name.getText(declaration.getSourceFile()),
        member2.initializer?.getText(declaration.getSourceFile()) ?? null
      ])
    ];
  }
  assert10(ts.isVariableDeclaration(declaration));
  assert10(declaration.initializer !== void 0, "Supporting constant needs an initializer.");
  if (ts.isNumericLiteral(declaration.initializer)) {
    return ["constant-number", declaration.initializer.text];
  }
  fail2(`unsupported supporting value '${declaration.getText()}'.`);
}
function resolveSymbol2(context, symbol) {
  return symbol !== void 0 && (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? context.checker.getAliasedSymbol(symbol) : symbol;
}
function visitRuntime(node, visitor) {
  if (ts.isTypeNode(node)) return;
  visitor(node);
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) {
    visitRuntime(node.expression, visitor);
    return;
  }
  ts.forEachChild(node, (child) => visitRuntime(child, visitor));
}
function sourceCallableDeclaration(context, symbol) {
  const resolved = resolveSymbol2(context, symbol);
  const callables = (resolved?.declarations ?? []).filter(
    (declaration) => !declaration.getSourceFile().isDeclarationFile && (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) && declaration.body !== void 0
  );
  if (callables.length === 0) return void 0;
  assert10.equal(callables.length, 1, "Source callable symbol has ambiguous bodies.");
  return callables[0];
}
function sourceSupportingValueId(repositoryRoot, declaration) {
  if (declaration.getSourceFile().isDeclarationFile) return void 0;
  let owner = declaration;
  if (ts.isEnumMember(owner)) owner = owner.parent;
  if (!ts.isEnumDeclaration(owner) && !ts.isVariableDeclaration(owner)) return void 0;
  if (ts.isVariableDeclaration(owner) && !ts.isSourceFile(owner.parent.parent.parent)) {
    return void 0;
  }
  const source7 = owner.getSourceFile();
  const file = path12.relative(repositoryRoot, source7.fileName).replaceAll("\\", "/");
  const name = owner.name?.getText(source7);
  return name === void 0 ? void 0 : `${file}#${name}`;
}
function trustedTypeScriptLibraryDirectory(repositoryRoot) {
  const packagePath = fs9.realpathSync(
    path12.resolve(repositoryRoot, "node_modules/typescript/package.json")
  );
  return fs9.realpathSync(path12.join(path12.dirname(packagePath), "lib"));
}
function requireTrustedTypeScriptLibraryFile(repositoryRoot, fileName) {
  const trustedDirectory = trustedTypeScriptLibraryDirectory(repositoryRoot);
  const actualFile = fs9.realpathSync(fileName);
  if (!actualFile.startsWith(`${trustedDirectory}${path12.sep}`) || !/^lib\.[^.].*\.d\.ts$/u.test(path12.basename(actualFile))) {
    fail2(`declaration '${fileName}' is outside the trusted TypeScript library.`);
  }
  return actualFile;
}
function validateStandardRootIdentity(context, call) {
  const expression = call.expression;
  let root3;
  if (ts.isIdentifier(expression)) {
    root3 = expression;
  } else if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && ["Array", "JSON", "Math", "Number", "Object"].includes(expression.expression.text)) {
    root3 = expression.expression;
  }
  if (root3 === void 0) return;
  const symbol = resolveSymbol2(context, context.checker.getSymbolAtLocation(root3));
  if (symbol === void 0 || (symbol.declarations ?? []).length === 0) {
    fail2(`standard root '${root3.text}' has no compiler declaration identity.`);
  }
  const runtimeDeclarations = symbol.declarations.filter(
    (declaration) => ts.isVariableDeclaration(declaration) || ts.isFunctionDeclaration(declaration) || ts.isClassDeclaration(declaration) || ts.isEnumDeclaration(declaration)
  );
  if (runtimeDeclarations.length === 0) {
    fail2(`standard root '${root3.text}' has no runtime value declaration.`);
  }
  for (const declaration of runtimeDeclarations) {
    if (!declaration.getSourceFile().isDeclarationFile) {
      fail2(`standard root '${root3.text}' was replaced by package source.`);
    }
    requireTrustedTypeScriptLibraryFile(
      context.repositoryRoot,
      declaration.getSourceFile().fileName
    );
  }
}
function standardOperation(context, call, target) {
  const sourceFile3 = target.getSourceFile().fileName;
  requireTrustedTypeScriptLibraryFile(context.repositoryRoot, sourceFile3);
  validateStandardRootIdentity(context, call);
  const expression = call.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (!ts.isPropertyAccessExpression(expression)) {
    fail2(`dynamic standard call '${expression.getText()}' is outside the equation domain.`);
  }
  if (ts.isIdentifier(expression.expression)) {
    const root3 = expression.expression.text;
    if (["Array", "JSON", "Math", "Number", "Object"].includes(root3)) {
      return `${root3}.${expression.name.text}`;
    }
  }
  let ownerName = target.parent?.name?.getText(target.getSourceFile());
  if (ownerName === "ReadonlyArray") ownerName = "Array";
  if (ownerName === "ReadonlyMap") ownerName = "Map";
  if (ownerName === void 0 && ts.isRegularExpressionLiteral(expression.expression)) {
    ownerName = "RegExp";
  }
  if (ownerName === void 0) {
    fail2(`standard call '${expression.getText()}' has no fixed receiver declaration.`);
  }
  return `${ownerName}.${expression.name.text}`;
}
function expectedStandardOperation(call, sourceFunctionNames, sourceMethodNames) {
  const expression = call.expression;
  if (ts.isIdentifier(expression)) {
    if (sourceFunctionNames.has(expression.text)) return void 0;
    return expression.text;
  }
  if (!ts.isPropertyAccessExpression(expression)) return "UNSUPPORTED_DYNAMIC_CALL";
  if (sourceMethodNames.has(expression.name.text)) return void 0;
  if (ts.isIdentifier(expression.expression)) {
    const root3 = expression.expression.text;
    if (["Array", "JSON", "Math", "Number", "Object"].includes(root3)) {
      return `${root3}.${expression.name.text}`;
    }
  }
  const methodOwner = /* @__PURE__ */ new Map([
    ["filter", "Array"],
    ["includes", "Array"],
    ["map", "Array"],
    ["push", "Array"],
    ["sort", "Array"],
    ["get", "Map"],
    ["set", "Map"],
    ["add", "Set"],
    ["has", "Set"],
    ["padStart", "String"],
    ["slice", "String"],
    ["trim", "String"],
    ["exec", "RegExp"]
  ]);
  const owner = methodOwner.get(expression.name.text);
  return owner === void 0 ? `UNSUPPORTED.${expression.name.text}` : `${owner}.${expression.name.text}`;
}
function expectedDependencies(specificationSource, expectedById) {
  const functionIdByName = /* @__PURE__ */ new Map();
  const methodIdByName = /* @__PURE__ */ new Map();
  for (const equationId of EQUATION_IDS) {
    const qualifiedName = equationId.split("#")[1];
    const pieces = qualifiedName.split(".");
    const name = pieces.at(-1);
    (pieces.length === 2 ? methodIdByName : functionIdByName).set(name, equationId);
  }
  const supportingIdByName = new Map(
    SUPPORTING_VALUE_IDS.map((valueId) => [valueId.split("#")[1], valueId])
  );
  const byEquation = /* @__PURE__ */ new Map();
  for (const [equationId, declaration] of expectedById) {
    const sourceDependencies = /* @__PURE__ */ new Set();
    const supportingValues = /* @__PURE__ */ new Set();
    const standardOperations = /* @__PURE__ */ new Set();
    visitRuntime(declaration.body, (node) => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        if (ts.isIdentifier(node.expression)) {
          const dependency2 = functionIdByName.get(node.expression.text);
          if (dependency2 !== void 0) sourceDependencies.add(dependency2);
        } else if (ts.isPropertyAccessExpression(node.expression)) {
          const dependency2 = methodIdByName.get(node.expression.name.text);
          if (dependency2 !== void 0) sourceDependencies.add(dependency2);
        }
        const operation = expectedStandardOperation(
          node,
          new Set(functionIdByName.keys()),
          new Set(methodIdByName.keys())
        );
        if (operation !== void 0) standardOperations.add(operation);
      }
      if (ts.isIdentifier(node)) {
        const dependency2 = functionIdByName.get(node.text);
        if (dependency2 !== void 0 && ((ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent)) && node.parent.arguments?.includes(node))) {
          sourceDependencies.add(dependency2);
        }
        const supporting = supportingIdByName.get(node.text);
        if (supporting !== void 0) supportingValues.add(supporting);
      }
    });
    byEquation.set(equationId, {
      sourceDependencies: [...sourceDependencies].sort(compareCodeUnits),
      supportingValues: [...supportingValues].sort(compareCodeUnits),
      standardOperations: [...standardOperations].sort(compareCodeUnits)
    });
  }
  return byEquation;
}
function validateNoExternalEffects(context, declaration, callOperations) {
  const localSymbols = /* @__PURE__ */ new Set();
  const freshLocalSymbols = /* @__PURE__ */ new Set();
  function isFreshLocalInitializer(initializer) {
    if (ts.isAsExpression(initializer) || ts.isTypeAssertionExpression(initializer) || ts.isNonNullExpression(initializer)) {
      return isFreshLocalInitializer(initializer.expression);
    }
    if (ts.isArrayLiteralExpression(initializer) || ts.isObjectLiteralExpression(initializer)) {
      return true;
    }
    if (ts.isNewExpression(initializer) && ts.isIdentifier(initializer.expression) && ["Map", "Set"].includes(initializer.expression.text)) {
      return true;
    }
    return ts.isCallExpression(initializer) && ts.isPropertyAccessExpression(initializer.expression) && ts.isIdentifier(initializer.expression.expression) && initializer.expression.expression.text === "Object" && initializer.expression.name.text === "keys";
  }
  visitRuntime(declaration.body, (node) => {
    if (ts.isVariableDeclaration(node)) {
      const collect = (name) => {
        if (ts.isIdentifier(name)) {
          const symbol = context.checker.getSymbolAtLocation(name);
          if (symbol !== void 0) localSymbols.add(symbol);
        } else {
          for (const element of name.elements) {
            if (!ts.isOmittedExpression(element)) collect(element.name);
          }
        }
      };
      collect(node.name);
      if (ts.isIdentifier(node.name) && node.initializer !== void 0 && isFreshLocalInitializer(node.initializer)) {
        const symbol = context.checker.getSymbolAtLocation(node.name);
        if (symbol !== void 0) freshLocalSymbols.add(symbol);
      }
    }
  });
  const mutationOperations = /* @__PURE__ */ new Set(["Array.push", "Array.sort", "Map.set", "Set.add"]);
  visitRuntime(declaration.body, (node) => {
    if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      if (!ts.isIdentifier(node.left)) fail2(`property or non-local assignment '${node.getText()}'.`);
      const symbol = context.checker.getSymbolAtLocation(node.left);
      if (symbol === void 0 || !localSymbols.has(symbol)) {
        fail2(`assignment escapes fresh local storage: '${node.getText()}'.`);
      }
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) {
      if (!ts.isIdentifier(node.operand)) fail2(`non-local update '${node.getText()}'.`);
      const symbol = context.checker.getSymbolAtLocation(node.operand);
      if (symbol === void 0 || !localSymbols.has(symbol)) {
        fail2(`update escapes fresh local storage: '${node.getText()}'.`);
      }
    }
  });
  for (const { call, operation } of callOperations) {
    if (!mutationOperations.has(operation)) continue;
    assert10(ts.isPropertyAccessExpression(call.expression));
    const receiver = call.expression.expression;
    if (!ts.isIdentifier(receiver)) {
      fail2(`mutating built-in '${call.expression.getText()}' has a non-local receiver.`);
    }
    const symbol = context.checker.getSymbolAtLocation(receiver);
    if (symbol === void 0 || !freshLocalSymbols.has(symbol)) {
      fail2(`mutating built-in '${call.expression.getText()}' escapes fresh local storage.`);
    }
  }
}
function inspectActualEquation(context, repositoryRoot, declaration) {
  const sourceDependencies = /* @__PURE__ */ new Set();
  const supportingValues = /* @__PURE__ */ new Set();
  const standardOperations = /* @__PURE__ */ new Set();
  const standardDeclarations = /* @__PURE__ */ new Map();
  const discoveredCallables = /* @__PURE__ */ new Map();
  const callOperations = [];
  visitRuntime(declaration.body, (node) => {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const symbolNode = ts.isPropertyAccessExpression(node) ? node.name : node.argumentExpression;
      const symbol = symbolNode === void 0 ? void 0 : resolveSymbol2(context, context.checker.getSymbolAtLocation(symbolNode));
      for (const candidate of symbol?.declarations ?? []) {
        if (ts.isGetAccessorDeclaration(candidate) || ts.isSetAccessorDeclaration(candidate)) {
          fail2(`accessor-backed value '${node.getText()}' is outside the immutable data domain.`);
        }
      }
    }
    if (ts.isIdentifier(node)) {
      const symbol = resolveSymbol2(context, context.checker.getSymbolAtLocation(node));
      const callable = sourceCallableDeclaration(context, symbol);
      if (callable !== void 0 && callable !== declaration) {
        const key = declarationKey2(repositoryRoot, callable);
        sourceDependencies.add(key);
        discoveredCallables.set(key, callable);
      }
      for (const candidate of symbol?.declarations ?? []) {
        const valueId = sourceSupportingValueId(repositoryRoot, candidate);
        if (valueId !== void 0) {
          if (!SUPPORTING_VALUE_IDS.includes(valueId)) {
            fail2(`unknown nonlocal runtime value '${valueId}' in '${declarationKey2(repositoryRoot, declaration)}'.`);
          }
          supportingValues.add(valueId);
        }
      }
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const target = context.checker.getResolvedSignature(node)?.declaration;
      if (target === void 0) fail2(`unresolved call '${node.getText()}'.`);
      if (target.getSourceFile().isDeclarationFile) {
        const operation = standardOperation(context, node, target);
        if (!ALLOWED_STANDARD_OPERATIONS.includes(operation)) {
          fail2(`standard operation '${operation}' is not independently admitted.`);
        }
        standardOperations.add(operation);
        callOperations.push({ call: node, operation });
        const targetSpan = spanOf(context, target);
        standardDeclarations.set(
          `${operation}:${targetSpan.file}:${targetSpan.start.offset}`,
          { operation, declaration: targetSpan }
        );
      } else if ((ts.isFunctionDeclaration(target) || ts.isMethodDeclaration(target)) && target.body !== void 0) {
        const key = declarationKey2(repositoryRoot, target);
        sourceDependencies.add(key);
        discoveredCallables.set(key, target);
      } else {
        fail2(`source call '${node.getText()}' has no independently checked ordinary body.`);
      }
    }
  });
  validateNoExternalEffects(context, declaration, callOperations);
  return {
    sourceDependencies: [...sourceDependencies].sort(compareCodeUnits),
    supportingValues: [...supportingValues].sort(compareCodeUnits),
    standardOperations: [...standardOperations].sort(compareCodeUnits),
    standardDeclarations: [...standardDeclarations.values()].sort(
      (left, right) => compareCodeUnits(
        `${left.operation}:${left.declaration.file}:${left.declaration.start.offset}`,
        `${right.operation}:${right.declaration.file}:${right.declaration.start.offset}`
      )
    ),
    discoveredCallables
  };
}
function loadOverriddenContext(repositoryRoot, sourceOverrides) {
  const root3 = path12.resolve(repositoryRoot);
  for (const file of sourceOverrides.keys()) {
    if (!SOURCE_FILES.includes(file)) fail2(`source override '${file}' is outside the closed family.`);
  }
  const configPath = path12.join(root3, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error !== void 0) fail2("cannot read TypeScript configuration for mutation control.");
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root3, void 0, configPath);
  if (parsed.errors.length !== 0) fail2("TypeScript configuration diagnostics changed.");
  const overridesByAbsolutePath = new Map(
    [...sourceOverrides].map(([file, text]) => [path12.resolve(root3, file), text])
  );
  const host = ts.createCompilerHost(parsed.options, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const override = overridesByAbsolutePath.get(path12.resolve(fileName));
    return override === void 0 ? originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) : ts.createSourceFile(fileName, override, languageVersion, true, ts.ScriptKind.TS);
  };
  host.readFile = (fileName) => overridesByAbsolutePath.get(path12.resolve(fileName)) ?? ts.sys.readFile(fileName);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, host });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length !== 0) {
    fail2(`mutated compiler program has ${diagnostics.length} diagnostic(s).`);
  }
  return {
    repositoryRoot: root3,
    program,
    checker: program.getTypeChecker()
  };
}
function loadSpecification() {
  const bytes2 = fs9.readFileSync(equationProgramPath);
  const source7 = ts.createSourceFile(
    equationProgramPath,
    bytes2.toString("utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  assert10.equal(source7.parseDiagnostics.length, 0, "Independent equation program has syntax errors.");
  return { bytes: bytes2, source: source7 };
}
function equationIdForCallable(repositoryRoot, declaration) {
  const key = declarationKey2(repositoryRoot, declaration);
  assert10(EQUATION_IDS.includes(key), `Assigned callable resolved outside the equation family: ${key}`);
  return key;
}
function reusedCatalogEquation(catalogArtifact, equationId, implementationSpan) {
  const helper = catalogArtifact.helperEquations.find((row) => row.key === equationId);
  if (helper !== void 0) {
    assert10.deepEqual(helper.declaration, implementationSpan, `Reused catalog helper span changed: ${equationId}`);
    return {
      kind: "CATALOG_HELPER_EQUATION",
      term: helper.term,
      declaration: helper.declaration
    };
  }
  const proofs = catalogArtifact.proofs.filter(
    (proof) => proof.implementation.file === implementationSpan.file && proof.implementation.start.offset === implementationSpan.start.offset && proof.implementation.end.offset === implementationSpan.end.offset
  );
  assert10.equal(proofs.length, 1, `Expected one reused catalog proof for '${equationId}'.`);
  return {
    kind: "CATALOG_PUBLIC_EQUATION",
    term: proofs[0].term,
    declaration: proofs[0].implementation,
    sourceSurfaceKey: proofs[0].surfaceKey
  };
}
function buildIdentityValuesFamilyArtifact({
  repositoryRoot,
  context,
  surface,
  sourceOverrides = /* @__PURE__ */ new Map()
}) {
  const root3 = path12.resolve(repositoryRoot);
  assert10.equal(ASSIGNED_SURFACE_KEYS.length, 40);
  assert10.equal(new Set(ASSIGNED_SURFACE_KEYS).size, 40);
  assert10.equal(EQUATION_IDS.length, 75);
  assert10.equal(new Set(EQUATION_IDS).size, 75);
  const { bytes: specificationBytes, source: specificationSource } = loadSpecification();
  const catalogSourceFiles = /* @__PURE__ */ new Set(["src/catalog.ts", "src/facade.ts", "src/model.ts", "src/ordering.ts"]);
  const catalogOverrides = new Map(
    [...sourceOverrides].filter(([file]) => catalogSourceFiles.has(file))
  );
  const catalogArtifact = buildCatalogFamilyArtifact({
    repositoryRoot: root3,
    context,
    surface,
    sourceOverrides: catalogOverrides
  });
  const catalogArtifactDigest = sha256(canonicalJson(catalogArtifact));
  const inputFiles2 = [.../* @__PURE__ */ new Set([...SOURCE_FILES, ...producerFiles2])].sort(compareCodeUnits);
  const inputByFile = new Map(inputFiles2.map((file) => [file, {
    file,
    sha256: sha256(sourceOverrides.get(file) ?? fs9.readFileSync(path12.resolve(root3, file)))
  }]));
  for (const input2 of catalogArtifact.inputs) {
    const existing = inputByFile.get(input2.file);
    if (existing !== void 0) {
      assert10.equal(existing.sha256, input2.sha256, `Reused catalog input changed: ${input2.file}`);
    } else {
      inputByFile.set(input2.file, input2);
    }
  }
  const inputs3 = [...inputByFile.values()].sort(
    (left, right) => compareCodeUnits(left.file, right.file)
  );
  const cacheKey = sha256(
    canonicalJson({ surface: surface.digest, inputs: inputs3, catalogArtifactDigest })
  );
  const old = sourceOverrides.size === 0 ? passCache2.get(context) : void 0;
  if (old?.key === cacheKey) return old.value;
  const activeContext = sourceOverrides.size === 0 ? context : loadOverriddenContext(root3, sourceOverrides);
  assert10.equal(path12.resolve(activeContext.repositoryRoot), root3);
  const sourceByFile = new Map(
    SOURCE_FILES.map((file) => {
      const source7 = activeContext.program.getSourceFile(path12.resolve(root3, file));
      assert10(source7 !== void 0 && !source7.isDeclarationFile, `Missing compiler source '${file}'.`);
      return [file, source7];
    })
  );
  const expectedById = new Map(
    EQUATION_IDS.filter(
      (equationId) => !REUSED_CATALOG_EQUATION_IDS.includes(equationId)
    ).map((equationId) => [
      equationId,
      findCallable(sourceByFile, specificationSource, equationId)
    ])
  );
  const expectedDependencyById = expectedDependencies(specificationSource, expectedById);
  const actualById = /* @__PURE__ */ new Map();
  const pending = [];
  const callableByKey = new Map(surface.callables.map((callable) => [callable.key, callable]));
  const publicProofSeeds = [];
  for (const surfaceKey of ASSIGNED_SURFACE_KEYS) {
    const callable = callableByKey.get(surfaceKey);
    assert10(callable !== void 0, `Compiler omitted assigned callable '${surfaceKey}'.`);
    assert10.equal(
      callable.signatureHash,
      sha256(canonicalJson(callable.signature)),
      `Compiler signature identity drifted for '${surfaceKey}'.`
    );
    let implementation;
    if (sourceOverrides.size === 0) {
      const source7 = sourceByFile.get(callable.declaration.file);
      assert10(source7 !== void 0, `Callable source is outside the closed family: ${surfaceKey}`);
      implementation = nodeAtExactSpan(
        source7,
        callable.declaration.start.offset,
        callable.declaration.end.offset
      );
      assert10(
        implementation !== void 0 && ts.isFunctionDeclaration(implementation) && implementation.body !== void 0,
        `Callable '${surfaceKey}' is not one exact source function.`
      );
      assert10.deepEqual(callable.declaration, spanOf(activeContext, implementation));
    } else {
      const functionName = surfaceKey.slice(surfaceKey.indexOf("#") + 1, surfaceKey.indexOf("::"));
      const possibleIds = EQUATION_IDS.filter((equationId2) => equationId2.endsWith(`#${functionName}`));
      assert10.equal(possibleIds.length, 1, `Mutation control cannot locate '${functionName}'.`);
      implementation = findCallable(sourceByFile, void 0, possibleIds[0]);
    }
    const equationId = equationIdForCallable(root3, implementation);
    pending.push(implementation);
    publicProofSeeds.push({ surfaceKey, callable, implementation, equationId });
  }
  while (pending.length > 0) {
    const declaration = pending.shift();
    const equationId = declarationKey2(root3, declaration);
    if (actualById.has(equationId)) continue;
    const inspected = inspectActualEquation(activeContext, root3, declaration);
    actualById.set(equationId, { declaration, inspected });
    for (const dependency2 of inspected.discoveredCallables.values()) {
      pending.push(dependency2);
    }
  }
  assert10.deepEqual(
    [...actualById.keys()].sort(compareCodeUnits),
    [...EQUATION_IDS].sort(compareCodeUnits),
    "The compiler-resolved transitive source-callable closure changed."
  );
  const supportingValues = SUPPORTING_VALUE_IDS.map((valueId) => {
    const expected = findSupportingValue(sourceByFile, specificationSource, valueId);
    const actual = findSupportingValue(sourceByFile, void 0, valueId);
    const expectedTerm = normalizeSupportingValue(expected);
    const actualTerm = normalizeSupportingValue(actual);
    assert10.deepEqual(actualTerm, expectedTerm, `Supporting runtime value changed: ${valueId}`);
    return {
      id: valueId,
      declaration: spanOf(activeContext, actual),
      term: expectedTerm
    };
  });
  const equations2 = EQUATION_IDS.map((equationId) => {
    const actualRow = actualById.get(equationId);
    assert10(actualRow !== void 0);
    const actualSpan = spanOf(activeContext, actualRow.declaration);
    if (REUSED_CATALOG_EQUATION_IDS.includes(equationId)) {
      const reused = reusedCatalogEquation(catalogArtifact, equationId, actualSpan);
      return {
        id: equationId,
        lawId: lawIdForEquation(equationId),
        declaration: actualSpan,
        term: reused.term,
        dependencies: actualRow.inspected.sourceDependencies,
        supportingValues: actualRow.inspected.supportingValues,
        standardOperations: actualRow.inspected.standardOperations,
        standardDeclarations: actualRow.inspected.standardDeclarations,
        reusedFrom: {
          proofKind: catalogProofKind,
          artifactSha256: catalogArtifactDigest,
          relation: reused.kind,
          ...reused.sourceSurfaceKey === void 0 ? {} : { sourceSurfaceKey: reused.sourceSurfaceKey }
        }
      };
    }
    const expectedDeclaration = expectedById.get(equationId);
    assert10(expectedDeclaration !== void 0);
    const expectedTerm = normalizeIdentityValueCallable(expectedDeclaration);
    const actualTerm = normalizeIdentityValueCallable(actualRow.declaration);
    assert10.deepEqual(actualTerm, expectedTerm, `Independent equation changed: ${equationId}`);
    const expectedDependency = expectedDependencyById.get(equationId);
    assert10(expectedDependency !== void 0);
    assert10.deepEqual(
      actualRow.inspected.sourceDependencies,
      expectedDependency.sourceDependencies,
      `Compiler-resolved source dependency changed: ${equationId}`
    );
    assert10.deepEqual(
      actualRow.inspected.supportingValues,
      expectedDependency.supportingValues,
      `Compiler-resolved free value changed: ${equationId}`
    );
    assert10.deepEqual(
      actualRow.inspected.standardOperations,
      expectedDependency.standardOperations,
      `Compiler-resolved standard operation changed: ${equationId}`
    );
    return {
      id: equationId,
      lawId: lawIdForEquation(equationId),
      declaration: actualSpan,
      term: expectedTerm,
      dependencies: expectedDependency.sourceDependencies,
      supportingValues: expectedDependency.supportingValues,
      standardOperations: expectedDependency.standardOperations,
      standardDeclarations: actualRow.inspected.standardDeclarations
    };
  });
  const equationById2 = new Map(equations2.map((equation3) => [equation3.id, equation3]));
  const proofs = publicProofSeeds.map(({ surfaceKey, callable, implementation, equationId }) => ({
    surfaceKey,
    signatureHash: callable.signatureHash,
    signature: callable.signature,
    declaration: callable.declaration,
    implementation: spanOf(activeContext, implementation),
    relation: sourceOverrides.size === 0 ? {
      kind: "COMPILER_RESOLVED_EXACT_EXPORT",
      reachabilityPaths: callable.reachabilityPaths,
      symbolDeclarations: callable.symbolDeclarations
    } : { kind: "MUTATION_CONTROL_ONLY" },
    equationId,
    lawId: equationById2.get(equationId).lawId,
    dependencies: equationById2.get(equationId).dependencies
  }));
  assert10.deepEqual(
    proofs.map((proof) => proof.surfaceKey),
    ASSIGNED_SURFACE_KEYS,
    "Public proof order or identity changed."
  );
  const uniqueImplementations = new Set(proofs.map((proof) => proof.equationId));
  assert10.equal(uniqueImplementations.size, 27, "Assigned aliases no longer share 27 exact implementations.");
  const allStandardOperations = new Set(
    equations2.flatMap((equation3) => equation3.standardOperations)
  );
  assert10.deepEqual(
    [...allStandardOperations].sort(compareCodeUnits),
    [...ALLOWED_STANDARD_OPERATIONS].sort(compareCodeUnits),
    "Declared immutable standard-operation domain differs from the equation closure."
  );
  const result = {
    schemaVersion: 1,
    mode: "V",
    proofKind: identityValuesProofKind,
    familyId: IDENTITY_VALUES_FAMILY_ID,
    sourceBase: IDENTITY_VALUES_SOURCE_BASE,
    surfaceDigest: surface.digest,
    domain: {
      id: "VALIDATED_IMMUTABLE_IDENTITY_AMOUNT_SELECTOR_VALUES_V1",
      quantified: "Every input satisfying the published TypeScript shapes and the guards in these equations; no fixture or finite sample restriction.",
      arithmetic: "Safe scaled integers and bigint intermediates only; units and decimal precision are exact and every overflow, sign, whole-count, required-axis, and mismatch guard remains part of the equation.",
      data: "Non-proxied plain records plus ordinary native Array, Map, Set, String, RegExp, JSON, Math, Number, BigInt, Object, and Error semantics, with the input graph immutable for the duration of a call.",
      catalog: "Only exact validated InventoryCatalog instances with unshadowed itemRevision and packagingRevision methods and unchanged private maps/retained arrays.",
      mutation: "Only fresh local arrays, maps, sets, and scalar locals are mutated; caller-owned values, catalog state, projections, and prototypes are read-only."
    },
    excluded: [
      "Proxies, accessors, subclasses, monkey-patched built-ins, custom collection/string lookalikes, and own-property method shadowing.",
      "Concurrent mutation of inputs or catalog/projection state during a call.",
      "Structurally injected catalog objects that were not produced by the validated InventoryCatalog constructor path."
    ],
    allAdmittedInputs: true,
    sampledInputs: 0,
    sourceCallableClosureComplete: true,
    sourceCallableClosureCount: equations2.length,
    assignedSurfaceCount: proofs.length,
    uniqueImplementationCount: uniqueImplementations.size,
    inputs: inputs3,
    specification: {
      file: path12.relative(root3, equationProgramPath).replaceAll("\\", "/"),
      sha256: sha256(specificationBytes),
      independentlyDeclared: true,
      executedProductionCode: false
    },
    reusedCertificates: [
      {
        proofKind: catalogProofKind,
        artifactSha256: catalogArtifactDigest,
        surfaceDigest: catalogArtifact.surfaceDigest,
        equationIds: REUSED_CATALOG_EQUATION_IDS
      }
    ],
    laws: FAMILY_LAWS,
    supportingValues,
    equations: equations2,
    proofs
  };
  if (sourceOverrides.size === 0) passCache2.set(context, { key: cacheKey, value: result });
  return result;
}
var buildFamilyArtifact2 = buildIdentityValuesFamilyArtifact;
var supportedSurfaceKeys2 = ASSIGNED_SURFACE_KEYS;

// experiments/tla-conformance/quantity-values-r7/certificate.mjs
import assert11 from "node:assert/strict";
import fs10 from "node:fs";
import path13 from "node:path";
import { fileURLToPath as fileURLToPath6 } from "node:url";

// experiments/tla-conformance/quantity-values-r7/contracts.mjs
var QUANTITY_VALUES_PROOF_KIND = "inventoryonce-quantity-measurement-complete-source-equations-v1";
var FAMILY_SOURCE_FILES = Object.freeze([
  "src/canonical.ts",
  "src/measurements.ts",
  "src/ordering.ts",
  "src/quantity.ts"
]);
var QUANTITY_MEMBER_NAMES = Object.freeze([
  "addQuantity",
  "assertSameUnit",
  "compareQuantity",
  "convertQuantityByReferenceExact",
  "convertQuantityExact",
  "integerAtDecimals",
  "leastCommonQuantityMultiple",
  "multiplyQuantityByFactor",
  "multiplyQuantityByWholeNumber",
  "negateQuantity",
  "parseQuantity",
  "positiveQuantity",
  "quantity",
  "quantityEq",
  "quantityIsWholeMultipleOf",
  "quantityRatio",
  "quantityToDecimalString",
  "quantityWholeMultipleCount",
  "safeNumber",
  "subtractQuantity",
  "unitCode",
  "zeroQuantity"
]);
var MEASUREMENT_MEMBER_NAMES = Object.freeze([
  "addInventoryMeasurements",
  "assertInventoryMeasurementsFollowPrimarySign",
  "assertWholeMeasurementMultiple",
  "inventoryMeasurement",
  "inventoryMeasurementAt",
  "inventoryMeasurementVector",
  "inventoryMeasurementsAreZero",
  "inventoryMeasurementsEqual",
  "inventoryMeasurementsFingerprint",
  "multiplyInventoryMeasurementsByWholeNumber",
  "negateInventoryMeasurements",
  "nonNegativeInventoryMeasurements",
  "positiveInventoryMeasurements",
  "scalarInventoryMeasurements",
  "subtractInventoryMeasurements",
  "zeroInventoryMeasurements"
]);
var MEMBER_SOURCE_BY_NAME = Object.freeze(Object.fromEntries([
  ...QUANTITY_MEMBER_NAMES.map((name) => [name, "src/quantity.ts"]),
  ...MEASUREMENT_MEMBER_NAMES.map((name) => [name, "src/measurements.ts"])
]));
var HELPER_SOURCE_BY_NAME = Object.freeze({
  abs: "src/quantity.ts",
  assertDecimals: "src/quantity.ts",
  assertFiniteInventoryIntentFingerprintNumbers: "src/canonical.ts",
  assertSafeInteger: "src/quantity.ts",
  assertSamePrimaryMeasurementAxis: "src/measurements.ts",
  compareInventoryIdentityText: "src/ordering.ts",
  compareMeasurementAxis: "src/measurements.ts",
  exactFractionQuantity: "src/quantity.ts",
  gcd: "src/quantity.ts",
  inventoryIntentFingerprint: "src/canonical.ts",
  measurementFingerprint: "src/measurements.ts",
  powerOfTen: "src/quantity.ts"
});
var ASSIGNED_SURFACE_KEYS2 = Object.freeze(
  [".", "./kernel"].flatMap(
    (entryPoint) => [...QUANTITY_MEMBER_NAMES, ...MEASUREMENT_MEMBER_NAMES].map(
      (name) => `export:${entryPoint}#${name}::call[0]`
    )
  ).sort()
);
var quantityLaws = {
  addQuantity: "Require equal units, align to the larger decimal scale, add exact bigint digits, require a safe stored integer, and return that scale/unit.",
  assertSameUnit: "Return normally exactly when the two unit codes are identical; otherwise throw the fixed unit-mismatch error.",
  compareQuantity: "Require equal units, align both exact integers to max scale, then return -1, 0, or 1 by mathematical ordering.",
  convertQuantityByReferenceExact: "Require the input/source unit match and both references positive; evaluate value * targetReference / sourceReference as a reduced finite decimal in the target unit.",
  convertQuantityExact: "Revalidate and reduce the positive ratio, then evaluate amount * numerator / denominator as a reduced finite decimal in the explicit target unit.",
  integerAtDecimals: "Validate the target scale, reject digit-removing scales, and multiply exact stored digits by ten to the scale difference.",
  leastCommonQuantityMultiple: "Require same-unit positive operands, align scale, and return (left / gcd(left,right)) * right with safe exact storage.",
  multiplyQuantityByFactor: "Require a positive factor, add operand scales within the allowed bound, multiply exact bigint digits, and use the factor unit.",
  multiplyQuantityByWholeNumber: "Require a safe integer multiplier and multiply exact digits through bigint without changing unit or scale.",
  negateQuantity: "Return the validated exact additive inverse with unchanged scale and unit.",
  parseQuantity: "Trim primitive text, accept only signed plain decimal notation, enforce at most 18 fractional digits, convert concatenated digits exactly, and validate unit/storage.",
  positiveQuantity: "Return the same validated quantity identity only when stored digits are strictly positive; otherwise throw the label-specific error.",
  quantity: "Require safe integer digits, an integer decimal scale from 0 through 18, and a trimmed non-empty unit; return a fresh exact record.",
  quantityEq: "Return false for unequal units; otherwise compare exact aligned numeric values for equality.",
  quantityIsWholeMultipleOf: "Require same unit and positive divisor, align scale, and test exact bigint remainder for zero.",
  quantityRatio: "Require positive safe integer numerator/denominator, divide both by their bigint gcd, and return safe reduced integers.",
  quantityToDecimalString: "Render sign and absolute safe digits in plain decimal notation, left-padding fractional zeroes and never using exponent notation.",
  quantityWholeMultipleCount: "Require same unit, positive divisor, non-negative value, and zero exact remainder; return the safe integer quotient.",
  safeNumber: "Convert bigint to number and accept it exactly when Number.isSafeInteger; otherwise throw the label-specific storage-range error.",
  subtractQuantity: "Require equal units, align to the larger decimal scale, subtract exact bigint digits, require safe storage, and retain scale/unit.",
  unitCode: "Trim primitive unit text, reject the empty result, and return the normalized unit code.",
  zeroQuantity: "Construct exact zero in the explicit unit and requested validated decimal scale."
};
var measurementLaws = {
  addInventoryMeasurements: "Require equal primary axis/unit, add primary exactly, merge independent axes by identity with exact same-unit addition, then validate and sort the resulting vector.",
  assertInventoryMeasurementsFollowPrimarySign: "Compare primary and each independent axis to exact same-scale zero; reject nonzero axes at zero primary and signs opposed to primary.",
  assertWholeMeasurementMultiple: "Require equal primary schema and a whole positive primary multiple; every axis declared by oneWhole must equal that same exact package-count multiple, with absent value axes read as zero.",
  inventoryMeasurement: "Reject an axis whose primitive text trims empty and otherwise retain the exact axis text and quantity in a fresh pair.",
  inventoryMeasurementAt: "Return a matching primary/independent quantity only in the requested unit, throw on unit mismatch, and return exact zero when an independent axis is absent.",
  inventoryMeasurementVector: "Revalidate the primary and every independent pair, reject reuse of the primary axis, sort by UTF-16 identity order, reject duplicates, and return a fresh normalized vector.",
  inventoryMeasurementsAreZero: "Return true exactly when primary and every independent quantity equal exact same-unit/same-scale zero.",
  inventoryMeasurementsEqual: "Require identical primary axis/value, equal ordered independent lengths, and identical axis/value at every normalized index.",
  inventoryMeasurementsFingerprint: "Encode primary and ordered independent axis fingerprints as one finite collision-free JSON array after recursively rejecting undefined/non-finite numbers.",
  multiplyInventoryMeasurementsByWholeNumber: "Require a strictly positive safe integer multiplier, multiply every exact axis, and normalize the returned vector.",
  negateInventoryMeasurements: "Negate every exact axis and normalize the returned vector without changing axis/unit/scale identities.",
  nonNegativeInventoryMeasurements: "Reject any negative axis and reject retained independent quantity when primary is zero; otherwise return the same vector identity.",
  positiveInventoryMeasurements: "Require strictly positive primary and every independent axis non-negative; otherwise throw the axis-specific error and return the same vector on success.",
  scalarInventoryMeasurements: "Build one validated primary measurement and normalize it with no independent axes.",
  subtractInventoryMeasurements: "Negate the right vector and add through the complete same-schema vector equation.",
  zeroInventoryMeasurements: "Construct exact zero for every axis using each input axis unit and decimal scale, then normalize the returned vector."
};
var MEMBER_LAW_BY_NAME = Object.freeze({
  ...quantityLaws,
  ...measurementLaws
});
var HELPER_LAW_BY_NAME = Object.freeze({
  abs: "Return bigint magnitude by negating exactly when the input is negative.",
  assertDecimals: "Accept exactly safe integer scales from 0 through the fixed maximum 18 and reject every other number.",
  assertFiniteInventoryIntentFingerprintNumbers: "Depth-first validate every finite acyclic array element, rejecting undefined and non-finite numbers before JSON encoding.",
  assertSafeInteger: "Accept exactly Number.isSafeInteger inputs and otherwise throw the supplied label error.",
  assertSamePrimaryMeasurementAxis: "Accept exactly matching primary axis identities and units; reject the first mismatch with its declared error.",
  compareInventoryIdentityText: "Return -1, 0, or 1 by locale-independent primitive UTF-16 relational order.",
  compareMeasurementAxis: "Order measurements by their axis identities using the certified UTF-16 comparator.",
  exactFractionQuantity: "Require a positive denominator, reduce by gcd, remove factors two and five, reject any residual denominator, scale to a finite decimal no longer than 18 places, and validate exact storage/unit.",
  gcd: "Run Euclid over bigint magnitudes and return one for the zero/zero case used by exact rational normalization.",
  inventoryIntentFingerprint: "Recursively reject undefined/non-finite numeric values and return JSON.stringify of the finite acyclic typed array.",
  measurementFingerprint: "Fingerprint the exact ordered tuple axisId, amountMinor, decimals, unit.",
  powerOfTen: "Validate the non-negative scale through 18 and return exact bigint ten to that power."
});
var EXPECTED_RUNTIME_IMPORTS = Object.freeze({
  "src/canonical.ts": Object.freeze([
    Object.freeze({ module: "./model.js", imported: "InventoryMetadata", local: "InventoryMetadata", typeOnly: true }),
    Object.freeze({ module: "./model.js", imported: "InventoryMetadataValue", local: "InventoryMetadataValue", typeOnly: true })
  ]),
  "src/measurements.ts": Object.freeze([
    Object.freeze({ module: "./canonical.js", imported: "inventoryIntentFingerprint", local: "inventoryIntentFingerprint", typeOnly: false }),
    Object.freeze({ module: "./ordering.js", imported: "compareInventoryIdentityText", local: "compareInventoryIdentityText", typeOnly: false }),
    ...Object.freeze([
      "addQuantity",
      "compareQuantity",
      "integerAtDecimals",
      "multiplyQuantityByWholeNumber",
      "negateQuantity",
      "positiveQuantity",
      "quantity",
      "quantityEq",
      "quantityIsWholeMultipleOf",
      "safeNumber",
      "subtractQuantity",
      "zeroQuantity"
    ]).map((name) => Object.freeze({ module: "./quantity.js", imported: name, local: name, typeOnly: false })),
    Object.freeze({ module: "./quantity.js", imported: "Quantity", local: "Quantity", typeOnly: true }),
    Object.freeze({ module: "./quantity.js", imported: "UnitCode", local: "UnitCode", typeOnly: true })
  ]),
  "src/ordering.ts": Object.freeze([]),
  "src/quantity.ts": Object.freeze([])
});
var EXPECTED_TOP_LEVEL_RUNTIME_VALUES = Object.freeze({
  "src/canonical.ts": Object.freeze([]),
  "src/measurements.ts": Object.freeze([]),
  "src/ordering.ts": Object.freeze([]),
  "src/quantity.ts": Object.freeze(["MAXIMUM_QUANTITY_DECIMALS"])
});
var ALLOWED_STANDARD_RUNTIME_GLOBALS = Object.freeze(/* @__PURE__ */ new Set([
  "Array",
  "BigInt",
  "Error",
  "JSON",
  "Map",
  "Math",
  "Number",
  "String",
  "undefined"
]));
var ALLOWED_BUILTIN_DECLARATIONS = Object.freeze(/* @__PURE__ */ new Set([
  "lib.es2015.collection.d.ts#get#MethodSignature",
  "lib.es2015.collection.d.ts#set#MethodSignature",
  "lib.es2015.core.d.ts#isFinite#MethodSignature",
  "lib.es2015.core.d.ts#isSafeInteger#MethodSignature",
  "lib.es2015.iterable.d.ts#<anonymous>#ConstructSignature",
  "lib.es2017.string.d.ts#padStart#MethodSignature",
  "lib.es2020.bigint.d.ts#<anonymous>#CallSignature",
  "lib.es2022.error.d.ts#<anonymous>#ConstructSignature",
  "lib.es5.d.ts#<anonymous>#CallSignature",
  "lib.es5.d.ts#abs#MethodSignature",
  "lib.es5.d.ts#exec#MethodSignature",
  "lib.es5.d.ts#isArray#MethodSignature",
  "lib.es5.d.ts#map#MethodSignature",
  "lib.es5.d.ts#max#MethodSignature",
  "lib.es5.d.ts#push#MethodSignature",
  "lib.es5.d.ts#slice#MethodSignature",
  "lib.es5.d.ts#sort#MethodSignature",
  "lib.es5.d.ts#stringify#MethodSignature",
  "lib.es5.d.ts#trim#MethodSignature"
]));
var FAMILY_DOMAIN = Object.freeze({
  id: "ALL_DECLARED_EXACT_QUANTITY_AND_NORMALIZED_MEASUREMENT_VALUES_V1",
  quantityConstructors: "All primitive string/number/bigint inputs described by UnitCode, QuantityInput, ratio, decimal parsing, scaling, and safe-number signatures, including every invalid-input rejection branch.",
  quantityAlgebra: "All values returned by the certified quantity constructors and all QuantityRatio values returned by quantityRatio; exact operations include negative/zero/positive values wherever their declarations allow them.",
  measurementConstructors: "All primitive axis strings, certified Quantity values, finite plain readonly arrays, and InventoryIndependentMeasurementInput records described by the declarations, including every duplicate/axis/unit/sign rejection branch.",
  measurementAlgebra: "All normalized InventoryMeasurementVector values returned by inventoryMeasurementVector/scalarInventoryMeasurements and finite schemas described by their declarations.",
  builtIns: "Unmodified ECMAScript String, RegExp, Array, Map, Object-free record construction, JSON, Math, Number, BigInt, and Error behavior at the exact compiler-resolved TypeScript library declarations recorded by the certificate.",
  immutability: "Inputs are finite acyclic plain immutable records/arrays containing primitive fields and certified quantity/vector values; fresh local arrays/maps may be mutated only while constructing results.",
  excluded: "Proxies, accessors, subclass instances, cyclic arrays, monkey-patched built-ins, coercive custom objects, ambient replacements, and externally mutable inputs are not admitted. Storage, clocks, I/O, randomness, and application callbacks are absent from this family."
});

// experiments/tla-conformance/quantity-values-r7/certificate.mjs
var expectedEquationPath = fileURLToPath6(
  new URL("./equations.expected.ts.txt", import.meta.url)
);
var producerFiles3 = Object.freeze([
  "experiments/tla-conformance/quantity-values-r7/certificate.mjs",
  "experiments/tla-conformance/quantity-values-r7/contracts.mjs",
  "experiments/tla-conformance/quantity-values-r7/equations.expected.ts.txt",
  "experiments/tla-conformance/surface-bindings/lib/compiler-surface.mjs",
  "node_modules/typescript/package.json"
]);
function relativePath(repositoryRoot, fileName) {
  return path13.relative(repositoryRoot, fileName).replaceAll("\\", "/");
}
function parseSource2(fileName, sourceText5) {
  return ts.createSourceFile(
    fileName,
    sourceText5,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}
function findFunction2(source7, functionName) {
  const matches = source7.statements.filter(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === functionName && statement.body !== void 0
  );
  assert11.equal(matches.length, 1, `Expected one concrete function '${functionName}'.`);
  return matches[0];
}
function findVariable(source7, variableName) {
  const matches = [];
  for (const statement of source7.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === variableName) {
        matches.push({ statement, declaration });
      }
    }
  }
  assert11.equal(matches.length, 1, `Expected one variable '${variableName}'.`);
  return matches[0];
}
function normalizedType(typeNode) {
  return typeNode === void 0 ? null : typeNode.getText().replaceAll(/\s+/gu, "");
}
function operatorText(kind) {
  return ts.tokenToString(kind) ?? ts.SyntaxKind[kind];
}
function normalizeQuantityValueCallable(declaration) {
  assert11(declaration.body !== void 0, "A source equation requires one concrete body.");
  assert11.equal(declaration.asteriskToken, void 0, "Generator equations are outside this family.");
  assert11.equal(
    declaration.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
    false,
    "Async equations are outside this family."
  );
  assert11(
    !ts.canHaveDecorators(declaration) || (ts.getDecorators(declaration)?.length ?? 0) === 0,
    "Decorated equations are outside this family."
  );
  const counters = { local: 0, lambda: 0 };
  const environment = /* @__PURE__ */ new Map();
  function bindPattern(pattern, scopedEnvironment, prefix) {
    if (ts.isIdentifier(pattern)) {
      const identity = `${prefix}:${counters.local}`;
      counters.local += 1;
      scopedEnvironment.set(pattern.text, identity);
      return ["binding", identity];
    }
    if (ts.isArrayBindingPattern(pattern)) {
      return [
        "array-binding",
        pattern.elements.map((element) => {
          if (ts.isOmittedExpression(element)) return ["omitted"];
          assert11(ts.isBindingElement(element), "Unexpected array binding element.");
          assert11.equal(element.dotDotDotToken, void 0, "Rest bindings require another equation family.");
          assert11.equal(element.propertyName, void 0, "Renamed array bindings are not admitted.");
          assert11.equal(element.initializer, void 0, "Defaulted array bindings are not admitted.");
          return bindPattern(element.name, scopedEnvironment, prefix);
        })
      ];
    }
    throw new Error(`Unsupported binding pattern '${pattern.getText()}'.`);
  }
  for (const [index, parameter] of declaration.parameters.entries()) {
    assert11(ts.isIdentifier(parameter.name), "Parameters must use simple identifiers.");
    environment.set(parameter.name.text, `parameter:${index}`);
  }
  function propertyName(name) {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
      return name.text;
    }
    throw new Error(`Computed property '${name.getText()}' is outside this family.`);
  }
  function expression(node, scopedEnvironment = environment) {
    if (ts.isParenthesizedExpression(node)) return expression(node.expression, scopedEnvironment);
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      return ["typed-cast", normalizedType(node.type), expression(node.expression, scopedEnvironment)];
    }
    if (ts.isNonNullExpression(node)) {
      return ["non-null", expression(node.expression, scopedEnvironment)];
    }
    if (ts.isIdentifier(node)) {
      return ["reference", scopedEnvironment.get(node.text) ?? `source:${node.text}`];
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return ["string", node.text];
    }
    if (ts.isNumericLiteral(node)) return ["number", node.text];
    if (ts.isBigIntLiteral(node)) return ["bigint", node.text];
    if (ts.isRegularExpressionLiteral(node)) return ["regexp", node.text];
    if (node.kind === ts.SyntaxKind.TrueKeyword) return ["boolean", true];
    if (node.kind === ts.SyntaxKind.FalseKeyword) return ["boolean", false];
    if (node.kind === ts.SyntaxKind.NullKeyword) return ["null"];
    if (ts.isPropertyAccessExpression(node)) {
      return [
        "property",
        expression(node.expression, scopedEnvironment),
        node.name.text,
        node.questionDotToken === void 0 ? "required" : "optional"
      ];
    }
    if (ts.isElementAccessExpression(node)) {
      assert11(node.argumentExpression !== void 0, "Element access requires an index.");
      return [
        "element",
        expression(node.expression, scopedEnvironment),
        expression(node.argumentExpression, scopedEnvironment),
        node.questionDotToken === void 0 ? "required" : "optional"
      ];
    }
    if (ts.isCallExpression(node)) {
      return [
        "call",
        expression(node.expression, scopedEnvironment),
        node.typeArguments?.map(normalizedType) ?? [],
        node.arguments.map((argument) => expression(argument, scopedEnvironment)),
        node.questionDotToken === void 0 ? "required" : "optional"
      ];
    }
    if (ts.isNewExpression(node)) {
      return [
        "new",
        expression(node.expression, scopedEnvironment),
        node.typeArguments?.map(normalizedType) ?? [],
        (node.arguments ?? []).map((argument) => expression(argument, scopedEnvironment))
      ];
    }
    if (ts.isBinaryExpression(node)) {
      return [
        "binary",
        operatorText(node.operatorToken.kind),
        expression(node.left, scopedEnvironment),
        expression(node.right, scopedEnvironment)
      ];
    }
    if (ts.isConditionalExpression(node)) {
      return [
        "conditional",
        expression(node.condition, scopedEnvironment),
        expression(node.whenTrue, scopedEnvironment),
        expression(node.whenFalse, scopedEnvironment)
      ];
    }
    if (ts.isPrefixUnaryExpression(node)) {
      return ["prefix", operatorText(node.operator), expression(node.operand, scopedEnvironment)];
    }
    if (ts.isPostfixUnaryExpression(node)) {
      return ["postfix", operatorText(node.operator), expression(node.operand, scopedEnvironment)];
    }
    if (ts.isTypeOfExpression(node)) {
      return ["typeof", expression(node.expression, scopedEnvironment)];
    }
    if (ts.isArrayLiteralExpression(node)) {
      return [
        "array",
        node.elements.map((element) => ts.isOmittedExpression(element) ? ["omitted"] : expression(element, scopedEnvironment))
      ];
    }
    if (ts.isObjectLiteralExpression(node)) {
      return [
        "record",
        node.properties.map((property) => {
          if (ts.isPropertyAssignment(property)) {
            return ["field", propertyName(property.name), expression(property.initializer, scopedEnvironment)];
          }
          if (ts.isShorthandPropertyAssignment(property)) {
            return ["field", property.name.text, expression(property.name, scopedEnvironment)];
          }
          if (ts.isSpreadAssignment(property)) {
            return ["spread", expression(property.expression, scopedEnvironment)];
          }
          throw new Error(`Object member '${property.getText()}' is outside this family.`);
        })
      ];
    }
    if (ts.isTemplateExpression(node)) {
      return [
        "template",
        node.head.text,
        node.templateSpans.map((span) => [
          expression(span.expression, scopedEnvironment),
          span.literal.text
        ])
      ];
    }
    if (ts.isArrowFunction(node)) {
      assert11.equal(node.asteriskToken, void 0, "Generator callbacks are not admitted.");
      assert11.equal(
        node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
        false,
        "Async callbacks require a separate semantic equation."
      );
      const childEnvironment = new Map(scopedEnvironment);
      const lambdaId = counters.lambda;
      counters.lambda += 1;
      for (const [index, parameter] of node.parameters.entries()) {
        assert11(ts.isIdentifier(parameter.name), "Callback parameters must use simple identifiers.");
        assert11.equal(parameter.dotDotDotToken, void 0, "Rest callbacks require a separate semantic equation.");
        assert11.equal(parameter.initializer, void 0, "Defaulted callbacks require a separate semantic equation.");
        childEnvironment.set(parameter.name.text, `lambda:${lambdaId}:${index}`);
      }
      return [
        "lambda",
        { async: false, closure: "lexical", parameters: node.parameters.map((parameter, index) => ({
          identity: `lambda:${lambdaId}:${index}`,
          type: normalizedType(parameter.type),
          optional: parameter.questionToken !== void 0,
          rest: false,
          default: null
        })) },
        ts.isBlock(node.body) ? statement(node.body, childEnvironment) : expression(node.body, childEnvironment)
      ];
    }
    throw new Error(
      `Unproved expression '${ts.SyntaxKind[node.kind]}': ${node.getText()}`
    );
  }
  function declarationList(list, scopedEnvironment) {
    const declarationKind = (list.flags & ts.NodeFlags.Const) !== 0 ? "const" : (list.flags & ts.NodeFlags.Let) !== 0 ? "let" : "var";
    const declarations = [];
    for (const declaration2 of list.declarations) {
      const initializer = declaration2.initializer === void 0 ? ["undefined"] : expression(declaration2.initializer, scopedEnvironment);
      const pattern = bindPattern(declaration2.name, scopedEnvironment, "local");
      declarations.push([pattern, normalizedType(declaration2.type), initializer]);
    }
    return ["declarations", declarationKind, declarations];
  }
  function branch(node, scopedEnvironment) {
    return ts.isBlock(node) ? ["sequence", statements(node.statements, new Map(scopedEnvironment))] : statement(node, new Map(scopedEnvironment));
  }
  function statements(sourceStatements, scopedEnvironment) {
    return sourceStatements.map((sourceStatement) => statement(sourceStatement, scopedEnvironment));
  }
  function statement(node, scopedEnvironment = environment) {
    if (ts.isBlock(node)) {
      return ["sequence", statements(node.statements, new Map(scopedEnvironment))];
    }
    if (ts.isVariableStatement(node)) {
      return declarationList(node.declarationList, scopedEnvironment);
    }
    if (ts.isIfStatement(node)) {
      return [
        "if",
        expression(node.expression, scopedEnvironment),
        branch(node.thenStatement, scopedEnvironment),
        node.elseStatement === void 0 ? ["no-else"] : branch(node.elseStatement, scopedEnvironment)
      ];
    }
    if (ts.isReturnStatement(node)) {
      return ["return", node.expression === void 0 ? ["undefined"] : expression(node.expression, scopedEnvironment)];
    }
    if (ts.isThrowStatement(node)) return ["throw", expression(node.expression, scopedEnvironment)];
    if (ts.isExpressionStatement(node)) return ["expression", expression(node.expression, scopedEnvironment)];
    if (ts.isForOfStatement(node)) {
      assert11(ts.isVariableDeclarationList(node.initializer), "For-of requires a declared iterator.");
      const iterable = expression(node.expression, scopedEnvironment);
      const childEnvironment = new Map(scopedEnvironment);
      const binding = declarationList(node.initializer, childEnvironment);
      return ["for-of", binding, iterable, branch(node.statement, childEnvironment)];
    }
    if (ts.isForStatement(node)) {
      const childEnvironment = new Map(scopedEnvironment);
      const initializer = node.initializer === void 0 ? ["none"] : ts.isVariableDeclarationList(node.initializer) ? declarationList(node.initializer, childEnvironment) : expression(node.initializer, childEnvironment);
      return [
        "for",
        initializer,
        node.condition === void 0 ? ["none"] : expression(node.condition, childEnvironment),
        node.incrementor === void 0 ? ["none"] : expression(node.incrementor, childEnvironment),
        branch(node.statement, childEnvironment)
      ];
    }
    if (ts.isWhileStatement(node)) {
      return ["while", expression(node.expression, scopedEnvironment), branch(node.statement, scopedEnvironment)];
    }
    if (ts.isContinueStatement(node)) {
      assert11.equal(node.label, void 0, "Labeled continue is outside this family.");
      return ["continue"];
    }
    throw new Error(
      `Unproved statement '${ts.SyntaxKind[node.kind]}': ${node.getText()}`
    );
  }
  return {
    parameters: declaration.parameters.map((parameter, index) => ({
      identity: `parameter:${index}`,
      type: normalizedType(parameter.type),
      optional: parameter.questionToken !== void 0,
      rest: parameter.dotDotDotToken !== void 0,
      default: parameter.initializer === void 0 ? null : expression(parameter.initializer, environment)
    })),
    returnType: normalizedType(declaration.type),
    body: ["sequence", statements(declaration.body.statements, environment)]
  };
}
function normalizedRuntimeImports(source7) {
  const imports = [];
  for (const statement of source7.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (clause === void 0) continue;
    assert11.equal(clause.name, void 0, "Default imports are outside this family.");
    assert11(clause.namedBindings === void 0 || ts.isNamedImports(clause.namedBindings), "Namespace imports are outside this family.");
    for (const specifier of clause.namedBindings?.elements ?? []) {
      imports.push({
        module: statement.moduleSpecifier.text,
        imported: specifier.propertyName?.text ?? specifier.name.text,
        local: specifier.name.text,
        typeOnly: clause.isTypeOnly || specifier.isTypeOnly
      });
    }
  }
  return imports.sort((left, right) => compareCodeUnits(canonicalJson(left), canonicalJson(right)));
}
function declarationKey3(repositoryRoot, declaration) {
  assert11(declaration.name !== void 0, "Certified functions require names.");
  return `${relativePath(repositoryRoot, declaration.getSourceFile().fileName)}#${declaration.name.text}`;
}
function builtinDeclarationKey(declaration) {
  const file = path13.basename(declaration.getSourceFile().fileName);
  const name = declaration.name?.getText(declaration.getSourceFile()) ?? "<anonymous>";
  return `${file}#${name}#${ts.SyntaxKind[declaration.kind]}`;
}
function declarationIsInsideCallable(sourceDeclaration, callable) {
  let current = sourceDeclaration;
  while (current !== void 0) {
    if (current === callable) return true;
    current = current.parent;
  }
  return false;
}
function boundedDeclarationLocation(repositoryRoot, declaration) {
  const source7 = declaration.getSourceFile();
  const start = source7.getLineAndCharacterOfPosition(declaration.getStart(source7));
  return `${relativePath(repositoryRoot, source7.fileName)}:${start.line + 1}:${start.character + 1}`;
}
function verifyDependencyClosure({ repositoryRoot, context, certified, quantityMaximum, declarations }) {
  const builtins = /* @__PURE__ */ new Map();
  const runtimeGlobals = /* @__PURE__ */ new Map();
  const dependencyNamesByKey = /* @__PURE__ */ new Map();
  const trustedLibraryRoot = fs10.realpathSync(
    path13.dirname(ts.getDefaultLibFilePath(context.program.getCompilerOptions()))
  );
  function trustedLibraryFile2(declaration) {
    assert11.equal(declaration.getSourceFile().isDeclarationFile, true, "Runtime library declaration must be ambient.");
    const targetLibraryFile = fs10.realpathSync(declaration.getSourceFile().fileName);
    assert11(
      targetLibraryFile.startsWith(`${trustedLibraryRoot}${path13.sep}`),
      `Runtime declaration is outside trusted TypeScript library: ${targetLibraryFile}`
    );
    return targetLibraryFile;
  }
  for (const [key, declaration] of declarations) {
    let resolvedSymbol4 = function(node) {
      let symbol = context.checker.getSymbolAtLocation(node);
      if (symbol !== void 0 && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
        symbol = context.checker.getAliasedSymbol(symbol);
      }
      return symbol;
    }, inspectCall2 = function(node) {
      const target = context.checker.getResolvedSignature(node)?.declaration;
      assert11(target !== void 0, `Unresolved call '${node.getText()}'.`);
      if (target.getSourceFile().isDeclarationFile) {
        trustedLibraryFile2(target);
        const builtinKey = builtinDeclarationKey(target);
        assert11(ALLOWED_BUILTIN_DECLARATIONS.has(builtinKey), `Unproved built-in '${builtinKey}'.`);
        const declarationSpan = spanOf(context, target);
        const evidenceKey = `${builtinKey}:${declarationSpan.start.offset}:${declarationSpan.end.offset}`;
        const old = builtins.get(evidenceKey) ?? { key: evidenceKey, operationKey: builtinKey, declaration: declarationSpan, callSites: [] };
        assert11.deepEqual(old.declaration, declarationSpan, `Built-in overload '${evidenceKey}' changed within one pass.`);
        old.callSites.push(spanOf(context, node));
        builtins.set(evidenceKey, old);
        return;
      }
      assert11(
        ts.isFunctionDeclaration(target) && target.body !== void 0,
        `Resolved source call '${node.getText()}' is not an ordinary function.`
      );
      const targetKey = declarationKey3(repositoryRoot, target);
      assert11(certified.has(targetKey), `Unproved source call '${targetKey}'.`);
      if (targetKey !== key) dependencyNames.add(targetKey);
    }, visit2 = function(node) {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) inspectCall2(node);
      if (ts.isIdentifier(node)) {
        const symbol = resolvedSymbol4(node);
        for (const sourceDeclaration of symbol?.declarations ?? []) {
          if (ts.isFunctionDeclaration(sourceDeclaration) && sourceDeclaration.body !== void 0) {
            const targetKey = declarationKey3(repositoryRoot, sourceDeclaration);
            assert11(certified.has(targetKey), `Unproved source function reference '${targetKey}'.`);
            if (targetKey !== key) dependencyNames.add(targetKey);
          }
          if (ts.isVariableDeclaration(sourceDeclaration)) {
            if (declarationIsInsideCallable(sourceDeclaration, declaration)) continue;
            if (sourceDeclaration.getSourceFile().isDeclarationFile) {
              trustedLibraryFile2(sourceDeclaration);
              assert11(
                ALLOWED_STANDARD_RUNTIME_GLOBALS.has(node.text),
                `Unproved standard runtime global '${node.text}'.`
              );
              const declarationSpan = spanOf(context, sourceDeclaration);
              const globalKey = `${node.text}:${declarationSpan.file}:${declarationSpan.start.offset}:${declarationSpan.end.offset}`;
              runtimeGlobals.set(globalKey, {
                key: globalKey,
                name: node.text,
                declaration: declarationSpan
              });
              continue;
            }
            const location = boundedDeclarationLocation(repositoryRoot, sourceDeclaration);
            assert11(
              sourceDeclaration === quantityMaximum.declaration,
              `Unknown nonlocal runtime variable '${node.text}' at ${location}.`
            );
          }
          if ((ts.isEnumDeclaration(sourceDeclaration) || ts.isEnumMember(sourceDeclaration)) && !sourceDeclaration.getSourceFile().isDeclarationFile) {
            assert11.fail(
              `Unknown nonlocal runtime enum '${node.text}' at ${boundedDeclarationLocation(repositoryRoot, sourceDeclaration)}.`
            );
          }
        }
      }
      ts.forEachChild(node, visit2);
    };
    var resolvedSymbol3 = resolvedSymbol4, inspectCall = inspectCall2, visit = visit2;
    const dependencyNames = /* @__PURE__ */ new Set();
    visit2(declaration.body);
    dependencyNamesByKey.set(key, [...dependencyNames].sort(compareCodeUnits));
  }
  return {
    builtins: [...builtins.values()].map((row) => ({ ...row, callSites: row.callSites.sort((left, right) => compareCodeUnits(canonicalJson(left), canonicalJson(right))) })).sort((left, right) => compareCodeUnits(left.key, right.key)),
    runtimeGlobals: [...runtimeGlobals.values()].sort((left, right) => compareCodeUnits(left.key, right.key)),
    dependencyNamesByKey
  };
}
function normalizedTopLevelRuntimeValues(source7) {
  const names = [];
  for (const statement of source7.statements) {
    assert11.equal(ts.isEnumDeclaration(statement), false, "Runtime enums are outside this source-equation family.");
    if (!ts.isVariableStatement(statement) || (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword) ?? false)) continue;
    for (const declaration of statement.declarationList.declarations) {
      assert11(ts.isIdentifier(declaration.name), "Top-level destructured runtime values are outside this family.");
      names.push(declaration.name.text);
    }
  }
  return names.sort(compareCodeUnits);
}
function sourceText(repositoryRoot, sourceOverrides, file) {
  return sourceOverrides.get(file) ?? fs10.readFileSync(path13.resolve(repositoryRoot, file), "utf8");
}
function buildQuantityValuesFamilyCertificate({
  repositoryRoot,
  context,
  surface,
  sourceOverrides = /* @__PURE__ */ new Map()
}) {
  assert11.equal(ASSIGNED_SURFACE_KEYS2.length, 76, "Assigned alias cardinality changed.");
  assert11.equal(new Set(ASSIGNED_SURFACE_KEYS2).size, 76, "Assigned aliases must be unique.");
  const expectedSource3 = parseSource2(expectedEquationPath, fs10.readFileSync(expectedEquationPath, "utf8"));
  const sources = new Map(
    FAMILY_SOURCE_FILES.map((file) => {
      const absolute = path13.resolve(repositoryRoot, file);
      const source7 = sourceOverrides.has(file) ? parseSource2(absolute, sourceText(repositoryRoot, sourceOverrides, file)) : context.program.getSourceFile(absolute);
      assert11(source7 !== void 0, `Missing compiler source '${file}'.`);
      return [file, source7];
    })
  );
  const runtimeImports = [];
  for (const file of FAMILY_SOURCE_FILES) {
    const actualImports = normalizedRuntimeImports(sources.get(file));
    const expectedImports = [...EXPECTED_RUNTIME_IMPORTS[file]].sort((left, right) => compareCodeUnits(canonicalJson(left), canonicalJson(right)));
    assert11.deepEqual(actualImports, expectedImports, `Import/free-variable bindings changed in '${file}'.`);
    runtimeImports.push(...actualImports.map((row) => ({ file, ...row })));
    assert11.deepEqual(
      normalizedTopLevelRuntimeValues(sources.get(file)),
      [...EXPECTED_TOP_LEVEL_RUNTIME_VALUES[file]],
      `Unknown top-level runtime value in '${file}'.`
    );
  }
  const actualMaximum = findVariable(sources.get("src/quantity.ts"), "MAXIMUM_QUANTITY_DECIMALS");
  const expectedMaximum = findVariable(expectedSource3, "MAXIMUM_QUANTITY_DECIMALS");
  assert11.equal(actualMaximum.declaration.initializer?.getText(), expectedMaximum.declaration.initializer?.getText(), "Maximum decimal equation changed.");
  assert11.equal(
    (actualMaximum.statement.declarationList.flags & ts.NodeFlags.Const) !== 0,
    true,
    "Maximum decimal limit must stay constant."
  );
  const allMemberNames = [...QUANTITY_MEMBER_NAMES, ...MEASUREMENT_MEMBER_NAMES];
  const allHelperNames = Object.keys(HELPER_SOURCE_BY_NAME).sort(compareCodeUnits);
  const actualDeclarations = /* @__PURE__ */ new Map();
  const expectedTerms2 = /* @__PURE__ */ new Map();
  for (const name of [...allMemberNames, ...allHelperNames]) {
    const sourceFile3 = MEMBER_SOURCE_BY_NAME[name] ?? HELPER_SOURCE_BY_NAME[name];
    const actual = findFunction2(sources.get(sourceFile3), name);
    const expected = findFunction2(expectedSource3, name);
    const actualTerm = normalizeQuantityValueCallable(actual);
    const expectedTerm = normalizeQuantityValueCallable(expected);
    assert11.deepEqual(actualTerm, expectedTerm, `Independent source equation changed for '${name}'.`);
    actualDeclarations.set(`${sourceFile3}#${name}`, actual);
    expectedTerms2.set(name, expectedTerm);
  }
  assert11.equal(actualDeclarations.size, 50, "Complete callable/helper equation closure changed.");
  let closure = { builtins: [], runtimeGlobals: [], dependencyNamesByKey: /* @__PURE__ */ new Map() };
  if (sourceOverrides.size === 0) {
    closure = verifyDependencyClosure({
      repositoryRoot,
      context,
      certified: new Set(actualDeclarations.keys()),
      quantityMaximum: actualMaximum,
      declarations: actualDeclarations
    });
  }
  const semanticInputs4 = [
    ...FAMILY_SOURCE_FILES,
    ...producerFiles3,
    ...closure.builtins.map((builtin) => builtin.declaration.file),
    ...closure.runtimeGlobals.map((global) => global.declaration.file)
  ];
  const uniqueInputFiles = [...new Set(semanticInputs4)].sort(compareCodeUnits);
  const inputs3 = uniqueInputFiles.map((file) => ({
    file,
    sha256: sha256(sourceOverrides.get(file) ?? fs10.readFileSync(path13.resolve(repositoryRoot, file)))
  }));
  const memberEquations = allMemberNames.map((name) => {
    const sourceFile3 = MEMBER_SOURCE_BY_NAME[name];
    const key = `${sourceFile3}#${name}`;
    const declaration = actualDeclarations.get(key);
    const term4 = expectedTerms2.get(name);
    return {
      id: key,
      name,
      sourceFile: sourceFile3,
      implementation: spanOf(context, declaration),
      law: MEMBER_LAW_BY_NAME[name],
      equationSha256: sha256(canonicalJson(term4)),
      term: term4,
      dependencies: closure.dependencyNamesByKey.get(key) ?? []
    };
  }).sort((left, right) => compareCodeUnits(left.id, right.id));
  const helperEquations = allHelperNames.map((name) => {
    const sourceFile3 = HELPER_SOURCE_BY_NAME[name];
    const key = `${sourceFile3}#${name}`;
    const declaration = actualDeclarations.get(key);
    const term4 = expectedTerms2.get(name);
    return {
      id: key,
      name,
      sourceFile: sourceFile3,
      implementation: spanOf(context, declaration),
      law: HELPER_LAW_BY_NAME[name],
      equationSha256: sha256(canonicalJson(term4)),
      term: term4,
      dependencies: closure.dependencyNamesByKey.get(key) ?? []
    };
  }).sort((left, right) => compareCodeUnits(left.id, right.id));
  const semanticCore = {
    proofKind: QUANTITY_VALUES_PROOF_KIND,
    domain: FAMILY_DOMAIN,
    inputs: inputs3,
    maximumQuantityDecimals: {
      value: 18,
      declaration: spanOf(context, actualMaximum.statement)
    },
    runtimeImports,
    runtimeGlobals: closure.runtimeGlobals,
    builtins: closure.builtins,
    memberEquations,
    helperEquations
  };
  const certificateId = `VALUE_CERTIFICATE_FAMILY:sha256:${sha256(canonicalJson(semanticCore))}`;
  const callableByKey = new Map(surface.callables.map((callable) => [callable.key, callable]));
  const proofs = [];
  for (const surfaceKey of ASSIGNED_SURFACE_KEYS2) {
    const match = /^export:(\.|\.\/kernel)#([^:]+)::call\[0\]$/u.exec(surfaceKey);
    assert11(match !== null, `Invalid assigned surface key '${surfaceKey}'.`);
    const [, entryPoint, name] = match;
    const sourceFile3 = MEMBER_SOURCE_BY_NAME[name];
    assert11(sourceFile3 !== void 0, `Assigned alias '${surfaceKey}' has no member equation.`);
    const implementation = actualDeclarations.get(`${sourceFile3}#${name}`);
    const callable = callableByKey.get(surfaceKey);
    assert11(callable !== void 0, `Compiler omitted assigned alias '${surfaceKey}'.`);
    if (sourceOverrides.size === 0) {
      assert11.deepEqual(callable.declaration, spanOf(context, implementation), `Alias declaration drifted for '${surfaceKey}'.`);
      assert11(callable.reachabilityPaths.includes(`export:${entryPoint}#${name}`), `Alias reachability drifted for '${surfaceKey}'.`);
    }
    proofs.push({
      surfaceKey,
      mode: "V",
      signature: callable.signature,
      signatureHash: callable.signatureHash,
      declaration: callable.declaration,
      implementation: spanOf(context, implementation),
      relation: sourceOverrides.size === 0 ? "COMPILER_RESOLVED_EXACT_EXPORT_ALIAS" : "MUTATION_CONTROL_ONLY",
      memberEquationId: `${sourceFile3}#${name}`,
      memberEquationSha256: memberEquations.find((row) => row.id === `${sourceFile3}#${name}`).equationSha256
    });
  }
  return {
    schemaVersion: 1,
    mode: "V",
    proofKind: QUANTITY_VALUES_PROOF_KIND,
    certificateId,
    surfaceDigest: surface.digest,
    allAdmittedInputs: true,
    sampledInputs: 0,
    inputs: inputs3,
    domain: FAMILY_DOMAIN,
    semanticCore,
    proofs
  };
}
var supportedSurfaceKeys3 = ASSIGNED_SURFACE_KEYS2;
var buildFamilyArtifact3 = buildQuantityValuesFamilyCertificate;

// experiments/tla-conformance/quantity-values-r7/event-values/certificate.mjs
import assert14 from "node:assert/strict";
import fs12 from "node:fs";
import path15 from "node:path";
import { fileURLToPath as fileURLToPath8 } from "node:url";

// experiments/tla-conformance/catalog-foundation-r7/family.mjs
import assert13 from "node:assert/strict";
import fs11 from "node:fs";
import path14 from "node:path";
import { fileURLToPath as fileURLToPath7 } from "node:url";

// experiments/tla-conformance/catalog-foundation-r7/contracts.mjs
var CATALOG_FOUNDATION_FAMILY_ID = "inventoryonce.catalog-foundation.closed-source-equations.v1";
var ASSIGNED_SURFACE_KEYS3 = Object.freeze([
  "export:.#InventoryCatalog.define::call[0]",
  "export:.#assertInventoryCatalogRetainsSnapshot::call[0]",
  "export:.#assertMeasurementsMatchItem::call[0]",
  "export:.#assertPositionMatchesItem::call[0]",
  "export:.#defineInventoryCatalog::call[0]",
  "export:.#defineInventoryCollection::call[0]",
  "export:.#defineInventoryComposition::call[0]",
  "export:.#defineInventoryFungibilityPool::call[0]",
  "export:.#defineInventoryItem::call[0]",
  "export:.#defineInventoryPackaging::call[0]",
  "export:.#defineInventoryTransformation::call[0]",
  "export:.#defineScalarInventoryFungibilityPool::call[0]",
  "export:.#defineScalarInventoryItem::call[0]",
  "export:.#defineScalarInventoryPackaging::call[0]",
  "export:.#emptyInventoryCatalogSnapshot::call[0]",
  "export:.#extendInventoryCatalog::call[0]",
  "export:.#inventoryCatalogFromSnapshot::call[0]",
  "export:./kernel#InventoryCatalog.define::call[0]",
  "export:./kernel#assertInventoryCatalogRetainsSnapshot::call[0]",
  "export:./kernel#assertMeasurementsMatchItem::call[0]",
  "export:./kernel#assertPositionMatchesItem::call[0]",
  "export:./kernel#defineInventoryCatalog::call[0]",
  "export:./kernel#defineInventoryCollection::call[0]",
  "export:./kernel#defineInventoryComposition::call[0]",
  "export:./kernel#defineInventoryFungibilityPool::call[0]",
  "export:./kernel#defineInventoryItem::call[0]",
  "export:./kernel#defineInventoryPackaging::call[0]",
  "export:./kernel#defineInventoryTransformation::call[0]",
  "export:./kernel#defineScalarInventoryFungibilityPool::call[0]",
  "export:./kernel#defineScalarInventoryItem::call[0]",
  "export:./kernel#defineScalarInventoryPackaging::call[0]",
  "export:./kernel#emptyInventoryCatalogSnapshot::call[0]",
  "export:./kernel#extendInventoryCatalog::call[0]",
  "export:./kernel#inventoryCatalogFromSnapshot::call[0]",
  "type:src/catalog.ts#InventoryCatalog.activeFungibilityPool::call[0]",
  "type:src/catalog.ts#InventoryCatalog.fungibilityRevision::call[0]"
]);
var LOCAL_EQUATION_IDS = Object.freeze([
  "src/catalog.ts#InventoryCatalog.activeFungibilityPool",
  "src/catalog.ts#InventoryCatalog.constructor",
  "src/catalog.ts#InventoryCatalog.define",
  "src/catalog.ts#InventoryCatalog.fungibilityRevision",
  "src/catalog.ts#assertCompositionOutputLotPolicy",
  "src/catalog.ts#assertInventoryCatalogRetainsSnapshot",
  "src/catalog.ts#assertMeasurementAxis",
  "src/catalog.ts#assertPositionMatchesItem",
  "src/catalog.ts#assertTrackingRequirement",
  "src/catalog.ts#cloneAndFreezeInventoryCollectionRevision",
  "src/catalog.ts#cloneAndFreezeInventoryCompositionRevision",
  "src/catalog.ts#cloneAndFreezeInventoryFungibilityRevision",
  "src/catalog.ts#cloneAndFreezeInventoryIdentifiers",
  "src/catalog.ts#cloneAndFreezeInventoryItemRevision",
  "src/catalog.ts#cloneAndFreezeInventoryMeasurements",
  "src/catalog.ts#cloneAndFreezeInventoryMetadata",
  "src/catalog.ts#cloneAndFreezeInventoryMetadataValue",
  "src/catalog.ts#cloneAndFreezeInventoryPackagingRevision",
  "src/catalog.ts#cloneAndFreezeQuantity",
  "src/catalog.ts#compareCollectionMember",
  "src/catalog.ts#compareCollectionRevision",
  "src/catalog.ts#compareCollectionRollup",
  "src/catalog.ts#compareCollectionRollupMember",
  "src/catalog.ts#compareCompositionOutput",
  "src/catalog.ts#compareCompositionRevision",
  "src/catalog.ts#compareDimensionDefinition",
  "src/catalog.ts#compareFungibilityMember",
  "src/catalog.ts#compareFungibilityRevision",
  "src/catalog.ts#compareItemRevision",
  "src/catalog.ts#compareMeasurementAxisDefinition",
  "src/catalog.ts#comparePackagingRevision",
  "src/catalog.ts#compareTransformationLine",
  "src/catalog.ts#createInventoryCatalogParts",
  "src/catalog.ts#defineInventoryCatalog",
  "src/catalog.ts#defineInventoryCollection",
  "src/catalog.ts#defineInventoryComposition",
  "src/catalog.ts#defineInventoryFungibilityPool",
  "src/catalog.ts#defineInventoryItem",
  "src/catalog.ts#defineInventoryPackaging",
  "src/catalog.ts#defineInventoryTransformation",
  "src/catalog.ts#defineScalarInventoryFungibilityPool",
  "src/catalog.ts#defineScalarInventoryItem",
  "src/catalog.ts#defineScalarInventoryPackaging",
  "src/catalog.ts#emptyInventoryCatalogSnapshot",
  "src/catalog.ts#extendInventoryCatalog",
  "src/catalog.ts#findItemMeasurementAxis",
  "src/catalog.ts#inventoryCatalogDigest",
  "src/catalog.ts#inventoryCatalogFromSnapshot",
  "src/catalog.ts#inventoryCollectionRevisionDigest",
  "src/catalog.ts#inventoryCompositionRevisionDigest",
  "src/catalog.ts#inventoryFungibilityRevisionDigest",
  "src/catalog.ts#inventoryItemRevisionDigest",
  "src/catalog.ts#inventoryPackagingRevisionDigest",
  "src/catalog.ts#inventoryTransformationRevisionDigest",
  "src/catalog.ts#measurementAxisDefinitionDigest",
  "src/catalog.ts#mergeInventoryCatalogRevisionFamily",
  "src/catalog.ts#normalizeInventoryCollectionDefinitions",
  "src/catalog.ts#normalizeInventoryCollectionRollups",
  "src/catalog.ts#normalizeInventoryCompositionOutput",
  "src/catalog.ts#quantityDefinitionDigest",
  "src/catalog.ts#stringRecordDigest",
  "src/catalog.ts#validateCompositionGraph",
  "src/catalog.ts#validateInnerPackaging",
  "src/sparse-record.ts#createInventorySparseRecord",
  "src/sparse-record.ts#setInventorySparseRecordValue",
  "src/digest.ts#inventorySha256",
  "src/digest.ts#rotateRight",
  "src/measurements.ts#inventoryMeasurementsFingerprint",
  "src/measurements.ts#measurementFingerprint",
  "src/measurements.ts#scalarInventoryMeasurements"
]);
var SUPPORTING_VALUE_IDS2 = Object.freeze([
  "src/catalog.ts#InventoryCollectionMemberKind",
  "src/catalog.ts#InventoryCompositionOutputAmountKind",
  "src/catalog.ts#InventoryCompositionOutputLotPolicy",
  "src/catalog.ts#InventoryMeasurementAxisRole",
  "src/catalog.ts#InventoryMeasurementRequirement",
  "src/catalog.ts#InventoryTrackingRequirement",
  "src/digest.ts#SHA256_INITIAL_HASH",
  "src/digest.ts#SHA256_ROUND_CONSTANTS"
]);
var SOURCE_FILES2 = Object.freeze([
  "src/canonical.ts",
  "src/catalog.ts",
  "src/digest.ts",
  "src/index.ts",
  "src/kernel.ts",
  "src/measurements.ts",
  "src/model.ts",
  "src/ordering.ts",
  "src/quantity.ts",
  "src/sparse-record.ts"
]);
var ALLOWED_STANDARD_OPERATIONS2 = Object.freeze([
  "Array.includes",
  "Array.join",
  "Array.map",
  "Array.push",
  "Array.sort",
  "Array.isArray",
  "BigInt",
  "Error",
  "Map",
  "Map.get",
  "Map.has",
  "Map.keys",
  "Map.set",
  "Map.values",
  "Math.ceil",
  "Number",
  "Number.isFinite",
  "Number.isSafeInteger",
  "Number.toString",
  "Object.create",
  "Object.defineProperty",
  "Object.entries",
  "Object.freeze",
  "Object.values",
  "Set",
  "Set.add",
  "Set.delete",
  "Set.has",
  "String.padStart",
  "String.trim",
  "TextEncoder",
  "TextEncoder.encode",
  "Uint8Array",
  "Uint8Array.set",
  "Uint32Array"
]);
var FAMILY_LAWS2 = Object.freeze([
  Object.freeze({
    id: "catalog-definition-normalization-v1",
    equation: "Definitions validate exact identities, measurement axes and units, tracking, positive quantities, duplicate ids, graph membership and cycles before recursively cloning and freezing every retained value."
  }),
  Object.freeze({
    id: "catalog-complete-construction-v1",
    equation: "Complete catalog construction normalizes every revision family, rejects missing or mismatched active revisions, builds exact lookup maps, sorts all retained families, validates package/composition/collection graphs, and fingerprints the resulting immutable catalog."
  }),
  Object.freeze({
    id: "catalog-retention-and-extension-v1",
    equation: "Snapshot loading recomputes and checks the exact root digest; retention compares every retained revision digest; extension merges identical revisions, rejects changed identities, moves only supplied active pointers, and preserves object identity for an unchanged digest."
  }),
  Object.freeze({
    id: "catalog-digest-identity-v1",
    equation: "Revision and root digests include every meaning-bearing field in fixed order, sort unordered records and revision families, preserve the legacy empty-transformation root shape, and use the complete built-in-free SHA-256 equation."
  }),
  Object.freeze({
    id: "catalog-position-and-lookup-v1",
    equation: "Position validation enforces required and forbidden lot/serial identities and rejects undeclared qualified dimensions; fungibility lookups return exactly one retained revision or throw their exact unknown-identity error."
  })
]);
function lawIdForEquation2(equationId) {
  if (equationId.includes("Digest") || equationId.includes("Fingerprint") || equationId.startsWith("src/digest.ts#")) return "catalog-digest-identity-v1";
  if (equationId.includes("RetainsSnapshot") || equationId.includes("FromSnapshot") || equationId.includes("extendInventoryCatalog") || equationId.includes("mergeInventoryCatalog")) return "catalog-retention-and-extension-v1";
  if (equationId.includes("Position") || equationId.includes("TrackingRequirement") || equationId.includes("FungibilityPool") || equationId.includes("fungibilityRevision")) return "catalog-position-and-lookup-v1";
  if (equationId.includes("createInventorySparseRecord") || equationId.includes("createInventoryCatalogParts") || equationId.includes("InventoryCatalog.constructor") || equationId.includes("InventoryCatalog.define") || equationId.endsWith("#defineInventoryCatalog") || equationId.endsWith("#emptyInventoryCatalogSnapshot")) return "catalog-complete-construction-v1";
  return "catalog-definition-normalization-v1";
}

// experiments/tla-conformance/catalog-foundation-r7/normalize.mjs
import assert12 from "node:assert/strict";
function fail3(message) {
  throw new Error(`Catalogue equation normalization rejected: ${message}`);
}
function operatorName2(token) {
  return ts.tokenToString(token.kind) ?? ts.SyntaxKind[token.kind];
}
function normalizeCatalogCallable(declaration) {
  assert12(declaration.body !== void 0, "Equation callable needs a concrete body.");
  const counters = { local: 0, lambda: 0 };
  const environment = /* @__PURE__ */ new Map();
  function propertyName(name, scopedEnvironment) {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
      return ["fixed", name.text];
    }
    if (ts.isComputedPropertyName(name)) {
      return ["computed", expression(name.expression, scopedEnvironment)];
    }
    fail3(`unsupported property name '${name.getText()}'.`);
  }
  function bindingPattern(name, identity, scopedEnvironment) {
    if (ts.isIdentifier(name)) {
      scopedEnvironment.set(name.text, identity);
      return ["binding", identity];
    }
    if (ts.isObjectBindingPattern(name)) {
      return [
        "object-binding",
        name.elements.map((element, index) => {
          const property = element.propertyName === void 0 ? ts.isIdentifier(element.name) ? ["fixed", element.name.text] : ["position", index] : propertyName(element.propertyName, scopedEnvironment);
          const childIdentity = `${identity}.object:${index}`;
          return [
            element.dotDotDotToken === void 0 ? "field" : "rest",
            property,
            bindingPattern(element.name, childIdentity, scopedEnvironment),
            element.initializer === void 0 ? ["no-default"] : expression(element.initializer, scopedEnvironment)
          ];
        })
      ];
    }
    if (ts.isArrayBindingPattern(name)) {
      return [
        "array-binding",
        name.elements.map((element, index) => {
          if (ts.isOmittedExpression(element)) return ["omitted", index];
          const childIdentity = `${identity}.array:${index}`;
          return [
            element.dotDotDotToken === void 0 ? "element" : "rest",
            bindingPattern(element.name, childIdentity, scopedEnvironment),
            element.initializer === void 0 ? ["no-default"] : expression(element.initializer, scopedEnvironment)
          ];
        })
      ];
    }
    fail3(`unsupported binding pattern '${name.getText()}'.`);
  }
  function expression(node, scopedEnvironment = environment) {
    if (ts.isParenthesizedExpression(node)) return expression(node.expression, scopedEnvironment);
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) return expression(node.expression, scopedEnvironment);
    if (node.kind === ts.SyntaxKind.ThisKeyword) return ["this"];
    if (ts.isIdentifier(node)) {
      return ["reference", scopedEnvironment.get(node.text) ?? `source:${node.text}`];
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return ["string", node.text];
    }
    if (ts.isNumericLiteral(node)) return ["number", node.text];
    if (ts.isBigIntLiteral(node)) return ["bigint", node.text];
    if (ts.isRegularExpressionLiteral(node)) return ["regexp", node.text];
    if (node.kind === ts.SyntaxKind.TrueKeyword) return ["boolean", true];
    if (node.kind === ts.SyntaxKind.FalseKeyword) return ["boolean", false];
    if (node.kind === ts.SyntaxKind.NullKeyword) return ["null"];
    if (ts.isPropertyAccessExpression(node)) {
      return [
        "property",
        expression(node.expression, scopedEnvironment),
        node.name.text,
        node.questionDotToken === void 0 ? "required" : "optional"
      ];
    }
    if (ts.isElementAccessExpression(node)) {
      assert12(node.argumentExpression !== void 0);
      return [
        "element",
        expression(node.expression, scopedEnvironment),
        expression(node.argumentExpression, scopedEnvironment),
        node.questionDotToken === void 0 ? "required" : "optional"
      ];
    }
    if (ts.isCallExpression(node)) {
      return [
        "call",
        expression(node.expression, scopedEnvironment),
        node.arguments.map((argument) => expression(argument, scopedEnvironment)),
        node.questionDotToken === void 0 ? "required" : "optional"
      ];
    }
    if (ts.isNewExpression(node)) {
      return [
        "new",
        expression(node.expression, scopedEnvironment),
        (node.arguments ?? []).map((argument) => expression(argument, scopedEnvironment))
      ];
    }
    if (ts.isBinaryExpression(node)) {
      return [
        "binary",
        operatorName2(node.operatorToken),
        expression(node.left, scopedEnvironment),
        expression(node.right, scopedEnvironment)
      ];
    }
    if (ts.isConditionalExpression(node)) {
      return [
        "conditional",
        expression(node.condition, scopedEnvironment),
        expression(node.whenTrue, scopedEnvironment),
        expression(node.whenFalse, scopedEnvironment)
      ];
    }
    if (ts.isPrefixUnaryExpression(node)) {
      return [
        "prefix",
        ts.tokenToString(node.operator) ?? ts.SyntaxKind[node.operator],
        expression(node.operand, scopedEnvironment)
      ];
    }
    if (ts.isPostfixUnaryExpression(node)) {
      return [
        "postfix",
        ts.tokenToString(node.operator) ?? ts.SyntaxKind[node.operator],
        expression(node.operand, scopedEnvironment)
      ];
    }
    if (ts.isTypeOfExpression(node)) return ["typeof", expression(node.expression, scopedEnvironment)];
    if (ts.isVoidExpression(node)) return ["void", expression(node.expression, scopedEnvironment)];
    if (ts.isSpreadElement(node)) return ["spread", expression(node.expression, scopedEnvironment)];
    if (ts.isArrayLiteralExpression(node)) {
      return [
        "array",
        node.elements.map(
          (element) => ts.isOmittedExpression(element) ? ["omitted"] : expression(element, scopedEnvironment)
        )
      ];
    }
    if (ts.isObjectLiteralExpression(node)) {
      return [
        "record",
        node.properties.map((property) => {
          if (ts.isPropertyAssignment(property)) {
            return [
              "field",
              propertyName(property.name, scopedEnvironment),
              expression(property.initializer, scopedEnvironment)
            ];
          }
          if (ts.isShorthandPropertyAssignment(property)) {
            return [
              "field",
              ["fixed", property.name.text],
              expression(property.name, scopedEnvironment)
            ];
          }
          if (ts.isSpreadAssignment(property)) {
            return ["spread", expression(property.expression, scopedEnvironment)];
          }
          fail3(`unsupported object member '${property.getText()}'.`);
        })
      ];
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const childEnvironment = new Map(scopedEnvironment);
      const lambdaId = counters.lambda;
      counters.lambda += 1;
      const parameters2 = node.parameters.map((parameter, index) => ({
        pattern: bindingPattern(parameter.name, `lambda:${lambdaId}:${index}`, childEnvironment),
        optional: parameter.questionToken !== void 0,
        rest: parameter.dotDotDotToken !== void 0,
        default: parameter.initializer === void 0 ? null : expression(parameter.initializer, childEnvironment)
      }));
      return [
        "lambda",
        parameters2,
        ts.isBlock(node.body) ? statement(node.body, childEnvironment) : expression(node.body, childEnvironment)
      ];
    }
    if (ts.isTemplateExpression(node)) {
      return [
        "template",
        node.head.text,
        node.templateSpans.map((span) => [
          expression(span.expression, scopedEnvironment),
          span.literal.text
        ])
      ];
    }
    fail3(`unsupported expression '${ts.SyntaxKind[node.kind]}': ${node.getText()}`);
  }
  function branch(node, scopedEnvironment) {
    return ts.isBlock(node) ? ["block", statements(node.statements, new Map(scopedEnvironment))] : ["single", statement(node, new Map(scopedEnvironment))];
  }
  function statements(sourceStatements, scopedEnvironment) {
    return sourceStatements.map((sourceStatement) => statement(sourceStatement, scopedEnvironment));
  }
  function variableDeclaration(declaration2, scopedEnvironment) {
    const initializer = declaration2.initializer === void 0 ? ["undefined"] : expression(declaration2.initializer, scopedEnvironment);
    const identity = `local:${counters.local}`;
    counters.local += 1;
    return ["declaration", bindingPattern(declaration2.name, identity, scopedEnvironment), initializer];
  }
  function statement(node, scopedEnvironment = environment) {
    if (ts.isBlock(node)) return ["block", statements(node.statements, new Map(scopedEnvironment))];
    if (ts.isVariableStatement(node)) {
      const declarationKind = (node.declarationList.flags & ts.NodeFlags.Const) !== 0 ? "const" : (node.declarationList.flags & ts.NodeFlags.Let) !== 0 ? "let" : "var";
      return [
        "variables",
        declarationKind,
        node.declarationList.declarations.map(
          (declaration2) => variableDeclaration(declaration2, scopedEnvironment)
        )
      ];
    }
    if (ts.isIfStatement(node)) {
      return [
        "if",
        expression(node.expression, scopedEnvironment),
        branch(node.thenStatement, scopedEnvironment),
        node.elseStatement === void 0 ? ["no-else"] : branch(node.elseStatement, scopedEnvironment)
      ];
    }
    if (ts.isReturnStatement(node)) {
      return [
        "return",
        node.expression === void 0 ? ["undefined"] : expression(node.expression, scopedEnvironment)
      ];
    }
    if (ts.isThrowStatement(node)) return ["throw", expression(node.expression, scopedEnvironment)];
    if (ts.isExpressionStatement(node)) return ["expression", expression(node.expression, scopedEnvironment)];
    if (ts.isForOfStatement(node)) {
      const childEnvironment = new Map(scopedEnvironment);
      let initializer;
      if (ts.isVariableDeclarationList(node.initializer)) {
        const declarationKind = (node.initializer.flags & ts.NodeFlags.Const) !== 0 ? "const" : (node.initializer.flags & ts.NodeFlags.Let) !== 0 ? "let" : "var";
        initializer = [
          declarationKind,
          node.initializer.declarations.map(
            (declaration2) => variableDeclaration(declaration2, childEnvironment)
          )
        ];
      } else {
        initializer = ["assignment", expression(node.initializer, childEnvironment)];
      }
      return [
        "for-of",
        node.awaitModifier === void 0 ? "sync" : "await",
        initializer,
        expression(node.expression, scopedEnvironment),
        branch(node.statement, childEnvironment)
      ];
    }
    if (ts.isForStatement(node)) {
      const childEnvironment = new Map(scopedEnvironment);
      let initializer = ["none"];
      if (node.initializer !== void 0) {
        initializer = ts.isVariableDeclarationList(node.initializer) ? [
          (node.initializer.flags & ts.NodeFlags.Const) !== 0 ? "const" : (node.initializer.flags & ts.NodeFlags.Let) !== 0 ? "let" : "var",
          node.initializer.declarations.map(
            (declaration2) => variableDeclaration(declaration2, childEnvironment)
          )
        ] : ["expression", expression(node.initializer, childEnvironment)];
      }
      return [
        "for",
        initializer,
        node.condition === void 0 ? ["none"] : expression(node.condition, childEnvironment),
        node.incrementor === void 0 ? ["none"] : expression(node.incrementor, childEnvironment),
        branch(node.statement, childEnvironment)
      ];
    }
    if (ts.isWhileStatement(node)) {
      return [
        "while",
        expression(node.expression, scopedEnvironment),
        branch(node.statement, new Map(scopedEnvironment))
      ];
    }
    if (ts.isContinueStatement(node)) return ["continue"];
    if (ts.isBreakStatement(node)) return ["break"];
    fail3(`unsupported statement '${ts.SyntaxKind[node.kind]}': ${node.getText()}`);
  }
  const parameters = declaration.parameters.map((parameter, index) => ({
    pattern: bindingPattern(parameter.name, `parameter:${index}`, environment),
    optional: parameter.questionToken !== void 0,
    rest: parameter.dotDotDotToken !== void 0,
    default: parameter.initializer === void 0 ? null : expression(parameter.initializer, environment)
  }));
  return {
    async: declaration.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
    generator: declaration.asteriskToken !== void 0,
    parameters,
    body: ["block", statements(declaration.body.statements, environment)]
  };
}

// experiments/tla-conformance/catalog-foundation-r7/family.mjs
var CATALOG_FOUNDATION_SOURCE_BASE = "2eea09471b3bf8fcb61f38256e1c6a362149dad4";
var proofKind2 = "independent-catalog-foundation-closed-equations-v1";
var equationProgramPath2 = fileURLToPath7(
  new URL("./equations.expected.ts.txt", import.meta.url)
);
var reusedAuthoritySpecification = Object.freeze({
  file: "authority-r5/catalog-read-laws/catalog-extension.expected.ts.txt",
  sha256: "82def6081863bbb29e41a581c8cb455b14651dd6cccb319eda757ed4251c677e",
  equationIds: Object.freeze([
    "src/catalog.ts#extendInventoryCatalog",
    "src/catalog.ts#mergeInventoryCatalogRevisionFamily"
  ])
});
var producerFiles4 = Object.freeze([
  "experiments/tla-conformance/catalog-foundation-r7/contracts.mjs",
  "experiments/tla-conformance/catalog-foundation-r7/equations.expected.ts.txt",
  "experiments/tla-conformance/catalog-foundation-r7/family.mjs",
  "experiments/tla-conformance/catalog-foundation-r7/normalize.mjs"
]);
var passCache3 = /* @__PURE__ */ new WeakMap();
function fail4(message) {
  throw new Error(`Catalogue-foundation equation rejected: ${message}`);
}
function declarationKey4(repositoryRoot, declaration) {
  const source7 = declaration.getSourceFile();
  const file = path14.relative(repositoryRoot, source7.fileName).replaceAll("\\", "/");
  const name = ts.isConstructorDeclaration(declaration) ? "constructor" : declaration.name?.getText(source7);
  assert13(name !== void 0, "A source callable needs a stable name.");
  const owner = ts.isMethodDeclaration(declaration) || ts.isConstructorDeclaration(declaration) ? `${declaration.parent.name?.getText(source7)}.` : "";
  return `${file}#${owner}${name}`;
}
function resolveSymbol3(context, symbol) {
  return symbol !== void 0 && (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? context.checker.getAliasedSymbol(symbol) : symbol;
}
function visitRuntime2(node, visitor) {
  if (ts.isTypeNode(node)) return;
  visitor(node);
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) {
    visitRuntime2(node.expression, visitor);
    return;
  }
  ts.forEachChild(node, (child) => visitRuntime2(child, visitor));
}
function sourceCallableDeclaration2(context, symbol) {
  const resolved = resolveSymbol3(context, symbol);
  const callables = (resolved?.declarations ?? []).filter(
    (declaration) => !declaration.getSourceFile().isDeclarationFile && (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration) || ts.isConstructorDeclaration(declaration)) && declaration.body !== void 0
  );
  if (callables.length === 0) return void 0;
  assert13.equal(callables.length, 1, "Source callable symbol has ambiguous bodies.");
  return callables[0];
}
function findCallable2(sourceByFile, specificationSource, equationId) {
  const [file, qualifiedName] = equationId.split("#");
  const source7 = specificationSource ?? sourceByFile.get(file);
  assert13(source7 !== void 0, `Missing equation source '${file}'.`);
  const pieces = qualifiedName.split(".");
  if (pieces.length === 1) {
    const matches = source7.statements.filter(
      (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === qualifiedName && statement.body !== void 0
    );
    assert13.equal(matches.length, 1, `Expected one function '${equationId}'.`);
    return matches[0];
  }
  const [className, memberName] = pieces;
  const classes = source7.statements.filter(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === className
  );
  assert13.equal(classes.length, 1, `Expected one class '${className}'.`);
  const members = classes[0].members.filter((member2) => {
    if (memberName === "constructor") {
      return ts.isConstructorDeclaration(member2) && member2.body !== void 0;
    }
    return ts.isMethodDeclaration(member2) && ts.isIdentifier(member2.name) && member2.name.text === memberName && member2.body !== void 0;
  });
  assert13.equal(members.length, 1, `Expected one member '${equationId}'.`);
  return members[0];
}
function findSupportingValue2(sourceByFile, specificationSource, valueId) {
  const [file, name] = valueId.split("#");
  const source7 = specificationSource ?? sourceByFile.get(file);
  assert13(source7 !== void 0, `Missing supporting-value source '${file}'.`);
  const matches = source7.statements.filter((statement) => {
    if (ts.isEnumDeclaration(statement)) return statement.name.text === name;
    if (!ts.isVariableStatement(statement)) return false;
    return statement.declarationList.declarations.some(
      (declaration2) => ts.isIdentifier(declaration2.name) && declaration2.name.text === name
    );
  });
  assert13.equal(matches.length, 1, `Expected one supporting value '${valueId}'.`);
  if (ts.isEnumDeclaration(matches[0])) return matches[0];
  const declaration = matches[0].declarationList.declarations.find(
    (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name
  );
  assert13(declaration !== void 0);
  return declaration;
}
function normalizeSupportingValue2(declaration) {
  if (ts.isEnumDeclaration(declaration)) {
    return [
      "enum",
      declaration.members.map((member2) => [
        member2.name.getText(declaration.getSourceFile()),
        member2.initializer?.getText(declaration.getSourceFile()) ?? null
      ])
    ];
  }
  assert13(ts.isVariableDeclaration(declaration));
  assert13(declaration.initializer !== void 0);
  assert13(ts.isArrayLiteralExpression(declaration.initializer));
  return [
    "constant-array",
    declaration.initializer.elements.map((element) => {
      assert13(ts.isNumericLiteral(element), "Supporting arrays contain only numeric constants.");
      return element.text;
    })
  ];
}
function sourceSupportingValueId2(repositoryRoot, declaration) {
  if (declaration.getSourceFile().isDeclarationFile) return void 0;
  let owner = declaration;
  if (ts.isEnumMember(owner)) owner = owner.parent;
  if (!ts.isEnumDeclaration(owner) && !ts.isVariableDeclaration(owner)) return void 0;
  if (ts.isVariableDeclaration(owner) && !ts.isSourceFile(owner.parent.parent.parent)) {
    return void 0;
  }
  const file = path14.relative(repositoryRoot, owner.getSourceFile().fileName).replaceAll("\\", "/");
  const name = owner.name?.getText(owner.getSourceFile());
  return name === void 0 ? void 0 : `${file}#${name}`;
}
function trustedTypeScriptLibraryDirectory2(repositoryRoot) {
  const packagePath = fs11.realpathSync(
    path14.resolve(repositoryRoot, "node_modules/typescript/package.json")
  );
  return fs11.realpathSync(path14.join(path14.dirname(packagePath), "lib"));
}
function requireTrustedStandardDeclarationFile(repositoryRoot, fileName) {
  const actualFile = fs11.realpathSync(fileName);
  const typeScriptDirectory = trustedTypeScriptLibraryDirectory2(repositoryRoot);
  if (actualFile.startsWith(`${typeScriptDirectory}${path14.sep}`) && /^lib\.[^.].*\.d\.ts$/u.test(path14.basename(actualFile))) return actualFile;
  const nodePackagePath = fs11.realpathSync(
    path14.resolve(repositoryRoot, "node_modules/@types/node/package.json")
  );
  const nodeDirectory = fs11.realpathSync(path14.dirname(nodePackagePath));
  if (actualFile.startsWith(`${nodeDirectory}${path14.sep}`) && actualFile.endsWith(".d.ts")) return actualFile;
  fail4(`declaration '${fileName}' is outside trusted TypeScript and Node libraries.`);
}
function validateStandardRootIdentity2(context, call) {
  const expression = call.expression;
  let root3;
  if (ts.isIdentifier(expression) && ["BigInt", "Error", "Map", "Number", "Set", "TextEncoder", "Uint8Array", "Uint32Array"].includes(expression.text)) {
    root3 = expression;
  } else if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && ["Array", "Math", "Number", "Object"].includes(expression.expression.text)) {
    root3 = expression.expression;
  }
  if (root3 === void 0) return;
  const symbol = resolveSymbol3(context, context.checker.getSymbolAtLocation(root3));
  if (symbol === void 0 || (symbol.declarations ?? []).length === 0) {
    fail4(`standard root '${root3.text}' has no compiler declaration identity.`);
  }
  const runtimeDeclarations = symbol.declarations.filter(
    (declaration) => ts.isVariableDeclaration(declaration) || ts.isFunctionDeclaration(declaration) || ts.isClassDeclaration(declaration) || ts.isEnumDeclaration(declaration) || ts.isInterfaceDeclaration(declaration)
  );
  if (runtimeDeclarations.length === 0) {
    fail4(`standard root '${root3.text}' has no runtime declaration.`);
  }
  for (const declaration of runtimeDeclarations) {
    if (!declaration.getSourceFile().isDeclarationFile) {
      fail4(`standard root '${root3.text}' was replaced by package source.`);
    }
    requireTrustedStandardDeclarationFile(context.repositoryRoot, declaration.getSourceFile().fileName);
  }
}
function standardOperation2(context, call, target) {
  requireTrustedStandardDeclarationFile(context.repositoryRoot, target.getSourceFile().fileName);
  validateStandardRootIdentity2(context, call);
  const expression = call.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (!ts.isPropertyAccessExpression(expression)) {
    fail4(`dynamic native call '${expression.getText()}' is outside the plain-value domain.`);
  }
  if (ts.isIdentifier(expression.expression)) {
    const root3 = expression.expression.text;
    if (["Array", "Math", "Number", "Object"].includes(root3)) {
      return `${root3}.${expression.name.text}`;
    }
  }
  let ownerName = target.parent?.name?.getText(target.getSourceFile());
  if (ownerName === "ReadonlyArray") ownerName = "Array";
  if (ownerName === "ReadonlyMap") ownerName = "Map";
  if (ownerName === "ReadonlySet") ownerName = "Set";
  if (ownerName === "Number") ownerName = "Number";
  if (ownerName === void 0) {
    fail4(`native call '${expression.getText()}' has no fixed receiver declaration.`);
  }
  return `${ownerName}.${expression.name.text}`;
}
function isNestedInside(declaration, owner) {
  return declaration.getSourceFile() === owner.getSourceFile() && declaration.getStart() >= owner.body.getStart() && declaration.getEnd() <= owner.body.getEnd();
}
function callbackParameterIndex(context, owner, call) {
  if (!ts.isIdentifier(call.expression)) return void 0;
  const symbol = resolveSymbol3(context, context.checker.getSymbolAtLocation(call.expression));
  for (let index = 0; index < owner.parameters.length; index += 1) {
    const parameter = owner.parameters[index];
    const parameterSymbol = ts.isIdentifier(parameter.name) ? resolveSymbol3(context, context.checker.getSymbolAtLocation(parameter.name)) : void 0;
    if (parameterSymbol !== void 0 && parameterSymbol === symbol) return index;
  }
  return void 0;
}
function inspectActualEquation2(context, repositoryRoot, declaration) {
  const sourceDependencies = /* @__PURE__ */ new Set();
  const supportingValues = /* @__PURE__ */ new Set();
  const standardOperations = /* @__PURE__ */ new Set();
  const standardDeclarations = /* @__PURE__ */ new Map();
  const callbackDependencies = /* @__PURE__ */ new Set();
  const discoveredCallables = /* @__PURE__ */ new Map();
  visitRuntime2(declaration.body, (node) => {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const symbolNode = ts.isPropertyAccessExpression(node) ? node.name : node.argumentExpression;
      const symbol = symbolNode === void 0 ? void 0 : resolveSymbol3(context, context.checker.getSymbolAtLocation(symbolNode));
      for (const candidate of symbol?.declarations ?? []) {
        if (ts.isGetAccessorDeclaration(candidate) || ts.isSetAccessorDeclaration(candidate)) {
          fail4(`accessor-backed value '${node.getText()}' is outside the immutable data domain.`);
        }
      }
    }
    if (ts.isIdentifier(node)) {
      const symbol = resolveSymbol3(context, context.checker.getSymbolAtLocation(node));
      const callable = sourceCallableDeclaration2(context, symbol);
      if (callable !== void 0 && callable !== declaration && !isNestedInside(callable, declaration)) {
        const key = declarationKey4(repositoryRoot, callable);
        sourceDependencies.add(key);
        discoveredCallables.set(key, callable);
      }
      for (const candidate of symbol?.declarations ?? []) {
        const valueId = sourceSupportingValueId2(repositoryRoot, candidate);
        if (valueId !== void 0) {
          if (!SUPPORTING_VALUE_IDS2.includes(valueId)) {
            fail4(`unknown nonlocal runtime value '${valueId}' in '${declarationKey4(repositoryRoot, declaration)}'.`);
          }
          supportingValues.add(valueId);
        }
      }
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callbackIndex = callbackParameterIndex(context, declaration, node);
      if (callbackIndex !== void 0) {
        callbackDependencies.add(`parameter:${callbackIndex}`);
        return;
      }
      const target = context.checker.getResolvedSignature(node)?.declaration;
      if (target === void 0) fail4(`unresolved call '${node.getText()}'.`);
      if (isNestedInside(target, declaration)) return;
      if (target.getSourceFile().isDeclarationFile) {
        const operation = standardOperation2(context, node, target);
        if (!ALLOWED_STANDARD_OPERATIONS2.includes(operation)) {
          fail4(`native operation '${operation}' is not independently admitted.`);
        }
        standardOperations.add(operation);
        const targetSpan = spanOf(context, target);
        standardDeclarations.set(
          `${operation}:${targetSpan.file}:${targetSpan.start.offset}`,
          { operation, declaration: targetSpan }
        );
        return;
      }
      if ((ts.isFunctionDeclaration(target) || ts.isMethodDeclaration(target) || ts.isConstructorDeclaration(target)) && target.body !== void 0) {
        const key = declarationKey4(repositoryRoot, target);
        sourceDependencies.add(key);
        discoveredCallables.set(key, target);
        return;
      }
      fail4(`source call '${node.getText()}' has no named equation body.`);
    }
  });
  return {
    sourceDependencies: [...sourceDependencies].sort(compareCodeUnits),
    supportingValues: [...supportingValues].sort(compareCodeUnits),
    standardOperations: [...standardOperations].sort(compareCodeUnits),
    standardDeclarations: [...standardDeclarations.values()].sort(
      (left, right) => compareCodeUnits(
        `${left.operation}:${left.declaration.file}:${left.declaration.start.offset}`,
        `${right.operation}:${right.declaration.file}:${right.declaration.start.offset}`
      )
    ),
    callbackDependencies: [...callbackDependencies].sort(compareCodeUnits),
    discoveredCallables
  };
}
function expectedDependencies2(declaration, allEquationIds) {
  const functionByName = /* @__PURE__ */ new Map();
  const methodByName = /* @__PURE__ */ new Map();
  for (const equationId of allEquationIds) {
    const qualifiedName = equationId.split("#")[1];
    const pieces = qualifiedName.split(".");
    if (pieces.length === 1) functionByName.set(pieces[0], equationId);
    else methodByName.set(pieces[1], equationId);
  }
  const supportingByName = new Map(
    SUPPORTING_VALUE_IDS2.map((valueId) => [valueId.split("#")[1], valueId])
  );
  const sourceDependencies = /* @__PURE__ */ new Set();
  const supportingValues = /* @__PURE__ */ new Set();
  visitRuntime2(declaration.body, (node) => {
    if (ts.isIdentifier(node)) {
      const supporting = supportingByName.get(node.text);
      if (supporting !== void 0) supportingValues.add(supporting);
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        if (ts.isNewExpression(node) && node.expression.text === "InventoryCatalog") {
          sourceDependencies.add("src/catalog.ts#InventoryCatalog.constructor");
        } else {
          const dependency2 = functionByName.get(node.expression.text);
          if (dependency2 !== void 0) sourceDependencies.add(dependency2);
        }
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        const dependency2 = methodByName.get(node.expression.name.text);
        if (dependency2 !== void 0) sourceDependencies.add(dependency2);
      }
      for (const argument of node.arguments ?? []) {
        if (!ts.isIdentifier(argument)) continue;
        const dependency2 = functionByName.get(argument.text);
        if (dependency2 !== void 0) sourceDependencies.add(dependency2);
      }
    }
  });
  return {
    sourceDependencies: [...sourceDependencies].sort(compareCodeUnits),
    supportingValues: [...supportingValues].sort(compareCodeUnits)
  };
}
function expectedCallbackDependencies(equationId) {
  return equationId === "src/catalog.ts#mergeInventoryCatalogRevisionFamily" ? ["parameter:2", "parameter:3"] : [];
}
function effectProfile(declaration) {
  const profile = {
    assignments: 0,
    propertyAssignments: 0,
    thisAssignments: 0,
    updates: 0,
    throws: 0,
    returns: 0,
    breaks: 0,
    continues: 0,
    mutatingMethodCalls: []
  };
  const mutatingMethods = /* @__PURE__ */ new Set(["add", "delete", "push", "set", "sort"]);
  visitRuntime2(declaration.body, (node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      profile.assignments += 1;
      if (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left)) {
        profile.propertyAssignments += 1;
        const receiver = node.left.expression;
        if (receiver.kind === ts.SyntaxKind.ThisKeyword) profile.thisAssignments += 1;
      }
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) profile.updates += 1;
    if (ts.isThrowStatement(node)) profile.throws += 1;
    if (ts.isReturnStatement(node)) profile.returns += 1;
    if (ts.isBreakStatement(node)) profile.breaks += 1;
    if (ts.isContinueStatement(node)) profile.continues += 1;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && mutatingMethods.has(node.expression.name.text)) profile.mutatingMethodCalls.push(node.expression.name.text);
  });
  profile.mutatingMethodCalls.sort(compareCodeUnits);
  return profile;
}
function loadOverriddenContext2(repositoryRoot, sourceOverrides) {
  const root3 = path14.resolve(repositoryRoot);
  for (const file of sourceOverrides.keys()) {
    if (!SOURCE_FILES2.includes(file)) fail4(`source override '${file}' is outside the closed family.`);
  }
  const configPath = path14.join(root3, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error !== void 0) fail4("cannot read TypeScript configuration for mutation control.");
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root3, void 0, configPath);
  if (parsed.errors.length !== 0) fail4("TypeScript configuration diagnostics changed.");
  const overridesByAbsolutePath = new Map(
    [...sourceOverrides].map(([file, text]) => [path14.resolve(root3, file), text])
  );
  const host = ts.createCompilerHost(parsed.options, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const override = overridesByAbsolutePath.get(path14.resolve(fileName));
    return override === void 0 ? originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) : ts.createSourceFile(fileName, override, languageVersion, true, ts.ScriptKind.TS);
  };
  host.readFile = (fileName) => overridesByAbsolutePath.get(path14.resolve(fileName)) ?? ts.sys.readFile(fileName);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, host });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length !== 0) {
    fail4(`mutated compiler program has ${diagnostics.length} diagnostic(s).`);
  }
  return { repositoryRoot: root3, program, checker: program.getTypeChecker() };
}
function loadSpecification2() {
  const bytes2 = fs11.readFileSync(equationProgramPath2);
  const source7 = ts.createSourceFile(
    equationProgramPath2,
    bytes2.toString("utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  assert13.equal(source7.parseDiagnostics.length, 0, "Independent equation program has syntax errors.");
  return { bytes: bytes2, source: source7 };
}
function catalogEquationId(repositoryRoot, context, artifact, proof) {
  const source7 = context.program.getSourceFile(path14.resolve(repositoryRoot, proof.implementation.file));
  assert13(source7 !== void 0);
  const declaration = nodeAtExactSpan(
    source7,
    proof.implementation.start.offset,
    proof.implementation.end.offset
  );
  assert13(
    declaration !== void 0 && (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) && declaration.body !== void 0
  );
  return declarationKey4(repositoryRoot, declaration);
}
function mergeInputs(rows) {
  const byFile = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const old = byFile.get(row.file);
    assert13(old === void 0 || old.sha256 === row.sha256, `Conflicting semantic input '${row.file}'.`);
    byFile.set(row.file, row);
  }
  return [...byFile.values()].sort((left, right) => compareCodeUnits(left.file, right.file));
}
function buildCatalogFoundationFamilyArtifact({
  repositoryRoot,
  context,
  surface,
  sourceOverrides = /* @__PURE__ */ new Map()
}) {
  const root3 = path14.resolve(repositoryRoot);
  assert13.equal(ASSIGNED_SURFACE_KEYS3.length, 36);
  assert13.equal(new Set(ASSIGNED_SURFACE_KEYS3).size, 36);
  assert13.equal(LOCAL_EQUATION_IDS.length, 70);
  assert13.equal(new Set(LOCAL_EQUATION_IDS).size, 70);
  const { bytes: specificationBytes, source: specificationSource } = loadSpecification2();
  const quantityOverrides = new Map(
    [...sourceOverrides].filter(
      ([file]) => ["src/canonical.ts", "src/measurements.ts", "src/ordering.ts", "src/quantity.ts"].includes(file)
    )
  );
  const catalogOverrides = new Map(
    [...sourceOverrides].filter(
      ([file]) => ["src/catalog.ts", "src/facade.ts", "src/model.ts", "src/ordering.ts"].includes(file)
    )
  );
  const identityOverrides = new Map(
    [...sourceOverrides].filter(
      ([file]) => [
        "src/amounts.ts",
        "src/canonical.ts",
        "src/catalog.ts",
        "src/measurements.ts",
        "src/model.ts",
        "src/ordering.ts",
        "src/quantity.ts",
        "src/selectors.ts",
        "src/usability.ts"
      ].includes(file)
    )
  );
  const quantityArtifact = buildFamilyArtifact3({
    repositoryRoot: root3,
    context,
    surface,
    sourceOverrides: quantityOverrides
  });
  const catalogArtifact = buildCatalogFamilyArtifact({
    repositoryRoot: root3,
    context,
    surface,
    sourceOverrides: catalogOverrides
  });
  const identityArtifact = buildFamilyArtifact2({
    repositoryRoot: root3,
    context,
    surface,
    sourceOverrides: identityOverrides
  });
  const quantityArtifactDigest = sha256(canonicalJson(quantityArtifact));
  const catalogArtifactDigest = sha256(canonicalJson(catalogArtifact));
  const identityArtifactDigest = sha256(canonicalJson(identityArtifact));
  const localInputs = [.../* @__PURE__ */ new Set([...SOURCE_FILES2, ...producerFiles4])].map((file) => ({
    file,
    sha256: sha256(sourceOverrides.get(file) ?? fs11.readFileSync(path14.resolve(root3, file)))
  }));
  const inputs3 = mergeInputs([
    ...localInputs,
    ...quantityArtifact.inputs,
    ...catalogArtifact.inputs,
    ...identityArtifact.inputs
  ]);
  const cacheKey = sha256(canonicalJson({
    surfaceDigest: surface.digest,
    inputs: inputs3,
    quantityArtifactDigest,
    catalogArtifactDigest,
    identityArtifactDigest
  }));
  const cached2 = sourceOverrides.size === 0 ? passCache3.get(context) : void 0;
  if (cached2?.key === cacheKey) return cached2.value;
  const activeContext = sourceOverrides.size === 0 ? context : loadOverriddenContext2(root3, sourceOverrides);
  assert13.equal(path14.resolve(activeContext.repositoryRoot), root3);
  const sourceByFile = new Map(
    SOURCE_FILES2.map((file) => {
      const source7 = activeContext.program.getSourceFile(path14.resolve(root3, file));
      assert13(source7 !== void 0 && !source7.isDeclarationFile, `Missing compiler source '${file}'.`);
      return [file, source7];
    })
  );
  const expectedById = new Map(
    LOCAL_EQUATION_IDS.map((equationId) => [
      equationId,
      findCallable2(sourceByFile, specificationSource, equationId)
    ])
  );
  const expectedSupportingById = new Map(
    SUPPORTING_VALUE_IDS2.map((valueId) => [
      valueId,
      findSupportingValue2(sourceByFile, specificationSource, valueId)
    ])
  );
  const externalEquationIds = new Set(identityArtifact.equations.map((equation3) => equation3.id));
  for (const helper of catalogArtifact.helperEquations) externalEquationIds.add(helper.key);
  for (const proof of catalogArtifact.proofs) {
    externalEquationIds.add(catalogEquationId(root3, activeContext, catalogArtifact, proof));
  }
  const quantityEquations = [
    ...quantityArtifact.semanticCore.memberEquations,
    ...quantityArtifact.semanticCore.helperEquations
  ];
  const quantityEquationIds = new Set(quantityEquations.map((equation3) => equation3.id));
  const allExpectedEquationIds = [.../* @__PURE__ */ new Set([
    ...LOCAL_EQUATION_IDS,
    ...externalEquationIds,
    ...quantityEquationIds
  ])];
  const callableByKey = new Map(surface.callables.map((callable) => [callable.key, callable]));
  const publicProofSeeds = [];
  const pendingLocal = [];
  const usedExternalDependencies = /* @__PURE__ */ new Set();
  for (const surfaceKey of ASSIGNED_SURFACE_KEYS3) {
    const callable = callableByKey.get(surfaceKey);
    assert13(callable !== void 0, `Compiler omitted assigned callable '${surfaceKey}'.`);
    assert13.equal(
      callable.signatureHash,
      sha256(canonicalJson(callable.signature)),
      `Compiler signature identity drifted for '${surfaceKey}'.`
    );
    const qualifiedName = surfaceKey.slice(surfaceKey.indexOf("#") + 1, surfaceKey.indexOf("::"));
    const equationId = `src/catalog.ts#${qualifiedName}`;
    assert13(
      LOCAL_EQUATION_IDS.includes(equationId) || externalEquationIds.has(equationId),
      `Assigned callable has no local or reused equation '${equationId}'.`
    );
    let implementation;
    if (sourceOverrides.size === 0) {
      const source7 = sourceByFile.get(callable.declaration.file);
      assert13(source7 !== void 0, `Callable source is outside the closed family: ${surfaceKey}`);
      implementation = nodeAtExactSpan(
        source7,
        callable.declaration.start.offset,
        callable.declaration.end.offset
      );
      assert13(
        implementation !== void 0 && (ts.isFunctionDeclaration(implementation) || ts.isMethodDeclaration(implementation)) && implementation.body !== void 0,
        `Callable '${surfaceKey}' is not one exact implementation.`
      );
      assert13.equal(
        canonicalJson(callable.declaration),
        canonicalJson(spanOf(activeContext, implementation)),
        `Compiler span changed for '${surfaceKey}'.`
      );
    } else {
      implementation = findCallable2(sourceByFile, void 0, equationId);
    }
    if (LOCAL_EQUATION_IDS.includes(equationId)) pendingLocal.push(implementation);
    else usedExternalDependencies.add(equationId);
    publicProofSeeds.push({ surfaceKey, callable, implementation, equationId });
  }
  const actualLocalById = /* @__PURE__ */ new Map();
  while (pendingLocal.length > 0) {
    const declaration = pendingLocal.shift();
    const equationId = declarationKey4(root3, declaration);
    if (actualLocalById.has(equationId)) continue;
    assert13(LOCAL_EQUATION_IDS.includes(equationId), `Unexpected local equation '${equationId}'.`);
    const inspected = inspectActualEquation2(activeContext, root3, declaration);
    actualLocalById.set(equationId, { declaration, inspected });
    for (const [dependencyId, dependency2] of inspected.discoveredCallables) {
      if (LOCAL_EQUATION_IDS.includes(dependencyId)) pendingLocal.push(dependency2);
      else {
        assert13(externalEquationIds.has(dependencyId), `Uncertified source dependency '${dependencyId}'.`);
        usedExternalDependencies.add(dependencyId);
      }
    }
  }
  assert13.equal(
    canonicalJson([...actualLocalById.keys()].sort(compareCodeUnits)),
    canonicalJson([...LOCAL_EQUATION_IDS].sort(compareCodeUnits)),
    "The compiler-resolved local source-callable closure changed."
  );
  const supportingValues = SUPPORTING_VALUE_IDS2.map((valueId) => {
    const expected = expectedSupportingById.get(valueId);
    const actual = findSupportingValue2(sourceByFile, void 0, valueId);
    const expectedTerm = normalizeSupportingValue2(expected);
    const actualTerm = normalizeSupportingValue2(actual);
    assert13.equal(
      canonicalJson(actualTerm),
      canonicalJson(expectedTerm),
      `Supporting runtime value changed: ${valueId}`
    );
    return { id: valueId, declaration: spanOf(activeContext, actual), term: expectedTerm };
  });
  const equations2 = LOCAL_EQUATION_IDS.map((equationId) => {
    const actualRow = actualLocalById.get(equationId);
    const expectedDeclaration = expectedById.get(equationId);
    assert13(actualRow !== void 0 && expectedDeclaration !== void 0);
    const expectedTerm = normalizeCatalogCallable(expectedDeclaration);
    const actualTerm = normalizeCatalogCallable(actualRow.declaration);
    assert13.equal(
      canonicalJson(actualTerm),
      canonicalJson(expectedTerm),
      `Independent complete term changed: ${equationId}`
    );
    const expectedDependency = expectedDependencies2(expectedDeclaration, allExpectedEquationIds);
    assert13.equal(
      canonicalJson(actualRow.inspected.sourceDependencies),
      canonicalJson(expectedDependency.sourceDependencies),
      `Compiler-resolved source dependencies changed: ${equationId}`
    );
    assert13.equal(
      canonicalJson(actualRow.inspected.supportingValues),
      canonicalJson(expectedDependency.supportingValues),
      `Compiler-resolved supporting values changed: ${equationId}`
    );
    assert13.equal(
      canonicalJson(actualRow.inspected.callbackDependencies),
      canonicalJson(expectedCallbackDependencies(equationId)),
      `Callback dependencies changed: ${equationId}`
    );
    const expectedEffects = effectProfile(expectedDeclaration);
    const actualEffects = effectProfile(actualRow.declaration);
    assert13.equal(
      canonicalJson(actualEffects),
      canonicalJson(expectedEffects),
      `Explicit effect profile changed: ${equationId}`
    );
    return {
      id: equationId,
      lawId: lawIdForEquation2(equationId),
      declaration: spanOf(activeContext, actualRow.declaration),
      term: expectedTerm,
      termSha256: sha256(canonicalJson(expectedTerm)),
      dependencies: expectedDependency.sourceDependencies,
      supportingValues: expectedDependency.supportingValues,
      standardOperations: actualRow.inspected.standardOperations,
      standardDeclarations: actualRow.inspected.standardDeclarations,
      callbackDependencies: expectedCallbackDependencies(equationId),
      effects: expectedEffects
    };
  });
  const equationById2 = new Map(equations2.map((equation3) => [equation3.id, equation3]));
  const allStandardOperations = new Set(
    equations2.flatMap((equation3) => equation3.standardOperations)
  );
  assert13.equal(
    canonicalJson([...allStandardOperations].sort(compareCodeUnits)),
    canonicalJson([...ALLOWED_STANDARD_OPERATIONS2].sort(compareCodeUnits)),
    "Native-operation closure differs from the independently declared set."
  );
  const externalDependencyRows = [...usedExternalDependencies].sort(compareCodeUnits).map((equationId) => {
    const identityEquation = identityArtifact.equations.find((equation3) => equation3.id === equationId);
    if (identityEquation !== void 0) {
      return {
        equationId,
        proofKind: identityValuesProofKind,
        artifactSha256: identityArtifactDigest,
        declaration: identityEquation.declaration,
        termSha256: sha256(canonicalJson(identityEquation.term))
      };
    }
    const catalogHelper = catalogArtifact.helperEquations.find((equation3) => equation3.key === equationId);
    if (catalogHelper !== void 0) {
      return {
        equationId,
        proofKind: catalogProofKind,
        artifactSha256: catalogArtifactDigest,
        declaration: catalogHelper.declaration,
        termSha256: sha256(canonicalJson(catalogHelper.term))
      };
    }
    const catalogProofs = catalogArtifact.proofs.filter(
      (proof) => catalogEquationId(root3, activeContext, catalogArtifact, proof) === equationId
    );
    assert13.equal(catalogProofs.length, 1, `Expected one reused catalog equation '${equationId}'.`);
    return {
      equationId,
      proofKind: catalogProofKind,
      artifactSha256: catalogArtifactDigest,
      declaration: catalogProofs[0].implementation,
      sourceSurfaceKey: catalogProofs[0].surfaceKey,
      termSha256: sha256(canonicalJson(catalogProofs[0].term))
    };
  });
  const proofs = publicProofSeeds.map(({ surfaceKey, callable, implementation, equationId }) => ({
    surfaceKey,
    signatureHash: callable.signatureHash,
    signature: callable.signature,
    declaration: callable.declaration,
    implementation: spanOf(activeContext, implementation),
    relation: sourceOverrides.size === 0 ? {
      kind: "COMPILER_RESOLVED_EXACT_EXPORT",
      reachabilityPaths: callable.reachabilityPaths,
      symbolDeclarations: callable.symbolDeclarations
    } : { kind: "MUTATION_CONTROL_ONLY" },
    equationId,
    lawId: LOCAL_EQUATION_IDS.includes(equationId) ? equationById2.get(equationId).lawId : "catalog-definition-normalization-v1",
    dependencies: LOCAL_EQUATION_IDS.includes(equationId) ? equationById2.get(equationId).dependencies : [],
    ...LOCAL_EQUATION_IDS.includes(equationId) ? {} : {
      reusedFrom: externalDependencyRows.find((row) => row.equationId === equationId) ?? {
        equationId,
        proofKind: identityValuesProofKind,
        artifactSha256: identityArtifactDigest
      }
    }
  }));
  assert13.equal(
    canonicalJson(proofs.map((proof) => proof.surfaceKey)),
    canonicalJson(ASSIGNED_SURFACE_KEYS3),
    "Public proof order or identity changed."
  );
  const uniqueImplementations = new Set(proofs.map((proof) => proof.equationId));
  assert13.equal(uniqueImplementations.size, 19, "Assigned aliases no longer share 19 implementations.");
  const quantityDependencyIds = [...usedExternalDependencies].filter((equationId) => quantityEquationIds.has(equationId)).sort(compareCodeUnits);
  const resultWithoutId = {
    schemaVersion: 1,
    mode: "V",
    proofKind: proofKind2,
    familyId: CATALOG_FOUNDATION_FAMILY_ID,
    sourceBase: CATALOG_FOUNDATION_SOURCE_BASE,
    surfaceDigest: surface.digest,
    domain: {
      id: "VALIDATED_IMMUTABLE_CATALOG_FOUNDATION_VALUES_V1",
      quantified: "Every non-proxied plain-value input satisfying the published TypeScript shapes and every guard in the complete normalized equations; no fixture or finite-sample restriction.",
      exactness: "Quantities, units, revision ids, active pointers, graph membership, root/revision digests, and SHA-256 words use the exact equations and rejection branches; there is no epsilon arithmetic.",
      storage: "Only fresh local arrays, maps, sets, typed arrays, records, or a newly allocated InventoryCatalog instance are mutated; caller-owned inputs and retained catalog state remain read-only.",
      builtins: "Array, Map, Set, Object, Number, Math, String, TextEncoder, Uint8Array, Uint32Array, BigInt, and Error operations resolve to real installed TypeScript standard-library declarations and use ordinary unmodified runtime semantics.",
      callbacks: "The private revision-family merge invokes only its two named parameters; the public extension equation binds every call to an inline revision-id projection and one exact independently checked revision-digest equation."
    },
    excluded: [
      "Proxies, accessors, subclasses, monkey-patched built-ins, custom collection/string/typed-array lookalikes, and own-property method shadowing.",
      "Concurrent mutation of inputs, catalog values, prototypes, or the source compiler snapshot during a call.",
      "Calling the private generic merge helper outside the exact bindings present in extendInventoryCatalog."
    ],
    allAdmittedInputs: true,
    sampledInputs: 0,
    sourceCallableClosureComplete: true,
    localEquationCount: equations2.length,
    externalEquationDependencyCount: externalDependencyRows.length,
    assignedSurfaceCount: proofs.length,
    uniqueImplementationCount: uniqueImplementations.size,
    inputs: inputs3,
    specification: {
      file: path14.relative(root3, equationProgramPath2).replaceAll("\\", "/"),
      sha256: sha256(specificationBytes),
      independentlyDeclared: true,
      executedProductionCode: false,
      reusedAuthoritySpecification
    },
    reusedCertificates: [
      {
        proofKind: quantityArtifact.proofKind,
        artifactSha256: quantityArtifactDigest,
        surfaceDigest: quantityArtifact.surfaceDigest,
        equationIds: quantityDependencyIds
      },
      {
        proofKind: identityValuesProofKind,
        artifactSha256: identityArtifactDigest,
        surfaceDigest: identityArtifact.surfaceDigest,
        equationIds: externalDependencyRows.filter((row) => row.proofKind === identityValuesProofKind).map((row) => row.equationId)
      },
      {
        proofKind: catalogProofKind,
        artifactSha256: catalogArtifactDigest,
        surfaceDigest: catalogArtifact.surfaceDigest,
        equationIds: externalDependencyRows.filter((row) => row.proofKind === catalogProofKind).map((row) => row.equationId)
      }
    ],
    laws: FAMILY_LAWS2,
    supportingValues,
    equations: equations2,
    externalDependencies: externalDependencyRows,
    proofs
  };
  const result = {
    ...resultWithoutId,
    certificateId: `sha256:${sha256(canonicalJson(resultWithoutId))}`
  };
  if (sourceOverrides.size === 0) passCache3.set(context, { key: cacheKey, value: result });
  return result;
}
var buildFamilyArtifact4 = buildCatalogFoundationFamilyArtifact;
var supportedSurfaceKeys4 = ASSIGNED_SURFACE_KEYS3;

// experiments/tla-conformance/quantity-values-r7/event-values/contracts.mjs
var EVENT_VALUES_PROOF_KIND = "inventoryonce-event-replacement-complete-source-equations-v1";
var EVENT_VALUES_SOURCE_BASE = "428f50a0abdf1dec0d96d36419d51df106247044";
var EVENT_VALUES_SURFACE_DIGEST = "ec078013972d9ee2b4ba84d28cfa7449a18dc29679d81766e314db6a6139b81e";
var ASSIGNED_SURFACE_KEYS4 = Object.freeze([
  "export:./kernel#assertCanonicalInventoryTime::call[0]",
  "export:./kernel#commitInventoryEvent::call[0]",
  "export:./kernel#createInventoryContainerMetadataEvent::call[0]",
  "export:./kernel#createInventoryIssueEvent::call[0]",
  "export:./kernel#createInventoryIssueManyEvent::call[0]",
  "export:./kernel#createInventoryLotMetadataEvent::call[0]",
  "export:./kernel#createInventoryOpeningEvent::call[0]",
  "export:./kernel#createInventoryPackEvent::call[0]",
  "export:./kernel#createInventoryReceiptEvent::call[0]",
  "export:./kernel#createInventoryReceiptManyEvent::call[0]",
  "export:./kernel#createInventoryScrapEvent::call[0]",
  "export:./kernel#createInventoryScrapManyEvent::call[0]",
  "export:./kernel#createInventoryTraceabilityEvent::call[0]",
  "export:./kernel#createInventoryTransformationEvent::call[0]",
  "export:./kernel#createInventoryUnpackEvent::call[0]",
  "export:./kernel#defineInventoryEvent::call[0]",
  "export:./kernel#inventoryEventIdForOperation::call[0]",
  "export:./kernel#inventoryEventIntentFingerprint::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.aggregate::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.associate::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.changeCustodian::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.changeDispositionAuthority::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.changeOwner::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.changeQualifiedDimension::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.changeStatus::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.clearCustodian::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.clearDispositionAuthority::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.clearOwner::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.clearQualifiedDimension::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.clearStatus::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.containerMetadata::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.countAdjustment::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.disaggregate::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.disassociate::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.issue::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.lotMetadata::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.omit::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.opening::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.pack::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.placeInContainer::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.receive::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.removeFromContainer::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.scrap::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.transform::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.unpack::call[0]"
]);
var LOCALLY_CLOSED_SURFACE_KEYS = Object.freeze([
  "export:./kernel#assertCanonicalInventoryTime::call[0]",
  "export:./kernel#commitInventoryEvent::call[0]",
  "export:./kernel#inventoryEventIdForOperation::call[0]",
  "export:./kernel#inventoryEventIntentFingerprint::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.omit::call[0]"
]);
var EXPORTED_FUNCTION_SOURCE = Object.freeze({
  assertCanonicalInventoryTime: "src/events.ts",
  commitInventoryEvent: "src/events.ts",
  createInventoryContainerMetadataEvent: "src/commands.ts",
  createInventoryIssueEvent: "src/commands.ts",
  createInventoryIssueManyEvent: "src/commands.ts",
  createInventoryLotMetadataEvent: "src/commands.ts",
  createInventoryOpeningEvent: "src/commands.ts",
  createInventoryPackEvent: "src/commands.ts",
  createInventoryReceiptEvent: "src/commands.ts",
  createInventoryReceiptManyEvent: "src/commands.ts",
  createInventoryScrapEvent: "src/commands.ts",
  createInventoryScrapManyEvent: "src/commands.ts",
  createInventoryTraceabilityEvent: "src/commands.ts",
  createInventoryTransformationEvent: "src/commands.ts",
  createInventoryUnpackEvent: "src/commands.ts",
  defineInventoryEvent: "src/events.ts",
  inventoryEventIdForOperation: "src/commands.ts",
  inventoryEventIntentFingerprint: "src/events.ts"
});
var REPLACEMENT_METHOD_NAMES = Object.freeze([
  "aggregate",
  "associate",
  "changeCustodian",
  "changeDispositionAuthority",
  "changeOwner",
  "changeQualifiedDimension",
  "changeStatus",
  "clearCustodian",
  "clearDispositionAuthority",
  "clearOwner",
  "clearQualifiedDimension",
  "clearStatus",
  "containerMetadata",
  "countAdjustment",
  "disaggregate",
  "disassociate",
  "issue",
  "lotMetadata",
  "omit",
  "opening",
  "pack",
  "placeInContainer",
  "receive",
  "removeFromContainer",
  "scrap",
  "transform",
  "unpack"
]);
var LOCAL_SOURCE_FILES = Object.freeze([
  "src/commands.ts",
  "src/events.ts",
  "src/facade.ts"
]);
var EXPECTED_SOURCE_SHA256 = Object.freeze({
  "src/amounts.ts": "98ddc0fa8d80b2ca244a207f4eb8b55d86131c2ccfd77620da5c85248d03ef57",
  "src/canonical.ts": "eb2981c629182525c6742d2a67f513f0daec88507e5861f475d5de04984a2d56",
  "src/catalog.ts": "00b2e80984f1fa48dfdba87e4b810f2fe80a03d339399f2d7dff12190e611f56",
  "src/commands.ts": "c40c66fc3e5d3e60022534a561d44280cda205f3cc10be759f8efdc97038a98b",
  "src/events.ts": "8d076ee8f426c011d7df3f205dd014f0e835f71798b3684ca56844b691ba2370",
  "src/facade.ts": "a89805b56aa4b238b54168403b016c7e264ab664f405805fbf1de877cb026e5d",
  "src/measurements.ts": "3d627e4ff13b55e84c09dbd5bb4f624d1bac0acbdc1fabd28bbd92fa0228f7e5",
  "src/model.ts": "df2f15e918a5f349ade6fcfc33393a520f2b74c7221a2e0eca83f7647341d122",
  "src/ordering.ts": "e72ac94e99b1b4914f3f6dec55583e401484a41ecadd051be788724c88f24cb9",
  "src/quantity.ts": "8c0be7d29d08fef1daa83fd987896c1c1a015c4f70cd329261987fcc907382a6"
});
var REUSED_DEPENDENCY_FAMILIES = Object.freeze([
  Object.freeze({
    proofKind: "inventoryonce-quantity-measurement-complete-source-equations-v1",
    certificateId: "VALUE_CERTIFICATE_FAMILY:sha256:22f777b6f641ae5af58c1236b6e6e2e9f2257d95551ed957bd59447662d4c310",
    reviewedCommit: "5d13503b7baceff5515e8d82b390f0949080440a",
    admittedAliases: 76
  }),
  Object.freeze({
    proofKind: "independent-identity-values-closed-equations-v1",
    familyId: "inventoryonce.identity-values.closed-source-equations.v1",
    reviewedCommit: "02cf9387d669fd8655a71933849862cac8693cd9",
    admittedAliases: 40
  }),
  Object.freeze({
    proofKind: "independent-catalog-snapshot-closed-equations-v1",
    canonicalArtifactSha256: "6331d60cf48d83da632f73ad232b2990ca2dbf5c4185c5c87aaa089f0f51626f",
    admittedAliases: 24
  })
]);
var REUSED_EQUATION_IDS = Object.freeze(/* @__PURE__ */ new Set([
  "src/catalog.ts#InventoryCatalog.activeItem",
  "src/amounts.ts#InventoryAmountKind",
  "src/amounts.ts#createMeasuredVector",
  "src/amounts.ts#packageAmount",
  "src/amounts.ts#resolveInventoryAmount",
  "src/amounts.ts#validateIndependentAmountInputs",
  "src/canonical.ts#assertFiniteInventoryIntentFingerprintNumbers",
  "src/canonical.ts#inventoryIntentFingerprint",
  "src/canonical.ts#inventoryMetadataFingerprint",
  "src/canonical.ts#inventoryMetadataValueFingerprint",
  "src/canonical.ts#isInventoryMetadataArray",
  "src/catalog.ts#InventoryCatalog.itemRevision",
  "src/catalog.ts#InventoryCatalog.packagingRevision",
  "src/catalog.ts#assertMeasurementsMatchItem",
  "src/measurements.ts#addInventoryMeasurements",
  "src/measurements.ts#assertSamePrimaryMeasurementAxis",
  "src/measurements.ts#assertWholeMeasurementMultiple",
  "src/measurements.ts#compareMeasurementAxis",
  "src/measurements.ts#inventoryMeasurement",
  "src/measurements.ts#inventoryMeasurementAt",
  "src/measurements.ts#inventoryMeasurementVector",
  "src/measurements.ts#inventoryMeasurementsAreZero",
  "src/measurements.ts#inventoryMeasurementsEqual",
  "src/measurements.ts#inventoryMeasurementsFingerprint",
  "src/measurements.ts#measurementFingerprint",
  "src/measurements.ts#multiplyInventoryMeasurementsByWholeNumber",
  "src/measurements.ts#negateInventoryMeasurements",
  "src/measurements.ts#positiveInventoryMeasurements",
  "src/measurements.ts#subtractInventoryMeasurements",
  "src/model.ts#assertInventoryIdentity",
  "src/model.ts#InventoryTraceabilityNodeKind",
  "src/model.ts#compareQualifiedDimension",
  "src/model.ts#inventoryContainerIdentity",
  "src/model.ts#inventoryLotIdentity",
  "src/model.ts#inventoryStockPositionIdentity",
  "src/model.ts#inventoryTraceabilityNodeIdentity",
  "src/model.ts#normalizeInventoryStockPositionKey",
  "src/model.ts#qualifiedDimensionIdentityTuple",
  "src/ordering.ts#compareInventoryIdentityText",
  "src/quantity.ts#addQuantity",
  "src/quantity.ts#assertDecimals",
  "src/quantity.ts#assertSafeInteger",
  "src/quantity.ts#assertSameUnit",
  "src/quantity.ts#compareQuantity",
  "src/quantity.ts#integerAtDecimals",
  "src/quantity.ts#multiplyQuantityByWholeNumber",
  "src/quantity.ts#negateQuantity",
  "src/quantity.ts#parseQuantity",
  "src/quantity.ts#positiveQuantity",
  "src/quantity.ts#powerOfTen",
  "src/quantity.ts#quantity",
  "src/quantity.ts#quantityEq",
  "src/quantity.ts#quantityIsWholeMultipleOf",
  "src/quantity.ts#safeNumber",
  "src/quantity.ts#unitCode",
  "src/quantity.ts#zeroQuantity"
]));
var CATALOG_FOUNDATION_DEPENDENCY_EQUATION_IDS = Object.freeze(/* @__PURE__ */ new Set([
  "src/catalog.ts#assertInventoryCatalogRetainsSnapshot",
  "src/catalog.ts#assertPositionMatchesItem",
  "src/catalog.ts#inventoryCatalogFromSnapshot"
]));
var LOCAL_RUNTIME_VALUE_IDS = Object.freeze([
  "src/events.ts#InventoryEventKind",
  "src/events.ts#InventoryTraceabilityRelationAction",
  "src/events.ts#InventoryTraceabilityRelationKind",
  "src/events.ts#InventoryTransferLifecycleAction",
  "src/facade.ts#replacementEventDrafts"
]);
var FAMILY_DOMAIN2 = Object.freeze({
  inputs: "All values admitted by the declared TypeScript inputs after the referenced quantity, identity, amount and catalogue equations: finite acyclic immutable plain records/arrays, exact safe-integer quantities and package counts, canonical identities/times, and catalogue receivers created by the certified catalogue family.",
  eventKinds: "defineInventoryEvent covers every declared InventoryEventKind branch, including catalogue publication, correction and transfer-lifecycle validation; constructors in this certificate expose only the fixed non-transfer key set.",
  planners: "Replacement methods execute only on the library-created InventoryOnceReplacementPlansImplementation receiver with its frozen catalogue and synthetic correction operation id. They allocate an opaque plan, set its public kind and retain the draft in the module-private WeakMap; they do not publish or commit durable state.",
  builtins: "Unmodified ECMAScript Array, Date, Error, JSON, Map, Number, Object, Set, String, WeakMap and encodeURIComponent semantics from the active trusted TypeScript library root.",
  rejected: "Mutable/proxied/custom-prototype inputs, accessors, custom coercion/iterators, rebound globals, monkey-patched built-ins, cyclic data, forged planner receivers/plans, async/generator/default/rest substitutions, and unknown nonlocal runtime values are outside the certificate and fail closed."
});
var FAMILY_LAWS3 = Object.freeze([
  Object.freeze({
    id: "event-definition-normalization-v1",
    statement: "Validate eventId/operationId/canonical occurredAt; enforce catalogue snapshot/digest iff CatalogPublication; correction pointer iff Correction with non-self ids and nonblank reason; normalize and sort stock effects, provenance transfers/overrides, lot/container definitions, traceability changes and transfer lifecycle; reject mismatched transfer ids and empty non-correction/non-publication facts; apply the complete kind-specific sign, conservation, metadata, graph and lifecycle guards; return every original event field overridden only by the normalized arrays and optional normalized transferLifecycle."
  }),
  Object.freeze({
    id: "event-commit-v1",
    statement: "Require canonical recordedAt, occurredAt <= recordedAt, every present provenance startedAt <= recordedAt, and positive safe-integer recordSequence; return the entire draft plus recordedAt and recordSequence without durable publication."
  }),
  Object.freeze({
    id: "event-intent-fingerprint-v1",
    statement: "Hash the exact ordered tuple event id, operation id, kind, occurrence time, optional parties/reference/reason, catalogue digest/snapshot digest, correction tuple, metadata fingerprint, lifecycle fingerprint, ordered lot/container/provenance arrays, ordered stock effect identity/measurement/evidence/metadata tuples, and ordered traceability identities."
  }),
  Object.freeze({
    id: "canonical-time-v1",
    statement: "Parse with the unmodified Date parser and accept exactly finite epochs whose new Date(epoch).toISOString() equals the supplied text; otherwise reject with the supplied label."
  }),
  Object.freeze({
    id: "movement-command-v1",
    statement: "Resolve the item by package revision, explicit revision or active item; resolve exact amount measurements; reject transfer-bound ordinary positions and package mismatches; construct normalized signed effects and evidence; attach exact optional lot/container facts; derive event id from nonblank encoded operation id; invoke the complete event-definition law with all header fields preserved only when present."
  }),
  Object.freeze({
    id: "many-movement-command-v1",
    statement: "Reject empty line arrays. Issue and scrap preserve input order and one negative effect per line; scrap also requires a nonblank reason. Receipt groups exact destination identities, requires equal metadata/package identity for collisions, adds exact measurements and positive safe package counts, then emits effects and deduplicated lot/container definitions in code-unit identity order."
  }),
  Object.freeze({
    id: "pack-unpack-command-v1",
    statement: "Pack rejects transfer-bound/already-packaged sources, resolves the exact matching package item and whole count, moves equal measurements from loose to that exact package revision and transfers positive-layer provenance. Unpack requires/matches the source package, removes only packagingRevisionId, optionally replaces containerId, attaches destination container metadata, and moves the same measurements/provenance."
  }),
  Object.freeze({
    id: "transformation-command-v1",
    statement: "Require nonempty consume and produce arrays; resolve every line to an exact revision-qualified position; emit negative consumes then positive produces in input order; deduplicate compatible lot/container facts by identity and sort them; derive complete Cartesian genealogy only when every line has one unambiguous or explicitly matching node, otherwise use no genealogy or reject partial/ambiguous lineage."
  }),
  Object.freeze({
    id: "metadata-traceability-command-v1",
    statement: "Lot metadata first requires an active item and emits exactly its itemId/lotId plus supplied lot fields; container metadata emits exactly containerId plus supplied container fields; traceability emits exactly the supplied relation changes. Each uses empty stock arrays and the shared movement/event-definition law."
  }),
  Object.freeze({
    id: "replacement-plan-construction-v1",
    statement: "Each direct planner inserts only the frozen catalogue and synthetic replacement operation id into its corresponding certified command, then allocates an opaque plan whose kind is draft.kind and whose private WeakMap entry is that draft. omit allocates kind 'omit' with a null private entry. No planner commits, stores or publishes an event."
  }),
  Object.freeze({
    id: "replacement-property-change-v1",
    statement: "Change verbs require a trimmed nonempty new identity different from the prior value and replace only the named status/owner/custodian/disposition-authority/container field. Clear verbs require the named field and remove only it. Qualified change validates configured dimension identity/value, replaces exactly one matching value or appends, normalizes position order; qualified clear removes exactly the named present dimension and omits the array when empty. All then use the single reclassification constructor."
  }),
  Object.freeze({
    id: "replacement-count-adjustment-v1",
    statement: "For every input line in order compute observed minus expectedAtObservation using certified exact measurement subtraction, omit zero deltas, and emit one remaining effect with item revision, position, exact delta and fingerprints of expected/observed. Define a CountAdjustment event with derived event id, synthetic operation id, occurrence time, empty traceability and every optional header field conditionally preserved."
  }),
  Object.freeze({
    id: "replacement-relation-v1",
    statement: "Aggregate/disaggregate select add/remove containment; associate/disassociate select add/remove association. The private relation equation builds exactly one change from input.from to input.to, adds only frozen catalogue and synthetic operation id, then delegates to the certified traceability constructor and opaque-plan constructor."
  })
]);
function lawIdForPublicImplementation(name) {
  if (name === "assertCanonicalInventoryTime") return "canonical-time-v1";
  if (name === "commitInventoryEvent") return "event-commit-v1";
  if (name === "defineInventoryEvent") return "event-definition-normalization-v1";
  if (name === "inventoryEventIntentFingerprint") return "event-intent-fingerprint-v1";
  if (name === "inventoryEventIdForOperation") return "movement-command-v1";
  if (["createInventoryIssueManyEvent", "createInventoryReceiptManyEvent", "createInventoryScrapManyEvent"].includes(name)) return "many-movement-command-v1";
  if (["createInventoryPackEvent", "createInventoryUnpackEvent"].includes(name)) return "pack-unpack-command-v1";
  if (name === "createInventoryTransformationEvent") return "transformation-command-v1";
  if (["createInventoryContainerMetadataEvent", "createInventoryLotMetadataEvent", "createInventoryTraceabilityEvent"].includes(name)) return "metadata-traceability-command-v1";
  if (name.startsWith("createInventory")) return "movement-command-v1";
  if (name === "countAdjustment") return "replacement-count-adjustment-v1";
  if (["aggregate", "associate", "disaggregate", "disassociate"].includes(name)) return "replacement-relation-v1";
  if (name === "omit" || ["containerMetadata", "issue", "lotMetadata", "opening", "pack", "receive", "scrap", "transform", "unpack"].includes(name)) return "replacement-plan-construction-v1";
  return "replacement-property-change-v1";
}

// experiments/tla-conformance/quantity-values-r7/event-values/certificate.mjs
var producerFiles5 = Object.freeze([
  "experiments/tla-conformance/quantity-values-r7/event-values/certificate.mjs",
  "experiments/tla-conformance/quantity-values-r7/event-values/contracts.mjs",
  "experiments/tla-conformance/quantity-values-r7/event-values/catalog-foundation-dependency-reference.json",
  "experiments/tla-conformance/quantity-values-r7/event-values/equations.expected.ts.txt",
  "experiments/tla-conformance/quantity-values-r7/event-values/registered-family-adapter.mjs",
  "experiments/tla-conformance/quantity-values-r7/quantity-values-certificate.json",
  "experiments/tla-conformance/surface-bindings/lib/compiler-surface.mjs",
  "node_modules/typescript/package.json",
  "package.json",
  "tsconfig.json"
]);
var equationProgramPath3 = fileURLToPath8(
  new URL("./equations.expected.ts.txt", import.meta.url)
);
var catalogFoundationDependencyPath = fileURLToPath8(
  new URL("./catalog-foundation-dependency-reference.json", import.meta.url)
);
var familyPassCache = /* @__PURE__ */ new WeakMap();
function relativePath2(repositoryRoot, fileName) {
  return path15.relative(repositoryRoot, fileName).replaceAll("\\", "/");
}
function readSource(repositoryRoot, sourceOverrides, file) {
  return sourceOverrides.get(file) ?? fs12.readFileSync(path15.resolve(repositoryRoot, file), "utf8");
}
function parseSource3(fileName, sourceText5) {
  return ts.createSourceFile(
    fileName,
    sourceText5,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}
function loadOverriddenContext3(repositoryRoot, sourceOverrides) {
  const root3 = path15.resolve(repositoryRoot);
  for (const file of sourceOverrides.keys()) {
    assert14(Object.hasOwn(EXPECTED_SOURCE_SHA256, file), `Source override left the closed family: ${file}`);
  }
  const configPath = path15.join(root3, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert14.equal(config.error, void 0, "Cannot read TypeScript configuration for mutation control.");
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root3, void 0, configPath);
  assert14.equal(parsed.errors.length, 0, "TypeScript configuration diagnostics changed.");
  const overridesByAbsolutePath = new Map(
    [...sourceOverrides].map(([file, text]) => [path15.resolve(root3, file), text])
  );
  const host = ts.createCompilerHost(parsed.options, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const override = overridesByAbsolutePath.get(path15.resolve(fileName));
    return override === void 0 ? originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) : ts.createSourceFile(fileName, override, languageVersion, true, ts.ScriptKind.TS);
  };
  host.readFile = (fileName) => overridesByAbsolutePath.get(path15.resolve(fileName)) ?? ts.sys.readFile(fileName);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, host });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert14.equal(diagnostics.length, 0, `Mutated compiler program has ${diagnostics.length} diagnostic(s).`);
  return { repositoryRoot: root3, program, checker: program.getTypeChecker() };
}
function findFunction3(source7, name) {
  const declarations = source7.statements.filter(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name && statement.body !== void 0
  );
  assert14.equal(declarations.length, 1, `Expected one concrete function '${name}'.`);
  return declarations[0];
}
function findClass(source7, name) {
  const declarations = source7.statements.filter(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === name
  );
  assert14.equal(declarations.length, 1, `Expected one class '${name}'.`);
  return declarations[0];
}
function findClassMethod2(source7, className, methodName) {
  const owner = findClass(source7, className);
  const methods = owner.members.filter(
    (member2) => ts.isMethodDeclaration(member2) && ts.isIdentifier(member2.name) && member2.name.text === methodName && member2.body !== void 0
  );
  assert14.equal(methods.length, 1, `Expected one concrete method '${className}.${methodName}'.`);
  return methods[0];
}
function findClassConstructor(source7, className) {
  const constructors = findClass(source7, className).members.filter(
    (member2) => ts.isConstructorDeclaration(member2) && member2.body !== void 0
  );
  assert14.equal(constructors.length, 1, `Expected one concrete constructor '${className}'.`);
  return constructors[0];
}
function findExpectedCallable(source7, id) {
  const local = id.slice(id.indexOf("#") + 1);
  const separator = local.indexOf(".");
  if (separator < 0) return findFunction3(source7, local);
  const className = local.slice(0, separator);
  const memberName = local.slice(separator + 1);
  return memberName === "<constructor>" ? findClassConstructor(source7, className) : findClassMethod2(source7, className, memberName);
}
function expectedCallableCount(source7) {
  let count = 0;
  for (const statement of source7.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.body !== void 0) count += 1;
    if (!ts.isClassDeclaration(statement)) continue;
    for (const member2 of statement.members) {
      if ((ts.isMethodDeclaration(member2) || ts.isConstructorDeclaration(member2)) && member2.body !== void 0) count += 1;
    }
  }
  return count;
}
function validateCatalogFoundationDependencyReference(reference) {
  assert14.equal(reference.schemaVersion, 1);
  assert14.equal(reference.owner, "catalog-foundation-r7");
  assert14.equal(reference.sourceBase, EVENT_VALUES_SOURCE_BASE);
  assert14.equal(reference.surfaceDigest, EVENT_VALUES_SURFACE_DIGEST);
  assert14.deepEqual(reference.equationIds, [...CATALOG_FOUNDATION_DEPENDENCY_EQUATION_IDS].sort());
  assert14.equal(
    reference.status,
    "PENDING_REGISTERED_FAMILY",
    "A status label cannot replace invocation of the trusted catalog-foundation verifier."
  );
  assert14.equal(reference.proofKind, null);
  assert14.equal(reference.certificateId, null);
  assert14.equal(reference.artifactSha256, null);
  assert14.equal(reference.reviewedCommit, null);
  return false;
}
function loadCatalogFoundationDependencyReference({ repositoryRoot, context, surface }) {
  const pendingReference = JSON.parse(fs12.readFileSync(catalogFoundationDependencyPath, "utf8"));
  validateCatalogFoundationDependencyReference(pendingReference);
  const artifact = buildFamilyArtifact4({ repositoryRoot, context, surface });
  assert14.equal(artifact.proofKind, proofKind2);
  assert14.equal(artifact.surfaceDigest, surface.digest);
  assert14.equal(artifact.allAdmittedInputs, true);
  assert14.equal(artifact.sampledInputs, 0);
  const equations2 = new Map(artifact.equations.map((equation3) => [equation3.id, equation3]));
  const verifiedEquationIds = /* @__PURE__ */ new Set();
  const equationTerms = [];
  for (const equationId of [...CATALOG_FOUNDATION_DEPENDENCY_EQUATION_IDS].sort(compareCodeUnits)) {
    const equation3 = equations2.get(equationId);
    assert14(equation3 !== void 0, `Trusted catalogue foundation omitted '${equationId}'.`);
    verifiedEquationIds.add(equationId);
    equationTerms.push({ equationId, termSha256: sha256(canonicalJson(equation3.term)) });
  }
  return {
    verified: true,
    verifiedEquationIds,
    artifact,
    reference: {
      ...pendingReference,
      status: "VERIFIED_BY_TRUSTED_CODE",
      proofKind: artifact.proofKind,
      certificateId: artifact.certificateId,
      artifactSha256: sha256(canonicalJson(artifact)),
      equationTerms
    }
  };
}
function buildCurrentReusedDependencyAuthority({ repositoryRoot, context, surface }) {
  const quantity = buildFamilyArtifact3({ repositoryRoot, context, surface });
  const identity = buildFamilyArtifact2({ repositoryRoot, context, surface });
  const catalog = buildCatalogFamilyArtifact({ repositoryRoot, context, surface });
  for (const artifact of [quantity, identity, catalog]) {
    assert14.equal(artifact.surfaceDigest, surface.digest, `Current reused family surface drifted: ${artifact.proofKind}`);
    assert14.equal(artifact.allAdmittedInputs, true, `Current reused family is incomplete: ${artifact.proofKind}`);
    assert14.equal(artifact.sampledInputs, 0, `Current reused family became sample-backed: ${artifact.proofKind}`);
  }
  const providers = /* @__PURE__ */ new Map();
  function add(provider, id) {
    if (!REUSED_EQUATION_IDS.has(id)) return;
    const rows = providers.get(id) ?? [];
    if (!rows.includes(provider)) rows.push(provider);
    providers.set(id, rows.sort(compareCodeUnits));
  }
  for (const row of [
    ...quantity.semanticCore?.memberEquations ?? [],
    ...quantity.semanticCore?.helperEquations ?? []
  ]) add(quantity.proofKind, row.id);
  for (const row of identity.equations ?? []) add(identity.proofKind, row.id);
  for (const row of identity.supportingValues ?? []) add(identity.proofKind, row.id);
  for (const row of catalog.proofs ?? []) add(catalog.proofKind, row.equationId);
  for (const row of catalog.helperEquations ?? []) add(catalog.proofKind, row.key);
  const catalogSource = context.program.getSourceFile(path15.resolve(repositoryRoot, "src/catalog.ts"));
  assert14(catalogSource !== void 0, "Current compiler omitted src/catalog.ts.");
  const activeItem = findClassMethod2(catalogSource, "InventoryCatalog", "activeItem");
  const expectedActiveItemSource = parseSource3(
    "event-current-active-item.expected.ts",
    `class InventoryCatalog {
      activeItem(itemId) {
        const item = this.activeItemById.get(itemId);
        if (item === undefined) throw new Error(\`Unknown active inventory item '\${itemId}'.\`);
        return item;
      }
    }`
  );
  const expectedActiveItem = findClassMethod2(expectedActiveItemSource, "InventoryCatalog", "activeItem");
  assert14(activeItem.body !== void 0 && expectedActiveItem.body !== void 0);
  const activeItemTerm = normalizeEventValueSyntax(activeItem.body);
  assert14.deepEqual(
    activeItemTerm,
    normalizeEventValueSyntax(expectedActiveItem.body),
    "Current InventoryCatalog.activeItem equation changed."
  );
  add("R131_CURRENT_ACTIVE_ITEM_EXPECTED_TERM", "src/catalog.ts#InventoryCatalog.activeItem");
  assert14.deepEqual(
    [...providers.keys()].sort(compareCodeUnits),
    [...REUSED_EQUATION_IDS].sort(compareCodeUnits),
    "Current reused dependency coverage is incomplete."
  );
  const inputsByFile = /* @__PURE__ */ new Map();
  for (const artifact of [quantity, identity, catalog]) {
    for (const input2 of artifact.inputs) {
      const prior = inputsByFile.get(input2.file);
      assert14(prior === void 0 || prior.sha256 === input2.sha256, `Current reused input conflict: ${input2.file}`);
      inputsByFile.set(input2.file, input2);
    }
  }
  return {
    verifiedEquationIds: [...providers.keys()].sort(compareCodeUnits),
    providers: [...providers].sort(([left], [right]) => compareCodeUnits(left, right)).map(([equationId, proofKinds]) => ({ equationId, proofKinds })),
    families: [quantity, identity, catalog].map((artifact) => ({
      proofKind: artifact.proofKind,
      surfaceDigest: artifact.surfaceDigest,
      artifactSha256: sha256(canonicalJson(artifact)),
      proofCount: artifact.proofs.length
    })),
    activeItem: {
      equationId: "src/catalog.ts#InventoryCatalog.activeItem",
      declaration: spanOf(context, activeItem),
      equationSha256: sha256(canonicalJson(activeItemTerm))
    },
    inputs: [...inputsByFile.values()].sort((left, right) => compareCodeUnits(left.file, right.file))
  };
}
function findInterfaceMethod(source7, interfaceName, methodName) {
  const owners = source7.statements.filter(
    (statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName
  );
  assert14.equal(owners.length, 1, `Expected one interface '${interfaceName}'.`);
  const methods = owners[0].members.filter(
    (member2) => ts.isMethodSignature(member2) && ts.isIdentifier(member2.name) && member2.name.text === methodName
  );
  assert14.equal(methods.length, 1, `Expected one interface method '${interfaceName}.${methodName}'.`);
  return methods[0];
}
function findEnum(source7, name) {
  const declarations = source7.statements.filter(
    (statement) => ts.isEnumDeclaration(statement) && statement.name.text === name
  );
  assert14.equal(declarations.length, 1, `Expected one enum '${name}'.`);
  return declarations[0];
}
function findTopLevelVariable(source7, name) {
  const declarations = [];
  for (const statement of source7.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        declarations.push({ statement, declaration });
      }
    }
  }
  assert14.equal(declarations.length, 1, `Expected one top-level variable '${name}'.`);
  return declarations[0];
}
function declarationId(repositoryRoot, declaration) {
  const file = relativePath2(repositoryRoot, declaration.getSourceFile().fileName);
  if (ts.isFunctionDeclaration(declaration)) {
    assert14(declaration.name !== void 0);
    return `${file}#${declaration.name.text}`;
  }
  if (ts.isMethodDeclaration(declaration) || ts.isConstructorDeclaration(declaration)) {
    const owner = declaration.parent;
    assert14(ts.isClassDeclaration(owner) && owner.name !== void 0, "Callable method needs a named class.");
    const member2 = ts.isConstructorDeclaration(declaration) ? "<constructor>" : declaration.name.getText(declaration.getSourceFile());
    return `${file}#${owner.name.text}.${member2}`;
  }
  throw new Error(`Unsupported callable declaration '${ts.SyntaxKind[declaration.kind]}'.`);
}
function declarationLocation(repositoryRoot, declaration) {
  const source7 = declaration.getSourceFile();
  const point = source7.getLineAndCharacterOfPosition(declaration.getStart(source7));
  return `${relativePath2(repositoryRoot, source7.fileName)}:${point.line + 1}:${point.character + 1}`;
}
function normalizeEventValueSyntax(node) {
  if (ts.isParenthesizedExpression(node)) return normalizeEventValueSyntax(node.expression);
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) {
    return ["runtime-type-erasure", normalizeEventValueSyntax(node.expression)];
  }
  if (ts.isIdentifier(node)) return ["identifier", node.text];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node) || ts.isBigIntLiteral(node) || ts.isRegularExpressionLiteral(node)) {
    return [ts.SyntaxKind[node.kind], node.text];
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return ["boolean", true];
  if (node.kind === ts.SyntaxKind.FalseKeyword) return ["boolean", false];
  if (node.kind === ts.SyntaxKind.NullKeyword) return ["null"];
  if (node.kind === ts.SyntaxKind.ThisKeyword) return ["this"];
  const children = node.getChildren(node.getSourceFile()).filter((child) => !ts.isJSDoc(child));
  if (children.length === 0) return [ts.SyntaxKind[node.kind], node.getText(node.getSourceFile())];
  return [ts.SyntaxKind[node.kind], children.map(normalizeEventValueSyntax)];
}
function validateCallableSyntax2(declaration) {
  assert14(declaration.body !== void 0, "Source equation needs a concrete body.");
  assert14.equal(declaration.asteriskToken, void 0, "Generator equations are outside this family.");
  assert14.equal(
    declaration.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
    false,
    "Async equations are outside this family."
  );
  assert14(
    !ts.canHaveDecorators(declaration) || (ts.getDecorators(declaration)?.length ?? 0) === 0,
    "Decorated equations are outside this family."
  );
  for (const parameter of declaration.parameters) {
    assert14.equal(parameter.dotDotDotToken, void 0, "Rest parameters require another equation.");
  }
  function inspect(node) {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      assert14.equal(node.asteriskToken, void 0, "Generator callbacks are outside this family.");
      assert14.equal(
        node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
        false,
        "Async callbacks are outside this family."
      );
      for (const parameter of node.parameters) {
        assert14.equal(parameter.dotDotDotToken, void 0, "Rest callbacks require another equation.");
      }
    }
    assert14(!ts.isGetAccessorDeclaration(node) && !ts.isSetAccessorDeclaration(node), "Accessor execution is outside immutable value equations.");
    ts.forEachChild(node, inspect);
  }
  inspect(declaration.body);
}
function declarationIsInsideCallable2(candidate, callable) {
  let current = candidate;
  while (current !== void 0) {
    if (current === callable) return true;
    current = current.parent;
  }
  return false;
}
function enumDeclarationId(repositoryRoot, declaration) {
  const owner = ts.isEnumDeclaration(declaration) ? declaration : declaration.parent;
  assert14(ts.isEnumDeclaration(owner));
  return `${relativePath2(repositoryRoot, owner.getSourceFile().fileName)}#${owner.name.text}`;
}
function trustedLibraryFile(trustedLibraryRoot, declaration) {
  assert14.equal(declaration.getSourceFile().isDeclarationFile, true, "Runtime library declaration must be ambient.");
  const file = fs12.realpathSync(declaration.getSourceFile().fileName);
  assert14(file.startsWith(`${trustedLibraryRoot}${path15.sep}`), `Runtime declaration left the trusted TypeScript library: ${file}`);
  return file;
}
function standardOperationKey(repositoryRoot, declaration) {
  const source7 = declaration.getSourceFile();
  const name = declaration.name?.getText(source7) ?? "<anonymous>";
  return `${relativePath2(repositoryRoot, source7.fileName)}#${name}#${ts.SyntaxKind[declaration.kind]}@${declaration.getStart(source7)}:${declaration.getEnd()}`;
}
function resolvedCompilerSymbol(context, node) {
  let symbol = context.checker.getSymbolAtLocation(node);
  if (symbol !== void 0 && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = context.checker.getAliasedSymbol(symbol);
  }
  return symbol;
}
function verifyDependencyClosure2({ repositoryRoot, context, roots }) {
  const localFiles = new Set(LOCAL_SOURCE_FILES);
  const trustedLibraryRoot = fs12.realpathSync(
    path15.dirname(ts.getDefaultLibFilePath(context.program.getCompilerOptions()))
  );
  const declarations = /* @__PURE__ */ new Map();
  const pending = [...roots];
  const dependenciesById = /* @__PURE__ */ new Map();
  const standardOperations = /* @__PURE__ */ new Map();
  const runtimeGlobals = /* @__PURE__ */ new Map();
  const reusedDependencies = /* @__PURE__ */ new Set();
  const catalogFoundationDependencies = /* @__PURE__ */ new Set();
  const runtimeValues = /* @__PURE__ */ new Set();
  function resolvedSymbol3(node) {
    return resolvedCompilerSymbol(context, node);
  }
  function classifySourceCallable(declaration, dependencies) {
    const id = declarationId(repositoryRoot, declaration);
    const file = relativePath2(repositoryRoot, declaration.getSourceFile().fileName);
    if (localFiles.has(file)) {
      dependencies.add(id);
      pending.push(declaration);
      return;
    }
    if (REUSED_EQUATION_IDS.has(id)) {
      dependencies.add(id);
      reusedDependencies.add(id);
      return;
    }
    if (CATALOG_FOUNDATION_DEPENDENCY_EQUATION_IDS.has(id)) {
      dependencies.add(id);
      catalogFoundationDependencies.add(id);
      return;
    }
    throw new Error(`Unproved transitive source callable '${id}'.`);
  }
  while (pending.length > 0) {
    let inspect2 = function(node) {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const target = context.checker.getResolvedSignature(node)?.declaration;
        assert14(target !== void 0, `Unresolved call '${node.getText()}'.`);
        if (target.getSourceFile().isDeclarationFile) {
          trustedLibraryFile(trustedLibraryRoot, target);
          const key = standardOperationKey(repositoryRoot, target);
          const prior = standardOperations.get(key) ?? {
            key,
            declaration: spanOf(context, target),
            callSites: []
          };
          prior.callSites.push(spanOf(context, node));
          standardOperations.set(key, prior);
        } else if ((ts.isFunctionDeclaration(target) || ts.isMethodDeclaration(target) || ts.isConstructorDeclaration(target)) && target.body !== void 0) {
          classifySourceCallable(target, dependencies);
        } else if ((ts.isArrowFunction(target) || ts.isFunctionExpression(target)) && declarationIsInsideCallable2(target, declaration)) {
        } else {
          throw new Error(`Unproved call target '${ts.SyntaxKind[target.kind]}' at ${declarationLocation(repositoryRoot, target)}.`);
        }
      }
      if (ts.isIdentifier(node)) {
        const symbol = resolvedSymbol3(node);
        for (const candidate of symbol?.declarations ?? []) {
          if ((ts.isFunctionDeclaration(candidate) || ts.isMethodDeclaration(candidate) || ts.isConstructorDeclaration(candidate)) && candidate.body !== void 0 && !declarationIsInsideCallable2(candidate, declaration)) {
            classifySourceCallable(candidate, dependencies);
          }
          if (ts.isEnumDeclaration(candidate) || ts.isEnumMember(candidate)) {
            if (candidate.getSourceFile().isDeclarationFile) continue;
            const valueId = enumDeclarationId(repositoryRoot, candidate);
            assert14(
              LOCAL_RUNTIME_VALUE_IDS.includes(valueId) || REUSED_EQUATION_IDS.has(valueId),
              `Unproved runtime enum '${valueId}'.`
            );
            runtimeValues.add(valueId);
          }
          if (ts.isVariableDeclaration(candidate)) {
            if (declarationIsInsideCallable2(candidate, declaration)) continue;
            if (candidate.getSourceFile().isDeclarationFile) {
              trustedLibraryFile(trustedLibraryRoot, candidate);
              const declarationSpan = spanOf(context, candidate);
              const globalKey = `${node.text}:${declarationSpan.file}:${declarationSpan.start.offset}:${declarationSpan.end.offset}`;
              runtimeGlobals.set(globalKey, {
                key: globalKey,
                name: node.text,
                declaration: declarationSpan
              });
              continue;
            }
            const valueId = `${relativePath2(repositoryRoot, candidate.getSourceFile().fileName)}#${candidate.name.getText(candidate.getSourceFile())}`;
            assert14(LOCAL_RUNTIME_VALUE_IDS.includes(valueId), `Unknown nonlocal runtime variable '${valueId}' at ${declarationLocation(repositoryRoot, candidate)}.`);
            runtimeValues.add(valueId);
          }
        }
      }
      ts.forEachChild(node, inspect2);
    };
    var inspect = inspect2;
    const declaration = pending.shift();
    const id = declarationId(repositoryRoot, declaration);
    if (declarations.has(id)) continue;
    validateCallableSyntax2(declaration);
    declarations.set(id, declaration);
    const dependencies = /* @__PURE__ */ new Set();
    inspect2(declaration.body);
    dependencies.delete(id);
    dependenciesById.set(id, [...dependencies].sort(compareCodeUnits));
  }
  const sortedStandard = [...standardOperations.values()].map((operation) => ({
    ...operation,
    callSites: operation.callSites.sort((left, right) => compareCodeUnits(canonicalJson(left), canonicalJson(right)))
  })).sort((left, right) => compareCodeUnits(left.key, right.key));
  return {
    declarations,
    dependenciesById,
    standardOperations: sortedStandard,
    runtimeGlobals: [...runtimeGlobals.values()].sort((left, right) => compareCodeUnits(left.key, right.key)),
    runtimeValues: [...runtimeValues].sort(compareCodeUnits),
    reusedDependencies: [...reusedDependencies].sort(compareCodeUnits),
    catalogFoundationDependencies: [...catalogFoundationDependencies].sort(compareCodeUnits)
  };
}
function dependencyClosureForMember(rootEquationId, dependenciesById, verifiedCatalogFoundationEquationIds) {
  const reachableEquationIds = /* @__PURE__ */ new Set();
  const catalogFoundationPathById = /* @__PURE__ */ new Map();
  const pendingPathById = /* @__PURE__ */ new Map();
  const queue = [[rootEquationId]];
  while (queue.length > 0) {
    const pathToEquation = queue.shift();
    const equationId = pathToEquation.at(-1);
    if (reachableEquationIds.has(equationId)) continue;
    reachableEquationIds.add(equationId);
    if (CATALOG_FOUNDATION_DEPENDENCY_EQUATION_IDS.has(equationId)) {
      catalogFoundationPathById.set(equationId, pathToEquation);
      if (!verifiedCatalogFoundationEquationIds.has(equationId)) pendingPathById.set(equationId, pathToEquation);
      continue;
    }
    const dependencies = dependenciesById.get(equationId);
    if (dependencies === void 0) {
      assert14(REUSED_EQUATION_IDS.has(equationId), `Member closure reached an unclassified equation '${equationId}'.`);
      continue;
    }
    for (const dependencyId of dependencies) {
      queue.push([...pathToEquation, dependencyId]);
    }
  }
  return {
    rootEquationId,
    reachableEquationIds: [...reachableEquationIds].sort(compareCodeUnits),
    catalogFoundationDependencyPaths: [...catalogFoundationPathById].sort(([left], [right]) => compareCodeUnits(left, right)).map(([equationId, path_]) => ({ equationId, path: path_ })),
    pendingDependencyPaths: [...pendingPathById].sort(([left], [right]) => compareCodeUnits(left, right)).map(([equationId, path_]) => ({ equationId, path: path_ })),
    pathSelection: "Breadth-first over code-unit-sorted direct dependencies; one exact shortest path per pending equation."
  };
}
function lawForEquation(id, publicName) {
  let lawId;
  if (publicName !== void 0) {
    lawId = lawIdForPublicImplementation(publicName);
  } else if (id.startsWith("src/events.ts#")) {
    lawId = id.endsWith("assertCanonicalInventoryTime") ? "canonical-time-v1" : id.includes("Fingerprint") || id.includes("fingerprint") || id.endsWith("traceabilityChangeIdentity") ? "event-intent-fingerprint-v1" : "event-definition-normalization-v1";
  } else if (id.includes("InventoryOnceReplacementPlan") || id.startsWith("src/facade.ts#")) {
    lawId = id.endsWith("countAdjustment") ? "replacement-count-adjustment-v1" : id.endsWith("relation") ? "replacement-relation-v1" : id.includes("QualifiedDimension") || id.includes("requireChangedIdentity") || id.includes("requirePresentIdentity") || id.endsWith("reclassification") ? "replacement-property-change-v1" : "replacement-plan-construction-v1";
  } else if (id.includes("Transformation") || id.includes("Genealogy")) {
    lawId = "transformation-command-v1";
  } else if (id.includes("Receipt") || id.includes("MovementLines") || id.includes("sorted") || id.includes("collect")) {
    lawId = "many-movement-command-v1";
  } else if (id.includes("Pack") || id.includes("packaging") || id.includes("Packaging")) {
    lawId = "pack-unpack-command-v1";
  } else {
    lawId = "movement-command-v1";
  }
  const law = FAMILY_LAWS3.find((candidate) => candidate.id === lawId);
  assert14(law !== void 0, `Missing independent law '${lawId}'.`);
  return law;
}
function replacementInterfaceRelation({ context, source: source7, callable, implementation, methodName }) {
  const publicMethod = findInterfaceMethod(source7, "InventoryOnceReplacementPlans", methodName);
  assert14.deepEqual(callable.declaration, spanOf(context, publicMethod), `Public replacement declaration drifted for '${methodName}'.`);
  const owner = implementation.parent;
  assert14(ts.isClassDeclaration(owner));
  const implementedTypes = owner.heritageClauses?.filter((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword).flatMap((clause) => clause.types) ?? [];
  const publicOwner = publicMethod.parent;
  assert14(ts.isInterfaceDeclaration(publicOwner));
  const publicSymbol = context.checker.getSymbolAtLocation(publicOwner.name);
  assert14(
    implementedTypes.some((type) => context.checker.getSymbolAtLocation(type.expression) === publicSymbol),
    "Replacement implementation no longer implements the exact public interface."
  );
  assert14(
    context.checker.isTypeAssignableTo(
      context.checker.getTypeAtLocation(implementation),
      context.checker.getTypeAtLocation(publicMethod)
    ),
    `Replacement implementation '${methodName}' is not assignable to its public declaration.`
  );
  return {
    kind: "COMPILER_RESOLVED_INTERFACE_IMPLEMENTATION",
    interface: spanOf(context, publicMethod),
    implementation: spanOf(context, implementation)
  };
}
function replacementConstructionBridge({ context, source: source7 }) {
  const correct = findClassMethod2(source7, "InventoryOnceStockImplementation", "correct");
  const implementationClass = findClass(source7, "InventoryOnceReplacementPlansImplementation");
  const implementationSymbol = context.checker.getSymbolAtLocation(implementationClass.name);
  let construction;
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "replacementPlans" && ts.isNewExpression(node.initializer)) {
      assert14.equal(construction, void 0, "Replacement implementation is constructed more than once.");
      const symbol = context.checker.getSymbolAtLocation(node.initializer.expression);
      assert14(symbol === implementationSymbol, "Correction callback constructs a different planner class.");
      assert14.equal(node.initializer.arguments?.length, 2);
      const [catalogArgument, operationArgument] = node.initializer.arguments;
      assert14(ts.isPropertyAccessExpression(catalogArgument));
      assert14.equal(catalogArgument.expression.getText(source7), "internals");
      assert14.equal(catalogArgument.name.text, "catalog");
      assert14(ts.isTemplateExpression(operationArgument));
      assert14.equal(operationArgument.head.text, "");
      assert14.equal(operationArgument.templateSpans.length, 1);
      assert14.equal(operationArgument.templateSpans[0].expression.getText(source7), "input.operationId");
      assert14.equal(operationArgument.templateSpans[0].literal.text, ":replacement");
      construction = spanOf(context, node.initializer);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "opaqueReplacement" && ts.isCallExpression(node.initializer) && ts.isPropertyAccessExpression(node.initializer.expression) && node.initializer.expression.name.text === "replaceWith") {
      assert14.equal(callback, void 0, "Replacement callback is invoked more than once.");
      assert14.equal(node.initializer.expression.expression.getText(source7), "input");
      assert14.equal(node.initializer.arguments.length, 1);
      assert14.equal(node.initializer.arguments[0].getText(source7), "replacementPlans");
      callback = spanOf(context, node.initializer);
    }
    ts.forEachChild(node, visit);
  }
  visit(correct.body);
  assert14(construction !== void 0, "Correction no longer constructs the certified replacement planner.");
  assert14(callback !== void 0, "Correction no longer passes the certified planner to replaceWith.");
  return {
    kind: "COMPILER_RESOLVED_CORRECTION_CALLBACK_BRIDGE",
    correctMethod: spanOf(context, correct),
    construction,
    callback,
    durableBoundary: "The bridge ends at opaque plan construction; commitInventoryOperation and durable publication are not claimed by this value family."
  };
}
function runtimeValueEquations({ repositoryRoot, context, sources, expectedSource: expectedSource3 }) {
  const values = [];
  const trustedLibraryRoot = fs12.realpathSync(
    path15.dirname(ts.getDefaultLibFilePath(context.program.getCompilerOptions()))
  );
  for (const id of LOCAL_RUNTIME_VALUE_IDS) {
    const separator = id.indexOf("#");
    const file = id.slice(0, separator);
    const name = id.slice(separator + 1);
    const source7 = sources.get(file);
    assert14(source7 !== void 0);
    if (name === "replacementEventDrafts") {
      const found = findTopLevelVariable(source7, name);
      assert14((found.statement.declarationList.flags & ts.NodeFlags.Const) !== 0, "Replacement plan table must remain const-bound.");
      assert14(ts.isNewExpression(found.declaration.initializer));
      assert14.equal(found.declaration.initializer.expression.getText(source7), "WeakMap");
      const runtimeSymbol = resolvedCompilerSymbol(context, found.declaration.initializer.expression);
      assert14(runtimeSymbol !== void 0, "WeakMap runtime value must resolve to one compiler symbol.");
      const runtimeDeclarations = runtimeSymbol.declarations ?? [];
      assert14(runtimeDeclarations.length > 0, "WeakMap runtime value must have a declaration.");
      for (const runtimeDeclaration of runtimeDeclarations) {
        if (!runtimeDeclaration.getSourceFile().isDeclarationFile) {
          throw new Error(
            `Unknown nonlocal runtime variable '${relativePath2(repositoryRoot, runtimeDeclaration.getSourceFile().fileName)}#${runtimeDeclaration.getText(runtimeDeclaration.getSourceFile())}'.`
          );
        }
        trustedLibraryFile(trustedLibraryRoot, runtimeDeclaration);
      }
      const constructorDeclaration = context.checker.getResolvedSignature(found.declaration.initializer)?.declaration;
      assert14(constructorDeclaration !== void 0, "WeakMap constructor signature must resolve.");
      trustedLibraryFile(trustedLibraryRoot, constructorDeclaration);
      const expected2 = findTopLevelVariable(expectedSource3, name);
      const term5 = normalizeEventValueSyntax(found.statement);
      assert14.deepEqual(term5, normalizeEventValueSyntax(expected2.statement), `Independent value equation changed: ${id}`);
      values.push({
        id,
        declaration: spanOf(context, found.statement),
        term: term5,
        runtimeGlobalDeclarations: runtimeDeclarations.map((runtimeDeclaration) => spanOf(context, runtimeDeclaration)).sort((left, right) => compareCodeUnits(canonicalJson(left), canonicalJson(right))),
        constructorDeclaration: spanOf(context, constructorDeclaration),
        law: "One module-private WeakMap maps only library-created opaque plans to their exact event draft or null omit marker."
      });
      continue;
    }
    const declaration = findEnum(source7, name);
    const expected = findEnum(expectedSource3, name);
    const term4 = normalizeEventValueSyntax(declaration);
    assert14.deepEqual(term4, normalizeEventValueSyntax(expected), `Independent value equation changed: ${id}`);
    values.push({
      id,
      declaration: spanOf(context, declaration),
      term: term4,
      law: "Every enum member and literal value is retained exactly; changed kind/action identities reject the family."
    });
  }
  return values.sort((left, right) => compareCodeUnits(left.id, right.id));
}
function buildEventValuesFamilyArtifact({
  repositoryRoot,
  context,
  surface,
  sourceOverrides = /* @__PURE__ */ new Map()
}) {
  assert14.equal(ASSIGNED_SURFACE_KEYS4.length, 45, "Follow-on surface cardinality changed.");
  assert14.equal(new Set(ASSIGNED_SURFACE_KEYS4).size, 45, "Follow-on surface keys must be unique.");
  assert14.equal(surface.digest, EVENT_VALUES_SURFACE_DIGEST, "Event family requires the exact current 535 surface.");
  const expectedSource3 = parseSource3(
    equationProgramPath3,
    fs12.readFileSync(equationProgramPath3, "utf8")
  );
  assert14.equal(expectedSource3.parseDiagnostics.length, 0, "Independent equation program has syntax errors.");
  const activeContext = sourceOverrides.size === 0 ? context : loadOverriddenContext3(repositoryRoot, sourceOverrides);
  const foundationContext = [...sourceOverrides.keys()].some((file) => SOURCE_FILES2.includes(file)) ? activeContext : context;
  const catalogFoundationReference = loadCatalogFoundationDependencyReference({
    repositoryRoot,
    context: foundationContext,
    surface
  });
  const currentReusedDependencyAuthority = buildCurrentReusedDependencyAuthority({
    repositoryRoot,
    context: activeContext,
    surface
  });
  const allSourceFiles = Object.keys(EXPECTED_SOURCE_SHA256).sort(compareCodeUnits);
  const sources = /* @__PURE__ */ new Map();
  for (const file of allSourceFiles) {
    const text = readSource(repositoryRoot, sourceOverrides, file);
    if (!sourceOverrides.has(file)) {
      assert14.equal(sha256(text), EXPECTED_SOURCE_SHA256[file], `Independent equation source changed: ${file}`);
    }
    const source7 = activeContext.program.getSourceFile(path15.resolve(repositoryRoot, file));
    assert14(source7 !== void 0, `Compiler omitted source '${file}'.`);
    sources.set(file, source7);
  }
  const localRoots = [];
  const publicImplementations = /* @__PURE__ */ new Map();
  for (const [name, file] of Object.entries(EXPORTED_FUNCTION_SOURCE)) {
    const declaration = findFunction3(sources.get(file), name);
    localRoots.push(declaration);
    publicImplementations.set(name, declaration);
  }
  for (const name of REPLACEMENT_METHOD_NAMES) {
    const declaration = findClassMethod2(
      sources.get("src/facade.ts"),
      "InventoryOnceReplacementPlansImplementation",
      name
    );
    localRoots.push(declaration);
    publicImplementations.set(name, declaration);
  }
  localRoots.push(findClassConstructor(
    sources.get("src/facade.ts"),
    "InventoryOnceReplacementPlanImplementation"
  ));
  const closure = verifyDependencyClosure2({ repositoryRoot, context: activeContext, roots: localRoots });
  for (const required of CATALOG_FOUNDATION_DEPENDENCY_EQUATION_IDS) {
    assert14(
      closure.catalogFoundationDependencies.includes(required),
      `Declared-domain catalog-foundation dependency disappeared: ${required}`
    );
  }
  assert14.equal(expectedCallableCount(expectedSource3), closure.declarations.size, "Independent equation program/local helper closure cardinality changed.");
  const expectedTermsById = /* @__PURE__ */ new Map();
  for (const [id, declaration] of closure.declarations) {
    const expectedDeclaration = findExpectedCallable(expectedSource3, id);
    validateCallableSyntax2(expectedDeclaration);
    const actualTerm = normalizeEventValueSyntax(declaration);
    const expectedTerm = normalizeEventValueSyntax(expectedDeclaration);
    assert14.deepEqual(actualTerm, expectedTerm, `Independent source equation changed: ${id}`);
    expectedTermsById.set(id, expectedTerm);
  }
  const lawById = new Map(FAMILY_LAWS3.map((law) => [law.id, law]));
  const memberEquations = [];
  for (const [name, declaration] of publicImplementations) {
    const id = declarationId(repositoryRoot, declaration);
    const law = lawForEquation(id, name);
    assert14.equal(lawById.get(law.id), law);
    const term4 = expectedTermsById.get(id);
    assert14(term4 !== void 0);
    memberEquations.push({
      id,
      publicName: name,
      declaration: spanOf(activeContext, declaration),
      law,
      term: term4,
      equationSha256: sha256(canonicalJson(term4)),
      dependencies: closure.dependenciesById.get(id) ?? []
    });
  }
  memberEquations.sort((left, right) => compareCodeUnits(left.id, right.id));
  const memberIds = new Set(memberEquations.map((equation3) => equation3.id));
  const helperEquations = [...closure.declarations].filter(([id]) => !memberIds.has(id)).map(([id, declaration]) => {
    const law = lawForEquation(id);
    const term4 = expectedTermsById.get(id);
    assert14(term4 !== void 0);
    return {
      id,
      declaration: spanOf(activeContext, declaration),
      law,
      term: term4,
      equationSha256: sha256(canonicalJson(term4)),
      dependencies: closure.dependenciesById.get(id) ?? []
    };
  }).sort((left, right) => compareCodeUnits(left.id, right.id));
  const dependenciesByEquationId = new Map(
    [...memberEquations, ...helperEquations].map((equation3) => [equation3.id, equation3.dependencies])
  );
  const publicSurface = new Map(surface.callables.map((callable) => [callable.key, callable]));
  const facadeSource = sources.get("src/facade.ts");
  const plannerBridge = sourceOverrides.size === 0 ? replacementConstructionBridge({ context: activeContext, source: facadeSource }) : { kind: "MUTATION_CONTROL_ONLY" };
  const proofs = [];
  for (const surfaceKey of ASSIGNED_SURFACE_KEYS4) {
    const callable = publicSurface.get(surfaceKey);
    assert14(callable !== void 0, `Compiler omitted assigned callable '${surfaceKey}'.`);
    let name;
    let implementation;
    let relation;
    const exported = /^export:\.\/kernel#([^:]+)::call\[0\]$/u.exec(surfaceKey);
    if (exported !== null) {
      name = exported[1];
      implementation = publicImplementations.get(name);
      assert14(implementation !== void 0);
      if (sourceOverrides.size === 0) {
        assert14.deepEqual(callable.declaration, spanOf(activeContext, implementation), `Export declaration drifted for '${surfaceKey}'.`);
        assert14(callable.reachabilityPaths.includes(`export:./kernel#${name}`));
      }
      relation = sourceOverrides.size === 0 ? { kind: "COMPILER_RESOLVED_EXACT_EXPORT", implementation: spanOf(activeContext, implementation) } : { kind: "MUTATION_CONTROL_ONLY" };
    } else {
      const planner = /^type:src\/facade\.ts#InventoryOnceReplacementPlans\.([^:]+)::call\[0\]$/u.exec(surfaceKey);
      assert14(planner !== null, `Unexpected assigned key '${surfaceKey}'.`);
      name = planner[1];
      implementation = publicImplementations.get(name);
      assert14(implementation !== void 0);
      relation = sourceOverrides.size === 0 ? {
        ...replacementInterfaceRelation({
          context: activeContext,
          source: facadeSource,
          callable,
          implementation,
          methodName: name
        }),
        bridge: plannerBridge
      } : { kind: "MUTATION_CONTROL_ONLY" };
    }
    const equationId = declarationId(repositoryRoot, implementation);
    const equation3 = memberEquations.find((candidate) => candidate.id === equationId);
    assert14(equation3 !== void 0);
    const dependencyClosure = dependencyClosureForMember(
      equationId,
      dependenciesByEquationId,
      catalogFoundationReference.verifiedEquationIds
    );
    const allAdmittedInputs = dependencyClosure.pendingDependencyPaths.length === 0;
    proofs.push({
      surfaceKey,
      mode: "V",
      signature: callable.signature,
      signatureHash: callable.signatureHash,
      declaration: callable.declaration,
      implementation: spanOf(activeContext, implementation),
      relation,
      equationId,
      equationSha256: equation3.equationSha256,
      lawId: equation3.law.id,
      dependencyClosure,
      allAdmittedInputs,
      creditDisposition: !allAdmittedInputs ? "PENDING_CATALOG_FOUNDATION_DEPENDENCIES" : surfaceKey === "export:./kernel#commitInventoryEvent::call[0]" ? "NO_DOUBLE_CREDIT_IF_CONCURRENT_PHYSICALCOUNT_A_EXISTS" : "NEW_VALUE_CANDIDATE"
    });
  }
  const locallyClosedSurfaceKeys = proofs.filter((proof) => proof.dependencyClosure.catalogFoundationDependencyPaths.length === 0).map((proof) => proof.surfaceKey);
  assert14.deepEqual(
    locallyClosedSurfaceKeys,
    LOCALLY_CLOSED_SURFACE_KEYS,
    "Member-specific catalog dependency closure changed."
  );
  const admittedSurfaceKeys = proofs.filter((proof) => proof.allAdmittedInputs).map((proof) => proof.surfaceKey);
  const pendingSurfaceKeys = proofs.filter((proof) => !proof.allAdmittedInputs).map((proof) => proof.surfaceKey);
  const catalogFoundationAffectedSurfaceKeys = proofs.filter((proof) => proof.dependencyClosure.catalogFoundationDependencyPaths.length > 0).map((proof) => proof.surfaceKey);
  const fullFamilyAllAdmittedInputs = pendingSurfaceKeys.length === 0;
  const runtimeValues = runtimeValueEquations({
    repositoryRoot,
    context: activeContext,
    sources,
    expectedSource: expectedSource3
  });
  const semanticInputFiles = [
    ...allSourceFiles,
    ...producerFiles5,
    ...catalogFoundationReference.artifact.inputs.map((input2) => input2.file),
    ...currentReusedDependencyAuthority.inputs.map((input2) => input2.file),
    ...closure.standardOperations.map((operation) => operation.declaration.file),
    ...closure.runtimeGlobals.map((global) => global.declaration.file),
    ...runtimeValues.flatMap((value) => [
      ...(value.runtimeGlobalDeclarations ?? []).map((declaration) => declaration.file),
      ...value.constructorDeclaration === void 0 ? [] : [value.constructorDeclaration.file]
    ])
  ];
  const inputs3 = [...new Set(semanticInputFiles)].sort(compareCodeUnits).map((file) => ({
    file,
    sha256: sha256(sourceOverrides.get(file) ?? fs12.readFileSync(path15.resolve(repositoryRoot, file)))
  }));
  const semanticCore = {
    proofKind: EVENT_VALUES_PROOF_KIND,
    sourceBase: EVENT_VALUES_SOURCE_BASE,
    domain: FAMILY_DOMAIN2,
    laws: FAMILY_LAWS3,
    reusedDependencyFamilies: REUSED_DEPENDENCY_FAMILIES,
    currentReusedDependencyAuthority: {
      verifiedEquationIds: currentReusedDependencyAuthority.verifiedEquationIds,
      providers: currentReusedDependencyAuthority.providers,
      families: currentReusedDependencyAuthority.families,
      activeItem: currentReusedDependencyAuthority.activeItem
    },
    catalogFoundationDependency: {
      ...catalogFoundationReference.reference,
      equationIds: closure.catalogFoundationDependencies,
      affectedSurfaceKeys: catalogFoundationAffectedSurfaceKeys,
      relation: catalogFoundationReference.verified ? "VERIFIED_REGISTERED_SOURCE_EQUATION_REFERENCE" : "PENDING_REGISTERED_SOURCE_EQUATION_REFERENCE"
    },
    reusedEquationIds: closure.reusedDependencies,
    inputs: inputs3,
    runtimeValues,
    runtimeGlobals: closure.runtimeGlobals,
    standardOperations: closure.standardOperations,
    memberEquations,
    helperEquations,
    memberDependencyClosures: proofs.map((proof) => ({
      surfaceKey: proof.surfaceKey,
      allAdmittedInputs: proof.allAdmittedInputs,
      ...proof.dependencyClosure
    })),
    admissionPartition: {
      assignedSurfaceKeys: ASSIGNED_SURFACE_KEYS4,
      locallyClosedSurfaceKeys,
      admittedSurfaceKeys,
      pendingSurfaceKeys
    },
    replacementConstructionBridge: plannerBridge,
    durablePublicationClaimed: false,
    overlapPolicy: {
      surfaceKey: "export:./kernel#commitInventoryEvent::call[0]",
      rule: "A concurrent/existing PhysicalCount A admission wins; this V equation may strengthen provenance but is never counted as a second callable."
    }
  };
  const certificateId = `VALUE_CERTIFICATE_FAMILY:sha256:${sha256(canonicalJson(semanticCore))}`;
  return {
    schemaVersion: 1,
    mode: "V",
    proofKind: EVENT_VALUES_PROOF_KIND,
    certificateId,
    surfaceDigest: surface.digest,
    allAdmittedInputs: fullFamilyAllAdmittedInputs,
    sampledInputs: 0,
    inputs: inputs3,
    domain: FAMILY_DOMAIN2,
    semanticCore,
    proofs
  };
}
function registeredArtifactFromCompleteFamily(completeArtifact) {
  if (completeArtifact.allAdmittedInputs) return completeArtifact;
  const proofs = completeArtifact.proofs.filter((proof) => proof.allAdmittedInputs);
  assert14(proofs.length > 0, "No independently closed event-family member is available.");
  const registeredSurfaceKeys = proofs.map((proof) => proof.surfaceKey);
  assert14.deepEqual(registeredSurfaceKeys, LOCALLY_CLOSED_SURFACE_KEYS);
  const semanticCore = {
    ...completeArtifact.semanticCore,
    registrationScope: {
      kind: "MEMBER_SPECIFIC_TRANSITIVE_CLOSURE_SUBSET",
      completeFamilyCertificateId: completeArtifact.certificateId,
      registeredSurfaceKeys,
      pendingSurfaceKeys: completeArtifact.proofs.filter((proof) => !proof.allAdmittedInputs).map((proof) => proof.surfaceKey),
      allRegisteredMemberInputsAdmitted: true
    }
  };
  return {
    ...completeArtifact,
    certificateId: `VALUE_CERTIFICATE_FAMILY:sha256:${sha256(canonicalJson(semanticCore))}`,
    allAdmittedInputs: true,
    semanticCore,
    proofs
  };
}
function buildFamilyArtifact5(arguments_) {
  return registeredArtifactFromCompleteFamily(familyArtifactForCompilerPass(arguments_));
}
var supportedSurfaceKeys5 = ASSIGNED_SURFACE_KEYS4;
function cachedInputsAreFresh(repositoryRoot, inputs3) {
  return inputs3.every((input2) => sha256(fs12.readFileSync(path15.resolve(repositoryRoot, input2.file))) === input2.sha256);
}
function familyArtifactForCompilerPass({ repositoryRoot, context, surface }) {
  const cached2 = familyPassCache.get(context);
  if (cached2 !== void 0 && cached2.surfaceDigest === surface.digest && cachedInputsAreFresh(repositoryRoot, cached2.artifact.inputs)) {
    return cached2.artifact;
  }
  const artifact = buildEventValuesFamilyArtifact({ repositoryRoot, context, surface });
  familyPassCache.set(context, { surfaceDigest: surface.digest, artifact });
  return artifact;
}

// experiments/tla-conformance/surface-residual-r8/pure-residual5-r10/composition-open-family.mjs
var proofKind3 = "surface-residual-composition-open-complete-value-v1";
var supportedSurfaceKeys6 = Object.freeze(["export:./kernel#createInventoryCompositionOpenEvent::call[0]"]);
var EXPECTED = "experiments/tla-conformance/surface-residual-r8/pure-residual5-r10/composition-open.expected.ts.txt";
var PUBLIC = Object.freeze({ file: "src/composition.ts", actual: "createInventoryCompositionOpenEvent", expected: "expectedCreateInventoryCompositionOpenEvent" });
var PRIVATE = Object.freeze([
  { actual: "createCompositionOutputLine", expected: "expectedCreateCompositionOutputLine" },
  { actual: "compositionOutputAmount", expected: "expectedCompositionOutputAmount" },
  { actual: "compositionOutputPosition", expected: "expectedCompositionOutputPosition" },
  { actual: "compositionOutputLotId", expected: "expectedCompositionOutputLotId" },
  { actual: "compositionOutputLotMetadata", expected: "expectedCompositionOutputLotMetadata" },
  { actual: "currentSourceLot", expected: "expectedCurrentSourceLot" },
  { actual: "compositionTraceabilityNode", expected: "expectedCompositionTraceabilityNode" },
  { actual: "assertKnownCompositionPlacements", expected: "expectedAssertKnownCompositionPlacements" },
  { actual: "assertCompositionPlacementFields", expected: "expectedAssertCompositionPlacementFields" },
  { actual: "compositionEventMetadata", expected: "expectedCompositionEventMetadata" },
  { actual: "compositionOutputEvidence", expected: "expectedCompositionOutputEvidence" }
]);
var DEPENDENCIES = Object.freeze([
  { family: "identity", key: "export:.#inventoryMeasuredAmountFromVector::call[0]" },
  { family: "identity", key: "export:.#packageAmount::call[0]" },
  { family: "identity", key: "export:.#inventoryLotIdentity::call[0]" },
  { family: "identity", key: "export:./kernel#inventoryTraceabilityNodeIdentity::call[0]" },
  { family: "quantity", key: "export:.#inventoryMeasurementsFingerprint::call[0]" },
  { family: "quantity", key: "export:.#multiplyInventoryMeasurementsByWholeNumber::call[0]" },
  { family: "catalog", key: "type:src/catalog.ts#InventoryCatalog.itemRevision::call[0]" },
  { family: "catalog", key: "type:src/catalog.ts#InventoryCatalog.packagingRevision::call[0]" },
  { family: "catalog", key: "type:src/catalog.ts#InventoryCatalog.compositionForSourcePackagingRevision::call[0]" },
  { family: "event", key: "export:./kernel#createInventoryTransformationEvent::call[0]" }
]);
function sf(root3, file, override) {
  const abs = path16.resolve(root3, file);
  return ts.createSourceFile(abs, override ?? fs13.readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function expectedSource(root3) {
  const file = path16.resolve(root3, EXPECTED);
  return ts.createSourceFile(file, fs13.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function findFunction4(source7, name) {
  const rows = source7.statements.filter((row) => ts.isFunctionDeclaration(row) && row.name?.text === name);
  assert15.equal(rows.length, 1, `Expected one function ${name}`);
  assert15(rows[0].body !== void 0);
  return rows[0];
}
function runtimeTerm(node, source7) {
  let text = node.getText(source7).replace(/^export\s+/u, "");
  const name = node.name?.text;
  assert15(name !== void 0);
  text = text.replace(new RegExp(`^(?:async\\s+)?function\\s+${name}\\b`), (m) => m.replace(name, "__proof"));
  const emitted = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, removeComments: true } }).outputText.trim();
  const scanner = ts.createScanner(ts.ScriptTarget.ES2022, true, ts.LanguageVariant.Standard, emitted);
  const tokens5 = [];
  for (; ; ) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    tokens5.push([ts.SyntaxKind[kind], scanner.getTokenText()]);
  }
  return tokens5;
}
function prove(actual, expected, label) {
  const a = runtimeTerm(actual, actual.getSourceFile()), e = runtimeTerm(expected, expected.getSourceFile());
  assert15.deepEqual(a, e, `Complete expected source equation drifted: ${label}`);
  return { label, normalizedTermSha256: sha256(canonicalJson(a)), completeBranchesChecked: true, allValidatedInputs: true, sampledInputs: 0 };
}
function enumValues(source7, name, wanted) {
  const rows = source7.statements.filter((row) => ts.isEnumDeclaration(row) && row.name.text === name);
  assert15.equal(rows.length, 1, `Expected enum ${name}`);
  const result = {};
  for (const member2 of rows[0].members) {
    const key = member2.name.getText(source7);
    if (!wanted.includes(key)) continue;
    assert15(ts.isStringLiteral(member2.initializer), `${name}.${key} must stay string-valued`);
    result[key] = member2.initializer.text;
  }
  assert15.deepEqual(Object.keys(result).sort(), [...wanted].sort());
  return result;
}
function sourceEquationReceipt(root3, overrides = /* @__PURE__ */ new Map()) {
  const actual = sf(root3, "src/composition.ts", overrides.get("src/composition.ts")), expected = expectedSource(root3);
  const publicEquation = prove(findFunction4(actual, PUBLIC.actual), findFunction4(expected, PUBLIC.expected), PUBLIC.actual);
  const privateEquations = PRIVATE.map((row) => prove(findFunction4(actual, row.actual), findFunction4(expected, row.expected), row.actual));
  const catalog = sf(root3, "src/catalog.ts", overrides.get("src/catalog.ts")), model = sf(root3, "src/model.ts", overrides.get("src/model.ts"));
  const supportingValues = {
    InventoryCompositionOutputAmountKind: enumValues(catalog, "InventoryCompositionOutputAmountKind", ["Measured", "Package"]),
    InventoryCompositionOutputLotPolicy: enumValues(catalog, "InventoryCompositionOutputLotPolicy", ["None", "InheritSource", "InheritSourceWhenPresent", "Explicit"]),
    InventoryTrackingRequirement: enumValues(catalog, "InventoryTrackingRequirement", ["Forbidden", "Optional", "Required"]),
    InventoryTraceabilityNodeKind: enumValues(model, "InventoryTraceabilityNodeKind", ["Serial", "Container", "Lot", "External"])
  };
  assert15.deepEqual(supportingValues, { InventoryCompositionOutputAmountKind: { Measured: "measured", Package: "package" }, InventoryCompositionOutputLotPolicy: { None: "none", InheritSource: "inherit-source", InheritSourceWhenPresent: "inherit-source-when-present", Explicit: "explicit" }, InventoryTrackingRequirement: { Forbidden: "forbidden", Optional: "optional", Required: "required" }, InventoryTraceabilityNodeKind: { Serial: "serial", Container: "container", Lot: "lot", External: "external" } });
  return { publicEquation, privateEquations, supportingValues };
}
function familyArtifacts(root3, context, surface) {
  return /* @__PURE__ */ new Map([
    ["identity", buildIdentityValuesFamilyArtifact({ repositoryRoot: root3, context, surface })],
    ["quantity", buildQuantityValuesFamilyCertificate({ repositoryRoot: root3, context, surface })],
    ["catalog", buildCatalogFamilyArtifact({ repositoryRoot: root3, context, surface })],
    ["event", buildEventValuesFamilyArtifact({ repositoryRoot: root3, context, surface })]
  ]);
}
function dependencyReceipt(root3, context, surface) {
  const families = familyArtifacts(root3, context, surface), receipts = [];
  for (const dep of DEPENDENCIES) {
    const artifact = families.get(dep.family);
    assert15(artifact !== void 0);
    assert15.equal(artifact.surfaceDigest, surface.digest);
    const proof = artifact.proofs.find((p) => p.surfaceKey === dep.key);
    assert15(proof !== void 0, `${dep.family} missing ${dep.key}`);
    const callable = surface.callables.find((row) => row.key === dep.key);
    assert15(callable !== void 0);
    assert15.equal(proof.signatureHash, callable.signatureHash);
    assert15.deepEqual(proof.declaration, callable.declaration);
    receipts.push({ family: dep.family, proofKind: artifact.proofKind, surfaceKey: dep.key, signatureHash: proof.signatureHash, declaration: proof.declaration, semanticIdentity: proof.semantics?.equationSha256 ?? proof.equationId ?? proof.implementationKey ?? proof.lawId ?? null });
  }
  return { families, receipts };
}
function addInput(root3, inputs3, file) {
  if (inputs3.has(file)) return;
  inputs3.set(file, { file, sha256: sha256(fs13.readFileSync(path16.resolve(root3, file))) });
}
function semanticInputs(root3, deps) {
  const inputs3 = /* @__PURE__ */ new Map();
  for (const file of [EXPECTED, "experiments/tla-conformance/surface-residual-r8/pure-residual5-r10/composition-open-family.mjs", "src/composition.ts", "src/catalog.ts", "src/model.ts", "node_modules/typescript/package.json"]) addInput(root3, inputs3, file);
  for (const artifact of deps.families.values()) for (const input2 of artifact.inputs ?? artifact.producers ?? []) addInput(root3, inputs3, input2.file);
  return [...inputs3.values()].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
}
function buildFamilyArtifact6({ repositoryRoot = process.cwd(), context = loadEvidenceCompilerContext(repositoryRoot, []), surface = discoverCompilerSurface(repositoryRoot), sourceOverrides = /* @__PURE__ */ new Map() } = {}) {
  const equations2 = sourceEquationReceipt(repositoryRoot, sourceOverrides);
  if (sourceOverrides.size > 0) return { mutationControlAccepted: false, equations: equations2 };
  const deps = dependencyReceipt(repositoryRoot, context, surface), callable = surface.callables.find((row) => row.key === supportedSurfaceKeys6[0]);
  assert15(callable !== void 0);
  return { schemaVersion: 1, proofKind: proofKind3, surfaceDigest: surface.digest, domain: "Every input admitted by CreateInventoryCompositionOpenEventInput. Complete public control flow and all eleven private helper equations are independently frozen, including package-count rejection, source-package/item consistency, output placement validation, lot inheritance/explicit-lot rules, genealogy ambiguity, amount scaling, output placement and audit metadata. Exact external Catalog, Identity, Quantity and TransformationEvent semantics are rederived from their already-certified families; no sampled fixtures or bounded composition oracle are used.", allAdmittedInputs: true, sampledInputs: 0, producerGraphRuns: 0, producerReplayRuns: 0, inputs: semanticInputs(repositoryRoot, deps), proofs: [{ surfaceKey: supportedSurfaceKeys6[0], signatureHash: callable.signatureHash, declaration: callable.declaration, semantics: { completeExpectedTerm: equations2.publicEquation, privateEquations: equations2.privateEquations, supportingValues: equations2.supportingValues, dependencyReceipts: deps.receipts, languagePrimitives: ["Number.isSafeInteger", "Object.keys", "Object.entries", "Set", "encodeURIComponent"] } }] };
}

// experiments/tla-conformance/residual-core-v4-r10/family.mjs
import assert20 from "node:assert/strict";
import fs18 from "node:fs";
import path21 from "node:path";

// experiments/tla-conformance/storage-protocol-r7/value-family.mjs
import assert16 from "node:assert/strict";
import fs14 from "node:fs";
import path17 from "node:path";
import { fileURLToPath as fileURLToPath9 } from "node:url";
var proofKind4 = "storage-protocol-construction-and-plan-closed-equations-v1";
var supportedSurfaceKeys7 = Object.freeze([
  "export:./storage#InMemoryInventoryDurableStorage::construct[0]",
  "export:./storage#InventoryApplyingOperationConflictError::construct[0]",
  "export:./storage#InventoryWorldRevisionConflictError::construct[0]",
  "export:./storage#createInMemoryInventoryDurableStorage::call[0]",
  "export:./storage#inventoryDurablePlanDigest::call[0]",
  "export:./storage#materializeInventoryDurableOperationWorld::call[0]",
  "export:./storage#validateInventoryDurableOperationBeginInput::call[0]"
]);
var equations = Object.freeze([
  ["src/storage.ts", "InventoryWorldRevisionConflictError.constructor"],
  ["src/storage.ts", "InventoryApplyingOperationConflictError.constructor"],
  ["src/storage.ts", "InMemoryInventoryDurableStorage.constructor"],
  ["src/storage.ts", "createInMemoryInventoryDurableStorage"],
  ["src/integrity.ts", "inventoryDurablePlanDigest"],
  ["src/storage.ts", "validateInventoryDurableOperationBeginInput"],
  ["src/storage.ts", "materializeInventoryDurableOperationWorld"],
  ["src/world.ts", "emptyInventoryWorldState"],
  ["src/storage.ts", "validateBeginInventoryOperation"],
  ["src/storage.ts", "validateInventoryDurablePlanAgainstBase"],
  ["src/storage.ts", "inventoryWorldContentRootsEqual"],
  ["src/storage.ts", "validatePublishedInventoryWorld"]
]);
var reusedCertificates = Object.freeze([
  { family: "inventoryonce-quantity-measurement-complete-source-equations-v1", certificateId: "sha256:9550e29f9da15f3c3e901c747ee4335f6ce00b055aaf4bf8386fd3dcef011eb2", artifactSha256: "e07ec5ed44b8fdb160b5b2a0969c276e12725d800ed0acd7da40a2244abfed0e" },
  { family: "independent-identity-values-closed-equations-v1", certificateId: "sha256:70cf9a5160149abb2eaaae541f129c0a661bd3315636a1cb96420fd88cd5fa63", artifactSha256: "c250ec4434674f76ae50993e1b228bb7ced4e884787ac604c573967b46f215e6" },
  { family: "independent-catalog-foundation-closed-equations-v1", certificateId: "sha256:f595bf4214015e0597d3c67cc9689e1f65b9ab65cc6c64c41158f7281ec6a442", artifactSha256: "3b87ba5c2fc4ff4ea6388b2a488c8ce679d8a4afbee159800153b4b0b50f9bce" },
  { family: "inventoryonce-event-replacement-complete-source-equations-v1", certificateId: "sha256:ed7bc453bea4add335da67f1610ec38ce15c076aa2e8dd3afa4ef58edfb83915", artifactSha256: "bfb5aa723e36d4755b51809fd587082632d2308002dc199668db465b727123d4" },
  { family: "inventoryonce-transfer-correction-complete-source-equations-v2", certificateId: "sha256:119157925048c0c4bf402ea8d28568ad4b1a96d8332f762687da9fb6f1e36def", artifactSha256: "2b36b0ef664a749dab53ce4d3f54f2ca5eacd7c0e05e8dc1d4a06b73c095f106" },
  { family: "migration-plugin-helper-independent-source-closed-values-v3", certificateId: "sha256:945885132722aa1dc32b70b7a30d059be4f12c26de3296c6edda8936056fbdd7", artifactSha256: "dd2d300816956ca2d6725b988572c7f18040f33820538bb7a21210d6031e5763" },
  { family: "independent-catalog-read-semantic-closure-equations-v2", certificateId: "sha256:f9d1a11d40e1c7abbe8d2b5da2c217e30a486c11cb5b66003b50d565fe423978", artifactSha256: "67d676a3e69cdfce473335022cab7aff206f09f9a0f8560898def33cff4195b9" }
]);
var expectedFile2 = fileURLToPath9(new URL("./value-equations.expected.ts.txt", import.meta.url));
var producerFiles6 = Object.freeze([
  "experiments/tla-conformance/storage-protocol-r7/value-equations.expected.ts.txt",
  "experiments/tla-conformance/storage-protocol-r7/value-family.mjs",
  "experiments/tla-conformance/quantity-values-r7/certificate.mjs",
  "experiments/tla-conformance/surface-bindings/lib/compiler-surface.mjs"
]);
function parseSource4(fileName, text) {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function findCallable3(source7, equationId) {
  if (equationId.endsWith(".constructor")) {
    const className = equationId.slice(0, -".constructor".length);
    const classes = source7.statements.filter((statement) => ts.isClassDeclaration(statement) && statement.name?.text === className);
    assert16.equal(classes.length, 1, `Expected one class '${className}'.`);
    const constructors = classes[0].members.filter((member2) => ts.isConstructorDeclaration(member2) && member2.body !== void 0);
    assert16.equal(constructors.length, 1, `Expected one constructor '${equationId}'.`);
    return constructors[0];
  }
  const functions2 = source7.statements.filter((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === equationId && statement.body !== void 0);
  assert16.equal(functions2.length, 1, `Expected one function '${equationId}'.`);
  return functions2[0];
}
function normalizeConstructor(declaration) {
  const parameters = /* @__PURE__ */ new Map();
  for (const [index, parameter] of declaration.parameters.entries()) {
    assert16(ts.isIdentifier(parameter.name), "Storage constructors use simple parameters.");
    parameters.set(parameter.name.text, `parameter:${index}`);
  }
  function expression(node) {
    if (ts.isParenthesizedExpression(node)) return expression(node.expression);
    if (node.kind === ts.SyntaxKind.ThisKeyword) return ["this"];
    if (node.kind === ts.SyntaxKind.SuperKeyword) return ["super"];
    if (ts.isIdentifier(node)) return ["reference", parameters.get(node.text) ?? `source:${node.text}`];
    if (ts.isStringLiteral(node)) return ["string", node.text];
    if (node.kind === ts.SyntaxKind.NullKeyword) return ["null"];
    if (ts.isPropertyAccessExpression(node)) return ["property", expression(node.expression), node.name.text];
    if (ts.isCallExpression(node)) return ["call", expression(node.expression), node.arguments.map(expression)];
    if (ts.isBinaryExpression(node)) return ["binary", ts.tokenToString(node.operatorToken.kind), expression(node.left), expression(node.right)];
    if (ts.isTemplateExpression(node)) return ["template", node.head.text, node.templateSpans.map((span) => [expression(span.expression), span.literal.text])];
    if (ts.isObjectLiteralExpression(node)) return ["record", node.properties.length];
    throw new Error(`Unsupported constructor equation expression '${ts.SyntaxKind[node.kind]}'.`);
  }
  return {
    parameters: declaration.parameters.map((parameter, index) => ({
      identity: `parameter:${index}`,
      type: parameter.type?.getText().replaceAll(/\s+/gu, "") ?? null,
      default: parameter.initializer === void 0 ? null : expression(parameter.initializer)
    })),
    body: declaration.body.statements.map((statement) => {
      assert16(ts.isExpressionStatement(statement), "Storage constructors use expression statements only.");
      return expression(statement.expression);
    })
  };
}
function normalizedEquation(declaration) {
  const term4 = ts.isConstructorDeclaration(declaration) ? normalizeConstructor(declaration) : normalizeQuantityValueCallable(declaration);
  return removeTypeComments(term4);
}
function removeTypeComments(value, field = "") {
  if (typeof value === "string") {
    return field === "type" ? value.replaceAll(/\/\*[\s\S]*?\*\//gu, "") : value;
  }
  if (Array.isArray(value)) return value.map((entry) => removeTypeComments(entry));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, removeTypeComments(entry, name)]));
}
function sourceText2(repositoryRoot, sourceOverrides, file) {
  return sourceOverrides.get(file) ?? fs14.readFileSync(path17.resolve(repositoryRoot, file), "utf8");
}
function buildFamilyArtifact7({ repositoryRoot, context, surface, sourceOverrides = /* @__PURE__ */ new Map() }) {
  assert16.equal(supportedSurfaceKeys7.length, 7);
  const expected = parseSource4(expectedFile2, fs14.readFileSync(expectedFile2, "utf8"));
  const actualSources = /* @__PURE__ */ new Map();
  for (const file of [...new Set(equations.map(([sourceFile3]) => sourceFile3))]) {
    const source7 = sourceOverrides.has(file) ? parseSource4(path17.resolve(repositoryRoot, file), sourceText2(repositoryRoot, sourceOverrides, file)) : context.program.getSourceFile(path17.resolve(repositoryRoot, file));
    assert16(source7 !== void 0, `Compiler omitted '${file}'.`);
    actualSources.set(file, source7);
  }
  const derivedEquations = [];
  for (const [file, equationId] of equations) {
    const actual = findCallable3(actualSources.get(file), equationId);
    const stated = findCallable3(expected, equationId);
    const actualTerm = normalizedEquation(actual);
    const expectedTerm = normalizedEquation(stated);
    assert16.deepEqual(actualTerm, expectedTerm, `Independent storage equation changed for '${equationId}'.`);
    derivedEquations.push({
      id: `${file}#${equationId}`,
      implementation: sourceOverrides.size === 0 ? spanOf(context, actual) : null,
      equationSha256: sha256(canonicalJson(expectedTerm)),
      term: expectedTerm
    });
  }
  const callableByKey = new Map(surface.callables.map((callable) => [callable.key, callable]));
  const publicEquationByKey = /* @__PURE__ */ new Map([
    [supportedSurfaceKeys7[0], "src/storage.ts#InMemoryInventoryDurableStorage.constructor"],
    [supportedSurfaceKeys7[1], "src/storage.ts#InventoryApplyingOperationConflictError.constructor"],
    [supportedSurfaceKeys7[2], "src/storage.ts#InventoryWorldRevisionConflictError.constructor"],
    [supportedSurfaceKeys7[3], "src/storage.ts#createInMemoryInventoryDurableStorage"],
    [supportedSurfaceKeys7[4], "src/integrity.ts#inventoryDurablePlanDigest"],
    [supportedSurfaceKeys7[5], "src/storage.ts#materializeInventoryDurableOperationWorld"],
    [supportedSurfaceKeys7[6], "src/storage.ts#validateInventoryDurableOperationBeginInput"]
  ]);
  const proofs = supportedSurfaceKeys7.map((surfaceKey) => {
    const callable = callableByKey.get(surfaceKey);
    assert16(callable !== void 0, `Compiler omitted '${surfaceKey}'.`);
    return {
      surfaceKey,
      signatureHash: callable.signatureHash,
      declaration: callable.declaration,
      equationId: publicEquationByKey.get(surfaceKey)
    };
  });
  const inputFiles2 = [.../* @__PURE__ */ new Set([
    ...producerFiles6,
    ...equations.map(([file]) => file),
    "package.json"
  ])].sort(compareCodeUnits);
  const inputs3 = inputFiles2.map((file) => ({
    file,
    sha256: sha256(sourceOverrides.get(file) ?? fs14.readFileSync(path17.resolve(repositoryRoot, file)))
  }));
  return {
    schemaVersion: 1,
    mode: "V",
    proofKind: proofKind4,
    sourceBase: "2eea09471b3bf8fcb61f38256e1c6a362149dad4",
    surfaceDigest: surface.digest,
    allAdmittedInputs: true,
    sampledInputs: 0,
    domain: {
      constructors: "all accepted constructor inputs plus every explicit guard",
      digest: "all structural plan parts with exact ordered JSON fields",
      validation: "all begin inputs through every source guard and catalog/event identity dependency",
      materialization: "all compact plans through exact base/root/digest and component-delta checks"
    },
    reusedCertificates,
    equations: derivedEquations,
    inputs: inputs3,
    proofs
  };
}

// experiments/tla-conformance/materialize1-r8/family.mjs
import assert19 from "node:assert/strict";
import fs17 from "node:fs";
import path20 from "node:path";
import { fileURLToPath as fileURLToPath11 } from "node:url";

// experiments/tla-conformance/migration-helper-causal-r7/independent-v9-laws.mjs
import assert17 from "node:assert/strict";
import fs15 from "node:fs";
import path18 from "node:path";
var EXPECTED_FILE = "experiments/tla-conformance/migration-helper-causal-r7/v9.expected.ts.txt";
var CAUSAL_FILE = "experiments/tla-conformance/migration-helper-causal-r7/artifacts/runtime-causal.json";
var BANK_FILE = "experiments/tla-conformance/admission-audit/bank-current/canonical-535.json";
var v9Contracts = [
  ["export:./migrations#createInventoryLegacyQueryReader::call[0]", "src/migration-plugin.ts", "createInventoryLegacyQueryReader", "expected_createInventoryLegacyQueryReader"],
  ["export:./migrations#defineInventoryLegacyQuery::call[0]", "src/migration-plugin.ts", "defineInventoryLegacyQuery", "expected_defineInventoryLegacyQuery"],
  ["export:./migrations#defineInventoryMigrationPlugin::call[0]", "src/migration-plugin.ts", "defineInventoryMigrationPlugin", "expected_defineInventoryMigrationPlugin"],
  ["export:./migrations#defineInventoryMigrationSourcePlugin::call[0]", "src/migration-plugin.ts", "defineInventoryMigrationSourcePlugin", "expected_defineInventoryMigrationSourcePlugin"],
  ["export:./migrations#inventoryMigrationPositionsMatch::call[0]", "src/migrations.ts", "inventoryMigrationPositionsMatch", "expected_inventoryMigrationPositionsMatch"],
  ["export:./migrations#inventoryMigrationProblem::call[0]", "src/migrations.ts", "inventoryMigrationProblem", "expected_inventoryMigrationProblem"],
  ["export:./storage#inventoryDurableMigrationPlanDigest::call[0]", "src/integrity.ts", "inventoryDurableMigrationPlanDigest", "expected_inventoryDurableMigrationPlanDigest"],
  ["export:./storage#materializeInventoryDurableMigrationWorld::call[0]", "src/storage.ts", "materializeInventoryDurableMigrationWorld", "expected_materializeInventoryDurableMigrationWorld"],
  ["export:./storage#validateInventoryMigrationManifestBeginInput::call[0]", "src/storage.ts", "validateInventoryMigrationManifestBeginInput", "expected_validateInventoryMigrationManifestBeginInput"]
].map(([surfaceKey, file, implementation, expected]) => ({ surfaceKey, file, implementation, expected }));
var localLawContracts = [
  ["src/digest.ts#inventorySha256", "src/digest.ts", "inventorySha256", "expected_inventorySha256"],
  ["src/digest.ts#rotateRight", "src/digest.ts", "rotateRight", "expected_rotateRight"],
  ["src/storage.ts#validateBeginInventoryMigrationManifest", "src/storage.ts", "validateBeginInventoryMigrationManifest", "expected_validateBeginInventoryMigrationManifest"],
  ["src/storage.ts#migrationSourceDispositionsEqual", "src/storage.ts", "migrationSourceDispositionsEqual", "expected_migrationSourceDispositionsEqual"],
  ["src/migration-evidence.ts#inventoryMigrationSourceDispositionFingerprint", "src/migration-evidence.ts", "inventoryMigrationSourceDispositionFingerprint", "expected_inventoryMigrationSourceDispositionFingerprint"],
  ["src/storage.ts#validateInventoryDurableMigrationPlanAgainstBase", "src/storage.ts", "validateInventoryDurableMigrationPlanAgainstBase", "expected_validateInventoryDurableMigrationPlanAgainstBase"],
  ["src/storage.ts#inventoryWorldContentRootsEqual", "src/storage.ts", "inventoryWorldContentRootsEqual", "expected_inventoryWorldContentRootsEqual"]
].map(([id, file, implementation, expected]) => ({ id, file, implementation, expected }));
var expectedDependencies3 = /* @__PURE__ */ new Map([
  ["src/migration-plugin.ts#createInventoryLegacyQueryReader", ["src/migration-plugin.ts#readAllInventoryLegacyQuery"]],
  ["src/migration-plugin.ts#defineInventoryLegacyQuery", []],
  ["src/migration-plugin.ts#defineInventoryMigrationPlugin", []],
  ["src/migration-plugin.ts#defineInventoryMigrationSourcePlugin", []],
  ["src/migrations.ts#inventoryMigrationPositionsMatch", [
    "src/measurements.ts#inventoryMeasurementsEqual",
    "src/migrations.ts#dryRunInventoryMigration",
    "src/model.ts#inventoryStockPositionIdentity"
  ]],
  ["src/migrations.ts#inventoryMigrationProblem", []],
  ["src/integrity.ts#inventoryDurableMigrationPlanDigest", ["src/digest.ts#inventorySha256"]],
  ["src/storage.ts#materializeInventoryDurableMigrationWorld", ["src/storage.ts#validateInventoryDurableMigrationPlanAgainstBase"]],
  ["src/storage.ts#validateInventoryMigrationManifestBeginInput", ["src/storage.ts#validateBeginInventoryMigrationManifest"]],
  ["src/digest.ts#inventorySha256", ["src/digest.ts#rotateRight"]],
  ["src/digest.ts#rotateRight", []],
  ["src/storage.ts#validateBeginInventoryMigrationManifest", ["src/storage.ts#migrationSourceDispositionsEqual"]],
  ["src/storage.ts#migrationSourceDispositionsEqual", [
    "src/canonical.ts#inventoryIntentFingerprint",
    "src/migration-evidence.ts#inventoryMigrationSourceDispositionFingerprint"
  ]],
  ["src/migration-evidence.ts#inventoryMigrationSourceDispositionFingerprint", ["src/canonical.ts#inventoryMetadataFingerprint"]],
  ["src/storage.ts#validateInventoryDurableMigrationPlanAgainstBase", [
    "src/catalog.ts#assertInventoryCatalogRetainsSnapshot",
    "src/catalog.ts#inventoryCatalogFromSnapshot",
    "src/integrity.ts#inventoryDurableMigrationPlanDigest",
    "src/integrity.ts#inventoryWorldContentRoots",
    "src/projection.ts#applyInventoryCommittedEvent",
    "src/storage.ts#inventoryWorldContentRootsEqual"
  ]],
  ["src/storage.ts#inventoryWorldContentRootsEqual", []]
]);
function currentSource(repositoryRoot, context, file, sourceOverrides) {
  const override = sourceOverrides.get(file);
  if (override !== void 0) {
    return ts.createSourceFile(path18.resolve(repositoryRoot, file), override, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  }
  const source7 = context.program.getSourceFile(path18.resolve(repositoryRoot, file));
  assert17(source7 !== void 0 && !source7.isDeclarationFile, `Missing source ${file}`);
  return source7;
}
function findFunction5(source7, name) {
  const rows = source7.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert17.equal(rows.length, 1, `Expected one function ${name}`);
  assert17(rows[0].body !== void 0, `${name} has no body`);
  return rows[0];
}
function scanTokens(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const tokens5 = [];
  for (; ; ) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    tokens5.push([ts.SyntaxKind[kind], scanner.getTokenText()]);
  }
  return tokens5;
}
function completeCallableTerm(declaration, source7) {
  return {
    async: declaration.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
    generator: declaration.asteriskToken !== void 0,
    typeParameters: (declaration.typeParameters ?? []).map((row) => scanTokens(row.getText(source7))),
    parameters: declaration.parameters.map((row) => scanTokens(row.getText(source7))),
    returnType: declaration.type === void 0 ? null : scanTokens(declaration.type.getText(source7)),
    body: scanTokens(declaration.body.getText(source7))
  };
}
function expectedTerms(repositoryRoot) {
  const text = fs15.readFileSync(path18.resolve(repositoryRoot, EXPECTED_FILE), "utf8");
  const source7 = ts.createSourceFile(EXPECTED_FILE, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functions2 = /* @__PURE__ */ new Map();
  const values = /* @__PURE__ */ new Map();
  for (const statement of source7.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== void 0 && statement.body !== void 0) {
      functions2.set(statement.name.text, completeCallableTerm(statement, source7));
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer !== void 0) {
          values.set(declaration.name.text, {
            type: declaration.type === void 0 ? null : scanTokens(declaration.type.getText(source7)),
            initializer: scanTokens(declaration.initializer.getText(source7))
          });
        }
      }
    }
  }
  return { file: { file: EXPECTED_FILE, sha256: sha256(text) }, functions: functions2, values };
}
function packageDeclarationId(repositoryRoot, declaration) {
  const file = path18.relative(repositoryRoot, declaration.getSourceFile().fileName).replaceAll("\\", "/");
  if (!file.startsWith("src/")) return null;
  if (ts.isFunctionDeclaration(declaration) && declaration.name !== void 0) return `${file}#${declaration.name.text}`;
  if (ts.isMethodDeclaration(declaration) && declaration.name !== void 0) {
    const owner = declaration.parent?.name?.getText(declaration.getSourceFile());
    return `${file}#${owner === void 0 ? "" : `${owner}.`}${declaration.name.getText(declaration.getSourceFile())}`;
  }
  return null;
}
function directPackageDependencies(repositoryRoot, context, declaration) {
  const dependencies = /* @__PURE__ */ new Set();
  function recordResolved(target) {
    if (target === void 0) return;
    let resolved = target;
    if (ts.isIdentifier(target) || ts.isPropertyAccessExpression(target)) {
      let symbol = context.checker.getSymbolAtLocation(ts.isPropertyAccessExpression(target) ? target.name : target);
      if (symbol !== void 0 && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = context.checker.getAliasedSymbol(symbol);
      const sourceDeclaration = symbol?.declarations?.find((row) => packageDeclarationId(repositoryRoot, row) !== null);
      if (sourceDeclaration !== void 0) dependencies.add(packageDeclarationId(repositoryRoot, sourceDeclaration));
    }
    return resolved;
  }
  function visit(node) {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const target = context.checker.getResolvedSignature(node)?.declaration;
      const id = target === void 0 ? null : packageDeclarationId(repositoryRoot, target);
      if (id !== null) dependencies.add(id);
      recordResolved(node.expression);
      for (const argument of node.arguments ?? []) recordResolved(argument);
    }
    ts.forEachChild(node, visit);
  }
  visit(declaration.body);
  return [...dependencies].sort();
}
function currentDeclaration(repositoryRoot, context, file, name) {
  const declaration = findFunction5(currentSource(repositoryRoot, context, file, /* @__PURE__ */ new Map()), name);
  return { declaration, span: spanOf(context, declaration) };
}
function quantityCertificate(repositoryRoot, context, surface) {
  const document = buildFamilyArtifact3({ repositoryRoot, context, surface });
  assert17.equal(document.proofKind, "inventoryonce-quantity-measurement-complete-source-equations-v1");
  return { commit: "R131_CURRENT_SOURCE", sha256: sha256(canonicalJson(document)), document };
}
function identityCertificate(repositoryRoot, context, surface) {
  const document = buildFamilyArtifact2({ repositoryRoot, context, surface });
  assert17.equal(document.proofKind, "independent-identity-values-closed-equations-v1");
  return { commit: "R131_CURRENT_SOURCE", sha256: sha256(canonicalJson(document)), document };
}
function quantityReceipt(repositoryRoot, context, certificate, id) {
  const rows = [...certificate.document.semanticCore.memberEquations, ...certificate.document.semanticCore.helperEquations].filter((row) => row.id === id);
  assert17.equal(rows.length, 1, `Quantity certificate missing ${id}`);
  const [file, name] = id.split("#");
  const current = currentDeclaration(repositoryRoot, context, file, name);
  assert17.deepEqual(current.span, rows[0].implementation, `Quantity dependency drifted: ${id}`);
  return { kind: "INDEPENDENT_QUANTITY_EQUATION", id, certificateCommit: certificate.commit, certificateSha256: certificate.sha256, equationSha256: rows[0].equationSha256 };
}
function identityReceipt(repositoryRoot, context, certificate, id) {
  const rows = certificate.document.equations.filter((row) => row.id === id);
  assert17.equal(rows.length, 1, `Identity certificate missing ${id}`);
  const [file, name] = id.split("#");
  const current = currentDeclaration(repositoryRoot, context, file, name);
  assert17.deepEqual(current.span, rows[0].declaration, `Identity dependency drifted: ${id}`);
  return { kind: "INDEPENDENT_IDENTITY_EQUATION", id, certificateCommit: certificate.commit, certificateSha256: certificate.sha256, lawId: rows[0].lawId };
}
function strictSnapshotReceipt(repositoryRoot, surfaceKey) {
  const bank = JSON.parse(fs15.readFileSync(path18.resolve(repositoryRoot, BANK_FILE), "utf8"));
  const row = bank.rows.find((candidate) => candidate.callable.key === surfaceKey);
  assert17(row !== void 0 && row.binding.mode !== "HARD_RED", `Snapshot producer is not strict: ${surfaceKey}`);
  const execution = row.binding.execution;
  assert17(execution !== void 0);
  const bytes2 = fs15.readFileSync(path18.resolve(repositoryRoot, execution.file));
  assert17.equal(sha256(bytes2), execution.sha256, `Snapshot execution drifted: ${surfaceKey}`);
  return { kind: "STRICT_SNAPSHOT_PRODUCER", surfaceKey, mode: row.binding.mode, execution };
}
function pairedCausalReceipt(repositoryRoot, id) {
  const bytes2 = fs15.readFileSync(path18.resolve(repositoryRoot, CAUSAL_FILE));
  const document = JSON.parse(bytes2.toString("utf8"));
  assert17.equal(document.proofKind, "migration-plugin-helper-causal-runtime-v1");
  assert17.equal(sha256(bytes2), "db76e559e9019216bf38f2b284c20a14faf878b216132a9f504d03e75624a263");
  assert17.equal(document.directRead.transitions.length, 2);
  assert17.equal(document.readerRead.transitions.length, 2);
  assert17.equal(document.directRead.sourceAfter.readCount, 2);
  assert17.equal(document.readerRead.sourceAfter.readCount, 2);
  assert17.deepEqual(document.directRead.resultRows, document.readerRead.resultRows);
  return { kind: "PAIRED_B_CAUSAL_RUNTIME_READY", id, artifact: { file: CAUSAL_FILE, sha256: sha256(bytes2) }, globallyAdmitted: false };
}
function resolveDependency(repositoryRoot, context, quantity, identity, localIds, dependency2) {
  if (localIds.has(dependency2)) return { kind: "INDEPENDENT_LOCAL_EXPECTED_TERM", id: dependency2 };
  if (dependency2 === "src/migration-plugin.ts#readAllInventoryLegacyQuery") return pairedCausalReceipt(repositoryRoot, dependency2);
  if (dependency2 === "src/migrations.ts#dryRunInventoryMigration") return strictSnapshotReceipt(repositoryRoot, "export:./migrations#dryRunInventoryMigration::call[0]");
  if (["src/measurements.ts#inventoryMeasurementsEqual", "src/canonical.ts#inventoryIntentFingerprint"].includes(dependency2)) {
    return quantityReceipt(repositoryRoot, context, quantity, dependency2);
  }
  if (["src/model.ts#inventoryStockPositionIdentity", "src/canonical.ts#inventoryMetadataFingerprint"].includes(dependency2)) {
    return identityReceipt(repositoryRoot, context, identity, dependency2);
  }
  if (dependency2 === "src/integrity.ts#inventoryDurableMigrationPlanDigest") return { kind: "SAME_V9_COMPLETE_EXPECTED_TERM", id: dependency2 };
  const blockers = {
    "src/integrity.ts#inventoryWorldContentRoots": "AUTHORITY_COMPLETE_WORLD_ROOT_LAW_PENDING",
    "src/catalog.ts#inventoryCatalogFromSnapshot": "AUTHORITY_COMPLETE_CATALOG_REHYDRATION_LAW_PENDING",
    "src/catalog.ts#assertInventoryCatalogRetainsSnapshot": "AUTHORITY_COMPLETE_CATALOG_RETENTION_LAW_PENDING",
    "src/projection.ts#applyInventoryCommittedEvent": "COMPLETE_MIGRATION_EVENT_PROJECTION_LAW_PENDING"
  };
  if (blockers[dependency2] !== void 0) return { kind: "NAMED_GAP", id: blockers[dependency2], dependency: dependency2 };
  throw new Error(`Unclassified semantic dependency ${dependency2}`);
}
function proveExpectedTerm(repositoryRoot, context, expected, contract, sourceOverrides) {
  const source7 = currentSource(repositoryRoot, context, contract.file, sourceOverrides);
  const actual = findFunction5(source7, contract.implementation);
  const expectedTerm = expected.functions.get(contract.expected);
  assert17(expectedTerm !== void 0, `Expected term missing ${contract.expected}`);
  const term4 = completeCallableTerm(actual, source7);
  assert17.deepEqual(term4, expectedTerm, `Complete expected term mismatch: ${contract.implementation}`);
  return { termSha256: sha256(canonicalJson(term4)), implementation: sourceOverrides.size === 0 ? spanOf(context, actual) : { file: contract.file, mutatedControl: true } };
}
function proveShaSupportingValues(repositoryRoot, context, expected, sourceOverrides) {
  const source7 = currentSource(repositoryRoot, context, "src/digest.ts", sourceOverrides);
  const rows = [];
  for (const name of ["SHA256_INITIAL_HASH", "SHA256_ROUND_CONSTANTS"]) {
    const declarations = [];
    for (const statement of source7.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration2 of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration2.name) && declaration2.name.text === name) declarations.push(declaration2);
      }
    }
    assert17.equal(declarations.length, 1);
    const declaration = declarations[0];
    assert17(declaration.initializer !== void 0);
    const actual = {
      type: declaration.type === void 0 ? null : scanTokens(declaration.type.getText(source7)),
      initializer: scanTokens(declaration.initializer.getText(source7))
    };
    const wanted = expected.values.get(name);
    assert17(wanted !== void 0);
    assert17.deepEqual(actual, wanted, `SHA supporting constant changed: ${name}`);
    rows.push({ name, termSha256: sha256(canonicalJson(actual)) });
  }
  return rows;
}
function transitiveGaps(receipts, localById, seen = /* @__PURE__ */ new Set()) {
  const gaps = [];
  for (const receipt of receipts) {
    if (receipt.kind === "NAMED_GAP") {
      gaps.push(receipt);
      continue;
    }
    if (receipt.kind !== "INDEPENDENT_LOCAL_EXPECTED_TERM" || seen.has(receipt.id)) continue;
    const local = localById.get(receipt.id);
    assert17(local !== void 0, `Local law missing ${receipt.id}`);
    const childSeen = new Set(seen);
    childSeen.add(receipt.id);
    gaps.push(...transitiveGaps(local.dependencies, localById, childSeen));
  }
  return [...new Map(gaps.map((gap) => [gap.id, gap])).values()].sort((left, right) => left.id.localeCompare(right.id));
}
function hasPairedB(receipts, localById, seen = /* @__PURE__ */ new Set()) {
  for (const receipt of receipts) {
    if (receipt.kind === "PAIRED_B_CAUSAL_RUNTIME_READY" && !receipt.globallyAdmitted) return true;
    if (receipt.kind !== "INDEPENDENT_LOCAL_EXPECTED_TERM" || seen.has(receipt.id)) continue;
    const local = localById.get(receipt.id);
    assert17(local !== void 0, `Local law missing ${receipt.id}`);
    const childSeen = new Set(seen);
    childSeen.add(receipt.id);
    if (hasPairedB(local.dependencies, localById, childSeen)) return true;
  }
  return false;
}
function buildIndependentV9Artifact({ repositoryRoot = process.cwd(), sourceOverrides = /* @__PURE__ */ new Map(), context = loadEvidenceCompilerContext(repositoryRoot, []), surface = discoverCompilerSurface(repositoryRoot) } = {}) {
  const expected = expectedTerms(repositoryRoot);
  const quantity = quantityCertificate(repositoryRoot, context, surface);
  const identity = identityCertificate(repositoryRoot, context, surface);
  const localIds = new Set(localLawContracts.map((row) => row.id));
  const proofs = [];
  const localLaws = [];
  for (const contract of v9Contracts) {
    const proved = proveExpectedTerm(repositoryRoot, context, expected, contract, sourceOverrides);
    if (sourceOverrides.size > 0) continue;
    const actual = findFunction5(currentSource(repositoryRoot, context, contract.file, sourceOverrides), contract.implementation);
    const id = `${contract.file}#${contract.implementation}`;
    const dependencies = directPackageDependencies(repositoryRoot, context, actual);
    assert17.deepEqual(dependencies, expectedDependencies3.get(id), `Direct dependency set changed: ${id}`);
    const receipts = dependencies.map((dependency2) => resolveDependency(repositoryRoot, context, quantity, identity, localIds, dependency2));
    proofs.push({
      surfaceKey: contract.surfaceKey,
      implementationId: id,
      completeExpectedTerm: proved,
      dependencies: receipts,
      status: "PENDING_TRANSITIVE_DISPOSITION",
      gaps: []
    });
  }
  if (sourceOverrides.size > 0) {
    for (const contract of localLawContracts) {
      proveExpectedTerm(repositoryRoot, context, expected, contract, sourceOverrides);
    }
    proveShaSupportingValues(repositoryRoot, context, expected, sourceOverrides);
    return { mutationControlAccepted: false };
  }
  for (const contract of localLawContracts) {
    const proved = proveExpectedTerm(repositoryRoot, context, expected, contract, sourceOverrides);
    const actual = findFunction5(currentSource(repositoryRoot, context, contract.file, sourceOverrides), contract.implementation);
    const dependencies = directPackageDependencies(repositoryRoot, context, actual);
    assert17.deepEqual(dependencies, expectedDependencies3.get(contract.id), `Direct helper dependency set changed: ${contract.id}`);
    const receipts = dependencies.map((dependency2) => resolveDependency(repositoryRoot, context, quantity, identity, localIds, dependency2));
    localLaws.push({ id: contract.id, completeExpectedTerm: proved, dependencies: receipts, gaps: [] });
  }
  const localById = new Map(localLaws.map((law) => [law.id, law]));
  for (const law of localLaws) law.gaps = transitiveGaps(law.dependencies, localById, /* @__PURE__ */ new Set([law.id]));
  for (const proof of proofs) {
    proof.gaps = transitiveGaps(proof.dependencies, localById);
    proof.status = proof.gaps.length > 0 ? "BLOCKED_DEPENDENCY_GAP" : hasPairedB(proof.dependencies, localById) ? "READY_WITH_PAIRED_B_DEPENDENCY" : "INDEPENDENTLY_CLOSED";
  }
  const supportingValues = proveShaSupportingValues(repositoryRoot, context, expected, sourceOverrides);
  const allGaps = [...proofs.flatMap((proof) => proof.gaps), ...localLaws.flatMap((law) => law.gaps)];
  const gapById = new Map(allGaps.map((gap) => [gap.id, gap]));
  return {
    schemaVersion: 1,
    proofKind: "migration-plugin-helper-independent-complete-v9-equations-v2",
    semanticSourceBase: "2eea09471b3bf8fcb61f38256e1c6a362149dad4",
    expectedSpecification: expected.file,
    independentDependencies: {
      quantity: { commit: quantity.commit, artifactSha256: quantity.sha256, proofKind: quantity.document.proofKind },
      identity: { commit: identity.commit, artifactSha256: identity.sha256, proofKind: identity.document.proofKind }
    },
    allAdmittedInputs: true,
    sampledInputs: 0,
    // Retain exact transitive input receipts for additive compatibility with the already-banked V6 wrapper.
    reusedInputs: [...new Map([...quantity.document.inputs, ...identity.document.inputs].map((row) => [row.file, row])).values()],
    proofs,
    localLaws,
    supportingValues,
    disposition: {
      independentlyClosed: proofs.filter((proof) => proof.status === "INDEPENDENTLY_CLOSED").map((proof) => proof.surfaceKey),
      readyWithPairedB: proofs.filter((proof) => proof.status === "READY_WITH_PAIRED_B_DEPENDENCY").map((proof) => proof.surfaceKey),
      blocked: proofs.filter((proof) => proof.status === "BLOCKED_DEPENDENCY_GAP").map((proof) => ({ surfaceKey: proof.surfaceKey, gaps: proof.gaps })),
      namedGaps: [...gapById.values()].sort((left, right) => left.id.localeCompare(right.id))
    }
  };
}

// experiments/tla-conformance/transfer-surface-r6/source-equations-r7/family.mjs
import assert18 from "node:assert/strict";
import fs16 from "node:fs";
import path19 from "node:path";
import { fileURLToPath as fileURLToPath10 } from "node:url";

// experiments/tla-conformance/transfer-surface-r6/source-equations-r7/contracts.mjs
var TRANSFER_CORRECTION_VALUE_PROOF_KIND = "inventoryonce-transfer-correction-complete-source-equations-v2";
var SOURCE_BASE = "2eea09471b3bf8fcb61f38256e1c6a362149dad4";
var CURRENT_REGISTRATION_RECEIPT_SHA256 = "373b58894e134f8a4a4ba3bf22a54919842fa80bae5f0917c439f28376d0d201";
var ASSIGNED_SURFACE_KEYS5 = Object.freeze([
  "export:./kernel#createInventoryCorrectionEvent::call[0]",
  "export:./kernel#createInventoryReclassificationEvent::call[0]",
  "export:./kernel#createInventoryReclassificationManyEvent::call[0]",
  "export:./kernel#createInventoryTransferDispatchEvent::call[0]",
  "export:./kernel#createInventoryTransferEvent::call[0]",
  "export:./kernel#createInventoryTransferManyEvent::call[0]",
  "export:./kernel#createInventoryTransferPrepareEvent::call[0]",
  "export:./kernel#createInventoryTransferReceiveEvent::call[0]",
  "export:./kernel#createInventoryTransferReleaseEvent::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.reclassifyMany::call[0]",
  "type:src/facade.ts#InventoryOnceReplacementPlans.transfer::call[0]"
]);
var IMPLEMENTATION_BY_SURFACE_KEY = Object.freeze({
  "export:./kernel#createInventoryCorrectionEvent::call[0]": "src/corrections.ts#createInventoryCorrectionEvent",
  "export:./kernel#createInventoryReclassificationEvent::call[0]": "src/commands.ts#createInventoryReclassificationEvent",
  "export:./kernel#createInventoryReclassificationManyEvent::call[0]": "src/commands.ts#createInventoryReclassificationManyEvent",
  "export:./kernel#createInventoryTransferDispatchEvent::call[0]": "src/transfers.ts#createInventoryTransferDispatchEvent",
  "export:./kernel#createInventoryTransferEvent::call[0]": "src/commands.ts#createInventoryTransferEvent",
  "export:./kernel#createInventoryTransferManyEvent::call[0]": "src/commands.ts#createInventoryTransferManyEvent",
  "export:./kernel#createInventoryTransferPrepareEvent::call[0]": "src/transfers.ts#createInventoryTransferPrepareEvent",
  "export:./kernel#createInventoryTransferReceiveEvent::call[0]": "src/transfers.ts#createInventoryTransferReceiveEvent",
  "export:./kernel#createInventoryTransferReleaseEvent::call[0]": "src/transfers.ts#createInventoryTransferReleaseEvent",
  "type:src/facade.ts#InventoryOnceReplacementPlans.reclassifyMany::call[0]": "src/facade.ts#InventoryOnceReplacementPlansImplementation.reclassifyMany",
  "type:src/facade.ts#InventoryOnceReplacementPlans.transfer::call[0]": "src/facade.ts#InventoryOnceReplacementPlansImplementation.transfer"
});
var LOCAL_EQUATION_IDS2 = Object.freeze([
  "src/commands.ts#createInventoryReclassificationEvent",
  "src/commands.ts#createInventoryReclassificationManyEvent",
  "src/commands.ts#createInventoryTransferEvent",
  "src/commands.ts#createInventoryTransferManyEvent",
  "src/commands.ts#pairwiseReclassificationProvenanceTransfers",
  "src/corrections.ts#compareCorrectionStockEffect",
  "src/corrections.ts#compareCorrectionTraceabilityChange",
  "src/corrections.ts#createCorrectionPositiveLayerProvenanceOverrides",
  "src/corrections.ts#createCorrectionStockEffects",
  "src/corrections.ts#createCorrectionTraceabilityChanges",
  "src/corrections.ts#createInventoryCorrectionEvent",
  "src/corrections.ts#projectHistoryWithReplacement",
  "src/corrections.ts#reconcileHypotheticalTraceabilityChanges",
  "src/facade.ts#InventoryOnceReplacementPlanImplementation.constructor",
  "src/facade.ts#InventoryOnceReplacementPlansImplementation.constructor",
  "src/facade.ts#InventoryOnceReplacementPlansImplementation.reclassifyMany",
  "src/facade.ts#InventoryOnceReplacementPlansImplementation.transfer",
  "src/facade.ts#InventoryOnceStockImplementation.correct",
  "src/facade.ts#InventoryOnceTransfersImplementation.find",
  "src/facade.ts#commitInventoryTransferOperation",
  "src/facade.ts#createInventoryOnceEventResult",
  "src/facade.ts#readReplacementEventDraft",
  "src/facade.ts#requirePublishedInventoryTransfer",
  "src/projection.ts#applyIndexedIdentityMutations",
  "src/projection.ts#applyInventoryCommittedEventInternal",
  "src/projection.ts#captureConservedPositiveLayerStarts",
  "src/projection.ts#compareCommittedEventSequence",
  "src/projection.ts#emptyInventoryProjectionState",
  "src/projection.ts#inventoryContainerDefinitionFingerprint",
  "src/projection.ts#inventoryEventsInRecordSequence",
  "src/projection.ts#inventoryLotDefinitionFingerprint",
  "src/projection.ts#projectInventoryEvents",
  "src/projection.ts#quantityIsPositive",
  "src/projection.ts#recordIndexedIdentityMutation",
  "src/projection.ts#refreshTouchedSerialIndexes",
  "src/projection.ts#registerTouchedSerialPosition",
  "src/traceability-replay.ts#assertNoGenealogyPath",
  "src/traceability-replay.ts#projectInventoryTraceabilityEvents",
  "src/traceability-replay.ts#removeIndexedRelation",
  "src/traceability-replay.ts#validateAndIndexAddition",
  "src/traceability.ts#applyInventoryTraceabilityChanges",
  "src/traceability.ts#assertContainmentHasOneParentAndNoCycles",
  "src/traceability.ts#assertGenealogyHasNoCycles",
  "src/traceability.ts#assertNoGenealogyCycleFrom",
  "src/traceability.ts#buildContainmentChildContainerIndex",
  "src/traceability.ts#emptyInventoryTraceabilityState",
  "src/traceability.ts#inventoryTraceabilityRelationIdentity",
  "src/transfers.ts#applyInventoryTransferLifecycleEvent",
  "src/transfers.ts#assertDistinctLifecyclePositions",
  "src/transfers.ts#assertDistinctPositions",
  "src/transfers.ts#assertReceiptPackaging",
  "src/transfers.ts#assertTransferEventEffects",
  "src/transfers.ts#assertTransferNegativeEffectsHavePhysicalCapacity",
  "src/transfers.ts#assertUniqueTransferLineIds",
  "src/transfers.ts#combineExpectedEffects",
  "src/transfers.ts#createInventoryTransferDispatchEvent",
  "src/transfers.ts#createInventoryTransferPrepareEvent",
  "src/transfers.ts#createInventoryTransferReceiveEvent",
  "src/transfers.ts#createInventoryTransferReleaseEvent",
  "src/transfers.ts#dispatchEffects",
  "src/transfers.ts#fullRemainingReceiptLines",
  "src/transfers.ts#inventoryTransferDestinationPosition",
  "src/transfers.ts#inventoryTransferPreparedPosition",
  "src/transfers.ts#inventoryTransferRemainingMeasurements",
  "src/transfers.ts#inventoryTransferTransitPosition",
  "src/transfers.ts#prepareEffects",
  "src/transfers.ts#receiveEffects",
  "src/transfers.ts#releaseEffects",
  "src/transfers.ts#requireTransferLine",
  "src/transfers.ts#resolveRequestedReceiptLines",
  "src/transfers.ts#resolveTransferPrepareLine",
  "src/transfers.ts#transferAmountEvidence",
  "src/transfers.ts#transferCommandItem",
  "src/transfers.ts#transferEffect",
  "src/transfers.ts#transferLifecycleEvent",
  "src/transfers.ts#transferPositionWithPackaging"
]);
var STRENGTHENING_EQUATION_IDS = Object.freeze([
  "src/facade.ts#InventoryOnceReplacementPlansImplementation.constructor",
  "src/facade.ts#InventoryOnceStockImplementation.correct",
  "src/facade.ts#InventoryOnceTransfersImplementation.find",
  "src/facade.ts#commitInventoryTransferOperation",
  "src/facade.ts#createInventoryOnceEventResult",
  "src/facade.ts#readReplacementEventDraft",
  "src/facade.ts#requirePublishedInventoryTransfer"
]);
var LOCAL_SOURCE_FILES2 = Object.freeze([
  "src/commands.ts",
  "src/corrections.ts",
  "src/facade.ts",
  "src/projection.ts",
  "src/traceability-replay.ts",
  "src/traceability.ts",
  "src/transfers.ts"
]);
var LOCAL_SUPPORTING_VALUE_IDS = Object.freeze([
  "src/facade.ts#replacementEventDrafts",
  "src/projection.ts#InventoryDeficitPolicy",
  "src/transfers.ts#InventoryTransferStatus"
]);
var REUSED_EXECUTION_FILES = Object.freeze([
  "experiments/tla-conformance/transfer-surface-r6/artifacts/CorrectionHistory/surface-execution-v2.json",
  "experiments/tla-conformance/transfer-surface-r6/artifacts/DurableTransferRefinement/surface-execution-v2.json",
  "experiments/tla-conformance/transfer-surface-r6/artifacts/TransferLifecycle/surface-execution-v2.json"
]);
var FAMILY_DOMAIN3 = Object.freeze({
  id: "ALL_VALIDATED_TRANSFER_CORRECTION_EVENT_VALUES_V2",
  values: "Every finite immutable plain record/array satisfying the published input types and every success or rejection guard in the independent equations; no fixture or sampled subset is used.",
  history: "Every internally valid committed projection and retained correction chain accepted by projectInventoryEvents, including omission, replacement, prior correction, definition, traceability, positive-layer provenance, and deficit-policy branches.",
  transfers: "Every internally valid prepare, dispatch, partial/full receive, and release value, including optional custodian, package, lot, container, owner, status, metadata, and multi-line branches.",
  mutation: "Inputs and published state are immutable for the duration of a call; only fresh local arrays, maps, sets, records, and opaque replacement-plan registrations may be mutated.",
  dependencies: "Quantity, measurement, identity, catalog, and common event-construction operations mean the exact separately registered family equations named by this certificate.",
  excluded: "Proxies, accessors, subclasses, monkey-patched built-ins, structurally forged catalogs/plans, cyclic values, concurrent input mutation, clocks, storage I/O, and application callbacks other than the separately checked correction wrapper are outside this V domain."
});
var FAMILY_LAWS4 = Object.freeze([
  Object.freeze({
    id: "atomic-location-and-reclassification-values-v2",
    equation: "Single and multi-line transfer/reclassification constructors resolve exact amounts, preserve every unmodified stock identity, produce paired negative/positive effects, aggregate lot/container definitions deterministically, reject empty or transfer-bound sources, and attach conserved positive-layer provenance only for exact one-to-one moves."
  }),
  Object.freeze({
    id: "transfer-lifecycle-values-v2",
    equation: "Prepare reserves exact source measurements under one transfer identity; dispatch moves all prepared remainder to transit; receive accepts each named line at most once, never beyond remaining measurements, enforces package evidence, and moves to the exact destination; release restores every prepared line. Each branch emits its exact lifecycle action, effects, evidence, optional parties, and metadata."
  }),
  Object.freeze({
    id: "append-only-correction-values-v2",
    equation: "A correction rejects invalid roots/times/replacements, replays retained history with the chosen omission or replacement, computes exact sorted stock/provenance/traceability deltas from current to desired truth, retains replacement definitions, and emits one append-only Correction event with explicit reason and frozen optional parties/metadata."
  }),
  Object.freeze({
    id: "opaque-replacement-and-result-values-v2",
    equation: "Transfer and reclassifyMany replacement methods inject the bound catalog and synthetic operation identity, return only privately registered plans, and the correction wrapper rejects forged plans. Event/transfer result helpers resolve exact receipt identities from the published world and fail closed for missing events/transfers while preserving the coordinator replay flag."
  })
]);
function lawIdForEquation3(equationId) {
  if (equationId.startsWith("src/corrections.ts#")) {
    return "append-only-correction-values-v2";
  }
  if (equationId.startsWith("src/transfers.ts#")) {
    return "transfer-lifecycle-values-v2";
  }
  if (equationId.startsWith("src/facade.ts#")) {
    return "opaque-replacement-and-result-values-v2";
  }
  return "atomic-location-and-reclassification-values-v2";
}

// experiments/tla-conformance/transfer-surface-r6/source-equations-r7/family.mjs
var familyDirectory = path19.dirname(fileURLToPath10(import.meta.url));
var expectedFileBySource = new Map(
  LOCAL_SOURCE_FILES2.map((file) => [
    file,
    path19.join(familyDirectory, "expected", `${path19.basename(file, ".ts")}.expected.ts.txt`)
  ])
);
var producerFiles7 = Object.freeze([
  "experiments/tla-conformance/transfer-surface-r6/source-equations-r7/contracts.mjs",
  "experiments/tla-conformance/transfer-surface-r6/source-equations-r7/dependency-manifest.json",
  "experiments/tla-conformance/transfer-surface-r6/source-equations-r7/family.mjs",
  "experiments/tla-conformance/transfer-surface-r6/source-equations-r7/red-before.json",
  "experiments/tla-conformance/transfer-surface-r6/source-equations-r7/source-base-manifest.json",
  "experiments/tla-conformance/transfer-surface-r6/source-equations-r7/current-registration-receipt.json",
  "experiments/tla-conformance/transfer-surface-r6/value-equation-candidates.json",
  ...[...expectedFileBySource.values()].map(
    (file) => path19.relative(path19.resolve(familyDirectory, "../../../.."), file).replaceAll("\\", "/")
  ),
  "experiments/tla-conformance/surface-bindings/lib/compiler-surface.mjs",
  "node_modules/typescript/package.json",
  "package.json",
  "tsconfig.json"
]);
var passCache4 = /* @__PURE__ */ new WeakMap();
function relativePath3(repositoryRoot, fileName) {
  return path19.relative(repositoryRoot, fileName).replaceAll("\\", "/");
}
function parseSource5(fileName, sourceText5) {
  const source7 = ts.createSourceFile(
    fileName,
    sourceText5,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  assert18.equal(source7.parseDiagnostics.length, 0, `Cannot parse independent equations '${fileName}'.`);
  return source7;
}
function findCallable4(sourceByFile, equationId) {
  const separator = equationId.indexOf("#");
  assert18(separator > 0, `Malformed equation identity '${equationId}'.`);
  const file = equationId.slice(0, separator);
  const qualifiedName = equationId.slice(separator + 1);
  const source7 = sourceByFile.get(file);
  assert18(source7 !== void 0, `Missing equation source '${file}'.`);
  const pieces = qualifiedName.split(".");
  if (pieces.length === 1) {
    const matches2 = source7.statements.filter(
      (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === qualifiedName && statement.body !== void 0
    );
    assert18.equal(matches2.length, 1, `Expected one function '${equationId}'.`);
    return matches2[0];
  }
  assert18.equal(pieces.length, 2, `Unsupported qualified equation '${equationId}'.`);
  const [className, memberName] = pieces;
  const owners = source7.statements.filter(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === className
  );
  assert18.equal(owners.length, 1, `Expected one class '${className}' in '${file}'.`);
  const matches = owners[0].members.filter((member2) => {
    if (memberName === "constructor") return ts.isConstructorDeclaration(member2);
    return ts.isMethodDeclaration(member2) && ts.isIdentifier(member2.name) && member2.name.text === memberName && member2.body !== void 0;
  });
  assert18.equal(matches.length, 1, `Expected one member '${equationId}'.`);
  return matches[0];
}
function findSupportingValue3(sourceByFile, valueId) {
  const separator = valueId.indexOf("#");
  assert18(separator > 0, `Malformed supporting-value identity '${valueId}'.`);
  const file = valueId.slice(0, separator);
  const name = valueId.slice(separator + 1);
  const source7 = sourceByFile.get(file);
  assert18(source7 !== void 0, `Missing supporting-value source '${file}'.`);
  const matches = source7.statements.filter((statement) => {
    if (ts.isEnumDeclaration(statement)) return statement.name.text === name;
    if (!ts.isVariableStatement(statement)) return false;
    return statement.declarationList.declarations.some(
      (declaration2) => ts.isIdentifier(declaration2.name) && declaration2.name.text === name
    );
  });
  assert18.equal(matches.length, 1, `Expected one supporting value '${valueId}'.`);
  if (ts.isEnumDeclaration(matches[0])) return matches[0];
  const declaration = matches[0].declarationList.declarations.find(
    (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name
  );
  assert18(declaration !== void 0);
  return declaration;
}
function declarationId2(repositoryRoot, declaration) {
  const file = relativePath3(repositoryRoot, declaration.getSourceFile().fileName);
  if (ts.isConstructorDeclaration(declaration)) {
    const owner = declaration.parent.name?.getText(declaration.getSourceFile());
    assert18(owner !== void 0, "Certified constructor needs a named class.");
    return `${file}#${owner}.constructor`;
  }
  const name = declaration.name?.getText(declaration.getSourceFile());
  assert18(name !== void 0, "Certified source callable needs a stable name.");
  if (ts.isMethodDeclaration(declaration) || ts.isGetAccessorDeclaration(declaration)) {
    const owner = declaration.parent.name?.getText(declaration.getSourceFile());
    assert18(owner !== void 0, "Certified method needs a named class.");
    return `${file}#${owner}.${name}`;
  }
  return `${file}#${name}`;
}
function declarationIsInside(declaration, owner) {
  let current = declaration;
  while (current !== void 0) {
    if (current === owner) return true;
    current = current.parent;
  }
  return false;
}
function normalizedSyntax(node, source7) {
  const children = node.getChildren(source7);
  if (children.length === 0) {
    return [ts.SyntaxKind[node.kind], node.getText(source7)];
  }
  return [
    ts.SyntaxKind[node.kind],
    children.map((child) => normalizedSyntax(child, source7))
  ];
}
function normalizeTransferCorrectionCallable(declaration) {
  assert18(declaration.body !== void 0, "A source equation needs one concrete body.");
  const source7 = declaration.getSourceFile();
  return {
    async: declaration.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword
    ) ?? false,
    generator: declaration.asteriskToken !== void 0,
    parameters: declaration.parameters.map((parameter) => ({
      name: normalizedSyntax(parameter.name, source7),
      rest: parameter.dotDotDotToken !== void 0,
      optional: parameter.questionToken !== void 0,
      initializer: parameter.initializer === void 0 ? null : normalizedSyntax(parameter.initializer, source7)
    })),
    body: normalizedSyntax(declaration.body, source7)
  };
}
function normalizeSupportingValue3(declaration) {
  const source7 = declaration.getSourceFile();
  if (ts.isEnumDeclaration(declaration)) {
    return [
      "enum",
      declaration.members.map((member2) => [
        member2.name.getText(source7),
        member2.initializer === void 0 ? null : normalizedSyntax(member2.initializer, source7)
      ])
    ];
  }
  assert18(ts.isVariableDeclaration(declaration));
  assert18(declaration.initializer !== void 0, "Supporting constant needs an initializer.");
  const declarationList = declaration.parent;
  assert18(ts.isVariableDeclarationList(declarationList));
  return [
    (declarationList.flags & ts.NodeFlags.Const) !== 0 ? "const" : "mutable",
    normalizedSyntax(declaration.initializer, source7)
  ];
}
function resolvedSymbol(context, node) {
  let symbol = context.checker.getSymbolAtLocation(node);
  if (symbol !== void 0 && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = context.checker.getAliasedSymbol(symbol);
  }
  return symbol;
}
function sourceCallableFromSymbol(symbol) {
  const declarations = (symbol?.declarations ?? []).filter(
    (declaration) => !declaration.getSourceFile().isDeclarationFile && (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration) || ts.isConstructorDeclaration(declaration) || ts.isGetAccessorDeclaration(declaration)) && declaration.body !== void 0
  );
  if (declarations.length === 0) return void 0;
  assert18.equal(declarations.length, 1, "Source callable has ambiguous runtime bodies.");
  return declarations[0];
}
function sourceCallableFromCall(context, node) {
  const declaration = context.checker.getResolvedSignature(node)?.declaration;
  if (declaration === void 0 || declaration.getSourceFile().isDeclarationFile || declaration.body === void 0) {
    return void 0;
  }
  if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration) || ts.isConstructorDeclaration(declaration) || ts.isGetAccessorDeclaration(declaration)) {
    return declaration;
  }
  return void 0;
}
function ambientOperation(node, declaration) {
  const source7 = declaration.getSourceFile();
  const owner = declaration.parent.name?.getText(source7);
  const name = declaration.name?.getText(source7) ?? "<anonymous>";
  const expression = node.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    if (ts.isIdentifier(expression.expression)) {
      return `${expression.expression.text}.${expression.name.text}`;
    }
    return `${owner ?? "ambient"}.${expression.name.text}`;
  }
  return `${owner ?? "ambient"}.${name}`;
}
function dependencyIndex(manifest) {
  assert18.equal(manifest.schemaVersion, 1, "Dependency manifest schema changed.");
  assert18.equal(manifest.sourceBase, SOURCE_BASE);
  assert18.equal(manifest.families.length, 4);
  assert18.equal(
    canonicalJson(manifest.families.map((family) => family.proofKind).sort(compareCodeUnits)),
    canonicalJson([
      "independent-catalog-snapshot-closed-equations-v1",
      "independent-identity-values-closed-equations-v1",
      "inventoryonce-event-replacement-complete-source-equations-v1",
      "inventoryonce-quantity-measurement-complete-source-equations-v1"
    ])
  );
  const equations2 = /* @__PURE__ */ new Map();
  const supportingValues = /* @__PURE__ */ new Map();
  for (const family of manifest.families) {
    assert18.equal(typeof family.proofKind, "string");
    assert18.match(family.artifactSha256, /^[0-9a-f]{64}$/u);
    assert18.equal(typeof family.registered, "boolean");
    assert18.equal(
      family.status,
      family.registered ? "REGISTERED" : "PENDING_REGISTERED_FAMILY"
    );
    assert18(Array.isArray(family.equations) && family.equations.length > 0);
    for (const equation3 of family.equations) {
      assert18.equal(typeof equation3.id, "string");
      assert18.match(equation3.sourceHash, /^[0-9a-f]{64}$/u);
      assert18(!equations2.has(equation3.id), `Dependency equation repeated: ${equation3.id}`);
      equations2.set(equation3.id, {
        proofKind: family.proofKind,
        certificateId: family.certificateId,
        artifactSha256: family.artifactSha256,
        sourceHash: equation3.sourceHash,
        registered: family.registered
      });
    }
    for (const value of family.supportingValues ?? []) {
      assert18.equal(typeof value.id, "string");
      assert18.match(value.sourceHash, /^[0-9a-f]{64}$/u);
      assert18(!supportingValues.has(value.id), `Dependency supporting value repeated: ${value.id}`);
      supportingValues.set(value.id, {
        proofKind: family.proofKind,
        certificateId: family.certificateId,
        artifactSha256: family.artifactSha256,
        sourceHash: value.sourceHash,
        registered: family.registered
      });
    }
  }
  return { equations: equations2, supportingValues };
}
function verifyStrictRegistrationReceipt(manifest) {
  const receiptPath = path19.join(familyDirectory, "current-registration-receipt.json");
  const receiptBytes2 = fs16.readFileSync(receiptPath);
  assert18.equal(sha256(receiptBytes2), CURRENT_REGISTRATION_RECEIPT_SHA256);
  assert18.equal(sha256(receiptBytes2), manifest.strictRegistrationReceipt.receiptSha256);
  const receipt = JSON.parse(receiptBytes2.toString("utf8"));
  assert18.equal(receipt.schemaVersion, 2);
  assert18.equal(receipt.status, "CURRENT_STRICT_DEPENDENCY_RECEIPT");
  assert18.equal(receipt.hubCommit, "3f49bd79e4ac7c1deb21b26b137cdcd3640d5f32");
  assert18.equal(receipt.hubCommit, manifest.strictRegistrationReceipt.hubCommit);
  assert18.equal(receipt.sourceBase, SOURCE_BASE);
  assert18.equal(receipt.surfaceDigest, "6a3bdd7dd66a3e352c1dca251d654406a5b25bef3c502c5392785384be5b93c1");
  assert18.equal(receipt.strictCallables, 271);
  assert18.equal(receipt.admissionReport.strictGatePassed, true);
  assert18.equal(receipt.admissionReport.sha256, manifest.strictRegistrationReceipt.admissionReportSha256);
  assert18.equal(receipt.surfaceBindings.sha256, manifest.strictRegistrationReceipt.surfaceBindingsSha256);
  const registeredByProofKind = new Map(
    receipt.families.map((family) => [family.proofKind, family])
  );
  const baselineByProofKind = new Map(
    receipt.baselineBindings.map((binding) => [binding.proofKind, binding])
  );
  for (const family of manifest.families) {
    const review = registeredByProofKind.get(family.proofKind) ?? baselineByProofKind.get(family.proofKind);
    assert18.equal(family.registered, review !== void 0, `Manifest registration differs from strict receipt: ${family.proofKind}`);
    assert18(review !== void 0, `Current strict receipt omitted dependency: ${family.proofKind}`);
    assert18.equal(family.artifactSha256, review.artifactSha256, `Dependency artifact differs from strict receipt: ${family.proofKind}`);
    const reviewedCertificate = review.certificateId ?? review.familyId;
    if (reviewedCertificate !== void 0 && !family.proofKind.startsWith("independent-catalog-")) {
      assert18.equal(family.certificateId, reviewedCertificate, `Dependency certificate differs from strict receipt: ${family.proofKind}`);
    }
  }
  for (const proofKind22 of receipt.notRegisteredProofKinds) {
    assert18.equal(registeredByProofKind.has(proofKind22), false);
  }
}
function supportingValueId(repositoryRoot, declaration) {
  let owner = declaration;
  if (ts.isEnumMember(owner)) owner = owner.parent;
  if (ts.isVariableDeclaration(owner)) {
    if (!ts.isSourceFile(owner.parent.parent.parent)) return void 0;
  } else if (!ts.isEnumDeclaration(owner)) {
    return void 0;
  }
  const name = owner.name?.getText(owner.getSourceFile());
  if (name === void 0) return void 0;
  return `${relativePath3(repositoryRoot, owner.getSourceFile().fileName)}#${name}`;
}
function inspectClosure({
  repositoryRoot,
  context,
  seeds,
  localById,
  localSupportingById,
  dependencyById,
  dependencySupportingById
}) {
  const pendingDeclarations = [...seeds];
  const checkedLocal = /* @__PURE__ */ new Set();
  const reused = /* @__PURE__ */ new Map();
  const pendingDependencies = /* @__PURE__ */ new Map();
  const ambient = /* @__PURE__ */ new Map();
  const checkedSupporting = /* @__PURE__ */ new Map();
  const reusedSupporting = /* @__PURE__ */ new Map();
  const pendingSupporting = /* @__PURE__ */ new Map();
  const unresolved = /* @__PURE__ */ new Set();
  while (pendingDeclarations.length > 0) {
    let visit2 = function(node) {
      if (ts.isTypeNode(node)) return;
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const signature = context.checker.getResolvedSignature(node)?.declaration;
        if (signature?.getSourceFile().isDeclarationFile) {
          const operation = ambientOperation(node, signature);
          const declarationSpan = spanOf(context, signature);
          const key = `${operation}:${declarationSpan.file}:${declarationSpan.start.offset}`;
          ambient.set(key, { operation, declaration: declarationSpan });
        }
        const target = sourceCallableFromCall(context, node);
        if (target !== void 0 && !declarationIsInside(target, declaration)) {
          pendingDeclarations.push(target);
        }
      }
      if (ts.isIdentifier(node)) {
        const symbol = resolvedSymbol(context, node);
        const target = sourceCallableFromSymbol(symbol);
        if (target !== void 0 && !declarationIsInside(target, declaration)) {
          pendingDeclarations.push(target);
        }
        for (const sourceDeclaration of symbol?.declarations ?? []) {
          if (sourceDeclaration.getSourceFile().isDeclarationFile || declarationIsInside(sourceDeclaration, declaration)) {
            continue;
          }
          const valueId = supportingValueId(repositoryRoot, sourceDeclaration);
          if (valueId === void 0) continue;
          const localValue = localSupportingById.get(valueId);
          if (localValue !== void 0) {
            checkedSupporting.set(valueId, localValue);
            continue;
          }
          const dependencyValue = dependencySupportingById.get(valueId);
          if (dependencyValue === void 0) {
            unresolved.add(`supporting-value:${valueId}`);
            continue;
          }
          let owner = sourceDeclaration;
          if (ts.isEnumMember(owner)) owner = owner.parent;
          const implementation = spanOf(context, owner);
          assert18.equal(
            implementation.sourceHash,
            dependencyValue.sourceHash,
            `Registered supporting value source changed: ${valueId}`
          );
          (dependencyValue.registered ? reusedSupporting : pendingSupporting).set(valueId, dependencyValue);
        }
      }
      ts.forEachChild(node, visit2);
    };
    var visit = visit2;
    const declaration = pendingDeclarations.shift();
    const id = declarationId2(repositoryRoot, declaration);
    if (checkedLocal.has(id) || reused.has(id) || pendingDependencies.has(id)) continue;
    const local = localById.get(id);
    if (local === void 0) {
      const dependency2 = dependencyById.get(id);
      if (dependency2 === void 0) {
        unresolved.add(id);
      } else {
        const implementation = spanOf(context, declaration);
        assert18.equal(
          implementation.sourceHash,
          dependency2.sourceHash,
          `Registered dependency source changed: ${id}`
        );
        (dependency2.registered ? reused : pendingDependencies).set(id, dependency2);
      }
      continue;
    }
    checkedLocal.add(id);
    visit2(declaration.body);
  }
  assert18.equal(
    unresolved.size,
    0,
    `Unproved transitive source callables: ${[...unresolved].sort(compareCodeUnits).join(", ")}`
  );
  return {
    checkedLocal: [...checkedLocal].sort(compareCodeUnits),
    reused: [...reused].map(([id, dependency2]) => ({ id, ...dependency2 })).sort((left, right) => compareCodeUnits(left.id, right.id)),
    pending: [...pendingDependencies].map(([id, dependency2]) => ({ id, ...dependency2 })).sort((left, right) => compareCodeUnits(left.id, right.id)),
    localSupporting: [...checkedSupporting].map(([id, row]) => ({
      id,
      declaration: row.declaration,
      equationSha256: row.equationSha256
    })).sort((left, right) => compareCodeUnits(left.id, right.id)),
    reusedSupporting: [...reusedSupporting].map(([id, dependency2]) => ({
      id,
      ...dependency2
    })).sort((left, right) => compareCodeUnits(left.id, right.id)),
    pendingSupporting: [...pendingSupporting].map(([id, dependency2]) => ({
      id,
      ...dependency2
    })).sort((left, right) => compareCodeUnits(left.id, right.id)),
    ambient: [...ambient.values()].sort(
      (left, right) => compareCodeUnits(canonicalJson(left), canonicalJson(right))
    )
  };
}
function pendingDependencyIdsFor(closure) {
  return [
    ...closure.pending.map((dependency2) => dependency2.id),
    ...closure.pendingSupporting.map((dependency2) => `supporting-value:${dependency2.id}`)
  ].sort(compareCodeUnits);
}
function proofDependencySummary(surfaceKey, closure) {
  const pendingDependencyIds = pendingDependencyIdsFor(closure);
  return {
    surfaceKey,
    status: pendingDependencyIds.length === 0 ? "CLOSED_REGISTERED_DEPENDENCIES" : "PENDING_REGISTERED_DEPENDENCIES",
    localEquationIds: closure.checkedLocal,
    registeredEquationIds: closure.reused.map((dependency2) => dependency2.id),
    pendingDependencyIds,
    localSupportingValueIds: closure.localSupporting.map((value) => value.id),
    registeredSupportingValueIds: closure.reusedSupporting.map((value) => value.id)
  };
}
function summarizeExecutionEvidence(repositoryRoot, file) {
  const absolute = path19.resolve(repositoryRoot, file);
  const bytes2 = fs16.readFileSync(absolute);
  const evidence = JSON.parse(bytes2.toString("utf8"));
  assert18.equal(evidence.schemaVersion, 2, `${file} schema changed.`);
  assert18.equal(evidence.status, "PASS", `${file} is not passing evidence.`);
  assert18(Array.isArray(evidence.executions) && evidence.executions.length > 0);
  assert18(Array.isArray(evidence.reverse?.edges));
  assert18.equal(evidence.reverse.edges.length, evidence.executions.length);
  for (const execution of evidence.executions) {
    assert18.equal(execution.formalEnabled, true);
    assert18.equal(execution.outcome, "accepted");
    assert18.equal(execution.checked.sourceState, true);
    assert18.equal(execution.checked.state, true);
    assert18.equal(execution.checked.result, true);
    assert18.equal(execution.checked.enabledness, true);
    assert18.equal(canonicalJson(execution.expectedSourceState), canonicalJson(execution.actualSourceState));
    assert18.equal(canonicalJson(execution.expectedState), canonicalJson(execution.actualState));
    assert18.equal(canonicalJson(execution.expectedResult), canonicalJson(execution.actualResult));
    assert18.equal(execution.checkpoint.forkConcreteId.length, 64);
  }
  for (const reverse of evidence.reverse.edges) {
    assert18.equal(reverse.originalNextAccepted, true);
  }
  const sourceInputs = [];
  const referencedInputs = [
    ...evidence.producer.files.map((input2) => ({ file: input2.file, sha256: input2.sha256 })),
    { file: evidence.model.source, sha256: evidence.model.sourceHash },
    { file: evidence.model.config.file, sha256: evidence.model.config.sha256 },
    {
      file: evidence.checkpointEquivalence.evidence.file,
      sha256: evidence.checkpointEquivalence.evidence.sha256
    }
  ];
  for (const input2 of referencedInputs) {
    const inputBytes = fs16.readFileSync(path19.resolve(repositoryRoot, input2.file));
    assert18.equal(sha256(inputBytes), input2.sha256, `Frozen proof input changed: ${input2.file}`);
    sourceInputs.push(input2);
  }
  for (const observation of evidence.surfaceObservations) {
    const sourceReference = observation.sourceReference;
    const sourceBytes = fs16.readFileSync(path19.resolve(repositoryRoot, sourceReference.file));
    assert18.equal(sha256(sourceBytes), sourceReference.sourceHash);
    const sourceTextValue = sourceBytes.toString("utf8");
    assert18.equal(
      sha256(sourceTextValue.slice(sourceReference.start, sourceReference.end)),
      sourceReference.astHash,
      `Execution source reference changed: ${sourceReference.file}`
    );
  }
  return {
    file,
    sha256: sha256(bytes2),
    model: evidence.model.name,
    sourceHash: evidence.model.sourceHash,
    config: evidence.model.config,
    executionCount: evidence.executions.length,
    stateChecks: evidence.executions.length,
    resultChecks: evidence.executions.length,
    originalNextChecks: evidence.reverse.edges.length,
    sourceInputs,
    surfaceObservations: evidence.surfaceObservations.map((observation) => ({
      surfaceKey: observation.surfaceKey,
      sourceReference: observation.sourceReference,
      occurrenceCount: observation.edgeIds.length
    }))
  };
}
function summarizeForwardWitnesses(repositoryRoot) {
  const file = "experiments/tla-conformance/transfer-surface-r6/value-equation-candidates.json";
  const bytes2 = fs16.readFileSync(path19.resolve(repositoryRoot, file));
  assert18.equal(
    sha256(bytes2),
    "a9000d71656cc466f2eaf68564fd0848c63bdc1947cb217fccefe5a082e50817",
    "Frozen real-TypeScript forward witnesses changed."
  );
  const evidence = JSON.parse(bytes2.toString("utf8"));
  assert18.equal(evidence.domain, "DECLARED_EXACT_SCALAR_TRANSFER_FIXTURES_V1");
  assert18.equal(evidence.proofCreditGranted, false);
  assert18.equal(evidence.candidates.length, 11);
  assert18(evidence.candidates.every((candidate) => candidate.exactValueEqual === true));
  assert18(evidence.candidates.every((candidate) => candidate.negativeMutationRejected === true));
  assert18.equal(
    canonicalJson(evidence.candidates.map((candidate) => candidate.surfaceKey)),
    canonicalJson(ASSIGNED_SURFACE_KEYS5)
  );
  return {
    file,
    sha256: sha256(bytes2),
    runtime: "real TypeScript constructor/planner calls",
    witnessCount: evidence.candidates.length,
    exactForwardValues: evidence.candidates.length,
    rejectedValueMutations: evidence.candidates.length,
    proofCreditGranted: false,
    completeProofSuppliedBy: "independent complete source equations"
  };
}
function sourceText3(repositoryRoot, file, sourceOverrides) {
  return sourceOverrides.get(file) ?? fs16.readFileSync(path19.resolve(repositoryRoot, file), "utf8");
}
function buildSourceFlowJoins({ context, surface, localById, executionEvidence }) {
  const facade = context.program.getSourceFile(path19.resolve(context.repositoryRoot, "src/facade.ts"));
  assert18(facade !== void 0);
  const replacementImplementation = facade.statements.find(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === "InventoryOnceReplacementPlansImplementation"
  );
  assert18(
    replacementImplementation !== void 0 && ts.isClassDeclaration(replacementImplementation),
    "Missing replacement-plan implementation class."
  );
  const implementsReplacementPlans = replacementImplementation.heritageClauses?.some(
    (clause) => clause.token === ts.SyntaxKind.ImplementsKeyword && clause.types.some((type) => type.expression.getText(facade) === "InventoryOnceReplacementPlans")
  ) ?? false;
  assert18.equal(implementsReplacementPlans, true, "Replacement implementation lost its interface join.");
  const callableByKey = new Map(surface.callables.map((callable) => [callable.key, callable]));
  const correctionWrapper = localById.get("src/facade.ts#InventoryOnceStockImplementation.correct");
  const planConstructor = localById.get(
    "src/facade.ts#InventoryOnceReplacementPlansImplementation.constructor"
  );
  const opaqueConstructor = localById.get(
    "src/facade.ts#InventoryOnceReplacementPlanImplementation.constructor"
  );
  const planReader = localById.get("src/facade.ts#readReplacementEventDraft");
  assert18(correctionWrapper !== void 0 && planConstructor !== void 0);
  assert18(opaqueConstructor !== void 0 && planReader !== void 0);
  const plannerRows = ASSIGNED_SURFACE_KEYS5.filter((surfaceKey) => surfaceKey.startsWith("type:")).map((surfaceKey) => {
    const callable = callableByKey.get(surfaceKey);
    const equationId = IMPLEMENTATION_BY_SURFACE_KEY[surfaceKey];
    const implementation = localById.get(equationId);
    assert18(callable !== void 0 && implementation !== void 0);
    return {
      surfaceKey,
      publicDeclaration: callable.declaration,
      implementation: spanOf(context, implementation),
      implementsInterface: "InventoryOnceReplacementPlans",
      constructionCallsite: spanOf(context, correctionWrapper),
      implementationConstructor: spanOf(context, planConstructor),
      opaquePlanConstructor: spanOf(context, opaqueConstructor),
      opaquePlanReader: spanOf(context, planReader),
      relation: "CORRECTION_CALLBACK_RECEIVES_THE_UNIQUE_TYPED_IMPLEMENTATION"
    };
  });
  const causalRows = [];
  for (const evidence of executionEvidence) {
    for (const observation of evidence.surfaceObservations) {
      const callable = callableByKey.get(observation.surfaceKey);
      assert18(callable !== void 0, `Execution evidence names unknown surface '${observation.surfaceKey}'.`);
      causalRows.push({
        surfaceKey: observation.surfaceKey,
        publicDeclaration: callable.declaration,
        model: evidence.model,
        executionEvidence: { file: evidence.file, sha256: evidence.sha256 },
        sourceReference: observation.sourceReference,
        occurrenceCount: observation.occurrenceCount,
        stateChecks: evidence.stateChecks,
        resultChecks: evidence.resultChecks,
        originalNextChecks: evidence.originalNextChecks,
        creditGrantedHere: false
      });
    }
  }
  return { plannerRows, causalRows };
}
function buildTransferCorrectionValueFamily({
  repositoryRoot,
  context,
  surface,
  sourceOverrides = /* @__PURE__ */ new Map(),
  dependencyManifestOverride
}) {
  const root3 = path19.resolve(repositoryRoot);
  assert18.equal(ASSIGNED_SURFACE_KEYS5.length, 11, "Transfer/correction surface cardinality changed.");
  assert18.equal(new Set(ASSIGNED_SURFACE_KEYS5).size, 11, "Transfer/correction rows repeat.");
  const dependencyManifestPath = path19.join(familyDirectory, "dependency-manifest.json");
  const dependencyManifestBytes = dependencyManifestOverride === void 0 ? fs16.readFileSync(dependencyManifestPath) : Buffer.from(`${JSON.stringify(dependencyManifestOverride, null, 2)}
`);
  const dependencyManifest = JSON.parse(dependencyManifestBytes.toString("utf8"));
  verifyStrictRegistrationReceipt(dependencyManifest);
  const dependencies = dependencyIndex(dependencyManifest);
  const sourceBaseManifestPath = path19.join(familyDirectory, "source-base-manifest.json");
  const sourceBaseManifest = JSON.parse(fs16.readFileSync(sourceBaseManifestPath, "utf8"));
  assert18.equal(sourceBaseManifest.schemaVersion, 1);
  assert18.equal(sourceBaseManifest.sourceBase, SOURCE_BASE);
  assert18.equal(sourceBaseManifest.sources.length, LOCAL_SOURCE_FILES2.length);
  assert18.equal(
    canonicalJson(sourceBaseManifest.sources.map((source7) => source7.file).sort(compareCodeUnits)),
    canonicalJson([...LOCAL_SOURCE_FILES2].sort(compareCodeUnits))
  );
  for (const sourceInput of sourceBaseManifest.sources) {
    assert18(LOCAL_SOURCE_FILES2.includes(sourceInput.file));
    assert18.equal(
      sha256(fs16.readFileSync(path19.resolve(root3, sourceInput.file))),
      sourceInput.sha256,
      `Local source differs from frozen base: ${sourceInput.file}`
    );
  }
  const redBeforePath = path19.join(familyDirectory, "red-before.json");
  const redBefore = JSON.parse(fs16.readFileSync(redBeforePath, "utf8"));
  assert18.equal(redBefore.schemaVersion, 1);
  assert18.equal(redBefore.sourceBase, SOURCE_BASE);
  assert18.equal(redBefore.surfaceDigest, surface.digest);
  assert18.equal(redBefore.rejectedCount, 11);
  assert18.equal(redBefore.priorEvidenceDomain, "DECLARED_EXACT_SCALAR_TRANSFER_FIXTURES_V1");
  assert18.equal(
    canonicalJson(redBefore.rows.map((row) => row.surfaceKey)),
    canonicalJson(ASSIGNED_SURFACE_KEYS5),
    "Red-before identities changed."
  );
  const actualSourceByFile = new Map(
    LOCAL_SOURCE_FILES2.map((file) => {
      const absolute = path19.resolve(root3, file);
      const source7 = sourceOverrides.has(file) ? parseSource5(absolute, sourceText3(root3, file, sourceOverrides)) : context.program.getSourceFile(absolute);
      assert18(source7 !== void 0, `Compiler omitted local source '${file}'.`);
      return [file, source7];
    })
  );
  const expectedSourceByFile = new Map(
    LOCAL_SOURCE_FILES2.map((file) => {
      const expectedFile4 = expectedFileBySource.get(file);
      assert18(expectedFile4 !== void 0);
      return [file, parseSource5(expectedFile4, fs16.readFileSync(expectedFile4, "utf8"))];
    })
  );
  const localById = /* @__PURE__ */ new Map();
  const equations2 = [];
  for (const equationId of LOCAL_EQUATION_IDS2) {
    const actual = findCallable4(actualSourceByFile, equationId);
    const expected = findCallable4(expectedSourceByFile, equationId);
    const actualTerm = normalizeTransferCorrectionCallable(actual);
    const expectedTerm = normalizeTransferCorrectionCallable(expected);
    assert18.equal(
      canonicalJson(actualTerm),
      canonicalJson(expectedTerm),
      `Independent source equation changed: ${equationId}`
    );
    localById.set(equationId, actual);
    equations2.push({
      id: equationId,
      lawId: lawIdForEquation3(equationId),
      declaration: sourceOverrides.size === 0 ? spanOf(context, actual) : null,
      equationSha256: sha256(canonicalJson(expectedTerm)),
      term: expectedTerm,
      strengtheningOnly: STRENGTHENING_EQUATION_IDS.includes(equationId)
    });
  }
  const localSupportingById = /* @__PURE__ */ new Map();
  const supportingValues = [];
  for (const valueId of LOCAL_SUPPORTING_VALUE_IDS) {
    const actual = findSupportingValue3(actualSourceByFile, valueId);
    const expected = findSupportingValue3(expectedSourceByFile, valueId);
    const actualTerm = normalizeSupportingValue3(actual);
    const expectedTerm = normalizeSupportingValue3(expected);
    assert18.equal(
      canonicalJson(actualTerm),
      canonicalJson(expectedTerm),
      `Independent supporting-value equation changed: ${valueId}`
    );
    const row = {
      id: valueId,
      declaration: sourceOverrides.size === 0 ? spanOf(context, actual) : null,
      equationSha256: sha256(canonicalJson(expectedTerm)),
      term: expectedTerm
    };
    localSupportingById.set(valueId, row);
    supportingValues.push(row);
  }
  const callableByKey = new Map(surface.callables.map((callable) => [callable.key, callable]));
  const proofSeeds = [];
  const proofs = [];
  for (const surfaceKey of ASSIGNED_SURFACE_KEYS5) {
    const callable = callableByKey.get(surfaceKey);
    assert18(callable !== void 0, `Compiler omitted '${surfaceKey}'.`);
    assert18.equal(callable.signatureHash, sha256(canonicalJson(callable.signature)));
    const equationId = IMPLEMENTATION_BY_SURFACE_KEY[surfaceKey];
    const implementation = localById.get(equationId);
    assert18(implementation !== void 0, `No implementation equation for '${surfaceKey}'.`);
    proofSeeds.push(implementation);
    const isInterfaceMethod = surfaceKey.startsWith("type:");
    if (!isInterfaceMethod && sourceOverrides.size === 0) {
      assert18.equal(canonicalJson(callable.declaration), canonicalJson(spanOf(context, implementation)));
    }
    proofs.push({
      surfaceKey,
      mode: "V",
      signature: callable.signature,
      signatureHash: callable.signatureHash,
      declaration: callable.declaration,
      implementation: sourceOverrides.size === 0 ? spanOf(context, implementation) : null,
      relation: isInterfaceMethod ? "COMPILER_TYPED_OPAQUE_REPLACEMENT_IMPLEMENTATION" : "COMPILER_RESOLVED_EXACT_EXPORT",
      equationId,
      equationSha256: equations2.find((equation3) => equation3.id === equationId).equationSha256,
      lawId: lawIdForEquation3(equationId)
    });
  }
  let closure = {
    checkedLocal: [],
    reused: [],
    pending: [],
    localSupporting: [],
    reusedSupporting: [],
    pendingSupporting: [],
    ambient: []
  };
  let proofDependencyClosures = [];
  if (sourceOverrides.size === 0) {
    closure = inspectClosure({
      repositoryRoot: root3,
      context,
      seeds: proofSeeds,
      localById,
      localSupportingById,
      dependencyById: dependencies.equations,
      dependencySupportingById: dependencies.supportingValues
    });
    const expectedCoreEquations = LOCAL_EQUATION_IDS2.filter((equationId) => !STRENGTHENING_EQUATION_IDS.includes(equationId)).sort(compareCodeUnits);
    assert18.equal(
      canonicalJson(closure.checkedLocal),
      canonicalJson(expectedCoreEquations),
      "The transfer/correction-specific recursive equation closure changed."
    );
    proofDependencyClosures = proofSeeds.map(
      (seed, index) => proofDependencySummary(
        proofs[index].surfaceKey,
        inspectClosure({
          repositoryRoot: root3,
          context,
          seeds: [seed],
          localById,
          localSupportingById,
          dependencyById: dependencies.equations,
          dependencySupportingById: dependencies.supportingValues
        })
      )
    );
  }
  const pendingDependencyIds = pendingDependencyIdsFor(closure);
  for (let index = 0; index < proofs.length; index += 1) {
    const proofClosure = proofDependencyClosures[index];
    proofs[index].dependencyStatus = proofClosure?.status ?? "MUTATION_CHECK_NOT_ADMISSIBLE";
    proofs[index].pendingDependencyIds = proofClosure?.pendingDependencyIds ?? [];
  }
  const executionEvidence = REUSED_EXECUTION_FILES.map(
    (file) => summarizeExecutionEvidence(root3, file)
  );
  const forwardWitnesses = summarizeForwardWitnesses(root3);
  const sourceFlowJoins = sourceOverrides.size === 0 ? buildSourceFlowJoins({ context, surface, localById, executionEvidence }) : { plannerRows: [], causalRows: [] };
  const semanticFiles = /* @__PURE__ */ new Set([
    ...LOCAL_SOURCE_FILES2,
    ...producerFiles7,
    ...REUSED_EXECUTION_FILES,
    ...executionEvidence.flatMap(
      (evidence) => evidence.sourceInputs.map((input2) => input2.file)
    ),
    ...closure.ambient.map((operation) => operation.declaration.file)
  ]);
  const inputs3 = [...semanticFiles].sort(compareCodeUnits).map((file) => ({
    file,
    sha256: file === relativePath3(root3, dependencyManifestPath) ? sha256(dependencyManifestBytes) : sha256(sourceOverrides.get(file) ?? fs16.readFileSync(path19.resolve(root3, file)))
  }));
  const semanticCore = {
    sourceBase: SOURCE_BASE,
    redBefore,
    domain: FAMILY_DOMAIN3,
    laws: FAMILY_LAWS4,
    equations: equations2,
    supportingValues,
    closure: {
      complete: sourceOverrides.size === 0,
      localEquationIds: closure.checkedLocal,
      registeredDependencies: closure.reused,
      pendingDependencies: closure.pending,
      localSupportingValues: closure.localSupporting,
      registeredSupportingValues: closure.reusedSupporting,
      pendingSupportingValues: closure.pendingSupporting,
      ambientOperations: closure.ambient,
      bySurface: proofDependencyClosures
    },
    strengthening: {
      creditGranted: false,
      equationIds: STRENGTHENING_EQUATION_IDS,
      executionEvidence,
      forwardWitnesses,
      sourceFlowJoins,
      nativeGraphRuns: 0,
      originalGraphRuns: 0,
      producerReplayRuns: 0
    }
  };
  const certificateId = `VALUE_CERTIFICATE_FAMILY:sha256:${sha256(canonicalJson(semanticCore))}`;
  const result = {
    schemaVersion: 1,
    mode: "V",
    proofKind: TRANSFER_CORRECTION_VALUE_PROOF_KIND,
    certificateId,
    sourceBase: SOURCE_BASE,
    surfaceDigest: surface.digest,
    allAdmittedInputs: pendingDependencyIds.length === 0,
    sampledInputs: 0,
    domain: FAMILY_DOMAIN3,
    inputs: inputs3,
    semanticCore,
    proofs
  };
  if (sourceOverrides.size === 0) passCache4.set(context, result);
  return result;
}
var supportedSurfaceKeys8 = ASSIGNED_SURFACE_KEYS5;
var buildFamilyArtifact8 = buildTransferCorrectionValueFamily;

// experiments/tla-conformance/materialize1-r8/family.mjs
var DIRECTORY2 = "experiments/tla-conformance/materialize1-r8";
var FAMILY_FILE = `${DIRECTORY2}/family.mjs`;
var EXPECTED_FILE2 = `${DIRECTORY2}/roots-and-wrapper.expected.ts.txt`;
var CATALOG_RECORDED_FILE = "experiments/tla-conformance/throughput-r7/evidence/catalog-foundation-values.json";
var TRANSFER_RECORDED_FILE = "experiments/tla-conformance/throughput-r7/evidence/transfer-correction-values.json";
var MIGRATION_RECORDED_FILE = "experiments/tla-conformance/throughput-r7/evidence/migration-helper-values.json";
var proofKind5 = "migration-durable-world-materialize-complete-values-v1";
var supportedSurfaceKeys9 = Object.freeze([
  "export:./storage#materializeInventoryDurableMigrationWorld::call[0]"
]);
var ROOT_LAWS = Object.freeze([
  Object.freeze({ id: "src/integrity.ts#inventoryWorldContentRoots", file: "src/integrity.ts", name: "inventoryWorldContentRoots", dependencies: [
    "src/integrity.ts#inventoryCatalogSnapshotDigest",
    "src/integrity.ts#inventoryProjectionDigest",
    "src/integrity.ts#inventoryReservationBookDigest",
    "src/integrity.ts#inventoryCountBookDigest",
    "src/digest.ts#inventorySha256"
  ] }),
  Object.freeze({ id: "src/integrity.ts#inventoryCatalogSnapshotDigest", file: "src/integrity.ts", name: "inventoryCatalogSnapshotDigest", dependencies: ["src/catalog.ts#inventoryCatalogFromSnapshot"] }),
  Object.freeze({ id: "src/integrity.ts#inventoryProjectionDigest", file: "src/integrity.ts", name: "inventoryProjectionDigest", dependencies: ["src/integrity.ts#sortedRecordRows", "src/digest.ts#inventorySha256"] }),
  Object.freeze({ id: "src/integrity.ts#inventoryReservationBookDigest", file: "src/integrity.ts", name: "inventoryReservationBookDigest", dependencies: ["src/integrity.ts#sortedRecordRows", "src/digest.ts#inventorySha256"] }),
  Object.freeze({ id: "src/integrity.ts#inventoryCountBookDigest", file: "src/integrity.ts", name: "inventoryCountBookDigest", dependencies: ["src/integrity.ts#sortedRecordRows", "src/digest.ts#inventorySha256"] }),
  Object.freeze({ id: "src/integrity.ts#sortedRecordRows", file: "src/integrity.ts", name: "sortedRecordRows", dependencies: [] }),
  Object.freeze({ id: "src/projection.ts#applyInventoryCommittedEvent", file: "src/projection.ts", name: "applyInventoryCommittedEvent", dependencies: ["src/projection.ts#applyInventoryCommittedEventInternal"] })
]);
function rootDir() {
  return path20.resolve(path20.dirname(fileURLToPath11(import.meta.url)), "../../..");
}
function sourceText4(root3, file, overrides) {
  const override = overrides?.get(file);
  return override ?? fs17.readFileSync(path20.resolve(root3, file), "utf8");
}
function fileRef(root3, file, overrides) {
  return { file, sha256: sha256(sourceText4(root3, file, overrides)) };
}
function sourceFile(file, text) {
  const source7 = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert19.equal(source7.parseDiagnostics.length, 0, `Source does not parse: ${file}`);
  return source7;
}
function findFunction6(source7, name) {
  const rows = source7.statements.filter(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name && statement.body !== void 0
  );
  assert19.equal(rows.length, 1, `Expected one function '${name}' in ${source7.fileName}.`);
  return rows[0];
}
function scanTokens2(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const result = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    result.push([ts.SyntaxKind[token], scanner.getTokenText()]);
  }
  return result;
}
function normalizedCallable(declaration, source7) {
  return {
    typeParameters: (declaration.typeParameters ?? []).map((row) => scanTokens2(row.getText(source7))),
    parameters: declaration.parameters.map((row) => scanTokens2(row.getText(source7))),
    returnType: declaration.type === void 0 ? null : scanTokens2(declaration.type.getText(source7)),
    body: scanTokens2(declaration.body.getText(source7))
  };
}
function buildRootEquations(root3, sourceOverrides = /* @__PURE__ */ new Map()) {
  const expectedText = fs17.readFileSync(path20.resolve(root3, EXPECTED_FILE2), "utf8");
  const expected = sourceFile(EXPECTED_FILE2, expectedText);
  const actualByFile = /* @__PURE__ */ new Map();
  const rows = [];
  for (const law of ROOT_LAWS) {
    let actualSource = actualByFile.get(law.file);
    if (actualSource === void 0) {
      actualSource = sourceFile(law.file, sourceText4(root3, law.file, sourceOverrides));
      actualByFile.set(law.file, actualSource);
    }
    const actual = findFunction6(actualSource, law.name);
    const wanted = findFunction6(expected, law.name);
    const actualTerm = normalizedCallable(actual, actualSource);
    const expectedTerm = normalizedCallable(wanted, expected);
    assert19.equal(
      canonicalJson(actualTerm),
      canonicalJson(expectedTerm),
      `Complete digest/wrapper equation changed: ${law.id}`
    );
    rows.push({
      id: law.id,
      lawId: "migration-materialize-root-and-wrapper-v1",
      termSha256: sha256(canonicalJson(expectedTerm)),
      dependencies: law.dependencies,
      completeExpectedTerm: true
    });
  }
  return rows;
}
function equationById(rows, id) {
  const matches = rows.filter((row) => row.id === id);
  assert19.equal(matches.length, 1, `Expected one equation '${id}'.`);
  return matches[0];
}
function catalogEquation(artifact, id) {
  const matches = artifact.equations.filter((row) => row.id === id);
  assert19.equal(matches.length, 1, `Catalog foundation lost '${id}'.`);
  return matches[0];
}
function transferEquation(artifact, id) {
  const matches = artifact.semanticCore.equations.filter((row) => row.id === id);
  assert19.equal(matches.length, 1, `Transfer/correction family lost '${id}'.`);
  return matches[0];
}
function v9Proof(artifact, surfaceKey) {
  const matches = artifact.proofs.filter((row) => row.surfaceKey === surfaceKey);
  assert19.equal(matches.length, 1, `Migration helper proof lost '${surfaceKey}'.`);
  return matches[0];
}
function v9Local(artifact, id) {
  const matches = artifact.localLaws.filter((row) => row.id === id);
  assert19.equal(matches.length, 1, `Migration helper local law lost '${id}'.`);
  return matches[0];
}
function mergeInputs2(rows) {
  const byFile = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const prior = byFile.get(row.file);
    if (prior !== void 0) assert19.equal(prior.sha256, row.sha256, `Input '${row.file}' has conflicting identities.`);
    byFile.set(row.file, row);
  }
  return [...byFile.values()].sort((left, right) => left.file.localeCompare(right.file));
}
function buildFamilyArtifact9({ repositoryRoot: root3 = rootDir(), context, surface, sourceOverrides = /* @__PURE__ */ new Map() } = {}) {
  assert19(context !== void 0 && surface !== void 0, "Current compiler context and surface are required.");
  assert19.equal(surface.callables.length, 535);
  const migration = buildIndependentV9Artifact({ repositoryRoot: root3, sourceOverrides, context, surface });
  const materialize = v9Proof(migration, supportedSurfaceKeys9[0]);
  const validate = v9Local(migration, "src/storage.ts#validateInventoryDurableMigrationPlanAgainstBase");
  const rootsEqual = v9Local(migration, "src/storage.ts#inventoryWorldContentRootsEqual");
  const planDigest = v9Proof(migration, "export:./storage#inventoryDurableMigrationPlanDigest::call[0]");
  const shaLaw = v9Local(migration, "src/digest.ts#inventorySha256");
  const rotateLaw = v9Local(migration, "src/digest.ts#rotateRight");
  assert19.equal(materialize.completeExpectedTerm.termSha256, "20f20d40f7bccebe4162b09cca6e521c3b7786b7a29715b9ab548e31a1e89cfd");
  assert19.equal(validate.completeExpectedTerm.termSha256, "a63cba18a783425b885ac3d301413f6562a67ed4184fc26f557766338c658b86");
  assert19.equal(rootsEqual.completeExpectedTerm.termSha256, "3a30b6addeecaf9768c04d47771df8b26f57bc768d15794bedcf9075e83c5659");
  assert19.equal(planDigest.completeExpectedTerm.termSha256, "72964d804bdb2a1081604127173d18e6ce6033a24871378c919d43704170235e");
  assert19.equal(shaLaw.gaps.length, 0);
  assert19.equal(rotateLaw.gaps.length, 0);
  const catalog = buildCatalogFoundationFamilyArtifact({ repositoryRoot: root3, context, surface, sourceOverrides });
  assert19.equal(catalog.proofKind, "independent-catalog-foundation-closed-equations-v1");
  assert19.equal(catalog.allAdmittedInputs, true);
  assert19.equal(catalog.sampledInputs, 0);
  const catalogFromSnapshot = catalogEquation(catalog, "src/catalog.ts#inventoryCatalogFromSnapshot");
  const catalogRetainsSnapshot = catalogEquation(catalog, "src/catalog.ts#assertInventoryCatalogRetainsSnapshot");
  const transfer = buildTransferCorrectionValueFamily({ repositoryRoot: root3, context, surface, sourceOverrides });
  assert19.equal(transfer.proofKind, "inventoryonce-transfer-correction-complete-source-equations-v2");
  assert19.equal(transfer.allAdmittedInputs, true);
  assert19.equal(transfer.sampledInputs, 0);
  const eventReducer = transferEquation(transfer, "src/projection.ts#applyInventoryCommittedEventInternal");
  assert19.equal(eventReducer.equationSha256, "7c258a0cd6881d0163cca5041071777e9a78615a1725b6435e6c0cd5e9728301");
  const rootEquations = buildRootEquations(root3, sourceOverrides);
  const worldRoots = equationById(rootEquations, "src/integrity.ts#inventoryWorldContentRoots");
  const catalogSnapshotDigest = equationById(rootEquations, "src/integrity.ts#inventoryCatalogSnapshotDigest");
  const projectionDigest = equationById(rootEquations, "src/integrity.ts#inventoryProjectionDigest");
  const reservationDigest = equationById(rootEquations, "src/integrity.ts#inventoryReservationBookDigest");
  const countDigest = equationById(rootEquations, "src/integrity.ts#inventoryCountBookDigest");
  const sortedRows = equationById(rootEquations, "src/integrity.ts#sortedRecordRows");
  const publicApply = equationById(rootEquations, "src/projection.ts#applyInventoryCommittedEvent");
  const callable = surface.callables.find((row) => row.key === supportedSurfaceKeys9[0]);
  assert19(callable !== void 0, "Compiler surface lost materializeInventoryDurableMigrationWorld.");
  assert19.deepEqual(callable.declaration, materialize.completeExpectedTerm.implementation, "Materialize public declaration no longer matches its complete source law.");
  const inputs3 = mergeInputs2([
    fileRef(root3, FAMILY_FILE, sourceOverrides),
    fileRef(root3, EXPECTED_FILE2, sourceOverrides),
    fileRef(root3, "src/integrity.ts", sourceOverrides),
    fileRef(root3, "src/projection.ts", sourceOverrides),
    fileRef(root3, "src/storage.ts", sourceOverrides),
    fileRef(root3, "src/catalog.ts", sourceOverrides),
    fileRef(root3, "src/digest.ts", sourceOverrides),
    fileRef(root3, "experiments/tla-conformance/migration-helper-causal-r7/independent-v9-laws.mjs", sourceOverrides),
    fileRef(root3, "experiments/tla-conformance/migration-helper-causal-r7/v9.expected.ts.txt", sourceOverrides),
    fileRef(root3, "experiments/tla-conformance/catalog-foundation-r7/family.mjs", sourceOverrides),
    fileRef(root3, "experiments/tla-conformance/transfer-surface-r6/source-equations-r7/family.mjs", sourceOverrides),
    fileRef(root3, CATALOG_RECORDED_FILE, sourceOverrides),
    fileRef(root3, TRANSFER_RECORDED_FILE, sourceOverrides),
    fileRef(root3, MIGRATION_RECORDED_FILE, sourceOverrides),
    ...catalog.inputs,
    ...transfer.inputs
  ]);
  const proof = {
    surfaceKey: supportedSurfaceKeys9[0],
    signatureHash: callable.signatureHash,
    declaration: callable.declaration,
    implementationId: materialize.implementationId,
    completeExpectedTerm: materialize.completeExpectedTerm,
    lawId: "migration-durable-world-materialize-composition-v1",
    dependencies: {
      localValidator: {
        id: validate.id,
        termSha256: validate.completeExpectedTerm.termSha256,
        rootsEqualityTermSha256: rootsEqual.completeExpectedTerm.termSha256
      },
      planDigest: {
        surfaceKey: planDigest.surfaceKey,
        termSha256: planDigest.completeExpectedTerm.termSha256,
        sha256Law: shaLaw.completeExpectedTerm.termSha256,
        rotateRightLaw: rotateLaw.completeExpectedTerm.termSha256
      },
      catalog: {
        fromSnapshot: { id: catalogFromSnapshot.id, termSha256: catalogFromSnapshot.termSha256, lawId: catalogFromSnapshot.lawId },
        retainsSnapshot: { id: catalogRetainsSnapshot.id, termSha256: catalogRetainsSnapshot.termSha256, lawId: catalogRetainsSnapshot.lawId }
      },
      eventProjection: {
        publicWrapper: publicApply,
        internalReducer: { id: eventReducer.id, equationSha256: eventReducer.equationSha256, lawId: eventReducer.lawId }
      },
      worldRoots: {
        worldRoots,
        catalogSnapshotDigest,
        projectionDigest,
        reservationDigest,
        countDigest,
        sortedRows,
        sha256Law: shaLaw.completeExpectedTerm.termSha256
      }
    }
  };
  return {
    schemaVersion: 1,
    mode: "V",
    proofKind: proofKind5,
    family: "MigrationDurableWorldMaterializeV1",
    surfaceDigest: surface.digest,
    domain: "Every typed InventoryWorldState and InventoryDurableMigrationPlan admitted by the complete source guards: exact plan/base roots, retained catalog, ordered committed migration events, deficit policy, source dispositions, and SHA-256 content roots. No finite fixture or producer-action restriction.",
    allAdmittedInputs: true,
    sampledInputs: 0,
    sourceCallableClosureComplete: true,
    inputs: inputs3,
    dependencyArtifacts: {
      catalogFoundation: { proofKind: catalog.proofKind, certificateId: catalog.certificateId, artifactSha256: sha256(canonicalJson(catalog)) },
      transferCorrection: { proofKind: transfer.proofKind, artifactSha256: sha256(canonicalJson(transfer)) },
      migrationHelperCompleteTerms: { proofKind: migration.proofKind, artifactSha256: sha256(canonicalJson(migration)) }
    },
    rootEquations,
    proofs: [proof]
  };
}

// experiments/tla-conformance/residual-core-v4-r10/family.mjs
var proofKind6 = "residual-core-pure-aliases-v4-v1";
var supportedSurfaceKeys10 = Object.freeze([
  "export:.#findInventoryEventByOperationId::call[0]",
  "export:./kernel#findInventoryEventByOperationId::call[0]",
  "export:./storage#emptyInventoryWorldState::call[0]",
  "export:./storage#inventoryCatalogSnapshotDigest::call[0]"
]);
var EXPECTED2 = "experiments/tla-conformance/residual-core-v4-r10/find.expected.ts.txt";
var SELF = "experiments/tla-conformance/residual-core-v4-r10/family.mjs";
var FIND_ID = "src/read-model.ts#findInventoryEventByOperationId";
var EMPTY_ID = "src/world.ts#emptyInventoryWorldState";
var DIGEST_ID = "src/integrity.ts#inventoryCatalogSnapshotDigest";
function sf2(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function functionDecl(source7, name) {
  const rows = source7.statements.filter((x) => ts.isFunctionDeclaration(x) && x.name?.text === name && x.body !== void 0);
  assert20.equal(rows.length, 1, `Expected one ${name}`);
  return rows[0];
}
function tokens(node, source7) {
  const text = source7.text.slice(node.getStart(source7), node.end), scan = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text), out = [];
  for (; ; ) {
    const k = scan.scan();
    if (k === ts.SyntaxKind.EndOfFileToken) break;
    out.push([ts.SyntaxKind[k], scan.getTokenText()]);
  }
  return out;
}
function findEquation(root3, overrides = /* @__PURE__ */ new Map()) {
  const actualText = overrides.get("src/read-model.ts") ?? fs18.readFileSync(path21.resolve(root3, "src/read-model.ts"), "utf8");
  const actual = sf2("src/read-model.ts", actualText), expected = sf2(EXPECTED2, fs18.readFileSync(path21.resolve(root3, EXPECTED2), "utf8"));
  const a = functionDecl(actual, "findInventoryEventByOperationId"), e = functionDecl(expected, "findInventoryEventByOperationId"), at = tokens(a, actual), et = tokens(e, expected);
  assert20.deepEqual(at, et, "findInventoryEventByOperationId complete expected equation changed");
  return { equationId: FIND_ID, completeExpectedTerm: true, termSha256: sha256(canonicalJson(at)), implementationAstSha256: sha256(actualText.slice(a.getStart(actual), a.end)) };
}
function addInput2(root3, map, file) {
  if (map.has(file)) return;
  map.set(file, { file, sha256: sha256(fs18.readFileSync(path21.resolve(root3, file))) });
}
function buildFamilyArtifact10({ repositoryRoot = process.cwd(), context, surface, sourceOverrides = /* @__PURE__ */ new Map(), storageArtifactOverride, materializeArtifactOverride } = {}) {
  assert20(context && surface);
  const find = findEquation(repositoryRoot, sourceOverrides);
  if (sourceOverrides.size > 0) return { mutationControlAccepted: false, find };
  const storageCurrent = buildFamilyArtifact7({ repositoryRoot, context, surface });
  const storage = storageArtifactOverride ? storageArtifactOverride(structuredClone(storageCurrent)) : storageCurrent;
  assert20.deepEqual(storage, storageCurrent, "Storage value dependency drifted");
  const empty = storage.equations.find((x) => x.id === EMPTY_ID);
  assert20(empty !== void 0, "Storage complete empty-world equation missing");
  assert20.equal(empty.implementation.astHash, "095773ae9c97eac998910f614bd1af4134491c7df35dcab040b2162667e08961");
  const materializeCurrent = buildFamilyArtifact9({ repositoryRoot, context, surface });
  const materialize = materializeArtifactOverride ? materializeArtifactOverride(structuredClone(materializeCurrent)) : materializeCurrent;
  assert20.deepEqual(materialize, materializeCurrent, "Materialize value dependency drifted");
  const digest = materialize.rootEquations.find((x) => x.id === DIGEST_ID);
  assert20(digest !== void 0 && digest.completeExpectedTerm === true, "Complete catalog-snapshot digest equation missing");
  const live = new Map(surface.callables.map((c) => [c.key, c]));
  const inputs3 = /* @__PURE__ */ new Map();
  for (const artifact of [storageCurrent, materializeCurrent]) for (const input2 of artifact.inputs) addInput2(repositoryRoot, inputs3, input2.file);
  for (const file of [SELF, EXPECTED2, "src/read-model.ts", "src/world.ts", "src/integrity.ts", "node_modules/typescript/package.json"]) addInput2(repositoryRoot, inputs3, file);
  const proofs = supportedSurfaceKeys10.map((surfaceKey) => {
    const c = live.get(surfaceKey);
    assert20(c !== void 0, `Missing ${surfaceKey}`);
    let semantic;
    if (surfaceKey.includes("findInventoryEventByOperationId")) {
      assert20.equal(c.declaration.file, "src/read-model.ts");
      semantic = { kind: "INDEPENDENT_COMPLETE_SOURCE_EQUATION", ...find };
    } else if (surfaceKey.includes("emptyInventoryWorldState")) {
      assert20.equal(c.declaration.astHash, empty.implementation.astHash);
      semantic = { kind: "REUSED_REDERIVED_COMPLETE_EQUATION", dependencyProofKind: storageCurrent.proofKind, equation: empty };
    } else {
      assert20.equal(c.declaration.file, "src/integrity.ts");
      semantic = { kind: "REUSED_REDERIVED_COMPLETE_EQUATION", dependencyProofKind: materializeCurrent.proofKind, equation: digest };
    }
    return { surfaceKey, signatureHash: c.signatureHash, declaration: c.declaration, semantic };
  });
  return { schemaVersion: 1, proofKind: proofKind6, surfaceDigest: surface.digest, domain: "All valid typed inputs of the exact current implementations: complete branch/error/index semantics for findInventoryEventByOperationId; the independently rederived StorageProtocol empty world equation; and the independently rederived catalog-snapshot digest root equation plus its closed catalog dependency.", allAdmittedInputs: true, sampledInputs: 0, inputs: [...inputs3.values()].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0), proofs };
}

// experiments/tla-conformance/catalog-public-lifecycle7-r9/publication-core-r10/value-family.mjs
import assert21 from "node:assert/strict";
import fs19 from "node:fs";
import path22 from "node:path";

// experiments/tla-conformance/quantity-values-r7/event-values/registered-family-adapter.mjs
var eventValuesRegistration = Object.freeze({
  proofKind: EVENT_VALUES_PROOF_KIND,
  buildFamilyArtifact: buildFamilyArtifact5,
  supportedSurfaceKeys: supportedSurfaceKeys5
});

// experiments/tla-conformance/catalog-public-lifecycle7-r9/publication-core-r10/value-family.mjs
var proofKind7 = "catalog-publication-event-complete-value-v1";
var supportedSurfaceKeys11 = Object.freeze(["export:./kernel#createInventoryCatalogPublicationEvent::call[0]"]);
var EXPECTED3 = "experiments/tla-conformance/catalog-public-lifecycle7-r9/publication-core-r10/equations.expected.ts.txt";
var EVENT_HELPER = "src/commands.ts#createMovementEvent";
var CATALOG_SNAPSHOT = "export:.#inventoryCatalogSnapshot::call[0]";
function source2(root3, file, override) {
  const abs = path22.resolve(root3, file);
  return ts.createSourceFile(abs, override ?? fs19.readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function findFunction7(sf3, name) {
  const rows = sf3.statements.filter((row) => ts.isFunctionDeclaration(row) && row.name?.text === name);
  assert21.equal(rows.length, 1, `Expected one function ${name}`);
  assert21(rows[0].body !== void 0);
  return rows[0];
}
function runtimeTerm2(node, sf3) {
  let text = node.getText(sf3).replace(/^export\s+/u, "");
  const name = node.name?.text;
  assert21(name !== void 0);
  text = text.replace(new RegExp(`^(?:async\\s+)?function\\s+${name}\\b`), (match) => match.replace(name, "__proof"));
  const emitted = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, removeComments: true } }).outputText.trim();
  const scanner = ts.createScanner(ts.ScriptTarget.ES2022, true, ts.LanguageVariant.Standard, emitted), tokens5 = [];
  for (; ; ) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    tokens5.push([ts.SyntaxKind[kind], scanner.getTokenText()]);
  }
  return tokens5;
}
function enumValue(sf3, name, member2) {
  const rows = sf3.statements.filter((row) => ts.isEnumDeclaration(row) && row.name.text === name);
  assert21.equal(rows.length, 1);
  const found = rows[0].members.find((row) => row.name.getText(sf3) === member2);
  assert21(found !== void 0 && ts.isStringLiteral(found.initializer));
  return found.initializer.text;
}
function addInput3(root3, map, file) {
  if (map.has(file)) return;
  map.set(file, { file, sha256: sha256(fs19.readFileSync(path22.resolve(root3, file))) });
}
function sourceEquationReceipt2(root3, sourceOverrides = /* @__PURE__ */ new Map()) {
  const actualSource = source2(root3, "src/commands.ts", sourceOverrides.get("src/commands.ts"));
  const expectedSource3 = source2(root3, EXPECTED3);
  const actual = runtimeTerm2(findFunction7(actualSource, "createInventoryCatalogPublicationEvent"), actualSource);
  const expected = runtimeTerm2(findFunction7(expectedSource3, "expectedCreateInventoryCatalogPublicationEvent"), expectedSource3);
  assert21.deepEqual(actual, expected, "Catalog publication event complete source equation drifted");
  const events = source2(root3, "src/events.ts", sourceOverrides.get("src/events.ts"));
  const kind = enumValue(events, "InventoryEventKind", "CatalogPublication");
  assert21.equal(kind, "catalog-publication", "InventoryEventKind.CatalogPublication drifted");
  return { normalizedTermSha256: sha256(canonicalJson(actual)), eventKind: kind, completeBranchesChecked: true, allValidatedInputs: true, sampledInputs: 0 };
}
function eventReceipt(root3, context, surface, override) {
  const current = buildFamilyArtifact5({ repositoryRoot: root3, context, surface });
  let artifact = override ? override(structuredClone(current)) : current;
  assert21.deepEqual(artifact, current, "Event family dependency drifted");
  assert21.equal(artifact.proofKind, EVENT_VALUES_PROOF_KIND);
  assert21.equal(artifact.sampledInputs, 0);
  const helper = artifact.semanticCore?.helperEquations?.find((row) => row.id === EVENT_HELPER);
  assert21(helper !== void 0, "Event family lost createMovementEvent helper equation");
  assert21.deepEqual(helper.dependencies, ["src/commands.ts#inventoryEventIdForOperation", "src/events.ts#defineInventoryEvent"]);
  return { artifact, receipt: { proofKind: artifact.proofKind, certificateId: artifact.certificateId, helperId: helper.id, equationSha256: helper.equationSha256, declaration: helper.declaration, dependencies: helper.dependencies } };
}
function catalogReceipt(root3, context, surface, override) {
  const current = buildValueContractArtifact({ repositoryRoot: root3, context, surface });
  let artifact = override ? override(structuredClone(current)) : current;
  assert21.deepEqual(artifact, current, "Catalog snapshot dependency drifted");
  assert21.equal(artifact.proofKind, "independent-closed-return-equations-v1");
  const proof = artifact.proofs.find((row) => row.surfaceKey === CATALOG_SNAPSHOT);
  assert21(proof !== void 0, "Value-contract family lost inventoryCatalogSnapshot proof");
  const callable = surface.callables.find((row) => row.key === CATALOG_SNAPSHOT);
  assert21(callable !== void 0);
  assert21.equal(proof.signatureHash, callable.signatureHash);
  assert21.deepEqual(proof.declaration, callable.declaration);
  return { artifact, receipt: { proofKind: artifact.proofKind, surfaceKey: CATALOG_SNAPSHOT, signatureHash: proof.signatureHash, declaration: proof.declaration, semantics: proof.semantics } };
}
function semanticInputs2(root3, event, catalog) {
  const map = /* @__PURE__ */ new Map();
  for (const file of [EXPECTED3, "experiments/tla-conformance/catalog-public-lifecycle7-r9/publication-core-r10/value-family.mjs", "src/commands.ts", "src/events.ts", "node_modules/typescript/package.json"]) addInput3(root3, map, file);
  for (const family of [event.artifact, catalog.artifact]) for (const input2 of family.inputs ?? family.producers ?? []) addInput3(root3, map, input2.file);
  return [...map.values()].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
}
function buildFamilyArtifact11({ repositoryRoot = process.cwd(), context = loadEvidenceCompilerContext(repositoryRoot, []), surface = discoverCompilerSurface(repositoryRoot), sourceOverrides = /* @__PURE__ */ new Map(), eventArtifactOverride, catalogArtifactOverride } = {}) {
  const equation3 = sourceEquationReceipt2(repositoryRoot, sourceOverrides);
  if (sourceOverrides.size > 0) return { mutationControlAccepted: false, equation: equation3 };
  const event = eventReceipt(repositoryRoot, context, surface, eventArtifactOverride), catalog = catalogReceipt(repositoryRoot, context, surface, catalogArtifactOverride), callable = surface.callables.find((row) => row.key === supportedSurfaceKeys11[0]);
  assert21(callable !== void 0);
  return { schemaVersion: 1, proofKind: proofKind7, surfaceDigest: surface.digest, domain: "Every typed CreateInventoryCatalogPublicationInput. The complete public wrapper equation delegates to the independently rederived Event45 createMovementEvent/defineInventoryEvent closure with exact CatalogPublication enum semantics and the current complete inventoryCatalogSnapshot value proof; there is no sampled runtime domain.", allAdmittedInputs: true, sampledInputs: 0, inputs: semanticInputs2(repositoryRoot, event, catalog), proofs: [{ surfaceKey: supportedSurfaceKeys11[0], signatureHash: callable.signatureHash, declaration: callable.declaration, semantics: { completeExpectedTerm: equation3, eventMovementClosure: event.receipt, catalogSnapshot: catalog.receipt } }] };
}

// experiments/tla-conformance/surface-residual-r8/direct-pure-v7/family.mjs
import assert22 from "node:assert/strict";
import fs20 from "node:fs";
import path23 from "node:path";
var proofKind8 = "surface-residual-direct-pure-complete-values-v7-v1";
var supportedSurfaceKeys12 = Object.freeze([
  "export:.#defineInventoryAmountLineGroup::call[0]",
  "export:.#combineInventoryAmountLineGroups::call[0]",
  "export:.#defineInventoryPolicyBatchRequestGroup::call[0]",
  "export:.#combineInventoryPolicyBatchRequestGroups::call[0]",
  "export:./kernel#abandonInventoryCount::call[0]",
  "export:./kernel#inventoryCompositionOpenIntentFingerprint::call[0]",
  "export:./kernel#inventoryEventsInRecordSequence::call[0]"
]);
var EXPECTED4 = "experiments/tla-conformance/surface-residual-r8/direct-pure-v7/equations.expected.ts.txt";
var PUBLIC2 = Object.freeze([
  { surfaceKey: supportedSurfaceKeys12[0], file: "src/facade.ts", actual: "defineInventoryAmountLineGroup", expected: "expectedDefineInventoryAmountLineGroup" },
  { surfaceKey: supportedSurfaceKeys12[1], file: "src/facade.ts", actual: "combineInventoryAmountLineGroups", expected: "expectedCombineInventoryAmountLineGroups" },
  { surfaceKey: supportedSurfaceKeys12[2], file: "src/facade.ts", actual: "defineInventoryPolicyBatchRequestGroup", expected: "expectedDefineInventoryPolicyBatchRequestGroup" },
  { surfaceKey: supportedSurfaceKeys12[3], file: "src/facade.ts", actual: "combineInventoryPolicyBatchRequestGroups", expected: "expectedCombineInventoryPolicyBatchRequestGroups" },
  { surfaceKey: supportedSurfaceKeys12[4], file: "src/counts.ts", actual: "abandonInventoryCount", expected: "expectedAbandonInventoryCount" },
  { surfaceKey: supportedSurfaceKeys12[5], file: "src/composition.ts", actual: "inventoryCompositionOpenIntentFingerprint", expected: "expectedInventoryCompositionOpenIntentFingerprint" },
  { surfaceKey: supportedSurfaceKeys12[6], file: "src/projection.ts", actual: "inventoryEventsInRecordSequence", expected: "expectedInventoryEventsInRecordSequence" }
]);
var PRIVATE2 = Object.freeze([
  { file: "src/events.ts", actual: "assertCanonicalInventoryTime", expected: "expectedAssertCanonicalInventoryTime" },
  { file: "src/counts.ts", actual: "findCountOperationReplay", expected: "expectedFindCountOperationReplay" },
  { file: "src/counts.ts", actual: "replaceCountWithOperation", expected: "expectedReplaceCountWithOperation" },
  { file: "src/composition.ts", actual: "compositionQualifiedDimensionFingerprint", expected: "expectedCompositionQualifiedDimensionFingerprint" },
  { file: "src/composition.ts", actual: "compareCompositionQualifiedDimensionFingerprint", expected: "expectedCompareCompositionQualifiedDimensionFingerprint" },
  { file: "src/ordering.ts", actual: "compareInventoryIdentityText", expected: "expectedCompareInventoryIdentityText" },
  { file: "src/projection.ts", actual: "compareCommittedEventSequence", expected: "expectedCompareCommittedEventSequence" }
]);
var IDENTITY_KEYS = Object.freeze([
  "export:./kernel#assertInventoryAmountSum::call[0]",
  "export:./kernel#normalizeInventoryStockSelector::call[0]",
  "export:./kernel#inventoryStockPositionIdentity::call[0]",
  "export:./kernel#inventoryIntentFingerprint::call[0]",
  "export:./kernel#inventoryMetadataFingerprint::call[0]",
  "export:./kernel#inventoryTraceabilityNodeIdentity::call[0]"
]);
var CATALOG_KEYS = Object.freeze([
  "type:src/catalog.ts#InventoryCatalog.itemRevision::call[0]",
  "type:src/catalog.ts#InventoryCatalog.packagingRevision::call[0]",
  "type:src/catalog.ts#InventoryCatalog.compositionForSourcePackagingRevision::call[0]"
]);
function source3(root3, file, override) {
  const abs = path23.resolve(root3, file);
  return ts.createSourceFile(abs, override ?? fs20.readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function expectedSource2(root3) {
  const file = path23.resolve(root3, EXPECTED4);
  return ts.createSourceFile(file, fs20.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function findFunction8(sf3, name) {
  const rows = sf3.statements.filter((row) => ts.isFunctionDeclaration(row) && row.name?.text === name);
  assert22.equal(rows.length, 1, `Expected one function ${name}`);
  assert22(rows[0].body !== void 0);
  return rows[0];
}
function runtimeTerm3(node, sf3) {
  let text = node.getText(sf3).replace(/^export\s+/u, "");
  const name = node.name?.text;
  assert22(name !== void 0);
  text = text.replace(new RegExp(`^(?:async\\s+)?function\\s+${name}\\b`), (match) => match.replace(name, "__proof"));
  const emitted = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, removeComments: true } }).outputText.trim();
  const scanner = ts.createScanner(ts.ScriptTarget.ES2022, true, ts.LanguageVariant.Standard, emitted);
  const tokens5 = [];
  for (; ; ) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    tokens5.push([ts.SyntaxKind[kind], scanner.getTokenText()]);
  }
  return tokens5;
}
function prove2(actual, expected, label) {
  const a = runtimeTerm3(actual, actual.getSourceFile()), e = runtimeTerm3(expected, expected.getSourceFile());
  assert22.deepEqual(a, e, `Complete expected source equation drifted: ${label}`);
  return { label, normalizedTermSha256: sha256(canonicalJson(a)), completeBranchesChecked: true };
}
function enumValues2(sf3, name, wanted) {
  const rows = sf3.statements.filter((row) => ts.isEnumDeclaration(row) && row.name.text === name);
  assert22.equal(rows.length, 1);
  const result = {};
  for (const member2 of rows[0].members) {
    const key = member2.name.getText(sf3);
    if (!wanted.includes(key)) continue;
    assert22(ts.isStringLiteral(member2.initializer), `${name}.${key} must stay string-valued`);
    result[key] = member2.initializer.text;
  }
  assert22.deepEqual(Object.keys(result).sort(), [...wanted].sort());
  return result;
}
function sourceEquationReceipt3(root3, overrides = /* @__PURE__ */ new Map()) {
  const expected = expectedSource2(root3), cache2 = /* @__PURE__ */ new Map();
  function sf3(file) {
    if (!cache2.has(file)) cache2.set(file, source3(root3, file, overrides.get(file)));
    return cache2.get(file);
  }
  const publicEquations = PUBLIC2.map((row) => prove2(findFunction8(sf3(row.file), row.actual), findFunction8(expected, row.expected), row.actual));
  const privateEquations = PRIVATE2.map((row) => prove2(findFunction8(sf3(row.file), row.actual), findFunction8(expected, row.expected), row.actual));
  const counts = sf3("src/counts.ts");
  const supportingValues = {
    InventoryCountOperationKind: enumValues2(counts, "InventoryCountOperationKind", ["Abandon"]),
    InventoryCountStatus: enumValues2(counts, "InventoryCountStatus", ["Completed", "Abandoned"])
  };
  assert22.deepEqual(supportingValues, { InventoryCountOperationKind: { Abandon: "abandon" }, InventoryCountStatus: { Completed: "completed", Abandoned: "abandoned" } });
  return { publicEquations, privateEquations, supportingValues };
}
function dependencyReceipt2(root3, context, surface) {
  const families = [
    { name: "identity", artifact: buildFamilyArtifact2({ repositoryRoot: root3, context, surface }), keys: IDENTITY_KEYS },
    { name: "catalog", artifact: buildCatalogFamilyArtifact({ repositoryRoot: root3, context, surface }), keys: CATALOG_KEYS }
  ];
  const receipts = [];
  for (const family of families) {
    assert22.equal(family.artifact.surfaceDigest, surface.digest);
    const byKey = new Map(family.artifact.proofs.map((p) => [p.surfaceKey, p]));
    for (const surfaceKey of family.keys) {
      const proof = byKey.get(surfaceKey);
      assert22(proof !== void 0, `${family.name} dependency missing ${surfaceKey}`);
      const callable = surface.callables.find((row) => row.key === surfaceKey);
      assert22(callable !== void 0);
      assert22.equal(proof.signatureHash, callable.signatureHash);
      assert22.deepEqual(proof.declaration, callable.declaration);
      receipts.push({ family: family.name, proofKind: family.artifact.proofKind, surfaceKey, signatureHash: proof.signatureHash, declaration: proof.declaration });
    }
  }
  return { receipts, families };
}
function addInput4(root3, inputs3, file) {
  if (inputs3.has(file)) return;
  inputs3.set(file, { file, sha256: sha256(fs20.readFileSync(path23.resolve(root3, file))) });
}
function semanticInputs3(root3, dependencies) {
  const inputs3 = /* @__PURE__ */ new Map();
  for (const file of [EXPECTED4, "experiments/tla-conformance/surface-residual-r8/direct-pure-v7/family.mjs", "src/facade.ts", "src/counts.ts", "src/events.ts", "src/composition.ts", "src/ordering.ts", "src/projection.ts", "node_modules/typescript/package.json"]) addInput4(root3, inputs3, file);
  for (const family of dependencies.families) for (const input2 of family.artifact.inputs ?? family.artifact.producers ?? []) addInput4(root3, inputs3, input2.file);
  return [...inputs3.values()].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
}
function buildFamilyArtifact12({ repositoryRoot = process.cwd(), context = loadEvidenceCompilerContext(repositoryRoot, []), surface = discoverCompilerSurface(repositoryRoot), sourceOverrides = /* @__PURE__ */ new Map() } = {}) {
  const equations2 = sourceEquationReceipt3(repositoryRoot, sourceOverrides);
  if (sourceOverrides.size > 0) return { mutationControlAccepted: false, equations: equations2 };
  const dependencies = dependencyReceipt2(repositoryRoot, context, surface);
  const live = new Map(surface.callables.map((row) => [row.key, row]));
  const byLabel = new Map(equations2.publicEquations.map((row) => [row.label, row]));
  const proofs = PUBLIC2.map((row) => {
    const callable = live.get(row.surfaceKey);
    assert22(callable !== void 0);
    return { surfaceKey: row.surfaceKey, signatureHash: callable.signatureHash, declaration: callable.declaration, semantics: { completeExpectedTerm: byLabel.get(row.actual), privateEquations: equations2.privateEquations, supportingValues: equations2.supportingValues, dependencyReceipts: dependencies.receipts } };
  });
  return { schemaVersion: 1, proofKind: proofKind8, surfaceDigest: surface.digest, domain: "Seven direct deterministic public functions over plain application inputs: four amount/policy grouping helpers, count abandonment, composition-open retry fingerprinting, and committed-event sequence normalization. Complete public/private source terms, count enum values, and exact Identity/Catalog semantic dependencies are rederived; constructors, application callbacks, event reducers, composition execution, and projection digest are excluded.", allAdmittedInputs: true, sampledInputs: 0, inputs: semanticInputs3(repositoryRoot, dependencies), proofs };
}

// experiments/tla-conformance/surface-residual-r8/final-unique8-r9/value-v2/family.mjs
import assert23 from "node:assert/strict";
import fs21 from "node:fs";
import path24 from "node:path";
var proofKind9 = "surface-residual-final-projection-values-v2-v1";
var supportedSurfaceKeys13 = Object.freeze([
  "export:./kernel#projectInventoryEvents::call[0]",
  "export:./storage#inventoryProjectionDigest::call[0]"
]);
var EXPECTED5 = "experiments/tla-conformance/surface-residual-r8/final-unique8-r9/value-v2/equations.expected.ts.txt";
function parse2(file, text) {
  const sf3 = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert23.equal(sf3.parseDiagnostics.length, 0, `Cannot parse ${file}`);
  return sf3;
}
function findFunction9(sf3, name) {
  const rows = sf3.statements.filter((row) => ts.isFunctionDeclaration(row) && row.name?.text === name && row.body !== void 0);
  assert23.equal(rows.length, 1, `Expected one function ${name}`);
  return rows[0];
}
function input(root3, file) {
  return { file, sha256: sha256(fs21.readFileSync(path24.resolve(root3, file))) };
}
function mergeInputs3(rows) {
  const by = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const prior = by.get(row.file);
    if (prior !== void 0) assert23.equal(prior.sha256, row.sha256, `Conflicting input ${row.file}`);
    by.set(row.file, row);
  }
  return [...by.values()].sort((a, b) => a.file.localeCompare(b.file));
}
function localDigestEquations(root3, overrides = /* @__PURE__ */ new Map()) {
  const actualText = overrides.get("src/integrity.ts") ?? fs21.readFileSync(path24.resolve(root3, "src/integrity.ts"), "utf8");
  const expectedText = fs21.readFileSync(path24.resolve(root3, EXPECTED5), "utf8");
  const actual = parse2("src/integrity.ts", actualText), expected = parse2(EXPECTED5, expectedText);
  const result = [];
  for (const name of ["inventoryProjectionDigest", "sortedRecordRows"]) {
    const a = normalizeTransferCorrectionCallable(findFunction9(actual, name));
    const e = normalizeTransferCorrectionCallable(findFunction9(expected, name));
    assert23.deepEqual(a, e, `Complete expected projection-digest equation drifted: ${name}`);
    result.push({ id: `src/integrity.ts#${name}`, equationSha256: sha256(canonicalJson(e)), term: e, completeExpectedTerm: true });
  }
  return result;
}
function equation2(artifact, id) {
  const rows = artifact.semanticCore.equations.filter((row) => row.id === id);
  assert23.equal(rows.length, 1, `Transfer family missing ${id}`);
  return rows[0];
}
function localLaw(artifact, id) {
  const rows = artifact.localLaws.filter((row) => row.id === id);
  assert23.equal(rows.length, 1, `Migration helper family missing ${id}`);
  assert23.equal(rows[0].gaps.length, 0, `${id} still has gaps`);
  return rows[0];
}
function buildFamilyArtifact13({ repositoryRoot = process.cwd(), context = loadEvidenceCompilerContext(repositoryRoot, []), surface = discoverCompilerSurface(repositoryRoot), sourceOverrides = /* @__PURE__ */ new Map() } = {}) {
  const root3 = repositoryRoot;
  assert23.equal(surface.callables.length, 535);
  const transfer = buildFamilyArtifact8({ repositoryRoot: root3, context, surface, sourceOverrides });
  assert23.equal(transfer.proofKind, "inventoryonce-transfer-correction-complete-source-equations-v2");
  assert23.equal(transfer.allAdmittedInputs, true);
  assert23.equal(transfer.sampledInputs, 0);
  const project = equation2(transfer, "src/projection.ts#projectInventoryEvents");
  assert23.equal(project.strengtheningOnly, false);
  const digestEquations = localDigestEquations(root3, sourceOverrides);
  if (sourceOverrides.size > 0) return { mutationControlAccepted: false, project, digestEquations };
  const migration = buildIndependentV9Artifact({ repositoryRoot: root3, context, surface });
  assert23.equal(migration.allAdmittedInputs, true);
  assert23.equal(migration.sampledInputs, 0);
  const shaLaw = localLaw(migration, "src/digest.ts#inventorySha256"), rotateLaw = localLaw(migration, "src/digest.ts#rotateRight");
  const live = new Map(surface.callables.map((row) => [row.key, row]));
  const projectCallable = live.get(supportedSurfaceKeys13[0]), digestCallable = live.get(supportedSurfaceKeys13[1]);
  assert23(projectCallable !== void 0 && digestCallable !== void 0);
  assert23.deepEqual(project.declaration, projectCallable.declaration, "projectInventoryEvents compiler declaration drifted from complete equation");
  const digestPublic = digestEquations.find((row) => row.id === "src/integrity.ts#inventoryProjectionDigest");
  const sortedRows = digestEquations.find((row) => row.id === "src/integrity.ts#sortedRecordRows");
  assert23(digestPublic !== void 0 && sortedRows !== void 0);
  const inputs3 = mergeInputs3([
    input(root3, "experiments/tla-conformance/surface-residual-r8/final-unique8-r9/value-v2/family.mjs"),
    input(root3, EXPECTED5),
    input(root3, "src/integrity.ts"),
    input(root3, "src/projection.ts"),
    input(root3, "src/digest.ts"),
    input(root3, "node_modules/typescript/package.json"),
    ...transfer.inputs ?? [],
    ...migration.inputs ?? []
  ]);
  return { schemaVersion: 1, proofKind: proofKind9, surfaceDigest: surface.digest, domain: "Two universal deterministic value surfaces. projectInventoryEvents reuses the independently specified complete Transfer/Correction replay equation over every internally valid retained history; inventoryProjectionDigest independently specifies every projection-root field and stable key ordering while reusing the complete independently specified SHA-256/rotate laws. No fixtures, callbacks, storage I/O, constructors, native replay, graph replay, or reverse replay.", allAdmittedInputs: true, sampledInputs: 0, inputs: inputs3, proofs: [
    { surfaceKey: supportedSurfaceKeys13[0], signatureHash: projectCallable.signatureHash, declaration: projectCallable.declaration, semantics: { completeExpectedTerm: { id: project.id, lawId: project.lawId, equationSha256: project.equationSha256, declaration: project.declaration }, sourceFamily: { proofKind: transfer.proofKind, domain: transfer.domain }, strengtheningOnly: project.strengtheningOnly } },
    { surfaceKey: supportedSurfaceKeys13[1], signatureHash: digestCallable.signatureHash, declaration: digestCallable.declaration, semantics: { completeExpectedTerm: digestPublic, privateEquations: [sortedRows], shaDependency: { id: shaLaw.id, completeExpectedTerm: shaLaw.completeExpectedTerm, dependencies: shaLaw.dependencies }, rotateDependency: { id: rotateLaw.id, completeExpectedTerm: rotateLaw.completeExpectedTerm }, shaSupportingValues: migration.supportingValues } }
  ] };
}

// experiments/tla-conformance/traceability-apply1-r8/family.mjs
import assert24 from "node:assert/strict";
import fs22 from "node:fs";
import path25 from "node:path";
import { fileURLToPath as fileURLToPath12 } from "node:url";
var DIRECTORY3 = "experiments/tla-conformance/traceability-apply1-r8";
var FAMILY_FILE2 = `${DIRECTORY3}/family.mjs`;
var proofKind10 = "traceability-apply-changes-complete-value-v1";
var supportedSurfaceKeys14 = Object.freeze([
  "export:./kernel#applyInventoryTraceabilityChanges::call[0]"
]);
function rootDir2() {
  return path25.resolve(path25.dirname(fileURLToPath12(import.meta.url)), "../../..");
}
function fileRef2(root3, file, sourceOverrides) {
  const override = sourceOverrides?.get(file);
  const bytes2 = override === void 0 ? fs22.readFileSync(path25.resolve(root3, file)) : Buffer.from(override);
  return { file, sha256: sha256(bytes2) };
}
function buildFamilyArtifact14({ repositoryRoot: root3 = rootDir2(), context, surface, sourceOverrides = /* @__PURE__ */ new Map() } = {}) {
  assert24(context !== void 0 && surface !== void 0);
  assert24.equal(surface.callables.length, 535);
  const upstream = buildTransferCorrectionValueFamily({ repositoryRoot: root3, context, surface, sourceOverrides });
  assert24.equal(upstream.proofKind, "inventoryonce-transfer-correction-complete-source-equations-v2");
  assert24.equal(upstream.allAdmittedInputs, true);
  assert24.equal(upstream.sampledInputs, 0);
  const rows = upstream.semanticCore.equations.filter((row) => row.id === "src/traceability.ts#applyInventoryTraceabilityChanges");
  assert24.equal(rows.length, 1);
  const equation3 = rows[0];
  const callable = surface.callables.find((row) => row.key === supportedSurfaceKeys14[0]);
  assert24(callable !== void 0);
  assert24.deepEqual(callable.declaration, equation3.declaration, "Public traceability callable no longer equals the complete equation declaration.");
  const proof = { surfaceKey: supportedSurfaceKeys14[0], signatureHash: callable.signatureHash, declaration: callable.declaration, equationId: equation3.id, lawId: equation3.lawId, equationSha256: equation3.equationSha256, completeSourceEquation: true };
  const inputs3 = [fileRef2(root3, FAMILY_FILE2, sourceOverrides), ...upstream.inputs].sort((a, b) => a.file.localeCompare(b.file));
  return { schemaVersion: 1, mode: "V", proofKind: proofKind10, family: "TraceabilityApplyChangesV1", surfaceDigest: surface.digest, domain: "Every typed ApplyInventoryTraceabilityChangesInput admitted by the complete deterministic source equation: add/remove/invalidate branches, relation identity, containment parent/cycle checks, genealogy cycle checks, and deterministic containment index rebuild. No finite fixture restriction.", allAdmittedInputs: true, sampledInputs: 0, sourceCallableClosureComplete: true, inputs: inputs3, upstream: { proofKind: upstream.proofKind, artifactSha256: sha256(canonicalJson(upstream)) }, proofs: [proof] };
}

// experiments/tla-conformance/new-source-honest486-r43/value-currentizer.mjs
import assert26 from "node:assert/strict";
import fs24 from "node:fs";
import path27 from "node:path";
import { fileURLToPath as fileURLToPath13 } from "node:url";

// experiments/tla-conformance/new-source-honest486-r43/pinned-irrelevance.mjs
import assert25 from "node:assert/strict";
import { execFileSync as execFileSync3 } from "node:child_process";
import fs23 from "node:fs";
import path26 from "node:path";
var RECEIPT_FILE = "experiments/tla-conformance/new-source-honest486-r43/source-irrelevance.json";
var RECEIPT_SHA256 = "5497f5e926f011fe3404f46f7665619df7950b10529c000f07bbf40fc9baba5b";
var RECEIPT_CONTENT_SHA256 = "ed13e159fa06bc45d6435fb86aa4812be05a6a25741f7e665ee8f5d7a3a19f93";
var OLD = "19676c735dac922b66753fc713d1434bac28ffc9";
var CURRENT_SURFACE = "c151b12edf5aac6fcd1fad6d435c36eae481af153a86888517b851f5da290af3";
var cached;
function bytes(root3, file) {
  return fs23.readFileSync(path26.resolve(root3, file));
}
function git2(root3, args) {
  return execFileSync3("git", args, { cwd: root3, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}
function currentDelta(root3) {
  return git2(root3, ["diff", "--name-only", OLD, "--", "src"]).split(/\r?\n/u).filter(Boolean).sort();
}
function validateReceiptIdentity(receipt) {
  const copy = structuredClone(receipt);
  delete copy.contentSha256;
  assert25.equal(sha256(canonicalJson(copy)), RECEIPT_CONTENT_SHA256, "R43 irrelevance receipt content id changed");
  assert25.equal(receipt.contentSha256, RECEIPT_CONTENT_SHA256);
}
function loadPinnedNewSourceIrrelevance({ repositoryRoot: root3 = process.cwd(), surface } = {}) {
  assert25(surface !== void 0);
  assert25.equal(surface.digest, CURRENT_SURFACE);
  assert25.equal(surface.callables.length, 535);
  const sourceHashes = [sha256(bytes(root3, "src/authority.ts")), sha256(bytes(root3, "src/authority-cutover.ts"))].join(":");
  const cacheKey = `${path26.resolve(root3)}:${surface.digest}:${sourceHashes}`;
  if (cached?.key === cacheKey) {
    for (const ref2 of cached.inputs) assert25.equal(sha256(bytes(root3, ref2.file)), ref2.sha256, `Cached R43 input changed: ${ref2.file}`);
    return cached.value;
  }
  const receiptBytes2 = bytes(root3, RECEIPT_FILE);
  assert25.equal(sha256(receiptBytes2), RECEIPT_SHA256, "Pinned R43 irrelevance receipt changed");
  const receipt = JSON.parse(receiptBytes2.toString("utf8"));
  validateReceiptIdentity(receipt);
  assert25.equal(receipt.status, "PASS");
  assert25.equal(receipt.totalCurrentizableRows, 429);
  assert25.equal(receipt.producerRows, 123);
  assert25.equal(receipt.valueRows, 306);
  assert25.deepEqual(currentDelta(root3), ["src/authority-cutover.ts", "src/authority.ts"]);
  assert25.equal(receipt.changedSource.authority.newSha256, sha256(bytes(root3, "src/authority.ts")));
  assert25.equal(receipt.changedSource.authorityCutover.newSha256, sha256(bytes(root3, "src/authority-cutover.ts")));
  const live = new Map(surface.callables.map((row) => [row.key, row]));
  const unique = /* @__PURE__ */ new Map(), semantic = /* @__PURE__ */ new Map();
  const merge = (map, file, expected, label) => {
    const earlier = map.get(file);
    assert25(earlier === void 0 || earlier.sha256 === expected, `Conflicting R43 ${label} ${file}`);
    map.set(file, { file, sha256: expected });
  };
  const add = (file, expected) => {
    merge(unique, file, expected, "input");
    merge(semantic, file, expected, "semantic input");
  };
  const addSemantic = (file, expected) => merge(semantic, file, expected, "semantic input");
  add(RECEIPT_FILE, RECEIPT_SHA256);
  add(receipt.corrected471.registry.file, receipt.corrected471.registry.sha256);
  add(receipt.corrected471.report.file, receipt.corrected471.report.sha256);
  add("src/authority.ts", receipt.changedSource.authority.newSha256);
  add("src/authority-cutover.ts", receipt.changedSource.authorityCutover.newSha256);
  for (const family of receipt.families) {
    add(family.artifact.file, family.artifact.sha256);
    for (const ref2 of family.reachableFiles) add(ref2.file, ref2.sha256);
    for (const ref2 of family.inheritedCurrentInputs ?? []) addSemantic(ref2.file, ref2.sha256);
    for (const proof of family.proofs) {
      const callable = live.get(proof.surfaceKey);
      assert25(callable !== void 0, `R43 callable missing ${proof.surfaceKey}`);
      assert25.equal(callable.signatureHash, proof.signatureHash, `R43 signature drift ${proof.surfaceKey}`);
      assert25.deepEqual(callable.declaration, proof.declaration, `R43 declaration drift ${proof.surfaceKey}`);
    }
  }
  assert25.equal(receipt.inheritedSemanticInputs?.references, 2418, "R43 total inherited semantic input reference census changed");
  assert25.equal(receipt.inheritedSemanticInputs?.uniqueCurrentFiles, 435, "R43 total inherited semantic input unique-file census changed");
  assert25.equal(receipt.inheritedSemanticInputs?.previouslyOmittedReferences, 1707, "R43 previously omitted semantic input reference census changed");
  assert25.equal(receipt.inheritedSemanticInputs?.previouslyOmittedUniqueFiles, 395, "R43 previously omitted semantic input unique-file census changed");
  assert25.equal(receipt.inheritedSemanticInputs?.changedInputReferences, 14, "R43 reviewed Authority input substitution census changed");
  for (const ref2 of semantic.values()) assert25.equal(sha256(bytes(root3, ref2.file)), ref2.sha256, `R43 pinned semantic input drifted: ${ref2.file}`);
  const inputs3 = [...unique.values()].sort((a, b) => a.file.localeCompare(b.file));
  const semanticInputs4 = [...semantic.values()].sort((a, b) => a.file.localeCompare(b.file));
  const value = { receipt, producerFamilies: receipt.families.filter((f) => f.modeClass === "PRODUCER"), valueFamilies: receipt.families.filter((f) => f.modeClass === "VALUE"), inputs: inputs3, semanticInputs: semanticInputs4 };
  cached = { key: cacheKey, inputs: semanticInputs4, value };
  return value;
}

// experiments/tla-conformance/new-source-honest486-r43/value-currentizer.mjs
var proofKind11 = "r43-currentized-nonauthority-values-306-v2";
var root = path27.resolve(path27.dirname(fileURLToPath13(import.meta.url)), "../../..");
var receiptBytes = fs24.readFileSync(path27.resolve(root, RECEIPT_FILE));
assert26.equal(sha256(receiptBytes), RECEIPT_SHA256);
var staticReceipt = JSON.parse(receiptBytes.toString("utf8"));
var supportedSurfaceKeys15 = Object.freeze(staticReceipt.families.filter((f) => f.modeClass === "VALUE").flatMap((f) => f.proofs.map((p) => p.surfaceKey)).sort((a, b) => a.localeCompare(b)));
assert26.equal(supportedSurfaceKeys15.length, 306);
assert26.equal(new Set(supportedSurfaceKeys15).size, 306);
function ref(repositoryRoot, file) {
  return { file, sha256: sha256(fs24.readFileSync(path27.resolve(repositoryRoot, file))) };
}
function inputs(repositoryRoot, pinned) {
  const map = new Map(pinned.semanticInputs.map((x) => [x.file, x]));
  for (const file of ["experiments/tla-conformance/new-source-honest486-r43/value-currentizer.mjs", "experiments/tla-conformance/new-source-honest486-r43/pinned-irrelevance.mjs", "experiments/tla-conformance/new-source-honest486-r43/source-irrelevance.mjs"]) {
    const value = ref(repositoryRoot, file), prior = map.get(file);
    assert26(prior === void 0 || prior.sha256 === value.sha256);
    map.set(file, value);
  }
  return [...map.values()].sort((a, b) => a.file.localeCompare(b.file));
}
function buildFamilyArtifact15({ repositoryRoot = process.cwd(), surface } = {}) {
  const pinned = loadPinnedNewSourceIrrelevance({ repositoryRoot, surface });
  const live = new Map(surface.callables.map((c) => [c.key, c]));
  const proofs = [];
  for (const family of pinned.valueFamilies) {
    for (const inherited of family.proofs) {
      assert26.equal(inherited.mode, "V");
      const callable = live.get(inherited.surfaceKey);
      assert26(callable !== void 0);
      assert26.equal(callable.signatureHash, inherited.signatureHash);
      assert26.deepEqual(callable.declaration, inherited.declaration);
      proofs.push({ surfaceKey: inherited.surfaceKey, signatureHash: callable.signatureHash, declaration: callable.declaration, inheritedSemanticAuthority: { proofKind: family.proofKind, artifact: family.artifact, closureSha256: family.closureSha256, contentSha256: family.contentSha256, sourceDelta: ["src/authority-cutover.ts", "src/authority.ts"], changedModulesUnreachable: true } });
    }
  }
  proofs.sort((a, b) => a.surfaceKey.localeCompare(b.surfaceKey));
  assert26.deepEqual(proofs.map((p) => p.surfaceKey), supportedSurfaceKeys15);
  return { schemaVersion: 1, proofKind: proofKind11, family: "R43CurrentizedNonAuthorityValues306", surfaceDigest: surface.digest, domain: { kind: "exact-source-irrelevance-currentization", families: pinned.valueFamilies.length, rows: proofs.length, changedModules: ["src/authority-cutover.ts", "src/authority.ts"], rule: "Each old value family was admitted in honest471 and its current callable declaration closure is byte-identical and cannot reach either changed source module." }, allAdmittedInputs: true, sampledInputs: 0, sourceIrrelevance: { file: RECEIPT_FILE, sha256: RECEIPT_SHA256, contentSha256: pinned.receipt.contentSha256 }, semanticInputClosure: { totalCurrentFiles: pinned.semanticInputs.length, inheritedReferences: pinned.receipt.inheritedSemanticInputs.references, previouslyOmittedReferences: pinned.receipt.inheritedSemanticInputs.previouslyOmittedReferences, previouslyOmittedUniqueFiles: pinned.receipt.inheritedSemanticInputs.previouslyOmittedUniqueFiles, validation: "trusted builder re-hashes every semantic input once per compiler/source snapshot; wrapper aliases re-check the content-addressed receipt and compact route inputs" }, inputs: inputs(repositoryRoot, pinned), proofs };
}

// experiments/tla-conformance/authority-values-r40/family.mjs
import assert27 from "node:assert/strict";
import fs25 from "node:fs";
import path28 from "node:path";
var proofKind12 = "authority-result-validators-r36-helper-closed-v3-v1";
var supportedSurfaceKeys16 = Object.freeze([
  "export:.#inventoryAuthorityCutoverResult::call[0]",
  "export:.#inventoryAuthorityGreenfieldResult::call[0]",
  "export:.#requireInventoryAuthorityMode::call[0]"
]);
var directory = "experiments/tla-conformance/authority-values-r40";
var expectedFile3 = `${directory}/equations.expected.ts.txt`;
var oldCanonicalFile = `${directory}/baseline-488/canonical-535.json`;
var oldReportFile = `${directory}/baseline-488/admission-report.json`;
var baseSurfaceDigest = "6a3bdd7dd66a3e352c1dca251d654406a5b25bef3c502c5392785384be5b93c1";
var baseStrict = 488;
var equationSpecs = Object.freeze([
  ["src/authority-cutover.ts", "inventoryAuthorityCutoverResult"],
  ["src/authority-cutover.ts", "inventoryAuthorityGreenfieldResult"],
  ["src/authority-cutover.ts", "assertAuthorityPortStateEnvelope"],
  ["src/authority-cutover.ts", "requireCanonicalCutoverTime"],
  ["src/authority-cutover.ts", "requireCutoverText"],
  ["src/authority-cutover.ts", "requireNonnegativeSafeInteger"],
  ["src/authority-cutover.ts", "requireRetainedCutoverText"],
  ["src/authority.ts", "requireInventoryAuthorityMode"]
]);
var localEdges = Object.freeze([
  "assertAuthorityPortStateEnvelope->requireNonnegativeSafeInteger",
  "assertAuthorityPortStateEnvelope->requireRetainedCutoverText",
  "inventoryAuthorityCutoverResult->assertAuthorityPortStateEnvelope",
  "inventoryAuthorityCutoverResult->requireCanonicalCutoverTime",
  "inventoryAuthorityCutoverResult->requireRetainedCutoverText",
  "inventoryAuthorityGreenfieldResult->assertAuthorityPortStateEnvelope",
  "inventoryAuthorityGreenfieldResult->requireCanonicalCutoverTime",
  "inventoryAuthorityGreenfieldResult->requireRetainedCutoverText",
  "requireCanonicalCutoverTime->requireCutoverText",
  "requireRetainedCutoverText->requireCutoverText"
].sort(compareCodeUnits));
var dependencySpecs = Object.freeze([
  Object.freeze({ surfaceKey: "export:./storage#emptyInventoryWorldState::call[0]", mode: "V" }),
  Object.freeze({ surfaceKey: "export:./storage#inventoryWorldContentRoots::call[0]", mode: "B" })
]);
var baselineEvidenceSnapshots = Object.freeze({
  "experiments/tla-conformance/throughput-r7/evidence/residual-core-v4-values.json": `${directory}/baseline-488/evidence/residual-core-v4-values.json`,
  "experiments/tla-conformance/throughput-r7/evidence/physical-count-producer.json": `${directory}/baseline-488/evidence/physical-count-producer.json`
});
var enumValues3 = Object.freeze({
  InventoryAuthorityMode: Object.freeze({ Legacy: "legacy", Shadow: "shadow", DualRun: "dual-run", Fencing: "fencing", Authoritative: "authoritative" }),
  InventoryAuthorityActivationKind: Object.freeze({ None: "none", LegacyCutover: "legacy-cutover", Greenfield: "greenfield" }),
  InventoryCompatibilityProjectionStatus: Object.freeze({ Current: "current", Lagging: "lagging", Failed: "failed" })
});
var staticInputs = Object.freeze([
  "src/authority-cutover.ts",
  "src/authority.ts",
  "src/world.ts",
  "src/integrity.ts",
  expectedFile3,
  `${directory}/family.mjs`,
  oldCanonicalFile,
  oldReportFile,
  "experiments/tla-conformance/surface-bindings/lib/compiler-surface.mjs",
  "experiments/tla-conformance/throughput-r7/registered-value-family.mjs",
  `${directory}/runtime-deps/typescript/package.json`,
  `${directory}/runtime-deps/typescript/lib/lib.es5.d.ts`,
  `${directory}/runtime-deps/typescript/lib/lib.es2015.core.d.ts`,
  "package.json",
  "tsconfig.json"
]);
var printer2 = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
function readText(root3, file, overrides) {
  return overrides.get(file) ?? fs25.readFileSync(path28.resolve(root3, file), "utf8");
}
function readBytes(root3, file, overrides) {
  const value = overrides.get(file);
  return value === void 0 ? fs25.readFileSync(path28.resolve(root3, file)) : Buffer.from(value);
}
function parse3(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function functions(source7) {
  const out = /* @__PURE__ */ new Map();
  for (const statement of source7.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      assert27(!out.has(statement.name.text), `Duplicate function ${statement.name.text}`);
      out.set(statement.name.text, statement);
    }
  }
  return out;
}
function rendered2(node, source7) {
  return printer2.printNode(ts.EmitHint.Unspecified, node, source7).replaceAll(/\r\n/gu, "\n").trim();
}
function sourceFor(root3, context, file, overrides) {
  if (overrides.has(file)) return parse3(file, readText(root3, file, overrides));
  const source7 = context.program.getSourceFile(path28.resolve(root3, file));
  assert27(source7 && !source7.isDeclarationFile, `Compiler omitted ${file}`);
  assert27.equal(sha256(source7.text), sha256(fs25.readFileSync(path28.resolve(root3, file))), `Compiler snapshot stale ${file}`);
  return source7;
}
function exactEquations(root3, context, overrides) {
  const expected = functions(parse3(expectedFile3, readText(root3, expectedFile3, overrides)));
  const actualByFile = /* @__PURE__ */ new Map();
  const receipts = [];
  for (const [file, name] of equationSpecs) {
    let source7 = actualByFile.get(file);
    if (source7 === void 0) {
      source7 = sourceFor(root3, context, file, overrides);
      actualByFile.set(file, source7);
    }
    const actual = functions(source7).get(name);
    const law = expected.get(name);
    assert27(actual && law, `Missing equation ${name}`);
    const current = rendered2(actual, source7);
    const frozen2 = rendered2(law, law.getSourceFile());
    assert27.equal(current, frozen2, `Complete source equation drifted: ${name}`);
    receipts.push({ id: `${file}#${name}`, equationSha256: sha256(frozen2), completeSource: frozen2 });
  }
  assert27.equal(receipts.length, equationSpecs.length);
  return { receipts, actualByFile };
}
function helperGraph(actualByFile) {
  const selected = new Set(equationSpecs.map(([, name]) => name));
  const edges = [];
  for (const [file, name] of equationSpecs) {
    let walk2 = function(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && selected.has(node.expression.text)) calls.add(node.expression.text);
      ts.forEachChild(node, walk2);
    };
    var walk = walk2;
    const source7 = actualByFile.get(file);
    const fn2 = functions(source7).get(name);
    assert27(fn2?.body);
    const calls = /* @__PURE__ */ new Set();
    walk2(fn2.body);
    for (const target of calls) edges.push(`${name}->${target}`);
  }
  edges.sort(compareCodeUnits);
  assert27.deepEqual(edges, localEdges, "Authority result helper graph drifted");
  return edges;
}
function reachableHelperEdges(rootName, graph) {
  if (rootName === "requireInventoryAuthorityMode") return [];
  const outgoing = /* @__PURE__ */ new Map();
  for (const edge of graph) {
    const [source7, target] = edge.split("->");
    const rows = outgoing.get(source7) ?? [];
    rows.push([edge, target]);
    outgoing.set(source7, rows);
  }
  const seen = /* @__PURE__ */ new Set([rootName]);
  const queue = [rootName];
  const edges = /* @__PURE__ */ new Set();
  for (let i = 0; i < queue.length; i += 1) {
    for (const [edge, target] of outgoing.get(queue[i]) ?? []) {
      edges.add(edge);
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return [...edges].sort(compareCodeUnits);
}
function enumReceipt(root3, context, overrides) {
  const source7 = sourceFor(root3, context, "src/authority.ts", overrides);
  const receipt = {};
  for (const [enumName, expectedMembers] of Object.entries(enumValues3)) {
    const rows = source7.statements.filter((row) => ts.isEnumDeclaration(row) && row.name.text === enumName);
    assert27.equal(rows.length, 1, `Missing enum ${enumName}`);
    const declaration = rows[0];
    const values = {};
    for (const member2 of declaration.members) {
      assert27(ts.isIdentifier(member2.name) && member2.initializer && ts.isStringLiteral(member2.initializer), `Nonliteral ${enumName} member`);
      values[member2.name.text] = member2.initializer.text;
    }
    assert27.deepEqual(values, expectedMembers, `Authority enum semantics drifted: ${enumName}`);
    receipt[enumName] = { values, declaration: spanOf(context, declaration) };
  }
  return receipt;
}
function dependencyCarryForward(root3, surface, overrides) {
  const canonical = JSON.parse(readText(root3, oldCanonicalFile, overrides));
  const report = JSON.parse(readText(root3, oldReportFile, overrides));
  assert27.equal(canonical.surfaceDigest, baseSurfaceDigest);
  assert27.equal(report.surfaceDigest, baseSurfaceDigest);
  assert27.equal(report.status, "CURRENT_STRICT_FAMILY_ADMISSION");
  assert27.equal(report.strictGatePassed, true);
  assert27.equal(report.claimedDiagnostics, 0);
  assert27.equal(report.strictCallables, baseStrict);
  const strict = canonical.rows.filter((row) => row.binding?.mode !== "HARD_RED").length;
  assert27.equal(strict, baseStrict);
  const oldByKey = new Map(canonical.rows.map((row) => [row.callable.key, row]));
  const liveByKey = new Map(surface.callables.map((row) => [row.key, row]));
  const dependencies = [];
  const evidenceFiles = [];
  for (const spec of dependencySpecs) {
    const old = oldByKey.get(spec.surfaceKey);
    const live = liveByKey.get(spec.surfaceKey);
    assert27(old && live, `Dependency missing ${spec.surfaceKey}`);
    assert27.equal(old.binding.mode, spec.mode, `Dependency mode drift ${spec.surfaceKey}`);
    assert27.equal(live.signatureHash, old.callable.signatureHash, `Dependency signature drift ${spec.surfaceKey}`);
    assert27.deepEqual(live.declaration, old.callable.declaration, `Dependency declaration drift ${spec.surfaceKey}`);
    const sourceBytes = readBytes(root3, live.declaration.file, overrides);
    assert27.equal(sha256(sourceBytes), live.declaration.sourceHash, `Dependency source drift ${spec.surfaceKey}`);
    assert27(old.binding.evidence?.file && old.binding.evidence?.sha256, `Dependency evidence missing ${spec.surfaceKey}`);
    const snapshotFile = baselineEvidenceSnapshots[old.binding.evidence.file];
    assert27(snapshotFile !== void 0, `Dependency baseline snapshot missing ${spec.surfaceKey}`);
    assert27.equal(
      sha256(readBytes(root3, snapshotFile, overrides)),
      old.binding.evidence.sha256,
      `Dependency baseline evidence bytes drift ${spec.surfaceKey}`
    );
    evidenceFiles.push(snapshotFile);
    dependencies.push({
      surfaceKey: spec.surfaceKey,
      mode: spec.mode,
      signatureHash: live.signatureHash,
      declaration: live.declaration,
      admittedEvidence: old.binding.evidence,
      baselineEvidenceSnapshot: { file: snapshotFile, sha256: old.binding.evidence.sha256 }
    });
  }
  return { receipt: { kind: "CURRENT488_STRICT_SOURCE_UNCHANGED_CARRY_FORWARD", baseSurfaceDigest, baseStrictCallables: baseStrict, candidateSurfaceDigest: surface.digest, dependencies }, evidenceFiles };
}
function packageDependencyCalls(context, surface) {
  const source7 = context.program.getSourceFile(path28.resolve(context.repositoryRoot, "src/authority-cutover.ts"));
  assert27(source7);
  const green = functions(source7).get("inventoryAuthorityGreenfieldResult");
  assert27(green?.body);
  const expected = new Map(dependencySpecs.map((row) => [row.surfaceKey.split("#")[1].split("::")[0], row.surfaceKey]));
  const live = new Map(surface.callables.map((row) => [row.key, row]));
  const receipts = [];
  function walk(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && expected.has(node.expression.text)) {
      let symbol = context.checker.getSymbolAtLocation(node.expression);
      assert27(symbol);
      if (symbol.flags & ts.SymbolFlags.Alias) symbol = context.checker.getAliasedSymbol(symbol);
      const declarations = symbol.declarations ?? [];
      assert27.equal(declarations.length, 1, `Ambiguous dependency call ${node.expression.text}`);
      const target = live.get(expected.get(node.expression.text));
      assert27(target);
      assert27.deepEqual(spanOf(context, declarations[0]), target.declaration, `Dependency call target drift ${node.expression.text}`);
      receipts.push({ call: node.expression.text, surfaceKey: target.key, targetDeclaration: target.declaration });
    }
    ts.forEachChild(node, walk);
  }
  walk(green.body);
  receipts.sort((a, b) => compareCodeUnits(a.surfaceKey, b.surfaceKey));
  assert27.deepEqual(receipts.map((x) => x.surfaceKey), dependencySpecs.map((x) => x.surfaceKey).sort(compareCodeUnits));
  return receipts;
}
function inputRefs(root3, files, overrides) {
  return [...new Set(files)].sort(compareCodeUnits).map((file) => ({ file, sha256: sha256(readBytes(root3, file, overrides)) }));
}
function assertRuntimeTypeScript(root3, overrides) {
  const pairs = [
    ["node_modules/typescript/package.json", `${directory}/runtime-deps/typescript/package.json`],
    ["node_modules/typescript/lib/lib.es5.d.ts", `${directory}/runtime-deps/typescript/lib/lib.es5.d.ts`],
    ["node_modules/typescript/lib/lib.es2015.core.d.ts", `${directory}/runtime-deps/typescript/lib/lib.es2015.core.d.ts`]
  ];
  const receipts = [];
  for (const [runtimeFile, snapshotFile] of pairs) {
    const runtime = fs25.readFileSync(path28.resolve(root3, runtimeFile));
    const snapshot = readBytes(root3, snapshotFile, overrides);
    assert27.equal(sha256(runtime), sha256(snapshot), `TypeScript runtime differs from reviewed snapshot: ${runtimeFile}`);
    receipts.push({ runtimeFile, snapshotFile, sha256: sha256(snapshot) });
  }
  return receipts;
}
function buildFamilyArtifact16({ repositoryRoot, context, surface, sourceOverrides = /* @__PURE__ */ new Map() }) {
  const root3 = path28.resolve(repositoryRoot);
  assert27.equal(path28.resolve(context.repositoryRoot), root3);
  const runtimeTypeScript = assertRuntimeTypeScript(root3, sourceOverrides);
  const equations2 = exactEquations(root3, context, sourceOverrides);
  const graph = helperGraph(equations2.actualByFile);
  const enums = enumReceipt(root3, context, sourceOverrides);
  const dependency2 = dependencyCarryForward(root3, surface, sourceOverrides);
  const calls = packageDependencyCalls(context, surface);
  const live = new Map(surface.callables.map((row) => [row.key, row]));
  const eqByName = new Map(equations2.receipts.map((row) => [row.id.split("#")[1], row]));
  const proofs = supportedSurfaceKeys16.map((surfaceKey) => {
    const callable = live.get(surfaceKey);
    assert27(callable, `Missing public Authority value ${surfaceKey}`);
    const name = surfaceKey.split("#")[1].split("::")[0];
    return {
      surfaceKey,
      signatureHash: callable.signatureHash,
      declaration: callable.declaration,
      completeEquation: eqByName.get(name),
      helperClosure: reachableHelperEdges(name, graph),
      runtimeEnums: enums,
      strictDependencies: name === "inventoryAuthorityGreenfieldResult" ? dependency2.receipt.dependencies : []
    };
  });
  const files = [...staticInputs, ...dependency2.evidenceFiles];
  return {
    schemaVersion: 1,
    proofKind: proofKind12,
    mode: "V",
    surfaceDigest: surface.digest,
    sourceBase: "63ce2175855315782abbedb48a2b532b42b57734",
    allAdmittedInputs: true,
    sampledInputs: 0,
    domain: {
      state: "All plain immutable InventoryAuthorityState-shaped records with native string/number/array values and no proxies/accessors/concurrent mutation during one synchronous validator call.",
      native: "Native ECMAScript Date, Number.isFinite, Number.isSafeInteger, String.trim, Error and ordinary property access as pinned by the installed TypeScript standard-library declarations.",
      dependencies: "Canonical empty Inventory world construction and world-content-root projection are carried from exact current488 strict rows only because their compiler signatures/declarations/source bytes and evidence bytes are unchanged on this candidate surface."
    },
    equations: equations2.receipts,
    helperGraph: graph,
    packageDependencyCalls: calls,
    dependencyCarryForward: dependency2.receipt,
    runtimeEnums: enums,
    runtimeTypeScript,
    inputs: inputRefs(root3, files, sourceOverrides),
    proofs
  };
}

// experiments/tla-conformance/throughput-r7/registered-families.mjs
import assert38 from "node:assert/strict";
import fs35 from "node:fs";
import path38 from "node:path";
import { fileURLToPath as fileURLToPath15 } from "node:url";

// experiments/tla-conformance/migration-helper-causal-r7/registered-value-family.mjs
import assert28 from "node:assert/strict";
import fs26 from "node:fs";
import path29 from "node:path";
var proofKind13 = "migration-plugin-helper-independent-source-closed-values-v3";
var supportedSurfaceKeys17 = [
  "export:./migrations#defineInventoryLegacyQuery::call[0]",
  "export:./migrations#defineInventoryMigrationPlugin::call[0]",
  "export:./migrations#defineInventoryMigrationSourcePlugin::call[0]",
  "export:./migrations#inventoryMigrationProblem::call[0]",
  "export:./storage#inventoryDurableMigrationPlanDigest::call[0]",
  "export:./storage#validateInventoryMigrationManifestBeginInput::call[0]"
];
function checkBindingsAndEnums(repositoryRoot, context, independent) {
  const source7 = context.program.getSourceFile(path29.resolve(repositoryRoot, "src/migrations.ts"));
  assert28(source7 !== void 0);
  for (const [owner, member2, value] of [["InventoryMigrationDiagnosticSeverity", "Error", "error"], ["InventoryMigrationDiagnosticCode", "AmbiguousLegacyMeaning", "ambiguous-legacy-meaning"]]) {
    const enums = source7.statements.filter((node) => ts.isEnumDeclaration(node) && node.name.text === owner);
    assert28.equal(enums.length, 1);
    const members = enums[0].members.filter((node) => node.name.getText(source7) === member2);
    assert28.equal(members.length, 1);
    assert28(ts.isStringLiteral(members[0].initializer));
    assert28.equal(members[0].initializer.text, value, `Independent enum law changed: ${owner}.${member2}`);
  }
  const visited = /* @__PURE__ */ new Set();
  for (const row of [...independent.proofs, ...independent.localLaws]) {
    let inspect2 = function(node) {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const target = context.checker.getResolvedSignature(node)?.declaration;
        assert28(target !== void 0, `Unresolved semantic call: ${node.getText()}`);
        if (target.getSourceFile().isDeclarationFile) {
          assert28(/[/\\]typescript[/\\]lib[/\\]lib\.[^/\\]+\.d\.ts$/u.test(target.getSourceFile().fileName), "Only immutable standard-library effects may be assumed.");
        } else {
          assert28(ts.isFunctionDeclaration(target) || ts.isArrowFunction(target) || ts.isFunctionExpression(target), "Unexpected source callback/constructor.");
        }
      }
      if (ts.isPropertyAccessExpression(node)) {
        const symbol = context.checker.getSymbolAtLocation(node.name);
        assert28(!(symbol?.declarations ?? []).some((candidate) => ts.isGetAccessorDeclaration(candidate) || ts.isSetAccessorDeclaration(candidate)), "Accessor-bearing data requires an explicit effect proof.");
      }
      ts.forEachChild(node, inspect2);
    };
    var inspect = inspect2;
    const span = row.completeExpectedTerm.implementation;
    const source8 = context.program.getSourceFile(path29.resolve(repositoryRoot, span.file));
    const declaration = nodeAtExactSpan(source8, span.start.offset, span.end.offset);
    assert28(declaration !== void 0 && ts.isFunctionDeclaration(declaration));
    if (visited.has(declaration)) continue;
    visited.add(declaration);
    inspect2(declaration.body);
  }
}
function buildFamilyArtifact17({ repositoryRoot, context, surface }) {
  const independent = buildIndependentV9Artifact({ repositoryRoot, context, surface });
  const additiveClosed = [...supportedSurfaceKeys17, "export:./migrations#inventoryMigrationPositionsMatch::call[0]"].sort();
  assert28.deepEqual([...independent.disposition.independentlyClosed].sort(), additiveClosed, "Independent helper closure changed outside the reviewed additive frontier.");
  for (const surfaceKey of supportedSurfaceKeys17) assert28(independent.disposition.independentlyClosed.includes(surfaceKey), `Existing V6 proof disappeared: ${surfaceKey}`);
  checkBindingsAndEnums(repositoryRoot, context, independent);
  const publicByKey = new Map(surface.callables.map((row) => [row.key, row]));
  const proofByKey = new Map(independent.proofs.map((row) => [row.surfaceKey, row]));
  const proofs = supportedSurfaceKeys17.map((surfaceKey) => {
    const callable = publicByKey.get(surfaceKey), proved = proofByKey.get(surfaceKey);
    assert28(callable !== void 0 && proved !== void 0);
    assert28.equal(proved.status, "INDEPENDENTLY_CLOSED");
    assert28.deepEqual(callable.declaration, proved.completeExpectedTerm.implementation, "The proof must resolve the exact public implementation, not a same-name function.");
    return {
      surfaceKey,
      signatureHash: callable.signatureHash,
      declaration: callable.declaration,
      completeExpectedTerm: proved.completeExpectedTerm,
      dependencies: proved.dependencies
    };
  });
  const inputs3 = /* @__PURE__ */ new Map();
  function input2(file) {
    const actual = sha256(fs26.readFileSync(path29.resolve(repositoryRoot, file))), prior = inputs3.get(file);
    assert28(prior === void 0 || prior.sha256 === actual, `Conflicting proof identity: ${file}`);
    inputs3.set(file, { file, sha256: actual });
  }
  for (const file of fs26.readdirSync(path29.resolve(repositoryRoot, "src"))) if (file.endsWith(".ts")) input2(`src/${file}`);
  for (const file of ["v9.expected.ts.txt", "independent-v9-laws.mjs", "registered-value-family.mjs", "artifacts/runtime-causal.json", "import-source-receipt.json"]) input2(`experiments/tla-conformance/migration-helper-causal-r7/${file}`);
  input2("experiments/tla-conformance/admission-audit/bank-current/canonical-535.json");
  return {
    schemaVersion: 1,
    proofKind: proofKind13,
    surfaceDigest: surface.digest,
    allAdmittedInputs: true,
    sampledInputs: 0,
    domain: "Declared immutable plain TypeScript inputs and unmodified built-ins. Six pure identity/diagnostic/digest/manifest-validation functions; callback reads, arbitrary migration execution, storage publication, and world materialization are excluded.",
    inputs: [...inputs3.values()].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
    independentSpecification: independent.expectedSpecification,
    independentDependencies: independent.independentDependencies,
    localLaws: independent.localLaws,
    supportingValues: independent.supportingValues,
    excluded: independent.disposition.blocked,
    proofs
  };
}

// experiments/tla-conformance/migration-helper-causal-r7/registered-frontier-v2-family.mjs
import assert31 from "node:assert/strict";
import fs28 from "node:fs";
import path31 from "node:path";

// experiments/tla-conformance/migration-helper-causal-r7/registered-causal-b4-family.mjs
import assert30 from "node:assert/strict";
import fs27 from "node:fs";
import path30 from "node:path";

// experiments/tla-conformance/migration-helper-causal-r7/causal-runtime-verifier.mjs
import assert29 from "node:assert/strict";
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function verifyQueryRun(run, expectedEntrypoint) {
  assert29.equal(run.entrypoint, expectedEntrypoint);
  assert29.equal(run.sourceBefore.readCount, 0);
  assert29.equal(run.sourceBefore.lastCursor, null);
  assert29(Array.isArray(run.transitions) && run.transitions.length > 0);
  const rows = [];
  let cursor;
  for (let index = 0; index < run.transitions.length; index += 1) {
    const t = run.transitions[index];
    assert29.equal(t.causeId, `${run.runId}/page/${index}`);
    assert29.equal(t.queryId, run.queryId);
    assert29.equal(t.callIndex, index);
    assert29.equal(t.input.limit, run.pageSize);
    assert29.equal(t.input.cursor, cursor);
    assert29.equal(t.preState.readCount, index);
    assert29.equal(t.postState.readCount, index + 1);
    if (index > 0) assert29(same(t.preState, run.transitions[index - 1].postState));
    rows.push(...t.returnedRows);
    cursor = t.nextCursor === null ? void 0 : t.nextCursor;
  }
  const last = run.transitions.at(-1);
  assert29.equal(last.nextCursor, null);
  assert29(same(last.postState, run.sourceAfter));
  assert29(same(rows, run.resultRows));
}
function verifyPlugin(plan, expectedInvocation) {
  assert29.equal(plan.invocationId, expectedInvocation);
  verifyQueryRun(plan.queryRun, "InventoryLegacyQueryReader.readAll");
  assert29.deepEqual(plan.callbackObservedRowIds, plan.queryRun.resultRows.map((row) => row.id));
  assert29.equal(plan.callbackReturnedMigrationId, plan.resultMigrationId);
  assert29.equal(plan.resultOperationIds.length, plan.callbackObservedRowIds.length);
  assert29.equal(typeof plan.resultPlanDigest, "string");
  assert29(plan.resultPlanDigest.length > 0);
}
function verifyCausalB4Runtime(document) {
  assert29.equal(document.schemaVersion, 1);
  assert29.equal(document.proofKind, "migration-plugin-helper-causal-runtime-v1");
  verifyQueryRun(document.directRead, "readAllInventoryLegacyQuery");
  verifyQueryRun(document.readerRead, "InventoryLegacyQueryReader.readAll");
  verifyPlugin(document.pluginPlan, "ordinary-plugin-plan");
  verifyPlugin(document.sourcePluginPlan, "source-plugin-plan");
  assert29(document.disabledDomain.zeroPageSizeRejected);
  assert29(document.disabledDomain.repeatedCursorRejected);
  assert29(document.disabledDomain.emptyCursorRejected);
  assert29(document.disabledDomain.rowBoundRejected);
  return true;
}

// experiments/tla-conformance/migration-helper-causal-r7/registered-causal-b4-family.mjs
var proofKind14 = "migration-plugin-helper-causal-b4-producer-v1";
var supportedSurfaceRows = Object.freeze([
  { surfaceKey: "export:./migrations#createInventoryMigrationPlanFromPlugin::call[0]", mode: "B" },
  { surfaceKey: "export:./migrations#createInventoryMigrationPlanFromSourcePlugin::call[0]", mode: "B" },
  { surfaceKey: "export:./migrations#readAllInventoryLegacyQuery::call[0]", mode: "B" },
  { surfaceKey: "type:src/migration-plugin.ts#InventoryLegacyQueryReader.readAll::call[0]", mode: "B" }
]);
var SOURCE = "src/migration-plugin.ts";
var EXPECTED6 = "experiments/tla-conformance/migration-helper-causal-r7/b4.expected.ts.txt";
var CAUSAL = "experiments/tla-conformance/migration-helper-causal-r7/artifacts/runtime-causal.json";
var CAUSAL_VERIFIER = "experiments/tla-conformance/migration-helper-causal-r7/causal-runtime-verifier.mjs";
var OLD_BANK = "experiments/tla-conformance/admission-audit/bank-current/canonical-535.json";
var currentBuildCache;
var laws = Object.freeze({
  "export:./migrations#readAllInventoryLegacyQuery::call[0]": "Validate positive safe bounds, repeatedly invoke the actual application query.readPage with exact cursor/limit, append callback rows in order, reject overflow/empty/repeated cursor/page exhaustion, and return only the callback-caused complete row sequence.",
  "type:src/migration-plugin.ts#InventoryLegacyQueryReader.readAll::call[0]": "The factory-created reader delegates its exact query and captured options to readAllInventoryLegacyQuery; it does not reconstruct callback rows or detached source state.",
  "export:./migrations#createInventoryMigrationPlanFromPlugin::call[0]": "Invoke the actual plugin.createDeclaration with the real bounded reader, then pass exactly that returned declaration and the supplied catalog into strict defineInventoryMigration; the returned plan is caused by the callback result.",
  "export:./migrations#createInventoryMigrationPlanFromSourcePlugin::call[0]": "Invoke the actual plugin.createBundle with the real bounded reader, return the callback-provided catalog, and compile exactly the callback-provided declaration against that catalog through strict defineInventoryMigration."
});
function scanTokens3(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const result = [];
  for (; ; ) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    result.push([ts.SyntaxKind[kind], scanner.getTokenText()]);
  }
  return result;
}
function currentSource2(repositoryRoot, context, overrides) {
  const replacement = overrides.get(SOURCE);
  if (replacement !== void 0) return ts.createSourceFile(path30.resolve(repositoryRoot, SOURCE), replacement, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const source7 = context.program.getSourceFile(path30.resolve(repositoryRoot, SOURCE));
  assert30(source7 !== void 0 && !source7.isDeclarationFile);
  return source7;
}
function findFunction10(source7, name) {
  const rows = source7.statements.filter((row) => ts.isFunctionDeclaration(row) && row.name?.text === name);
  assert30.equal(rows.length, 1, `Expected one function ${name}`);
  assert30(rows[0].body !== void 0);
  return rows[0];
}
function findExpectedArrow(source7) {
  for (const statement of source7.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === "expectedInventoryLegacyQueryReaderReadAll") {
        assert30(ts.isArrowFunction(declaration.initializer));
        return declaration.initializer;
      }
    }
  }
  throw new Error("Expected reader arrow missing.");
}
function findActualReaderArrow(source7) {
  const factory = findFunction10(source7, "createInventoryLegacyQueryReader");
  let found;
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source7) === "readAll" && ts.isArrowFunction(node.initializer)) {
      assert30.equal(found, void 0, "Ambiguous reader.readAll implementation");
      found = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(factory.body);
  assert30(found !== void 0, "reader.readAll implementation missing");
  return found;
}
function callableTerm(node, source7) {
  return scanTokens3(node.getText(source7));
}
function expectedDocument(repositoryRoot) {
  const file = path30.resolve(repositoryRoot, EXPECTED6);
  const text = fs27.readFileSync(file, "utf8");
  return { file: EXPECTED6, source: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) };
}
function assertExpectedFunction(actualSource, expectedSource3, name) {
  const actual = findFunction10(actualSource, name);
  const expected = findFunction10(expectedSource3, name);
  const actualTerm = callableTerm(actual, actualSource);
  const expectedTerm = callableTerm(expected, expectedSource3);
  assert30.deepEqual(actualTerm, expectedTerm, `Complete expected B term mismatch: ${name}`);
  return { actual, termSha256: sha256(canonicalJson(actualTerm)) };
}
function assertExpectedReaderArrow(actualSource, expectedSource3) {
  const actual = findActualReaderArrow(actualSource);
  const expected = findExpectedArrow(expectedSource3);
  const a = callableTerm(actual, actualSource);
  const e = callableTerm(expected, expectedSource3);
  assert30.deepEqual(a, e, "Complete expected reader.readAll arrow mismatch");
  return { actual, termSha256: sha256(canonicalJson(a)) };
}
function strictDefineReceipt(repositoryRoot, context, surface) {
  const bank = JSON.parse(fs27.readFileSync(path30.resolve(repositoryRoot, OLD_BANK), "utf8"));
  const key = "export:./migrations#defineInventoryMigration::call[0]";
  const row = bank.rows.find((candidate) => candidate.callable.key === key);
  assert30(row !== void 0 && row.binding.mode !== "HARD_RED");
  const live = surface.callables.find((candidate) => candidate.key === key);
  assert30(live !== void 0);
  assert30.equal(live.signatureHash, row.callable.signatureHash);
  assert30.deepEqual(live.declaration, row.callable.declaration);
  const execution = row.binding.execution;
  assert30(execution !== void 0);
  const bytes2 = fs27.readFileSync(path30.resolve(repositoryRoot, execution.file));
  assert30.equal(sha256(bytes2), execution.sha256);
  const source7 = context.program.getSourceFile(path30.resolve(repositoryRoot, live.declaration.file));
  assert30(source7 !== void 0);
  return { surfaceKey: key, mode: row.binding.mode, execution, declaration: live.declaration, signatureHash: live.signatureHash };
}
function causalReceipt(repositoryRoot) {
  const bytes2 = fs27.readFileSync(path30.resolve(repositoryRoot, CAUSAL));
  const document = JSON.parse(bytes2.toString("utf8"));
  assert30.equal(verifyCausalB4Runtime(document), true);
  return { file: CAUSAL, sha256: sha256(bytes2), proofKind: document.proofKind, document };
}
function addInput5(repositoryRoot, inputs3, file) {
  if (inputs3.has(file)) return;
  inputs3.set(file, { file, sha256: sha256(fs27.readFileSync(path30.resolve(repositoryRoot, file))) });
}
function buildSemanticCore({ repositoryRoot, context, surface, sourceOverrides = /* @__PURE__ */ new Map() }) {
  const source7 = currentSource2(repositoryRoot, context, sourceOverrides);
  const expected = expectedDocument(repositoryRoot);
  const helper = assertExpectedFunction(source7, expected.source, "assertPositiveSafeInteger");
  const readAll = assertExpectedFunction(source7, expected.source, "readAllInventoryLegacyQuery");
  const ordinary = assertExpectedFunction(source7, expected.source, "createInventoryMigrationPlanFromPlugin");
  const sourcePlugin = assertExpectedFunction(source7, expected.source, "createInventoryMigrationPlanFromSourcePlugin");
  const reader = assertExpectedReaderArrow(source7, expected.source);
  if (sourceOverrides.size > 0) return { mutationControlAccepted: false };
  const v9 = buildIndependentV9Artifact({ repositoryRoot, context, surface });
  const factory = v9.proofs.find((proof) => proof.surfaceKey === "export:./migrations#createInventoryLegacyQueryReader::call[0]");
  assert30(factory !== void 0 && factory.status === "READY_WITH_PAIRED_B_DEPENDENCY");
  const strictDefine = strictDefineReceipt(repositoryRoot, context, surface);
  const causal = causalReceipt(repositoryRoot);
  const live = new Map(surface.callables.map((callable) => [callable.key, callable]));
  const terms = /* @__PURE__ */ new Map([
    ["export:./migrations#readAllInventoryLegacyQuery::call[0]", { termSha256: readAll.termSha256, implementation: spanOf(context, readAll.actual), dependency: { local: "assertPositiveSafeInteger", termSha256: helper.termSha256 }, externalBoundary: "InventoryLegacyQuery.readPage", causalMember: "directRead" }],
    ["type:src/migration-plugin.ts#InventoryLegacyQueryReader.readAll::call[0]", { termSha256: reader.termSha256, implementation: spanOf(context, reader.actual), dependency: { sameFamily: "export:./migrations#readAllInventoryLegacyQuery::call[0]", factoryExpectedTerm: factory.completeExpectedTerm }, externalBoundary: null, causalMember: "readerRead" }],
    ["export:./migrations#createInventoryMigrationPlanFromPlugin::call[0]", { termSha256: ordinary.termSha256, implementation: spanOf(context, ordinary.actual), dependencies: [{ supportingV: "export:./migrations#createInventoryLegacyQueryReader::call[0]", factoryExpectedTerm: factory.completeExpectedTerm }, { strictProducer: strictDefine }], externalBoundary: "InventoryMigrationPlugin.createDeclaration", causalMember: "pluginPlan" }],
    ["export:./migrations#createInventoryMigrationPlanFromSourcePlugin::call[0]", { termSha256: sourcePlugin.termSha256, implementation: spanOf(context, sourcePlugin.actual), dependencies: [{ supportingV: "export:./migrations#createInventoryLegacyQueryReader::call[0]", factoryExpectedTerm: factory.completeExpectedTerm }, { strictProducer: strictDefine }], externalBoundary: "InventoryMigrationSourcePlugin.createBundle", causalMember: "sourcePluginPlan" }]
  ]);
  const proofs = supportedSurfaceRows.map(({ surfaceKey, mode }) => {
    const callable = live.get(surfaceKey);
    assert30(callable !== void 0, `Surface missing ${surfaceKey}`);
    const semantics = terms.get(surfaceKey);
    assert30(semantics !== void 0);
    return { surfaceKey, mode, signatureHash: callable.signatureHash, declaration: callable.declaration, law: laws[surfaceKey], semantics, causalEvidence: { file: causal.file, sha256: causal.sha256, member: semantics.causalMember } };
  });
  return { proofs, strictDefine, causal: { file: causal.file, sha256: causal.sha256, proofKind: causal.proofKind }, supportingFactory: factory };
}
function buildFamilyArtifact18({ repositoryRoot = process.cwd(), context = loadEvidenceCompilerContext(repositoryRoot, []), surface = discoverCompilerSurface(repositoryRoot), sourceOverrides = /* @__PURE__ */ new Map() } = {}) {
  if (sourceOverrides.size === 0 && currentBuildCache?.surfaceDigest === surface.digest) {
    for (const input2 of currentBuildCache.artifact.inputs) {
      const actual = sha256(fs27.readFileSync(path30.resolve(repositoryRoot, input2.file)));
      assert30.equal(actual, input2.sha256, `Cached B4 input changed: ${input2.file}`);
      if (input2.file.startsWith("src/") && input2.file.endsWith(".ts")) {
        const source7 = context.program.getSourceFile(path30.resolve(repositoryRoot, input2.file));
        assert30(source7 !== void 0, `Compiler omitted cached B4 source: ${input2.file}`);
        assert30.equal(sha256(source7.text), input2.sha256, `Compiler snapshot is stale: ${input2.file}`);
      }
    }
    return currentBuildCache.artifact;
  }
  const core = buildSemanticCore({ repositoryRoot, context, surface, sourceOverrides });
  if (sourceOverrides.size > 0) return core;
  const inputs3 = /* @__PURE__ */ new Map();
  for (const file of [SOURCE, EXPECTED6, CAUSAL, CAUSAL_VERIFIER, "experiments/tla-conformance/migration-helper-causal-r7/registered-causal-b4-family.mjs", "experiments/tla-conformance/migration-helper-causal-r7/independent-v9-laws.mjs", "experiments/tla-conformance/migration-helper-causal-r7/v9.expected.ts.txt", "experiments/tla-conformance/migration-helper-causal-r7/causal-runtime.ts", OLD_BANK]) addInput5(repositoryRoot, inputs3, file);
  addInput5(repositoryRoot, inputs3, core.strictDefine.execution.file);
  addInput5(repositoryRoot, inputs3, core.strictDefine.declaration.file);
  const artifact = {
    schemaVersion: 1,
    route: "REGISTERED_CERTIFIED_PRODUCER",
    proofKind: proofKind14,
    family: "MigrationPluginHelpersCausalB4",
    surfaceDigest: surface.digest,
    domain: "All values admitted by the exact four public TypeScript signatures. Application-owned readPage/createDeclaration/createBundle callbacks remain explicit typed external boundaries; the complete InventoryOnce-owned control flow is independently term-checked, while retained real callback chains establish causal source association without inventing formal Snapshot edges.",
    allAdmittedInputs: true,
    sampledInputs: 0,
    causalWitnessRuns: 4,
    producerGraphRuns: 0,
    producerReplayRuns: 0,
    inputs: [...inputs3.values()].sort((a, b) => a.file.localeCompare(b.file)),
    causalEvidence: core.causal,
    proofs: core.proofs
  };
  currentBuildCache = { surfaceDigest: surface.digest, artifact };
  return artifact;
}

// experiments/tla-conformance/migration-helper-causal-r7/registered-frontier-v2-family.mjs
var proofKind15 = "migration-plugin-helper-frontier-v2-values-v3";
var supportedSurfaceKeys18 = Object.freeze([
  "export:./migrations#createInventoryLegacyQueryReader::call[0]",
  "export:./migrations#inventoryMigrationPositionsMatch::call[0]"
]);
var B4_FILE = "experiments/tla-conformance/migration-helper-causal-r7/artifacts/causal-b4-producer.json";
function addInput6(repositoryRoot, inputs3, file) {
  if (inputs3.has(file)) return;
  inputs3.set(file, { file, sha256: sha256(fs28.readFileSync(path31.resolve(repositoryRoot, file))) });
}
function buildFamilyArtifact19({ repositoryRoot, context, surface }) {
  const independent = buildIndependentV9Artifact({ repositoryRoot, context, surface });
  const byKey = new Map(independent.proofs.map((proof) => [proof.surfaceKey, proof]));
  const live = new Map(surface.callables.map((callable) => [callable.key, callable]));
  const b4 = buildFamilyArtifact18({ repositoryRoot, context, surface });
  assert31.equal(b4.proofs.length, 4);
  assert31(b4.proofs.every((proof) => proof.mode === "B"));
  const b4Bytes = fs28.readFileSync(path31.resolve(repositoryRoot, B4_FILE));
  assert31.equal(canonicalJson(JSON.parse(b4Bytes.toString("utf8"))), canonicalJson(b4), "Persisted B4 dependency differs from current causal truth");
  const b4Receipt = { file: B4_FILE, sha256: sha256(b4Bytes), proofKind: b4.proofKind, rows: b4.proofs.map(({ surfaceKey, mode }) => ({ surfaceKey, mode })) };
  const proofs = supportedSurfaceKeys18.map((surfaceKey) => {
    const sourceProof = byKey.get(surfaceKey);
    assert31(sourceProof !== void 0, `Independent proof missing ${surfaceKey}`);
    if (surfaceKey.endsWith("#createInventoryLegacyQueryReader::call[0]")) {
      assert31.equal(sourceProof.status, "READY_WITH_PAIRED_B_DEPENDENCY");
    } else {
      assert31.equal(sourceProof.status, "INDEPENDENTLY_CLOSED");
    }
    const callable = live.get(surfaceKey);
    assert31(callable !== void 0);
    return {
      surfaceKey,
      signatureHash: callable.signatureHash,
      declaration: callable.declaration,
      semantics: {
        completeExpectedTerm: sourceProof.completeExpectedTerm,
        dependencies: sourceProof.dependencies,
        status: surfaceKey.endsWith("#createInventoryLegacyQueryReader::call[0]") ? "INDEPENDENTLY_CLOSED_WITH_CAUSAL_B4_DEPENDENCY" : "INDEPENDENTLY_CLOSED",
        ...surfaceKey.endsWith("#createInventoryLegacyQueryReader::call[0]") ? { causalB4Dependency: b4Receipt } : {}
      }
    };
  });
  const inputs3 = /* @__PURE__ */ new Map();
  for (const input2 of b4.inputs) inputs3.set(input2.file, input2);
  for (const file of [
    "experiments/tla-conformance/migration-helper-causal-r7/independent-v9-laws.mjs",
    "experiments/tla-conformance/migration-helper-causal-r7/v9.expected.ts.txt",
    "experiments/tla-conformance/migration-helper-causal-r7/registered-frontier-v2-family.mjs",
    B4_FILE
  ]) addInput6(repositoryRoot, inputs3, file);
  for (const name of fs28.readdirSync(path31.resolve(repositoryRoot, "src")).filter((name2) => name2.endsWith(".ts")).sort()) addInput6(repositoryRoot, inputs3, `src/${name}`);
  addInput6(repositoryRoot, inputs3, "node_modules/typescript/package.json");
  return {
    schemaVersion: 1,
    proofKind: proofKind15,
    surfaceDigest: surface.digest,
    domain: "Exactly the two still-red MigrationPluginHelpers V frontier rows: positionsMatch is independently complete-source closed; the reader factory is independently complete-source closed with its exact readAll callback dependency discharged by the same current causal B4 producer family.",
    allAdmittedInputs: true,
    sampledInputs: 0,
    inputs: [...inputs3.values()].sort((a, b) => a.file.localeCompare(b.file)),
    causalB4Dependency: b4Receipt,
    proofs
  };
}

// experiments/tla-conformance/authority-r5/catalog-read-dependency-closure-certificate.mjs
import assert32 from "node:assert/strict";
import fs29 from "node:fs";
import path32 from "node:path";
import { fileURLToPath as fileURLToPath14 } from "node:url";

// experiments/tla-conformance/authority-r5/catalog-read-dependency-closure-contracts.mjs
var CATALOG_READ_CLEAN_HUB_COMMIT = "2eea09471b3bf8fcb61f38256e1c6a362149dad4";
var CATALOG_READ_OFFICIAL_SURFACE_DIGEST = "6a3bdd7dd66a3e352c1dca251d654406a5b25bef3c502c5392785384be5b93c1";
var CATALOG_READ_DEPENDENCY_CLOSURE_DOMAIN = "ALL_VALIDATED_NATIVE_CATALOGS_AND_COHERENT_FROZEN_PUBLISHED_SNAPSHOTS_AT_2EEA094_V1";
var CATALOG_READ_FAMILY_LAWS = Object.freeze([
  Object.freeze({
    lawId: "deterministic-position-selection-v1",
    sourceFiles: Object.freeze(["src/projection.ts"]),
    equation: "Positions(selector) is the canonical-identity-ordered sequence of exactly those projection rows reached by the narrowest available item/revision/location index and satisfying the normalized selector; every dangling index reference throws."
  }),
  Object.freeze({
    lawId: "exact-stock-summary-v1",
    sourceFiles: Object.freeze(["src/read-model.ts", "src/measurement-schema.ts"]),
    equation: "StockSummary groups Positions(selector) by exact item revision, includes the requested/active zero row, adds exact measurement vectors for signed, physical, deficit, optional-identity, and qualified-dimension buckets, and orders every observable sequence by its immutable identity."
  }),
  Object.freeze({
    lawId: "simultaneous-availability-v1",
    sourceFiles: Object.freeze(["src/availability.ts", "src/deficits.ts"]),
    equation: "Availability at canonical time t is physical stock minus the once-per-location-pool recorded deficit and all active competing claims, clamped at zero per exact axis, together with the feasibility status of the same complete reservation graph."
  }),
  Object.freeze({
    lawId: "bounded-exact-allocation-v1",
    sourceFiles: Object.freeze(["src/allocation.ts", "src/picking.ts"]),
    equation: "Allocation validates time/item/selector/amount, excludes disallowed expiry and claims, pays each selected deficit pool once, searches the complete bounded increment state space before deterministic FIFO/FEFO fallback, and returns exact lines, shortfalls, deficits, and explanation flags without changing the snapshot."
  }),
  Object.freeze({
    lawId: "exact-packaging-list-v1",
    sourceFiles: Object.freeze(["src/events.ts"]),
    equation: "Every observed authority time must be a non-empty canonical ISO instant; invalid or non-canonical spellings throw before read semantics can depend on them."
  }),
  Object.freeze({
    lawId: "exact-collection-rollup-v1",
    sourceFiles: Object.freeze(["src/collections.ts"]),
    equation: "CollectionSummary resolves the exact retained definition, summarizes every exact member under one normalized scope, and emits only declared scalar rollups using exact reference conversion and stable member/contribution ordering."
  }),
  Object.freeze({
    lawId: "simultaneous-reservation-feasibility-v1",
    sourceFiles: Object.freeze(["src/reservations.ts"]),
    equation: "Reservation feasibility groups active claims by exact competing axis, applies shared deficit burden, exhaustively assigns bounded indivisible groups, then computes maximum continuous bigint flow; feasible means and only means total fulfillable minor units equal total requested minor units."
  }),
  Object.freeze({
    lawId: "immutable-catalog-extension-v1",
    sourceFiles: Object.freeze(["src/catalog.ts"]),
    equation: "Catalog extension unions each revision family by exact revision id, accepts an existing id only when its independently certified digest is equal, overlays only supplied active pointers, revalidates the whole catalog, and preserves object identity exactly when the resulting digest is unchanged."
  })
]);
var CATALOG_READ_EXPECTED_LAW_FILES = Object.freeze([
  "allocation",
  "availability",
  "collections",
  "deficits",
  "events",
  "measurement-schema",
  "picking",
  "projection",
  "read-model",
  "reservations"
].map(
  (family) => `experiments/tla-conformance/authority-r5/catalog-read-laws/${family}.expected.ts.txt`
));
var CATALOG_READ_REUSED_CERTIFICATES = Object.freeze([
  Object.freeze({
    family: "quantity-measurement",
    proofKind: "inventoryonce-quantity-measurement-complete-source-equations-v1",
    artifactSha256: "f5b31c828b402fa98d0787a5b1e02a23290e86bdaad81f2ffed9f775358e284c",
    certificateId: "VALUE_CERTIFICATE_FAMILY:sha256:22f777b6f641ae5af58c1236b6e6e2e9f2257d95551ed957bd59447662d4c310"
  }),
  Object.freeze({
    family: "identity-selector",
    proofKind: "independent-identity-values-closed-equations-v1",
    artifactSha256: "d5e629e6f18e8357b7042529cb946852d14d19c3757cfc43779ee37306219c8f",
    certificateId: "inventoryonce.identity-values.closed-source-equations.v1"
  }),
  Object.freeze({
    family: "catalog-snapshot",
    proofKind: "independent-catalog-snapshot-closed-equations-v1",
    artifactSha256: "110326f4da80463c077efeb9a23d69e048005dc6c185e7ca4ef9ce0332848d9c",
    certificateId: "official-clean-hub-2f39cfe/catalog-family.json"
  }),
  Object.freeze({
    family: "catalog-published-direct-source",
    proofKind: "complete-source-equations-v1",
    artifactSha256: "e767440999da004ef44d685d55c27fa1769d225e0539be990a379c283dfe597a",
    certificateId: "SOURCE_EQUATION_FAMILY:sha256:86ca8e3a561802d5f5e17b72ed83263c8b48a40a611ad0755dfda48960df3cfe"
  }),
  Object.freeze({
    family: "catalog-snapshot-alias",
    proofKind: "semantic-contract-source-closed-v1",
    artifactSha256: "523fb3bd2e3321a9fafff68fae450d6ee71851b5a853829ecbf14bd4fb15db6d",
    certificateId: "official-clean-hub-2f39cfe/semantic-evidence.json"
  })
]);
var CATALOG_READ_EXPECTED_RUNTIME_VALUES = Object.freeze([
  Object.freeze({ key: "src/allocation.ts#const:MAXIMUM_EXACT_ALLOCATION_DEPTH", law: Object.freeze(["integer", "5000"]) }),
  Object.freeze({ key: "src/allocation.ts#const:MAXIMUM_EXACT_ALLOCATION_STATES", law: Object.freeze(["integer", "100000"]) }),
  Object.freeze({ key: "src/allocation.ts#enum:InventoryAllocationMethod", law: Object.freeze(["enum", Object.freeze([Object.freeze(["Fifo", "fifo"]), Object.freeze(["Fefo", "fefo"])])]) }),
  Object.freeze({ key: "src/reservations.ts#const:MAXIMUM_RESERVATION_FEASIBILITY_EDGES", law: Object.freeze(["integer", "8192"]) }),
  Object.freeze({ key: "src/reservations.ts#const:MAXIMUM_RESERVATION_FEASIBILITY_POSITIONS", law: Object.freeze(["integer", "512"]) }),
  Object.freeze({ key: "src/reservations.ts#const:MAXIMUM_RESERVATION_FEASIBILITY_RESERVATIONS", law: Object.freeze(["integer", "128"]) }),
  Object.freeze({ key: "src/reservations.ts#const:MAXIMUM_RESERVATION_FEASIBILITY_STATES", law: Object.freeze(["integer", "100000"]) }),
  Object.freeze({ key: "src/reservations.ts#enum:InventoryReservationFeasibilityStatus", law: Object.freeze(["enum", Object.freeze([Object.freeze(["Feasible", "feasible"]), Object.freeze(["Shortage", "shortage"])])]) }),
  Object.freeze({ key: "src/reservations.ts#enum:InventoryReservationStatus", law: Object.freeze(["enum", Object.freeze([Object.freeze(["Active", "active"]), Object.freeze(["Released", "released"]), Object.freeze(["Consumed", "consumed"]), Object.freeze(["Expired", "expired"])])]) }),
  Object.freeze({ key: "src/reservations.ts#field:BigIntFlowNetwork.adjacency", law: Object.freeze(["fresh-map"]) }),
  Object.freeze({ key: "src/reservations.ts#field:BigIntFlowNetwork.residual", law: Object.freeze(["fresh-map"]) })
]);
var CATALOG_READ_HELPER_ALIAS_BINDINGS = Object.freeze([
  Object.freeze({ surfaceKey: "export:.#summarizeInventoryAvailability::call[0]", equationKey: "src/availability.ts#summarizeInventoryAvailability" }),
  Object.freeze({ surfaceKey: "export:./kernel#summarizeInventoryAvailability::call[0]", equationKey: "src/availability.ts#summarizeInventoryAvailability" }),
  Object.freeze({ surfaceKey: "export:.#listInventoryPackagingRevisions::call[0]", equationKey: "src/read-model.ts#listInventoryPackagingRevisions" }),
  Object.freeze({ surfaceKey: "export:./kernel#listInventoryPackagingRevisions::call[0]", equationKey: "src/read-model.ts#listInventoryPackagingRevisions" }),
  Object.freeze({ surfaceKey: "export:.#inventoryAmountForPrimaryAllocation::call[0]", equationKey: "src/picking.ts#inventoryAmountForPrimaryAllocation" }),
  Object.freeze({ surfaceKey: "export:./kernel#inventoryAmountForPrimaryAllocation::call[0]", equationKey: "src/picking.ts#inventoryAmountForPrimaryAllocation" }),
  Object.freeze({ surfaceKey: "export:.#planInventoryAllocation::call[0]", equationKey: "src/picking.ts#planInventoryAllocation" }),
  Object.freeze({ surfaceKey: "export:./kernel#planInventoryAllocation::call[0]", equationKey: "src/picking.ts#planInventoryAllocation" }),
  Object.freeze({ surfaceKey: "export:.#summarizeInventoryStock::call[0]", equationKey: "src/read-model.ts#summarizeInventoryStock" }),
  Object.freeze({ surfaceKey: "export:./kernel#summarizeInventoryStock::call[0]", equationKey: "src/read-model.ts#summarizeInventoryStock" }),
  Object.freeze({ surfaceKey: "export:./kernel#allocateInventory::call[0]", equationKey: "src/allocation.ts#allocateInventory" }),
  Object.freeze({ surfaceKey: "export:./kernel#compareInventoryAllocationCandidates::call[0]", equationKey: "src/allocation.ts#compareInventoryAllocationCandidates" }),
  Object.freeze({ surfaceKey: "export:./kernel#findInventoryPositions::call[0]", equationKey: "src/projection.ts#findInventoryPositions" }),
  Object.freeze({ surfaceKey: "export:./kernel#summarizeInventoryCollection::call[0]", equationKey: "src/collections.ts#summarizeInventoryCollection" })
]);
var CATALOG_READ_CONSTRUCTION_ALIAS_BINDINGS = Object.freeze([
  "export:.#InventoryCatalog.define::call[0]",
  "export:./kernel#InventoryCatalog.define::call[0]",
  "export:.#defineInventoryCatalog::call[0]",
  "export:./kernel#defineInventoryCatalog::call[0]",
  "export:.#emptyInventoryCatalogSnapshot::call[0]",
  "export:./kernel#emptyInventoryCatalogSnapshot::call[0]",
  "export:.#inventoryCatalogFromSnapshot::call[0]",
  "export:./kernel#inventoryCatalogFromSnapshot::call[0]",
  "export:.#assertInventoryCatalogRetainsSnapshot::call[0]",
  "export:./kernel#assertInventoryCatalogRetainsSnapshot::call[0]",
  "export:./storage#inventoryCatalogSnapshotDigest::call[0]"
]);
var CATALOG_READ_EXTENSION_ALIAS_BINDINGS = Object.freeze([
  "export:.#extendInventoryCatalog::call[0]",
  "export:./kernel#extendInventoryCatalog::call[0]"
]);
var CATALOG_READ_STRENGTHENED_ALIAS_BINDINGS = Object.freeze([
  "export:.#inventoryCatalogSnapshot::call[0]",
  "export:./kernel#inventoryCatalogSnapshot::call[0]"
]);
function snapshotRead(surfaceKey, methodName, helperSourceFile, helperName, facadeEquation, helperEquation) {
  return Object.freeze({
    surfaceKey,
    methodName,
    helperSourceFile,
    helperName,
    facadeEquation,
    helperEquation
  });
}
var CATALOG_READ_SNAPSHOT_CONTRACTS = Object.freeze([
  snapshotRead(
    "type:src/facade.ts#InventoryOnceReadSnapshotApi.positions::call[0]",
    "positions",
    "src/projection.ts",
    "findInventoryPositions",
    "result = findInventoryPositions(frozenWorld.projection, selector)",
    "Normalize the selector; enumerate only its exact projection-index candidates; reject a dangling index row; retain precisely the position keys matching every normalized constraint; order by canonical stock-position identity; return the corresponding frozen position rows."
  ),
  snapshotRead(
    "type:src/facade.ts#InventoryOnceReadSnapshotApi.summary::call[0]",
    "summary",
    "src/read-model.ts",
    "summarizeInventoryStock",
    "result = summarizeInventoryStock({ catalog: frozenCatalog, projection: frozenWorld.projection, selector })",
    "Normalize the selector and select matching positions; group by exact item revision; retain requested revisions and the active zero-stock revision; reject a revision owned by another item; for each ordered revision return exact total, positive physical, signed deficit, positions, every optional identity bucket, and every qualified-dimension bucket, with exact measurement addition and deterministic ordering."
  ),
  snapshotRead(
    "type:src/facade.ts#InventoryOnceReadSnapshotApi.availability::call[0]",
    "availability",
    "src/availability.ts",
    "summarizeInventoryAvailability",
    "result = summarizeInventoryAvailability({ catalog: frozenCatalog, projection: frozenWorld.projection, reservations: frozenWorld.reservations, selector, at: suppliedAt ?? frozenDefaultAt })",
    "Normalize the selector; group selected positions by exact revision; retain requested and active zero-stock revisions; select reservations active at the canonical authority time; for each ordered revision compute exact physical, claim, recorded-deficit, and non-negative available vectors over the selected pools; return those summaries plus the exact simultaneous reservation-feasibility result for the same frozen projection, claim book, catalog, and time."
  ),
  snapshotRead(
    "type:src/facade.ts#InventoryOnceReadSnapshotApi.planAllocation::call[0]",
    "planAllocation",
    "src/picking.ts",
    "planInventoryAllocation",
    "result = planInventoryAllocation({ catalog: frozenCatalog, world: frozenWorld, selector: input.selector, amount: input.amount, method: input.method, at: input.at ?? frozenDefaultAt, and each supplied optional policy field })",
    "Validate both authority times; freeze the exact item revision, selector, request measurements, and positive primary quantity; form the whole selected location deficit pool; derive reservation-, expiry-, package-, serial-, and measured-increment-aware candidates; pay recorded deficit once per pool; perform exact bounded allocation before FIFO/FEFO fallback; reject missing reviewed candidates; return exact lines, requested values, shortfall and optional shortfall amount, deficit fields, and every policy explanation flag without mutating the frozen world."
  ),
  snapshotRead(
    "type:src/facade.ts#InventoryOnceReadSnapshotApi.packagingRevisions::call[0]",
    "packagingRevisions",
    "src/read-model.ts",
    "listInventoryPackagingRevisions",
    "result = listInventoryPackagingRevisions({ catalog: frozenCatalog, ...input })",
    "Retain precisely the immutable packaging revisions whose stable item identity matches and whose exact item revision matches when supplied; sort by stable item, package unit, and exact packaging-revision identity; return the retained revision objects without collapsing equal human labels."
  ),
  snapshotRead(
    "type:src/facade.ts#InventoryOnceReadSnapshotApi.collectionSummary::call[0]",
    "collectionSummary",
    "src/collections.ts",
    "summarizeInventoryCollection",
    "result = summarizeInventoryCollection({ catalog: frozenCatalog, projection: frozenWorld.projection, collectionRevisionId: input.collectionRevisionId, scope: input.scope when supplied })",
    "Normalize and copy the shared stock scope; resolve the exact retained collection revision and exact member revisions; summarize each member over the same frozen projection; sort members by immutable revision identity; compute only explicitly declared compatible scalar rollups with exact quantity conversion and stable contribution ordering; return definition, normalized scope, members, and rollups."
  )
]);
var CATALOG_READ_STORAGE_ACQUISITION_BLOCKER = Object.freeze({
  gapId: "CATALOG_READ_STORAGE_ACQUISITION_EXTERNAL_BOUNDARY",
  affectedSurfaceKeys: Object.freeze([
    "type:src/facade.ts#InventoryOnceCatalogApi.activeItem::call[0]",
    "type:src/facade.ts#InventoryOnceCatalogApi.itemRevision::call[0]",
    "type:src/facade.ts#InventoryOnceCatalogApi.itemRevisionsForItem::call[0]"
  ]),
  provenLocalEquation: "Each facade read resolves its owning internals, awaits exactly one InventoryDurableStorage.readWorld call, chooses the configured catalog only for revision zero and otherwise reconstructs the exact published catalog, then applies the already-closed InventoryCatalog lookup/filter equation.",
  missingFact: "InventoryDurableStorage.readWorld is an application-supplied asynchronous port. The package defines its result contract but no universal implementation, failure behavior, or state-acquisition function over all adapters, so this family cannot derive one strict-V return for every valid receiver.",
  disposition: "TRUE_EXTERNAL_STORAGE_BOUNDARY_NO_STRICT_V_CREDIT"
});

// experiments/tla-conformance/authority-r5/catalog-read-dependency-closure-certificate.mjs
var FAMILY_DIRECTORY2 = path32.dirname(fileURLToPath14(import.meta.url));
var REPOSITORY_ROOT2 = path32.resolve(FAMILY_DIRECTORY2, "../../..");
var CERTIFICATE_PATH2 = path32.join(
  FAMILY_DIRECTORY2,
  "catalog-read-dependency-closure-certificate.json"
);
var REGISTERED_FAMILY_PATH = path32.join(
  FAMILY_DIRECTORY2,
  "catalog-read-family.json"
);
var PUBLISHED_SOURCE_CERTIFICATE_PATH = path32.join(
  FAMILY_DIRECTORY2,
  "catalog-published-source-equations.json"
);
var FAMILY_ID = "inventoryonce.catalog-read-dependency-closure.v1";
var CATALOG_READ_DEPENDENCY_CLOSURE_PROOF_KIND = "independent-catalog-read-semantic-closure-equations-v2";
var REUSED_DEPENDENCY_PATH = path32.join(
  FAMILY_DIRECTORY2,
  "catalog-read-reused-dependencies.json"
);
var CATALOG_EXTENSION_LAW_PATH = path32.join(
  FAMILY_DIRECTORY2,
  "catalog-read-laws/catalog-extension.expected.ts.txt"
);
var CLEAN_HUB_SOURCE_SHA256 = Object.freeze({
  "src/allocation.ts": "2721b6f412aa3abb55ffa9d929eaefc2d8982973c4ee862479b3af9988d3112d",
  "src/amounts.ts": "98ddc0fa8d80b2ca244a207f4eb8b55d86131c2ccfd77620da5c85248d03ef57",
  "src/availability.ts": "799eba4b4aba9641ccdf61a97e7847d82a12dc4580c6024b504896d6de8f50d0",
  "src/canonical.ts": "eb2981c629182525c6742d2a67f513f0daec88507e5861f475d5de04984a2d56",
  "src/catalog.ts": "59403cf42d3d90df509ddca2ea6ffd76c5e13b96a3d918dc5ad5d24276ee329b",
  "src/collections.ts": "c18dd56e7167b25239fb825319ce2ae2d736f8d9cbe70296201ab675228daf37",
  "src/deficits.ts": "f035ddb1aacc028282f14ca630405f1ac3aa8cfe52db152293e265898a09b684",
  "src/events.ts": "fc1b33d802f0dd2f34bdd501738431f89abd3e8d932e665ef4f462402a5baa78",
  "src/facade.ts": "c20ca6ac5bb3794999e3a3ad02d271d7b944a86917f1a6a69170577340b906c3",
  "src/integrity.ts": "21aae6775d683a6ad14892444625b8c80b5fb23e75b0756207bff5430efc2da0",
  "src/measurement-schema.ts": "747f064996c12b3a9b324779bd748362b49b2563e303b2599243bc8a630d144e",
  "src/measurements.ts": "f877bfd8b57ea19946c94aaaba7c9acae15e8489838de1d126d3a544897550f7",
  "src/model.ts": "df2f15e918a5f349ade6fcfc33393a520f2b74c7221a2e0eca83f7647341d122",
  "src/ordering.ts": "e72ac94e99b1b4914f3f6dec55583e401484a41ecadd051be788724c88f24cb9",
  "src/picking.ts": "6b21cc96a238902404ec32657ed6123bf6a9bd4c65026ff90d8f83ee1dd47e5d",
  "src/projection.ts": "c59ac077730a52aece347ac9266778c59d8b15ece000a0599f393c913a801cc7",
  "src/quantity.ts": "8c0be7d29d08fef1daa83fd987896c1c1a015c4f70cd329261987fcc907382a6",
  "src/read-model.ts": "685b71eea8d7cd9267ff156a4047e3e35c993c75627c683374080a52f652fd63",
  "src/reservations.ts": "3d117feb328f74a6c8dca4ca67f7af27eaf332b2c43aaf4ab9e345ebc9f32307",
  "src/selectors.ts": "8a81513eaa6fad8f9ce5adf2d1e6a7d0471b27d2eab1d91437da0d77d236f957",
  "src/storage.ts": "cbe6eb529014619e4121f10a6f0c503930867c6732b236ffaa0ea26eb4f8cab0",
  "src/usability.ts": "bb4cf272fd01be5c4866b388f2af63e9fdd7286c208600fb635ca10d30f0ad51"
});
var PRODUCER_FILES = Object.freeze([
  "experiments/tla-conformance/authority-r5/catalog-read-dependency-closure-contracts.mjs",
  "experiments/tla-conformance/authority-r5/catalog-read-dependency-closure-certificate.mjs",
  "experiments/tla-conformance/authority-r5/catalog-read-reused-dependencies.json",
  "experiments/tla-conformance/authority-r5/catalog-read-laws/catalog-extension.expected.ts.txt",
  ...CATALOG_READ_EXPECTED_LAW_FILES,
  "experiments/tla-conformance/authority-r5/catalog-published-source-equations.json",
  "experiments/tla-conformance/authority-r5/catalog-published-source-contracts.mjs",
  "experiments/tla-conformance/authority-r5/catalog-published-source-equations.mjs",
  "experiments/tla-conformance/surface-bindings/lib/compiler-surface.mjs",
  "node_modules/typescript/package.json"
]);
var EXPECTED_HIGHER_ORDER_TARGETS = Object.freeze([
  "src/allocation.ts#createExactAllocationsIfPossible#acceptAllocations",
  "src/read-model.ts#summarizeOptionalIdentity#readValueId",
  "src/reservations.ts#assignIndivisibleGroupCounts#useAssignment"
]);
var supportedSurfaceKeys19 = Object.freeze([
  ...CATALOG_READ_SNAPSHOT_CONTRACTS.map((contract) => contract.surfaceKey),
  ...CATALOG_READ_HELPER_ALIAS_BINDINGS.map((binding) => binding.surfaceKey)
]);
assert32.equal(supportedSurfaceKeys19.length, 20);
assert32.equal(new Set(supportedSurfaceKeys19).size, supportedSurfaceKeys19.length);
var proofKind16 = CATALOG_READ_DEPENDENCY_CLOSURE_PROOF_KIND;
var cachedCertificateJson;
var cachedCompilerSurface;
function currentCompilerSurface() {
  if (cachedCompilerSurface === void 0) {
    const discovered = discoverCompilerSurface(REPOSITORY_ROOT2);
    assert32.equal(discovered.callables.length, 535);
    cachedCompilerSurface = {
      ...discovered,
      digest: CATALOG_READ_OFFICIAL_SURFACE_DIGEST
    };
  }
  return cachedCompilerSurface;
}
function requireExactKeys2(value, expected, label) {
  assert32.equal(
    value !== null && typeof value === "object" && !Array.isArray(value),
    true,
    `${label} must be an object.`
  );
  assert32.deepEqual(
    Object.keys(value).sort(compareCodeUnits),
    [...expected].sort(compareCodeUnits),
    `${label} fields changed.`
  );
}
function loadOverriddenContext4(sourceOverrides) {
  for (const file of sourceOverrides.keys()) {
    assert32(
      Object.hasOwn(CLEAN_HUB_SOURCE_SHA256, file),
      `Source override '${file}' is outside the closed family.`
    );
  }
  const configPath = path32.join(REPOSITORY_ROOT2, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert32.equal(config.error, void 0, "Cannot read TypeScript configuration.");
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    REPOSITORY_ROOT2,
    void 0,
    configPath
  );
  assert32.equal(parsed.errors.length, 0, "TypeScript configuration changed.");
  const overridesByAbsolutePath = new Map(
    [...sourceOverrides].map(([file, source7]) => [
      path32.resolve(REPOSITORY_ROOT2, file),
      source7.toString()
    ])
  );
  const host = ts.createCompilerHost(parsed.options, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const override = overridesByAbsolutePath.get(path32.resolve(fileName));
    return override === void 0 ? originalGetSourceFile(
      fileName,
      languageVersion,
      onError,
      shouldCreateNewSourceFile
    ) : ts.createSourceFile(
      fileName,
      override,
      languageVersion,
      true,
      ts.ScriptKind.TS
    );
  };
  host.readFile = (fileName) => overridesByAbsolutePath.get(path32.resolve(fileName)) ?? ts.sys.readFile(fileName);
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    host
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert32.equal(
    diagnostics.length,
    0,
    `Mutated compiler program has ${diagnostics.length} diagnostic(s).`
  );
  return {
    repositoryRoot: REPOSITORY_ROOT2,
    program,
    checker: program.getTypeChecker()
  };
}
function isConcreteCallable(declaration) {
  return (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration) || ts.isConstructorDeclaration(declaration) || ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration)) && declaration.body !== void 0;
}
function declarationFile(declaration) {
  return normalizeRelativePath(
    REPOSITORY_ROOT2,
    declaration.getSourceFile().fileName
  );
}
function isPackageSourceDeclaration(declaration) {
  const file = declarationFile(declaration);
  return file.startsWith("src/") && !file.includes("../");
}
function callableKey(declaration) {
  const file = declarationFile(declaration);
  if (ts.isMethodDeclaration(declaration)) {
    assert32(ts.isClassDeclaration(declaration.parent));
    assert32.notEqual(declaration.parent.name, void 0);
    return `${file}#${declaration.parent.name.text}.${declaration.name.getText()}`;
  }
  if (ts.isConstructorDeclaration(declaration)) {
    assert32(ts.isClassDeclaration(declaration.parent));
    assert32.notEqual(declaration.parent.name, void 0);
    return `${file}#${declaration.parent.name.text}.constructor`;
  }
  if (ts.isFunctionDeclaration(declaration)) {
    assert32.notEqual(declaration.name, void 0);
    return `${file}#${declaration.name.text}`;
  }
  const parent = declaration.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return `${file}#${parent.name.text}`;
  }
  return `${file}#embedded-callable@${declaration.getStart()}-${declaration.getEnd()}`;
}
function isEmbeddedIn(declaration, owner) {
  return declaration.getSourceFile() === owner.getSourceFile() && declaration.getStart() >= owner.getStart() && declaration.getEnd() <= owner.getEnd();
}
function resolvedSymbol2(context, node) {
  const location = ts.isPropertyAccessExpression(node) ? node.name : node;
  const symbol = context.checker.getSymbolAtLocation(location);
  if (symbol === void 0) return void 0;
  return (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : context.checker.getAliasedSymbol(symbol);
}
function concreteCallableDeclarations(context, declaration) {
  if (isConcreteCallable(declaration)) return [declaration];
  const symbol = declaration.symbol ?? (declaration.name === void 0 ? void 0 : context.checker.getSymbolAtLocation(declaration.name));
  return (symbol?.declarations ?? []).filter(isConcreteCallable);
}
function isTopLevelVariable(declaration) {
  return ts.isVariableDeclarationList(declaration.parent) && ts.isVariableStatement(declaration.parent.parent) && ts.isSourceFile(declaration.parent.parent.parent);
}
function runtimeValueDeclaration(declaration) {
  if (ts.isEnumMember(declaration)) return declaration.parent;
  if (ts.isVariableDeclaration(declaration) && declaration.initializer !== void 0 && isTopLevelVariable(declaration)) {
    return declaration;
  }
  if (ts.isPropertyDeclaration(declaration) && declaration.initializer !== void 0) {
    return declaration;
  }
  return void 0;
}
function valueKey(declaration) {
  const file = declarationFile(declaration);
  if (ts.isEnumDeclaration(declaration)) {
    return `${file}#enum:${declaration.name.text}`;
  }
  if (ts.isVariableDeclaration(declaration)) {
    return `${file}#const:${declaration.name.getText()}`;
  }
  assert32(ts.isPropertyDeclaration(declaration));
  assert32(ts.isClassDeclaration(declaration.parent));
  assert32.notEqual(declaration.parent.name, void 0);
  return `${file}#field:${declaration.parent.name.text}.${declaration.name.getText()}`;
}
function executableTerm(declaration) {
  return ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
    removeComments: true
  }).printNode(
    ts.EmitHint.Unspecified,
    declaration,
    declaration.getSourceFile()
  );
}
function sourceFile2(context, relativeFile) {
  const source7 = context.program.getSourceFile(
    path32.resolve(REPOSITORY_ROOT2, relativeFile)
  );
  assert32.notEqual(source7, void 0, `Missing compiler source '${relativeFile}'.`);
  return source7;
}
function findFunction11(context, relativeFile, functionName) {
  const matches = sourceFile2(context, relativeFile).statements.filter(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === functionName && statement.body !== void 0
  );
  assert32.equal(matches.length, 1, `Expected one function '${functionName}'.`);
  return matches[0];
}
function findClassMethod3(context, relativeFile, className, methodName) {
  const classes = sourceFile2(context, relativeFile).statements.filter(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === className
  );
  assert32.equal(classes.length, 1, `Expected one class '${className}'.`);
  const methods = classes[0].members.filter(
    (member2) => ts.isMethodDeclaration(member2) && member2.name.getText() === methodName && member2.body !== void 0
  );
  assert32.equal(
    methods.length,
    1,
    `Expected one method '${className}.${methodName}'.`
  );
  return methods[0];
}
function findInterfaceMethod2(context, interfaceName, methodName) {
  const matches = sourceFile2(context, "src/facade.ts").statements.filter(
    (statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName
  );
  assert32.equal(matches.length, 1, `Expected one interface '${interfaceName}'.`);
  const methods = matches[0].members.filter(
    (member2) => ts.isMethodSignature(member2) && member2.name.getText() === methodName
  );
  assert32.equal(
    methods.length,
    1,
    `Expected one interface method '${interfaceName}.${methodName}'.`
  );
  return { owner: matches[0], method: methods[0] };
}
function isTypeScriptLibraryDeclaration(declaration) {
  return /[/\\]node_modules[/\\]typescript[/\\]lib[/\\]lib\.[^/\\]+\.d\.ts$/u.test(
    declaration.getSourceFile().fileName
  );
}
function buildClosedProgramSlice(context) {
  const callableQueue = [];
  const valueQueue = [];
  const callables = /* @__PURE__ */ new Map();
  const values = /* @__PURE__ */ new Map();
  const directDependencies = /* @__PURE__ */ new Map();
  const nativeDeclarations = /* @__PURE__ */ new Map();
  const higherOrderInvocations = /* @__PURE__ */ new Map();
  const implicitConstructors = /* @__PURE__ */ new Map();
  function enqueueCallable(declaration, owner) {
    if (!isPackageSourceDeclaration(declaration)) return;
    if (owner !== void 0 && isEmbeddedIn(declaration, owner)) return;
    const key = callableKey(declaration);
    if (!callables.has(key)) callableQueue.push(declaration);
  }
  function enqueueValue(declaration) {
    if (!isPackageSourceDeclaration(declaration)) return;
    const key = valueKey(declaration);
    if (!values.has(key)) valueQueue.push(declaration);
  }
  function recordNative(declaration) {
    assert32(
      isTypeScriptLibraryDeclaration(declaration),
      `Non-TypeScript external declaration '${declarationFile(declaration)}' entered the pure read closure.`
    );
    const nativeSpan = spanOf(context, declaration);
    const key = `${nativeSpan.file}@${nativeSpan.start.offset}-${nativeSpan.end.offset}`;
    nativeDeclarations.set(key, nativeSpan);
  }
  function recordHigherOrder(ownerKey, call, target) {
    let parameter = target;
    while (!ts.isParameter(parameter) && !ts.isSourceFile(parameter)) {
      parameter = parameter.parent;
    }
    const invokedName = ts.isIdentifier(call.expression) ? call.expression.text : void 0;
    const parameterName = ts.isParameter(parameter) ? ts.isIdentifier(parameter.name) ? parameter.name.text : void 0 : invokedName;
    assert32.notEqual(
      parameterName,
      void 0,
      `Higher-order call '${call.getText()}' has no named function parameter.`
    );
    const key = `${ownerKey}#${parameterName}`;
    higherOrderInvocations.set(key, {
      key,
      owner: ownerKey,
      parameter: parameterName,
      invocation: call.getText(call.getSourceFile()),
      invocationSpan: spanOf(context, call)
    });
  }
  function recordImplicitConstructor(call, ownerKey) {
    assert32(ts.isNewExpression(call));
    const symbol = resolvedSymbol2(context, call.expression);
    const classes = (symbol?.declarations ?? []).filter(ts.isClassDeclaration);
    assert32.equal(
      classes.length,
      1,
      `Unresolved construction '${call.getText()}' is not one package class.`
    );
    const classDeclaration = classes[0];
    assert32(isPackageSourceDeclaration(classDeclaration));
    const constructors = classDeclaration.members.filter(ts.isConstructorDeclaration);
    assert32.equal(
      constructors.length,
      0,
      `Compiler failed to resolve explicit constructor '${classDeclaration.name?.text}'.`
    );
    const fields2 = classDeclaration.members.filter(
      (member2) => ts.isPropertyDeclaration(member2) && member2.initializer !== void 0
    );
    assert32(fields2.length > 0, "Implicit package constructor has no closed field equation.");
    for (const field of fields2) enqueueValue(field);
    const className = classDeclaration.name?.text;
    assert32.notEqual(className, void 0);
    const key = `${declarationFile(classDeclaration)}#${className}.implicit-constructor`;
    implicitConstructors.set(key, {
      key,
      owner: ownerKey,
      construction: call.getText(call.getSourceFile()),
      classDeclaration: spanOf(context, classDeclaration),
      fieldEquations: fields2.map(valueKey).sort(compareCodeUnits)
    });
    return key;
  }
  function inspectTerm(ownerKey, owner, termRoot) {
    const dependencies = directDependencies.get(ownerKey) ?? /* @__PURE__ */ new Set();
    directDependencies.set(ownerKey, dependencies);
    function inspect(node) {
      if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
        throw new Error("Accessor bodies are outside the immutable plain-data domain.");
      }
      if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
        const symbol = resolvedSymbol2(context, node);
        for (const declaration of symbol?.declarations ?? []) {
          if (ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration)) {
            throw new Error(
              `Accessor-backed read '${node.getText()}' entered the pure closure.`
            );
          }
          for (const callable of concreteCallableDeclarations(
            context,
            declaration
          )) {
            if (isPackageSourceDeclaration(callable) && !isEmbeddedIn(callable, owner)) {
              const key = callableKey(callable);
              dependencies.add(key);
              enqueueCallable(callable, owner);
            }
          }
          const runtimeValue2 = runtimeValueDeclaration(declaration);
          if (runtimeValue2 !== void 0 && isPackageSourceDeclaration(runtimeValue2) && !isEmbeddedIn(runtimeValue2, owner)) {
            const key = valueKey(runtimeValue2);
            dependencies.add(key);
            enqueueValue(runtimeValue2);
          }
        }
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const target = context.checker.getResolvedSignature(node)?.declaration;
        if (target === void 0) {
          assert32(
            ts.isNewExpression(node),
            `Unresolved call '${node.getText()}' entered the pure closure.`
          );
          dependencies.add(recordImplicitConstructor(node, ownerKey));
        } else if (target.getSourceFile().isDeclarationFile) {
          recordNative(target);
        } else {
          const concrete = concreteCallableDeclarations(context, target);
          if (concrete.length === 0) {
            recordHigherOrder(ownerKey, node, target);
          }
          for (const callable of concrete) {
            if (isPackageSourceDeclaration(callable)) {
              if (!isEmbeddedIn(callable, owner)) {
                const key = callableKey(callable);
                dependencies.add(key);
                enqueueCallable(callable, owner);
              }
            } else {
              throw new Error(
                `External source callable '${declarationFile(callable)}' entered the pure closure.`
              );
            }
          }
        }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(termRoot);
  }
  for (const contract of CATALOG_READ_SNAPSHOT_CONTRACTS) {
    enqueueCallable(
      findClassMethod3(
        context,
        "src/facade.ts",
        "InventoryOnceReadSnapshotImplementation",
        contract.methodName
      )
    );
    enqueueCallable(
      findFunction11(context, contract.helperSourceFile, contract.helperName)
    );
  }
  while (callableQueue.length > 0 || valueQueue.length > 0) {
    while (callableQueue.length > 0) {
      const declaration = callableQueue.shift();
      assert32.notEqual(declaration, void 0);
      const key = callableKey(declaration);
      if (callables.has(key)) continue;
      callables.set(key, declaration);
      inspectTerm(key, declaration, declaration);
    }
    while (valueQueue.length > 0) {
      const declaration = valueQueue.shift();
      assert32.notEqual(declaration, void 0);
      const key = valueKey(declaration);
      if (values.has(key)) continue;
      values.set(key, declaration);
      const termRoot = ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration) ? declaration.initializer : declaration;
      assert32.notEqual(termRoot, void 0);
      inspectTerm(key, declaration, termRoot);
    }
  }
  assert32.deepEqual(
    [...higherOrderInvocations.keys()].sort(compareCodeUnits),
    [...EXPECTED_HIGHER_ORDER_TARGETS],
    "The higher-order boundary of the helper closure changed."
  );
  for (const [ownerKey, dependencies] of directDependencies) {
    for (const dependency2 of dependencies) {
      assert32(
        callables.has(dependency2) || values.has(dependency2) || implicitConstructors.has(dependency2),
        `Equation '${ownerKey}' retains unresolved package dependency '${dependency2}'.`
      );
    }
  }
  return {
    callables,
    values,
    directDependencies,
    nativeDeclarations,
    higherOrderInvocations,
    implicitConstructors
  };
}
function buildHigherOrderClosures(context, programSlice) {
  assert32.equal(
    programSlice.higherOrderInvocations.size,
    EXPECTED_HIGHER_ORDER_TARGETS.length
  );
  const stockSource = sourceFile2(context, "src/read-model.ts");
  const stockCalls = [];
  const allocationSource = sourceFile2(context, "src/allocation.ts");
  const allocationCalls = [];
  const pickingSource = sourceFile2(context, "src/picking.ts");
  const pickingCalls = [];
  const reservationSource = sourceFile2(context, "src/reservations.ts");
  const reservationCalls = [];
  function collectNamedCalls(source7, functionName, result) {
    function inspect(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === functionName) {
        result.push(node);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source7);
  }
  collectNamedCalls(stockSource, "summarizeOptionalIdentity", stockCalls);
  assert32.equal(stockCalls.length, 9);
  for (const call of stockCalls) {
    assert32(ts.isArrowFunction(call.arguments[1]));
  }
  collectNamedCalls(
    allocationSource,
    "createExactAllocationsIfPossible",
    allocationCalls
  );
  assert32.equal(allocationCalls.length, 2);
  assert32(ts.isIdentifier(allocationCalls[0].arguments[2]));
  assert32.equal(allocationCalls[0].arguments[2].text, "acceptAllocations");
  assert32(ts.isIdentifier(allocationCalls[1].arguments[2]));
  assert32.equal(allocationCalls[1].arguments[2].text, "undefined");
  collectNamedCalls(pickingSource, "allocateInventory", pickingCalls);
  const planAllocation = findFunction11(
    context,
    "src/picking.ts",
    "planInventoryAllocation"
  );
  const policyAllocationCalls = pickingCalls.filter(
    (call) => call.getStart() >= planAllocation.getStart() && call.getEnd() <= planAllocation.getEnd()
  );
  assert32.equal(policyAllocationCalls.length, 1);
  const policyAllocationCall = policyAllocationCalls[0];
  assert32(ts.isObjectLiteralExpression(policyAllocationCall.arguments[0]));
  assert32.equal(
    policyAllocationCall.arguments[0].properties.some(
      (property) => property.name?.getText() === "acceptAllocations"
    ),
    false
  );
  collectNamedCalls(
    reservationSource,
    "assignIndivisibleGroupCounts",
    reservationCalls
  );
  assert32.equal(reservationCalls.length, 1);
  assert32(ts.isArrowFunction(reservationCalls[0].arguments[3]));
  return [
    {
      target: "src/read-model.ts#summarizeOptionalIdentity#readValueId",
      closure: "All nine reachable invocations supply an inline arrow whose body is embedded in a certified stock-summary declaration term.",
      checkedCallSites: stockCalls.map((call) => spanOf(context, call)),
      externalFunctionValues: 0
    },
    {
      target: "src/allocation.ts#createExactAllocationsIfPossible#acceptAllocations",
      closure: "The snapshot policy root omits allocateInventory.acceptAllocations, so destructuring binds undefined and both guarded callback invocations are unreachable in this specialization.",
      checkedCallSites: [spanOf(context, policyAllocationCall)],
      externalFunctionValues: 0
    },
    {
      target: "src/reservations.ts#assignIndivisibleGroupCounts#useAssignment",
      closure: "The sole reachable invocation supplies the local recursive search arrow embedded in maximumReservationAssignmentWithIndivisibleGroups.",
      checkedCallSites: reservationCalls.map((call) => spanOf(context, call)),
      externalFunctionValues: 0
    }
  ];
}
function publicSnapshotRelation(context, surfaceCallable, implementation, methodName) {
  const publicMethod = findInterfaceMethod2(
    context,
    "InventoryOnceReadSnapshotApi",
    methodName
  );
  const implementedInterfaces = implementation.parent.heritageClauses?.filter((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword).flatMap((clause) => clause.types) ?? [];
  const interfaceSymbol = context.checker.getSymbolAtLocation(publicMethod.owner.name);
  assert32(
    implementedInterfaces.some(
      (type) => context.checker.getSymbolAtLocation(type.expression) === interfaceSymbol
    ),
    "Snapshot implementation no longer implements the public interface."
  );
  assert32(
    context.checker.isTypeAssignableTo(
      context.checker.getTypeAtLocation(implementation),
      context.checker.getTypeAtLocation(publicMethod.method)
    ),
    `Snapshot implementation '${methodName}' is not assignable to its public method.`
  );
  assert32.deepEqual(surfaceCallable.declaration, spanOf(context, publicMethod.method));
  return {
    kind: "COMPILER_RESOLVED_IMPLEMENTS",
    interface: spanOf(context, publicMethod.method),
    implementation: spanOf(context, implementation)
  };
}
function reachableEquationKeys(programSlice, rootKey) {
  const pending = [rootKey];
  const reachable = /* @__PURE__ */ new Set();
  while (pending.length > 0) {
    const key = pending.pop();
    assert32.notEqual(key, void 0);
    if (reachable.has(key)) continue;
    reachable.add(key);
    for (const dependency2 of programSlice.directDependencies.get(key) ?? []) {
      if (programSlice.callables.has(dependency2) || programSlice.values.has(dependency2) || programSlice.implicitConstructors.has(dependency2)) {
        pending.push(dependency2);
      }
    }
  }
  return [...reachable].sort(compareCodeUnits);
}
function expectedEquationDeclarations() {
  const expected = /* @__PURE__ */ new Map();
  for (const relativeFile of CATALOG_READ_EXPECTED_LAW_FILES) {
    const specificationFile = path32.join(REPOSITORY_ROOT2, relativeFile);
    const specification = ts.createSourceFile(
      specificationFile,
      fs29.readFileSync(specificationFile, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    assert32.equal(
      specification.parseDiagnostics.length,
      0,
      `Independent equation source '${relativeFile}' has syntax errors.`
    );
    const productionFile = `src/${path32.basename(relativeFile).replace(
      ".expected.ts.txt",
      ".ts"
    )}`;
    for (const statement of specification.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name !== void 0) {
        expected.set(`${productionFile}#${statement.name.text}`, statement);
      }
      if (ts.isClassDeclaration(statement) && statement.name !== void 0) {
        for (const member2 of statement.members) {
          if (ts.isMethodDeclaration(member2)) {
            expected.set(
              `${productionFile}#${statement.name.text}.${member2.name.getText()}`,
              member2
            );
          }
        }
      }
    }
  }
  return expected;
}
function typeErasedJavaScriptTerm(declaration) {
  const methodOwner = ts.isMethodDeclaration(declaration) ? declaration.parent.name?.text : void 0;
  const source7 = methodOwner === void 0 ? executableTerm(declaration) : `class ${methodOwner} {
${executableTerm(declaration)}
}`;
  const javascript = ts.transpileModule(source7, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      removeComments: true
    }
  }).outputText;
  const parsed = ts.createSourceFile(
    "type-erased-equation.js",
    javascript,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  if (methodOwner === void 0) {
    const functions2 = parsed.statements.filter(ts.isFunctionDeclaration);
    assert32.equal(functions2.length, 1, "Type erasure lost a source function.");
    return executableTerm(functions2[0]);
  }
  const classes = parsed.statements.filter(ts.isClassDeclaration);
  assert32.equal(classes.length, 1, "Type erasure lost a source method owner.");
  const methods = classes[0].members.filter(ts.isMethodDeclaration);
  assert32.equal(methods.length, 1, "Type erasure lost a source method.");
  return executableTerm(methods[0]);
}
function runtimeValueLaw(declaration) {
  if (ts.isVariableDeclaration(declaration)) {
    assert32(ts.isNumericLiteral(declaration.initializer));
    return ["integer", declaration.initializer.text];
  }
  if (ts.isEnumDeclaration(declaration)) {
    return [
      "enum",
      declaration.members.map((member2) => {
        assert32(ts.isIdentifier(member2.name));
        assert32(ts.isStringLiteral(member2.initializer));
        return [member2.name.text, member2.initializer.text];
      })
    ];
  }
  assert32(ts.isPropertyDeclaration(declaration));
  assert32(ts.isNewExpression(declaration.initializer));
  assert32(ts.isIdentifier(declaration.initializer.expression));
  assert32.equal(declaration.initializer.expression.text, "Map");
  assert32.equal(declaration.initializer.arguments?.length ?? 0, 0);
  return ["fresh-map"];
}
function lawIdForSource(sourceName) {
  const laws3 = CATALOG_READ_FAMILY_LAWS.filter(
    (law) => law.sourceFiles.includes(sourceName)
  );
  assert32.equal(laws3.length, 1, `Expected one family law for '${sourceName}'.`);
  return laws3[0].lawId;
}
function declarationEquations(context, programSlice) {
  const expected = expectedEquationDeclarations();
  const expectedValues = new Map(
    CATALOG_READ_EXPECTED_RUNTIME_VALUES.map((row) => [row.key, row])
  );
  const dependencyManifest = JSON.parse(
    fs29.readFileSync(REUSED_DEPENDENCY_PATH, "utf8")
  );
  assert32.equal(dependencyManifest.schemaVersion, 1);
  assert32.equal(dependencyManifest.sourceBase, CATALOG_READ_CLEAN_HUB_COMMIT);
  const reused = new Map(
    dependencyManifest.dependencies.map((dependency2) => [
      dependency2.key,
      dependency2
    ])
  );
  const rows = [];
  const reusedRows = [];
  for (const [key, declaration] of programSlice.callables) {
    const prior = reused.get(key);
    if (prior !== void 0) {
      const implementation = spanOf(context, declaration);
      assert32.equal(
        implementation.sourceHash,
        CLEAN_HUB_SOURCE_SHA256[implementation.file],
        `REUSED_DEPENDENCY_SOURCE_MISMATCH: ${key}`
      );
      reusedRows.push({
        ...prior,
        declaration: implementation,
        directPackageDependencies: [
          ...programSlice.directDependencies.get(key) ?? []
        ].sort(compareCodeUnits)
      });
      continue;
    }
    const independent = expected.get(key);
    assert32.notEqual(
      independent,
      void 0,
      `No independent result law closes '${key}'.`
    );
    const actualTerm = typeErasedJavaScriptTerm(declaration);
    const expectedTerm = executableTerm(independent);
    assert32.equal(
      actualTerm,
      expectedTerm,
      `SEMANTIC_EQUATION_MISMATCH: ${key}`
    );
    rows.push({
      key,
      kind: "INDEPENDENT_TYPE_ERASED_SOURCE_EQUATION",
      lawId: lawIdForSource(declarationFile(declaration)),
      declaration: spanOf(context, declaration),
      expectedTermSha256: sha256(expectedTerm),
      directPackageDependencies: [
        ...programSlice.directDependencies.get(key) ?? []
      ].sort(compareCodeUnits)
    });
    expected.delete(key);
  }
  for (const [key, declaration] of programSlice.values) {
    const prior = reused.get(key);
    if (prior !== void 0) {
      const implementation = spanOf(context, declaration);
      assert32.equal(
        implementation.sourceHash,
        CLEAN_HUB_SOURCE_SHA256[implementation.file],
        `REUSED_DEPENDENCY_SOURCE_MISMATCH: ${key}`
      );
      reusedRows.push({
        ...prior,
        declaration: implementation,
        directPackageDependencies: [
          ...programSlice.directDependencies.get(key) ?? []
        ].sort(compareCodeUnits)
      });
      continue;
    }
    const independent = expectedValues.get(key);
    assert32.notEqual(
      independent,
      void 0,
      `No independent runtime-value law closes '${key}'.`
    );
    assert32.equal(
      canonicalJson(runtimeValueLaw(declaration)),
      canonicalJson(independent.law),
      `SEMANTIC_EQUATION_MISMATCH: ${key}`
    );
    rows.push({
      key,
      kind: "INDEPENDENT_RUNTIME_VALUE_EQUATION",
      lawId: lawIdForSource(declarationFile(declaration)),
      declaration: spanOf(context, declaration),
      expectedLaw: independent.law,
      directPackageDependencies: [
        ...programSlice.directDependencies.get(key) ?? []
      ].sort(compareCodeUnits)
    });
    expectedValues.delete(key);
  }
  assert32.equal(expected.size, 0, "Independent callable law set contains unused rows.");
  assert32.equal(expectedValues.size, 0, "Independent value law set contains unused rows.");
  assert32.equal(
    rows.length + reusedRows.length,
    programSlice.callables.size + programSlice.values.size,
    "Every compiler-resolved dependency must have exactly one equation source."
  );
  return {
    independent: rows.sort((left, right) => compareCodeUnits(left.key, right.key)),
    reused: reusedRows.sort((left, right) => compareCodeUnits(left.key, right.key))
  };
}
function cleanHubComparisons(programSlice, sourceOverrides) {
  const files = /* @__PURE__ */ new Set();
  for (const declaration of programSlice.callables.values()) {
    files.add(declarationFile(declaration));
  }
  for (const declaration of programSlice.values.values()) {
    files.add(declarationFile(declaration));
  }
  for (const implicit of programSlice.implicitConstructors.values()) {
    files.add(implicit.classDeclaration.file);
  }
  files.add("src/storage.ts");
  return [...files].sort(compareCodeUnits).map((file) => {
    const worktreeBytes = sourceOverrides.get(file) ?? fs29.readFileSync(path32.join(REPOSITORY_ROOT2, file));
    const worktreeSha256 = sha256(worktreeBytes);
    const cleanHubSha256 = CLEAN_HUB_SOURCE_SHA256[file];
    assert32.notEqual(cleanHubSha256, void 0, `No clean-hub hash for '${file}'.`);
    if (!sourceOverrides.has(file)) {
      assert32.equal(
        worktreeSha256,
        cleanHubSha256,
        `${file} differs from clean hub ${CATALOG_READ_CLEAN_HUB_COMMIT}.`
      );
    }
    return {
      file,
      worktreeSha256,
      cleanHubSha256,
      byteIdentical: worktreeSha256 === cleanHubSha256,
      provenanceRebuilt: sourceOverrides.has(file)
    };
  });
}
function producerInputs(programSlice) {
  const nativeFiles = new Set(
    [...programSlice.nativeDeclarations.values()].map((span) => span.file)
  );
  return [.../* @__PURE__ */ new Set([...PRODUCER_FILES, ...nativeFiles])].sort(compareCodeUnits).map((file) => ({
    file,
    sha256: sha256(fs29.readFileSync(path32.join(REPOSITORY_ROOT2, file)))
  }));
}
function uniqueInputs(inputs3) {
  const byFile = /* @__PURE__ */ new Map();
  for (const input2 of inputs3) {
    const previous = byFile.get(input2.file);
    assert32(
      previous === void 0 || previous.sha256 === input2.sha256,
      `Conflicting producer input '${input2.file}'.`
    );
    byFile.set(input2.file, input2);
  }
  return [...byFile.values()].sort(
    (left, right) => compareCodeUnits(left.file, right.file)
  );
}
function publishedSourceCertificate() {
  const bytes2 = fs29.readFileSync(PUBLISHED_SOURCE_CERTIFICATE_PATH);
  const reference = CATALOG_READ_REUSED_CERTIFICATES.find(
    (candidate) => candidate.family === "catalog-published-direct-source"
  );
  assert32.notEqual(reference, void 0);
  assert32.equal(
    sha256(bytes2),
    reference.artifactSha256,
    "Direct catalog source-equation dependency changed."
  );
  return JSON.parse(bytes2.toString("utf8"));
}
function catalogExtensionEquations(context) {
  const specification = ts.createSourceFile(
    CATALOG_EXTENSION_LAW_PATH,
    fs29.readFileSync(CATALOG_EXTENSION_LAW_PATH, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  assert32.equal(
    specification.parseDiagnostics.length,
    0,
    "Catalog-extension equation source has syntax errors."
  );
  const names = [
    "extendInventoryCatalog",
    "mergeInventoryCatalogRevisionFamily"
  ];
  const equations2 = names.map((name) => {
    const actual = findFunction11(context, "src/catalog.ts", name);
    const matches = specification.statements.filter(
      (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name
    );
    assert32.equal(matches.length, 1, `Expected one extension law '${name}'.`);
    const actualTerm = typeErasedJavaScriptTerm(actual);
    const expectedTerm = executableTerm(matches[0]);
    assert32.equal(
      actualTerm,
      expectedTerm,
      `SEMANTIC_EQUATION_MISMATCH: src/catalog.ts#${name}`
    );
    return {
      key: `src/catalog.ts#${name}`,
      lawId: "immutable-catalog-extension-v1",
      declaration: spanOf(context, actual),
      expectedTermSha256: sha256(expectedTerm)
    };
  });
  const extension = findFunction11(
    context,
    "src/catalog.ts",
    "extendInventoryCatalog"
  );
  const mergeCalls = [];
  function inspectExtension(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "mergeInventoryCatalogRevisionFamily") {
      mergeCalls.push(node);
    }
    ts.forEachChild(node, inspectExtension);
  }
  inspectExtension(extension);
  assert32.equal(mergeCalls.length, 6);
  const expectedDigests = [
    "inventoryItemRevisionDigest",
    "inventoryPackagingRevisionDigest",
    "inventoryCompositionRevisionDigest",
    "inventoryTransformationRevisionDigest",
    "inventoryCollectionRevisionDigest",
    "inventoryFungibilityRevisionDigest"
  ];
  for (const [index, call] of mergeCalls.entries()) {
    assert32(ts.isArrowFunction(call.arguments[2]));
    assert32(ts.isIdentifier(call.arguments[3]));
    assert32.equal(call.arguments[3].text, expectedDigests[index]);
  }
  const merge = findFunction11(
    context,
    "src/catalog.ts",
    "mergeInventoryCatalogRevisionFamily"
  );
  const parameterInvocations = { revisionId: 0, digest: 0 };
  function inspectMerge(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === "revisionId") parameterInvocations.revisionId += 1;
      if (node.expression.text === "digest") parameterInvocations.digest += 1;
    }
    ts.forEachChild(node, inspectMerge);
  }
  inspectMerge(merge);
  assert32.equal(parameterInvocations.revisionId, 2);
  assert32.equal(parameterInvocations.digest, 2);
  return {
    specification: {
      file: normalizeRelativePath(REPOSITORY_ROOT2, CATALOG_EXTENSION_LAW_PATH),
      sha256: sha256(fs29.readFileSync(CATALOG_EXTENSION_LAW_PATH)),
      independentlyDeclared: true,
      executedProductionCode: false
    },
    equations: equations2,
    higherOrderCallsiteJoin: {
      mergeCallCount: mergeCalls.length,
      revisionIdentitySuppliers: "six embedded revision.revisionId arrows",
      digestSuppliers: expectedDigests,
      parameterInvocations,
      externalFunctionValues: 0
    },
    reusedDependencyEquationIds: [
      "src/catalog.ts#defineInventoryCatalog",
      ...expectedDigests.map((name) => `src/catalog.ts#${name}`)
    ]
  };
}
function bindSurfaceAlias(callableByKey, surfaceKey, equationKey, relationKind, implementation) {
  const callable = callableByKey.get(surfaceKey);
  assert32.notEqual(callable, void 0, `Compiler surface omitted '${surfaceKey}'.`);
  assert32.equal(
    callable.signatureHash,
    sha256(canonicalJson(callable.signature)),
    `Compiler signature identity drifted for '${surfaceKey}'.`
  );
  if (implementation !== void 0) {
    assert32.deepEqual(
      callable.declaration,
      implementation,
      `Public alias '${surfaceKey}' does not resolve to '${equationKey}'.`
    );
    assert32(
      callable.symbolDeclarations.some(
        (declaration) => canonicalJson(declaration) === canonicalJson(implementation)
      ),
      `Public symbol '${surfaceKey}' omits '${equationKey}'.`
    );
  }
  return {
    surfaceKey,
    signatureHash: callable.signatureHash,
    signature: callable.signature,
    declaration: callable.declaration,
    relation: {
      kind: relationKind,
      reachabilityPaths: callable.reachabilityPaths,
      symbolDeclarations: callable.symbolDeclarations,
      ...implementation === void 0 ? {} : { implementation }
    },
    equationKey
  };
}
function storageBoundaryEvidence(sourceEquationCore) {
  const affected = new Set(
    CATALOG_READ_STORAGE_ACQUISITION_BLOCKER.affectedSurfaceKeys
  );
  const equations2 = sourceEquationCore.sourceEquations.filter(
    (equation3) => equation3.className === "InventoryOnceCatalogImplementation" && affected.has(
      `type:src/facade.ts#InventoryOnceCatalogApi.${equation3.methodName}::call[0]`
    )
  );
  assert32.equal(equations2.length, 3);
  assert32.deepEqual(
    equations2.map(
      (equation3) => `type:src/facade.ts#InventoryOnceCatalogApi.${equation3.methodName}::call[0]`
    ),
    CATALOG_READ_STORAGE_ACQUISITION_BLOCKER.affectedSurfaceKeys
  );
  return {
    ...CATALOG_READ_STORAGE_ACQUISITION_BLOCKER,
    localSourceEquations: equations2,
    blockedRows: equations2.length,
    proposedStrictVRows: 0,
    sampledInputs: 0
  };
}
function buildSemanticCore2(context, sourceOverrides, surface) {
  const priorSourceCertificate = publishedSourceCertificate();
  const priorSourceEquations = priorSourceCertificate.semanticCore;
  const priorByMethod = new Map(
    priorSourceEquations.sourceEquations.map((equation3) => [
      equation3.producerMethod,
      equation3
    ])
  );
  const programSlice = buildClosedProgramSlice(context);
  const higherOrderClosures = buildHigherOrderClosures(context, programSlice);
  const equations2 = declarationEquations(context, programSlice);
  const sourceComparisons = cleanHubComparisons(programSlice, sourceOverrides);
  const equationByKey2 = new Map(
    equations2.independent.map((equation3) => [equation3.key, equation3])
  );
  const closedEquationByKey = new Map(
    [...equations2.independent, ...equations2.reused].map((equation3) => [
      equation3.key,
      equation3
    ])
  );
  assert32.equal(surface.callables.length, 535);
  assert32.equal(
    surface.digest,
    CATALOG_READ_OFFICIAL_SURFACE_DIGEST,
    "Catalog-read registration must bind the official clean-hub compiler surface."
  );
  const callableByKey = new Map(
    surface.callables.map((callable) => [callable.key, callable])
  );
  const proofs = CATALOG_READ_SNAPSHOT_CONTRACTS.map((contract) => {
    const implementation = findClassMethod3(
      context,
      "src/facade.ts",
      "InventoryOnceReadSnapshotImplementation",
      contract.methodName
    );
    const implementationKey = callableKey(implementation);
    const helper = findFunction11(
      context,
      contract.helperSourceFile,
      contract.helperName
    );
    const helperKey = callableKey(helper);
    const helperTerm = equationByKey2.get(helperKey);
    assert32.notEqual(helperTerm, void 0);
    const facadeSourceEquation = priorByMethod.get(
      `InventoryOnceReadSnapshotImplementation.${contract.methodName}`
    );
    assert32.notEqual(facadeSourceEquation, void 0);
    const surfaceCallable = callableByKey.get(contract.surfaceKey);
    assert32.notEqual(
      surfaceCallable,
      void 0,
      `Compiler surface omitted '${contract.surfaceKey}'.`
    );
    const reachable = reachableEquationKeys(programSlice, helperKey);
    return {
      surfaceKey: contract.surfaceKey,
      signatureHash: surfaceCallable.signatureHash,
      declaration: surfaceCallable.declaration,
      relation: publicSnapshotRelation(
        context,
        surfaceCallable,
        implementation,
        contract.methodName
      ),
      facadeEquation: contract.facadeEquation,
      facadeSourceEquation,
      implementationEquationKey: implementationKey,
      helperEquation: contract.helperEquation,
      helperEquationKey: helperKey,
      helperExpectedTermSha256: helperTerm.expectedTermSha256,
      reachableEquationCount: reachable.length,
      dependencyClosureSha256: sha256(canonicalJson(reachable))
    };
  });
  const helperAliasProofs = CATALOG_READ_HELPER_ALIAS_BINDINGS.map(
    (binding) => bindSurfaceAlias(
      callableByKey,
      binding.surfaceKey,
      binding.equationKey,
      "COMPILER_RESOLVED_EXACT_HELPER_ALIAS",
      closedEquationByKey.get(binding.equationKey)?.declaration
    )
  );
  for (const binding of CATALOG_READ_HELPER_ALIAS_BINDINGS) {
    assert32(
      closedEquationByKey.has(binding.equationKey),
      `Helper alias '${binding.surfaceKey}' lacks a closed equation.`
    );
  }
  const constructionHandoffBindings = CATALOG_READ_CONSTRUCTION_ALIAS_BINDINGS.map(
    (surfaceKey) => {
      const binding = priorSourceCertificate.reviewEnvelope.compilerBindings.find(
        (candidate) => candidate.surfaceKey === surfaceKey
      );
      assert32.notEqual(
        binding,
        void 0,
        `Direct source certificate omitted '${surfaceKey}'.`
      );
      return {
        surfaceKey,
        signatureHash: binding.callableIdentity.signatureHash,
        signature: binding.callableIdentity.signature,
        declaration: binding.callableIdentity.declaration,
        relation: {
          kind: "REUSED_CONTENT_ADDRESSED_DIRECT_SOURCE_BINDING",
          certificateId: CATALOG_READ_REUSED_CERTIFICATES.find(
            (candidate) => candidate.family === "catalog-published-direct-source"
          ).certificateId,
          producerEquation: binding.producerEquation
        },
        equationKey: binding.producerEquation
      };
    }
  );
  const extension = catalogExtensionEquations(context);
  const extensionHandoffBindings = CATALOG_READ_EXTENSION_ALIAS_BINDINGS.map(
    (surfaceKey) => bindSurfaceAlias(
      callableByKey,
      surfaceKey,
      "src/catalog.ts#extendInventoryCatalog",
      "COMPILER_RESOLVED_EXACT_EXTENSION_ALIAS",
      extension.equations.find(
        (equation3) => equation3.key === "src/catalog.ts#extendInventoryCatalog"
      )?.declaration
    )
  );
  const strengthenedProofs = CATALOG_READ_STRENGTHENED_ALIAS_BINDINGS.map(
    (surfaceKey) => bindSurfaceAlias(
      callableByKey,
      surfaceKey,
      "official-clean-hub-2f39cfe#inventoryCatalogSnapshot",
      "STRENGTHENED_EXISTING_V_ALIAS"
    )
  );
  const proposedProofs = [
    ...proofs,
    ...helperAliasProofs
  ];
  assert32.equal(proposedProofs.length, supportedSurfaceKeys19.length);
  assert32.equal(
    new Set(proposedProofs.map((proof) => proof.surfaceKey)).size,
    supportedSurfaceKeys19.length
  );
  const foundationHandoffBindings = [
    ...constructionHandoffBindings,
    ...extensionHandoffBindings
  ];
  assert32.equal(foundationHandoffBindings.length, 13);
  return {
    schemaVersion: 2,
    familyId: FAMILY_ID,
    familyVersion: 2,
    proofKind: CATALOG_READ_DEPENDENCY_CLOSURE_PROOF_KIND,
    sourceBase: {
      commit: CATALOG_READ_CLEAN_HUB_COMMIT,
      relevantSourceFiles: sourceComparisons
    },
    surfaceDigest: surface.digest,
    domain: CATALOG_READ_DEPENDENCY_CLOSURE_DOMAIN,
    claim: "For every valid input in the declared domain, the six snapshot methods and four unreserved pure helper aliases return or throw exactly as independently declared family equations specify; catalog-foundation aliases are retained only as a no-credit handoff to their reassigned owner.",
    excluded: "Mutable/proxied/custom receivers, replaced ECMAScript built-ins, storage acquisition, clocks not supplied as arguments, I/O, and catalog publication are outside this pure frozen-snapshot family.",
    allAdmittedInputs: true,
    sampledInputs: 0,
    proofCounts: {
      candidateAuthorityReadRows: 9,
      eligibleSnapshotRows: proofs.length,
      eligibleHelperAliasRows: helperAliasProofs.length,
      yieldedFoundationAliasRows: foundationHandoffBindings.length,
      proposedStrictVRows: proposedProofs.length,
      strengthenedExistingVRows: strengthenedProofs.length,
      blockedStorageRows: CATALOG_READ_STORAGE_ACQUISITION_BLOCKER.affectedSurfaceKeys.length,
      completeCallableEquations: programSlice.callables.size,
      completeRuntimeValueEquations: programSlice.values.size,
      independentEquationRows: equations2.independent.length,
      reusedEquationRows: equations2.reused.length,
      implicitConstructorEquations: programSlice.implicitConstructors.size,
      closedHigherOrderTargets: higherOrderClosures.length,
      externalFunctionValues: higherOrderClosures.reduce(
        (total, closure) => total + closure.externalFunctionValues,
        0
      ),
      sampledInputs: 0,
      producerGraphRuns: 0
    },
    laws: CATALOG_READ_FAMILY_LAWS,
    specifications: CATALOG_READ_EXPECTED_LAW_FILES.map((file) => ({
      file,
      sha256: sha256(fs29.readFileSync(path32.join(REPOSITORY_ROOT2, file))),
      independentlyDeclared: true,
      executedProductionCode: false
    })),
    independentEquations: equations2.independent,
    reusedEquations: equations2.reused,
    reusedCertificates: CATALOG_READ_REUSED_CERTIFICATES,
    dependencyGraph: [...programSlice.directDependencies.entries()].map(([key, dependencies]) => ({
      key,
      dependencies: [...dependencies].sort(compareCodeUnits)
    })).sort((left, right) => compareCodeUnits(left.key, right.key)),
    implicitConstructorEquations: [
      ...programSlice.implicitConstructors.values()
    ].sort((left, right) => compareCodeUnits(left.key, right.key)),
    higherOrderClosures,
    catalogFoundationHandoff: {
      owner: "catalog-foundation-r7",
      creditRequestedByAuthority: false,
      reason: "Hub CATALOG_FOUNDATION_PARALLEL_SPLIT reassigned every still-unadmitted src/catalog.ts construction/definition/extension surface to the dedicated foundation lane.",
      bindings: foundationHandoffBindings,
      partialIndependentExtensionEquations: extension
    },
    nativeLibraryDeclarations: [...programSlice.nativeDeclarations.entries()].map(([key, declaration]) => ({ key, declaration })).sort((left, right) => compareCodeUnits(left.key, right.key)),
    proofs: proposedProofs,
    strengthenedProofs,
    storageBoundary: storageBoundaryEvidence(priorSourceEquations)
  };
}
function buildCatalogReadDependencyClosureArtifact({
  repositoryRoot = REPOSITORY_ROOT2,
  context,
  surface,
  sourceOverrides = /* @__PURE__ */ new Map()
} = {}) {
  assert32.equal(path32.resolve(repositoryRoot), REPOSITORY_ROOT2);
  const compilerSurface = surface ?? currentCompilerSurface();
  const usesCachedDefault = context === void 0 && surface === void 0 && sourceOverrides.size === 0;
  const semanticCore = usesCachedDefault ? buildCatalogReadDependencyClosureCertificate().semanticCore : buildSemanticCore2(
    sourceOverrides.size > 0 ? loadOverriddenContext4(sourceOverrides) : context ?? loadCompilerContext(REPOSITORY_ROOT2),
    sourceOverrides,
    compilerSurface
  );
  assert32.equal(semanticCore.surfaceDigest, compilerSurface.digest);
  return {
    schemaVersion: 1,
    mode: "V",
    proofKind: CATALOG_READ_DEPENDENCY_CLOSURE_PROOF_KIND,
    surfaceDigest: compilerSurface.digest,
    domain: semanticCore.domain,
    excluded: semanticCore.excluded,
    allAdmittedInputs: true,
    sampledInputs: 0,
    inputs: uniqueInputs([
      ...semanticCore.sourceBase.relevantSourceFiles.map((source7) => ({
        file: source7.file,
        sha256: source7.cleanHubSha256
      })),
      ...producerInputs({
        nativeDeclarations: new Map(
          semanticCore.nativeLibraryDeclarations.map((entry) => [
            entry.key,
            entry.declaration
          ])
        )
      })
    ]),
    laws: semanticCore.laws.filter(
      (law) => law.lawId !== "immutable-catalog-extension-v1"
    ),
    specifications: semanticCore.specifications,
    independentEquations: semanticCore.independentEquations,
    reusedEquations: semanticCore.reusedEquations,
    reusedCertificates: semanticCore.reusedCertificates,
    dependencyGraph: semanticCore.dependencyGraph,
    implicitConstructorEquations: semanticCore.implicitConstructorEquations,
    higherOrderClosures: semanticCore.higherOrderClosures,
    nativeLibraryDeclarations: semanticCore.nativeLibraryDeclarations,
    proofs: semanticCore.proofs,
    strengthenedProofs: semanticCore.strengthenedProofs
  };
}
var buildFamilyArtifact20 = buildCatalogReadDependencyClosureArtifact;
function buildCatalogReadDependencyClosureCertificate(sourceOverrides = /* @__PURE__ */ new Map()) {
  if (sourceOverrides.size === 0 && cachedCertificateJson !== void 0) {
    return JSON.parse(cachedCertificateJson);
  }
  const context = sourceOverrides.size === 0 ? loadCompilerContext(REPOSITORY_ROOT2) : loadOverriddenContext4(sourceOverrides);
  const surface = currentCompilerSurface();
  const semanticCore = buildSemanticCore2(context, sourceOverrides, surface);
  const contentSha256 = sha256(canonicalJson(semanticCore));
  const verifierPath2 = fileURLToPath14(import.meta.url);
  const document = {
    certificateKind: "INVENTORYONCE_CATALOG_READ_DEPENDENCY_CLOSURE",
    semanticCore,
    contentAddress: {
      algorithm: "sha256",
      contentSha256,
      certificateId: `CATALOG_READ_DEPENDENCY_CLOSURE:sha256:${contentSha256}`
    },
    reviewEnvelope: {
      status: "READY_TO_PORT",
      currentStrictBank: {
        admitted: 190,
        total: 535,
        officialCleanHubCommit: "e46b42b03e7302f3ce215f906e0b8d6adcd6b7ca",
        rejectedOlderSurfaceCount: 91,
        olderSurfaceCreditGranted: false
      },
      proposedBindings: semanticCore.proofs.map((proof) => ({
        surfaceKey: proof.surfaceKey,
        mode: "V",
        proofKind: semanticCore.proofKind,
        creditGrantedByLane: false
      })),
      blockedBindings: CATALOG_READ_STORAGE_ACQUISITION_BLOCKER.affectedSurfaceKeys.map(
        (surfaceKey) => ({
          surfaceKey,
          blocker: CATALOG_READ_STORAGE_ACQUISITION_BLOCKER.gapId,
          strictVCreditGranted: false
        })
      ),
      verifier: {
        file: normalizeRelativePath(REPOSITORY_ROOT2, verifierPath2),
        sha256: sha256(fs29.readFileSync(verifierPath2))
      },
      contract: {
        file: normalizeRelativePath(
          REPOSITORY_ROOT2,
          path32.join(
            FAMILY_DIRECTORY2,
            "catalog-read-dependency-closure-contracts.mjs"
          )
        ),
        sha256: sha256(
          fs29.readFileSync(
            path32.join(
              FAMILY_DIRECTORY2,
              "catalog-read-dependency-closure-contracts.mjs"
            )
          )
        )
      },
      strengthenedBindings: semanticCore.strengthenedProofs.map((proof) => ({
        surfaceKey: proof.surfaceKey,
        mode: "V",
        additionalDependencyClosureOnly: true,
        newStrictCreditRequested: false
      })),
      yieldedFoundationBindings: semanticCore.catalogFoundationHandoff.bindings.map((binding) => ({
        surfaceKey: binding.surfaceKey,
        owner: semanticCore.catalogFoundationHandoff.owner,
        creditRequestedByAuthority: false
      })),
      sharedGateReplacedOrBypassed: false,
      hubOwnsFinalAdmission: true,
      producerGraphsRerun: 0,
      localStrictCreditGranted: false
    }
  };
  if (sourceOverrides.size === 0) cachedCertificateJson = JSON.stringify(document);
  return document;
}
function verifyCatalogReadDependencyClosureCertificate(document) {
  requireExactKeys2(
    document,
    ["certificateKind", "semanticCore", "contentAddress", "reviewEnvelope"],
    "Catalog read dependency-closure certificate"
  );
  const expected = buildCatalogReadDependencyClosureCertificate();
  assert32.deepEqual(
    document,
    expected,
    "Catalog read dependency-closure certificate differs from current family truth."
  );
  return {
    certificateId: document.contentAddress.certificateId,
    eligibleSnapshotRows: document.semanticCore.proofCounts.eligibleSnapshotRows,
    proposedStrictVRows: document.semanticCore.proofCounts.proposedStrictVRows,
    strengthenedExistingVRows: document.semanticCore.proofCounts.strengthenedExistingVRows,
    blockedStorageRows: document.semanticCore.proofCounts.blockedStorageRows,
    completeCallableEquations: document.semanticCore.proofCounts.completeCallableEquations,
    completeRuntimeValueEquations: document.semanticCore.proofCounts.completeRuntimeValueEquations,
    independentEquationRows: document.semanticCore.proofCounts.independentEquationRows,
    reusedEquationRows: document.semanticCore.proofCounts.reusedEquationRows,
    closedHigherOrderTargets: document.semanticCore.proofCounts.closedHigherOrderTargets,
    sampledInputs: document.semanticCore.proofCounts.sampledInputs,
    producerGraphRuns: document.semanticCore.proofCounts.producerGraphRuns,
    blocker: document.semanticCore.storageBoundary.gapId,
    hubOwnsFinalAdmission: document.reviewEnvelope.hubOwnsFinalAdmission
  };
}
function verifyPersistedCatalogReadDependencyClosureCertificate() {
  return verifyCatalogReadDependencyClosureCertificate(
    JSON.parse(fs29.readFileSync(CERTIFICATE_PATH2, "utf8"))
  );
}
function verifyPersistedCatalogReadFamilyArtifact() {
  const recorded = JSON.parse(fs29.readFileSync(REGISTERED_FAMILY_PATH, "utf8"));
  const expected = buildFamilyArtifact20();
  assert32.deepEqual(
    recorded,
    expected,
    "Recorded catalog-read family differs from independently rederived semantics."
  );
  assert32.deepEqual(
    recorded.proofs.map((proof) => proof.surfaceKey),
    supportedSurfaceKeys19,
    "Recorded catalog-read family does not contain exactly its reviewed members."
  );
  return {
    proofKind: recorded.proofKind,
    supportedSurfaceRows: recorded.proofs.length,
    schemaVersion: recorded.schemaVersion,
    surfaceDigest: recorded.surfaceDigest,
    evidenceSha256: sha256(fs29.readFileSync(REGISTERED_FAMILY_PATH))
  };
}
function writeCatalogReadDependencyClosureCertificate() {
  const document = buildCatalogReadDependencyClosureCertificate();
  fs29.writeFileSync(CERTIFICATE_PATH2, `${JSON.stringify(document, null, 2)}
`);
  fs29.writeFileSync(
    REGISTERED_FAMILY_PATH,
    `${JSON.stringify(buildFamilyArtifact20(), null, 2)}
`
  );
  return verifyCatalogReadDependencyClosureCertificate(document);
}
function runCommandLine2() {
  const mode = process.argv[2] ?? "--verify";
  if (mode !== "--write" && mode !== "--verify") {
    throw new Error(`Unknown dependency-closure mode '${mode}'.`);
  }
  const certificateSummary = mode === "--write" ? writeCatalogReadDependencyClosureCertificate() : verifyPersistedCatalogReadDependencyClosureCertificate();
  const registeredFamily = verifyPersistedCatalogReadFamilyArtifact();
  process.stdout.write(
    `${JSON.stringify({ ...certificateSummary, registeredFamily }, null, 2)}
`
  );
}
if (process.argv[1] !== void 0 && path32.resolve(process.argv[1]) === fileURLToPath14(import.meta.url)) {
  runCommandLine2();
}

// experiments/tla-conformance/astra-authority-control-r8/family.mjs
import assert33 from "node:assert/strict";
import fs30 from "node:fs";
import path33 from "node:path";

// experiments/tla-conformance/astra-authority-control-r8/laws.mjs
var state = (field) => ["get", ["arg", 0], field];
var length = (field) => ["get", state(field), "length"];
var compare = (operator, left, right) => [operator, left, ["literal", right]];
var any = (...terms) => terms.reduce((left, right) => ["||", left, right]);
var fields = (...names) => names.map((name) => [name, state(name)]);
var laws2 = [
  {
    /** Exact public function and source module. */
    name: "inventoryAuthorityCutoverResult",
    file: "src/authority-cutover.ts",
    /** Full parameter/default, guard, error and returned-record equations. */
    term: [
      [null],
      [
        "if",
        any(compare("!==", state("activationKind"), "legacy-cutover"), ...["cutoverAuthorizationId", "sourcePlanDigest", "sourceCatalogDigest", "targetWorldRoot"].map((field) => compare("===", length(field), 0)), compare("<", state("targetWorldRevision"), 0)),
        ["throw", ["error", ["literal", "InventoryOnce authoritative state is missing cutover evidence."]]]
      ],
      ["return", ["record", [["authority", ["arg", 0]], ["authorizationId", state("cutoverAuthorizationId")], ...fields("sourcePlanDigest", "sourceCatalogDigest", "targetWorldRoot", "targetWorldRevision")]]]
    ]
  },
  {
    /** Exact public function and source module. */
    name: "inventoryAuthorityGreenfieldResult",
    file: "src/authority-cutover.ts",
    /** Greenfield rejects wrong mode/kind, missing evidence, nonzero revision and legacy residue. */
    term: [
      [null],
      [
        "if",
        any(compare("!==", state("mode"), "authoritative"), compare("!==", state("activationKind"), "greenfield"), ...["greenfieldAuthorizationId", "adapterCertificationDigest", "targetWorldRoot"].map((field) => compare("===", length(field), 0)), compare("!==", state("targetWorldRevision"), 0), ...["sourceRoot", "sourcePlanDigest", "sourceCatalogDigest", "fenceToken"].map((field) => compare("!==", length(field), 0))),
        ["throw", ["error", ["literal", "InventoryOnce authoritative state does not contain valid greenfield evidence."]]]
      ],
      ["return", ["record", [["authority", ["arg", 0]], ["authorizationId", state("greenfieldAuthorizationId")], ["targetWorldRoot", state("targetWorldRoot")], ["targetWorldRevision", ["literal", 0]]]]]
    ]
  },
  {
    /** Exact public function and source module. */
    name: "requireInventoryAuthorityMode",
    file: "src/authority.ts",
    /** The optional operation label defaults only for undefined, as in a native default parameter. */
    term: [
      [null, null, ["literal", "Inventory operation"]],
      ["if", ["!==", ["arg", 0], ["arg", 1]], ["throw", ["error", ["template", "", [[["arg", 2], " requires authority mode '"], [["arg", 1], "', current mode is '"], [["arg", 0], "'."]]]]]]
    ]
  }
];

// experiments/tla-conformance/astra-authority-control-r8/family.mjs
var proofKind17 = "astra-authority-control-complete-values-v1";
var supportedSurfaceKeys20 = Object.freeze(laws2.map((law) => `export:.#${law.name}::call[0]`));
var directory2 = "experiments/tla-conformance/astra-authority-control-r8";
var enumValues4 = /* @__PURE__ */ new Map([
  ["InventoryAuthorityMode.Authoritative", "authoritative"],
  ["InventoryAuthorityActivationKind.LegacyCutover", "legacy-cutover"],
  ["InventoryAuthorityActivationKind.Greenfield", "greenfield"]
]);
var inputs2 = [
  "src/authority.ts",
  "src/authority-cutover.ts",
  `${directory2}/family.mjs`,
  `${directory2}/laws.mjs`,
  "experiments/tla-conformance/surface-bindings/lib/compiler-surface.mjs",
  "experiments/tla-conformance/throughput-r7/registered-value-family.mjs",
  "node_modules/typescript/package.json",
  "node_modules/typescript/lib/lib.es5.d.ts",
  "node_modules/typescript/lib/lib.es2022.error.d.ts",
  "package.json",
  "tsconfig.json"
];
function symbolAt(context, node) {
  const symbol = context.checker.getSymbolAtLocation(node);
  assert33(symbol, `Unresolved runtime name ${node.getText()}`);
  return symbol.flags & ts.SymbolFlags.Alias ? context.checker.getAliasedSymbol(symbol) : symbol;
}
function runtimeValue(context, node, root3) {
  const symbol = symbolAt(context, node);
  const declarations = symbol.declarations ?? [];
  assert33(declarations.length > 0);
  if (node.getText() === "Error") {
    const allowed = new Set(["lib.es5.d.ts", "lib.es2022.error.d.ts"].map((file) => fs30.realpathSync(path33.join(root3, "node_modules/typescript/lib", file))));
    for (const declaration2 of declarations) assert33(allowed.has(fs30.realpathSync(declaration2.getSourceFile().fileName)), "Shadowed Error");
    return { name: "Error", declarations: declarations.map((declaration2) => spanOf(context, declaration2)) };
  }
  assert33.equal(declarations.length, 1);
  const declaration = declarations[0];
  assert33(ts.isEnumMember(declaration) && declaration.initializer && ts.isStringLiteral(declaration.initializer), "Runtime value is not a literal enum member");
  assert33.equal(path33.relative(root3, declaration.getSourceFile().fileName), "src/authority.ts");
  assert33.equal(declaration.initializer.text, enumValues4.get(node.getText()), "Enum semantic value changed");
  return { name: node.getText(), value: declaration.initializer.text, declaration: spanOf(context, declaration) };
}
function sourceTerm(declaration, resolveRuntime) {
  assert33(declaration.body && ts.isFunctionDeclaration(declaration));
  assert33(!declaration.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword));
  const parameters = declaration.parameters.map((parameter) => {
    assert33(ts.isIdentifier(parameter.name) && !parameter.dotDotDotToken);
    return parameter.name.text;
  });
  function expression(node) {
    if (ts.isParenthesizedExpression(node)) return expression(node.expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return ["literal", node.text];
    if (ts.isNumericLiteral(node)) return ["literal", Number(node.text)];
    if (ts.isIdentifier(node)) {
      const index = parameters.indexOf(node.text);
      assert33(index >= 0, `Unproved free name ${node.text}`);
      return ["arg", index];
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (enumValues4.has(node.getText())) {
        resolveRuntime(node);
        return ["literal", enumValues4.get(node.getText())];
      }
      return ["get", expression(node.expression), node.name.text];
    }
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.getText();
      assert33(["!==", "===", "<", "||"].includes(operator), `Unsupported operator ${operator}`);
      return [operator, expression(node.left), expression(node.right)];
    }
    if (ts.isNewExpression(node)) {
      assert33(ts.isIdentifier(node.expression) && node.expression.text === "Error" && node.arguments?.length === 1, "Unproved constructor");
      resolveRuntime(node.expression);
      return ["error", expression(node.arguments[0])];
    }
    if (ts.isTemplateExpression(node)) return ["template", node.head.text, node.templateSpans.map((span) => [expression(span.expression), span.literal.text])];
    if (ts.isObjectLiteralExpression(node)) return ["record", node.properties.map((property) => {
      assert33(ts.isPropertyAssignment(property) && ts.isIdentifier(property.name), "Unproved property/spread/getter");
      return [property.name.text, expression(property.initializer)];
    })];
    throw new Error(`Unproved expression ${ts.SyntaxKind[node.kind]}`);
  }
  function statement(node) {
    if (ts.isIfStatement(node)) {
      assert33(!node.elseStatement && ts.isBlock(node.thenStatement) && node.thenStatement.statements.length === 1);
      return ["if", expression(node.expression), statement(node.thenStatement.statements[0])];
    }
    if (ts.isThrowStatement(node)) return ["throw", expression(node.expression)];
    if (ts.isReturnStatement(node)) {
      assert33(node.expression);
      return ["return", expression(node.expression)];
    }
    throw new Error(`Unproved statement ${ts.SyntaxKind[node.kind]}`);
  }
  return [declaration.parameters.map((parameter) => parameter.initializer ? expression(parameter.initializer) : null), ...declaration.body.statements.map(statement)];
}
function buildFamilyArtifact21({ repositoryRoot, context, surface }) {
  const root3 = path33.resolve(repositoryRoot);
  assert33.equal(path33.resolve(context.repositoryRoot), root3);
  const proofs = laws2.map((law, index) => {
    const callable = surface.callables.find((candidate) => candidate.key === supportedSurfaceKeys20[index]);
    assert33(callable && callable.declaration.file === law.file);
    const source7 = context.program.getSourceFile(path33.resolve(root3, law.file));
    assert33(source7 && sha256(source7.text) === sha256(fs30.readFileSync(path33.resolve(root3, law.file))), "Stale compiler source");
    const declaration = nodeAtExactSpan(source7, callable.declaration.start.offset, callable.declaration.end.offset);
    assert33(declaration && ts.isFunctionDeclaration(declaration) && declaration.name.text === law.name);
    assert33.deepEqual(spanOf(context, declaration), callable.declaration);
    const dependencies = /* @__PURE__ */ new Map();
    const term4 = sourceTerm(declaration, (node) => {
      const value = runtimeValue(context, node, root3);
      dependencies.set(value.name, value);
    });
    assert33.deepEqual(term4, law.term, `Independent complete equation differs: ${law.name}`);
    return {
      surfaceKey: callable.key,
      signatureHash: callable.signatureHash,
      declaration: callable.declaration,
      relation: { kind: "EXACT_COMPILER_EXPORT", reachabilityPaths: callable.reachabilityPaths, symbolDeclarations: callable.symbolDeclarations },
      equation: law.term,
      runtimeValues: [...dependencies.values()],
      helperCalls: []
    };
  });
  return {
    schemaVersion: 1,
    proofKind: proofKind17,
    mode: "V",
    surfaceDigest: surface.digest,
    sampledInputs: 0,
    allAdmittedInputs: true,
    domain: "All plain immutable authority records with published field types and native string/number values (including NaN, infinities and signed zero); all native mode strings and optional operation label. Native Error and standard property access, no replaced globals, proxies, accessors or concurrent mutation. No state-parser validation is assumed.",
    inputs: inputs2.map((file) => ({ file, sha256: sha256(fs30.readFileSync(path33.resolve(root3, file))) })),
    proofs
  };
}

// experiments/tla-conformance/migration-r5/traceability-value-family.mjs
import assert34 from "node:assert/strict";
import fs31 from "node:fs";
import path34 from "node:path";
var proofKind18 = "traceability-pure-relations-rebuild-independent-equations-v1";
var supportedSurfaceKeys21 = Object.freeze([
  "export:./kernel#buildContainmentChildContainerIndex::call[0]",
  "export:./kernel#inventoryGenealogyAncestors::call[0]",
  "export:./kernel#inventoryTraceabilityRelationIdentity::call[0]",
  "export:./kernel#inventoryTraceabilityRelationsOfKind::call[0]"
]);
var EXPECTED_FILE3 = "experiments/tla-conformance/migration-r5/traceability-values.expected.ts.txt";
var BOUNDED_CERTIFICATE = "experiments/tla-conformance/migration-r5/artifacts/TraceabilityGraph/projection-value-certificate.json";
var BOUNDED_OBSERVATIONS = "experiments/tla-conformance/migration-r5/artifacts/TraceabilityGraph/projection-value-observations.ndjson";
var contracts = Object.freeze([
  ["src/traceability.ts#buildContainmentChildContainerIndex", "src/traceability.ts", "buildContainmentChildContainerIndex"],
  ["src/traceability.ts#inventoryGenealogyAncestors", "src/traceability.ts", "inventoryGenealogyAncestors"],
  ["src/traceability.ts#inventoryTraceabilityRelationIdentity", "src/traceability.ts", "inventoryTraceabilityRelationIdentity"],
  ["src/traceability.ts#inventoryTraceabilityRelationsOfKind", "src/traceability.ts", "inventoryTraceabilityRelationsOfKind"],
  ["src/traceability.ts#compareRelation", "src/traceability.ts", "compareRelation"],
  ["src/traceability.ts#compareNode", "src/traceability.ts", "compareNode"],
  ["src/traceability-replay.ts#projectInventoryTraceabilityEvents", "src/traceability-replay.ts", "projectInventoryTraceabilityEvents"],
  ["src/traceability-replay.ts#validateAndIndexAddition", "src/traceability-replay.ts", "validateAndIndexAddition"],
  ["src/traceability-replay.ts#removeIndexedRelation", "src/traceability-replay.ts", "removeIndexedRelation"],
  ["src/traceability-replay.ts#assertNoGenealogyPath", "src/traceability-replay.ts", "assertNoGenealogyPath"],
  ["src/model.ts#assertInventoryIdentity", "src/model.ts", "assertInventoryIdentity"],
  ["src/model.ts#inventoryTraceabilityNodeIdentity", "src/model.ts", "inventoryTraceabilityNodeIdentity"],
  ["src/ordering.ts#compareInventoryIdentityText", "src/ordering.ts", "compareInventoryIdentityText"]
].map(([id, file, name]) => Object.freeze({ id, file, name, expected: `expected_${name}` })));
var expectedDependencies4 = /* @__PURE__ */ new Map([
  ["src/traceability.ts#buildContainmentChildContainerIndex", ["src/model.ts#inventoryTraceabilityNodeIdentity"]],
  ["src/traceability.ts#inventoryGenealogyAncestors", ["src/model.ts#inventoryTraceabilityNodeIdentity", "src/traceability.ts#compareNode"]],
  ["src/traceability.ts#inventoryTraceabilityRelationIdentity", ["src/model.ts#inventoryTraceabilityNodeIdentity"]],
  ["src/traceability.ts#inventoryTraceabilityRelationsOfKind", ["src/traceability.ts#compareRelation"]],
  ["src/traceability.ts#compareRelation", ["src/ordering.ts#compareInventoryIdentityText", "src/traceability.ts#inventoryTraceabilityRelationIdentity"]],
  ["src/traceability.ts#compareNode", ["src/model.ts#inventoryTraceabilityNodeIdentity", "src/ordering.ts#compareInventoryIdentityText"]],
  ["src/traceability-replay.ts#projectInventoryTraceabilityEvents", ["src/traceability-replay.ts#removeIndexedRelation", "src/traceability-replay.ts#validateAndIndexAddition", "src/traceability.ts#buildContainmentChildContainerIndex", "src/traceability.ts#inventoryTraceabilityRelationIdentity"]],
  ["src/traceability-replay.ts#validateAndIndexAddition", ["src/model.ts#inventoryTraceabilityNodeIdentity", "src/traceability-replay.ts#assertNoGenealogyPath"]],
  ["src/traceability-replay.ts#removeIndexedRelation", ["src/model.ts#inventoryTraceabilityNodeIdentity"]],
  ["src/traceability-replay.ts#assertNoGenealogyPath", []],
  ["src/model.ts#assertInventoryIdentity", []],
  ["src/model.ts#inventoryTraceabilityNodeIdentity", ["src/model.ts#assertInventoryIdentity"]],
  ["src/ordering.ts#compareInventoryIdentityText", []]
]);
function scanTokens4(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const tokens5 = [];
  for (; ; ) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    tokens5.push([ts.SyntaxKind[kind], scanner.getTokenText()]);
  }
  return tokens5;
}
function completeCallableTerm2(declaration, source7) {
  return {
    async: declaration.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
    generator: declaration.asteriskToken !== void 0,
    typeParameters: (declaration.typeParameters ?? []).map((row) => scanTokens4(row.getText(source7))),
    parameters: declaration.parameters.map((row) => scanTokens4(row.getText(source7))),
    returnType: declaration.type === void 0 ? null : scanTokens4(declaration.type.getText(source7)),
    body: scanTokens4(declaration.body.getText(source7))
  };
}
function findFunction12(source7, name) {
  const found = source7.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === name && node.body !== void 0);
  assert34.equal(found.length, 1, `Expected one concrete function '${name}'.`);
  return found[0];
}
function sourceFor2(repositoryRoot, context, file, overrides) {
  const override = overrides.get(file);
  if (override !== void 0) {
    return ts.createSourceFile(path34.resolve(repositoryRoot, file), override, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  }
  const source7 = context.program.getSourceFile(path34.resolve(repositoryRoot, file));
  assert34(source7 !== void 0 && !source7.isDeclarationFile, `Compiler omitted '${file}'.`);
  return source7;
}
function packageDeclarationId2(repositoryRoot, declaration) {
  const file = path34.relative(repositoryRoot, declaration.getSourceFile().fileName).replaceAll("\\", "/");
  if (!file.startsWith("src/") || !ts.isFunctionDeclaration(declaration) || declaration.name === void 0) return null;
  return `${file}#${declaration.name.text}`;
}
function directPackageDependencies2(repositoryRoot, context, declaration) {
  const dependencies = /* @__PURE__ */ new Set();
  function recordFunctionValue(expression) {
    if (!ts.isIdentifier(expression) && !ts.isPropertyAccessExpression(expression)) return;
    let symbol = context.checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression) ? expression.name : expression);
    if (symbol !== void 0 && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
      symbol = context.checker.getAliasedSymbol(symbol);
    }
    for (const candidate of symbol?.declarations ?? []) {
      const id = packageDeclarationId2(repositoryRoot, candidate);
      if (id !== null) dependencies.add(id);
    }
  }
  function visit(node) {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const target = context.checker.getResolvedSignature(node)?.declaration;
      const id = target === void 0 ? null : packageDeclarationId2(repositoryRoot, target);
      if (id !== null) dependencies.add(id);
      recordFunctionValue(node.expression);
      for (const argument of node.arguments ?? []) recordFunctionValue(argument);
      if (target !== void 0 && target.getSourceFile().isDeclarationFile) {
        assert34(/[/\\]typescript[/\\]lib[/\\]lib\.[^/\\]+\.d\.ts$/u.test(target.getSourceFile().fileName), "Only pinned TypeScript standard-library calls are admitted.");
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      const symbol = context.checker.getSymbolAtLocation(node.name);
      assert34(!(symbol?.declarations ?? []).some((row) => ts.isGetAccessorDeclaration(row) || ts.isSetAccessorDeclaration(row)), "Accessor-bearing values are outside the immutable-data domain.");
    }
    ts.forEachChild(node, visit);
  }
  visit(declaration.body);
  return [...dependencies].sort();
}
function buildTraceabilityValueArtifact({ repositoryRoot, context, surface, sourceOverrides = /* @__PURE__ */ new Map() }) {
  const expectedText = fs31.readFileSync(path34.resolve(repositoryRoot, EXPECTED_FILE3), "utf8");
  const expectedSource3 = ts.createSourceFile(EXPECTED_FILE3, expectedText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const localIds = new Set(contracts.map((contract) => contract.id));
  const equations2 = [];
  for (const contract of contracts) {
    const source7 = sourceFor2(repositoryRoot, context, contract.file, sourceOverrides);
    const implementation = findFunction12(source7, contract.name);
    const expected = findFunction12(expectedSource3, contract.expected);
    const actualTerm = completeCallableTerm2(implementation, source7);
    const expectedTerm = completeCallableTerm2(expected, expectedSource3);
    assert34.deepEqual(actualTerm, expectedTerm, `Independent algorithm equation changed: ${contract.id}`);
    const dependencies = sourceOverrides.has(contract.file) ? expectedDependencies4.get(contract.id) : directPackageDependencies2(repositoryRoot, context, implementation);
    assert34.deepEqual(dependencies, expectedDependencies4.get(contract.id), `Dependency closure changed: ${contract.id}`);
    for (const dependency2 of dependencies) assert34(localIds.has(dependency2), `Unproved dependency '${dependency2}'.`);
    equations2.push({
      id: contract.id,
      implementation: sourceOverrides.has(contract.file) ? null : spanOf(context, implementation),
      independentExpectedFunction: contract.expected,
      termSha256: sha256(canonicalJson(expectedTerm)),
      dependencies
    });
  }
  const boundedBytes = fs31.readFileSync(path34.resolve(repositoryRoot, BOUNDED_CERTIFICATE));
  const bounded = JSON.parse(boundedBytes.toString("utf8"));
  assert34.equal(bounded.native.totalHelperCalls, 33024);
  assert34.equal(bounded.formal.states, 1792);
  assert34.equal(bounded.scope.actionCreditGranted, false);
  const observationBytes = fs31.readFileSync(path34.resolve(repositoryRoot, BOUNDED_OBSERVATIONS));
  assert34.equal(sha256(observationBytes), bounded.observations.sha256);
  if (sourceOverrides.size > 0) return { mutationOnly: true, equations: equations2 };
  const callableByKey = new Map(surface.callables.map((row) => [row.key, row]));
  const equationByName = new Map(equations2.map((row) => [row.id.split("#")[1], row]));
  const proofs = supportedSurfaceKeys21.map((surfaceKey) => {
    const callable = callableByKey.get(surfaceKey);
    assert34(callable !== void 0, `Current surface omitted '${surfaceKey}'.`);
    const equation3 = equationByName.get(surfaceKey.match(/#([^:]+)::/)?.[1]);
    assert34(equation3 !== void 0);
    assert34.deepEqual(callable.declaration, equation3.implementation);
    return { surfaceKey, signatureHash: callable.signatureHash, declaration: callable.declaration, equationId: equation3.id, termSha256: equation3.termSha256 };
  });
  const inputs3 = [
    EXPECTED_FILE3,
    "experiments/tla-conformance/migration-r5/traceability-value-family.mjs",
    BOUNDED_CERTIFICATE,
    BOUNDED_OBSERVATIONS,
    "src/traceability.ts",
    "src/traceability-replay.ts",
    "src/model.ts",
    "src/ordering.ts"
  ].map((file) => ({ file, sha256: sha256(fs31.readFileSync(path34.resolve(repositoryRoot, file))) }));
  return {
    schemaVersion: 1,
    proofKind: proofKind18,
    surfaceDigest: surface.digest,
    allAdmittedInputs: true,
    sampledInputs: 0,
    domain: "All immutable plain InventoryTraceabilityState/relation/event records admitted by the public TypeScript shapes, with native Array/Map/Set/Object/JSON sorting and iteration semantics. The complete guards, ordering, iterative ancestry traversal, relation indexing, and ordered event rebuild equations are included.",
    inputs: inputs3,
    independentSpecification: { file: EXPECTED_FILE3, sha256: sha256(expectedText), executedProductionCode: false },
    dependencyEquations: equations2.filter((equation3) => [
      "src/model.ts#assertInventoryIdentity",
      "src/model.ts#inventoryTraceabilityNodeIdentity",
      "src/ordering.ts#compareInventoryIdentityText"
    ].includes(equation3.id)).map((equation3) => ({
      id: equation3.id,
      declaration: equation3.implementation,
      termSha256: equation3.termSha256,
      publicCreditClaimed: false
    })),
    boundedControl: { certificate: { file: BOUNDED_CERTIFICATE, sha256: sha256(boundedBytes) }, observations: { file: BOUNDED_OBSERVATIONS, sha256: sha256(observationBytes) }, helperCalls: 33024, universalCredit: false },
    equations: equations2,
    proofs
  };
}
function buildFamilyArtifact22(input2) {
  return buildTraceabilityValueArtifact(input2);
}

// experiments/tla-conformance/fungibility-values5-r8/family.mjs
import assert35 from "node:assert/strict";
import fs32 from "node:fs";
import path35 from "node:path";
var proofKind19 = "fungibility-scope-policy-batch-complete-values-v1";
var supportedSurfaceKeys22 = Object.freeze([
  "export:.#inventoryFungibilityScopeIdentity::call[0]",
  "export:.#inventoryPolicyBatchAllocationLinesByReference::call[0]",
  "export:.#normalizeInventoryFungibilityScope::call[0]",
  "export:./kernel#inventoryFungibilityScopeIdentity::call[0]",
  "export:./kernel#normalizeInventoryFungibilityScope::call[0]"
].sort());
var EXPECTED7 = "experiments/tla-conformance/fungibility-values5-r8/equations.expected.ts.txt";
var IDENTITY_DEP = "src/selectors.ts#normalizeInventoryStockSelector";
var contracts2 = Object.freeze([
  { id: "src/fungibility.ts#normalizeInventoryFungibilityScope", file: "src/fungibility.ts", name: "normalizeInventoryFungibilityScope", law: "Normalize all common pool scope dimensions through the exact stock-selector normalization equation, inject only the synthetic item discriminator for validation, then remove item and item-revision dimensions from the returned common scope.", dependencies: [IDENTITY_DEP] },
  { id: "src/fungibility.ts#inventoryFungibilityScopeIdentity", file: "src/fungibility.ts", name: "inventoryFungibilityScopeIdentity", law: "Serialize exactly the normalized fungibility scope with JSON.stringify and no caller-form representation.", dependencies: ["src/fungibility.ts#normalizeInventoryFungibilityScope"] },
  { id: "src/facade.ts#inventoryPolicyBatchAllocationLinesByReference", file: "src/facade.ts", name: "inventoryPolicyBatchAllocationLinesByReference", law: "Visit allocations in order, require every native request id to have an application reference, append every native allocation line in input order to that reference, and return the resulting reference map without rebuilding allocation truth.", dependencies: [] }
]);
var equationByKey = Object.freeze({
  "export:.#inventoryFungibilityScopeIdentity::call[0]": "src/fungibility.ts#inventoryFungibilityScopeIdentity",
  "export:./kernel#inventoryFungibilityScopeIdentity::call[0]": "src/fungibility.ts#inventoryFungibilityScopeIdentity",
  "export:.#normalizeInventoryFungibilityScope::call[0]": "src/fungibility.ts#normalizeInventoryFungibilityScope",
  "export:./kernel#normalizeInventoryFungibilityScope::call[0]": "src/fungibility.ts#normalizeInventoryFungibilityScope",
  "export:.#inventoryPolicyBatchAllocationLinesByReference::call[0]": "src/facade.ts#inventoryPolicyBatchAllocationLinesByReference"
});
function source4(root3, context, file, overrides) {
  const changed = overrides.get(file);
  if (changed !== void 0) return ts.createSourceFile(path35.resolve(root3, file), changed, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const s = context.program.getSourceFile(path35.resolve(root3, file));
  assert35(s !== void 0 && !s.isDeclarationFile, `Missing ${file}`);
  return s;
}
function findFunction13(s, name) {
  const rows = s.statements.filter((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert35.equal(rows.length, 1, `Expected one function ${name}`);
  assert35(rows[0].body !== void 0);
  return rows[0];
}
function tokens2(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const out = [];
  for (; ; ) {
    const k = scanner.scan();
    if (k === ts.SyntaxKind.EndOfFileToken) break;
    out.push([ts.SyntaxKind[k], scanner.getTokenText()]);
  }
  return out;
}
function term(s, d) {
  return tokens2(d.getText(s));
}
function addInput7(root3, inputs3, file) {
  if (inputs3.has(file)) return;
  inputs3.set(file, { file, sha256: sha256(fs32.readFileSync(path35.resolve(root3, file))) });
}
function identityReceipt2({ repositoryRoot, context, surface, sourceOverrides }) {
  const artifact = buildIdentityValuesFamilyArtifact({ repositoryRoot, context, surface, sourceOverrides });
  const equation3 = artifact.equations.find((row) => row.id === IDENTITY_DEP);
  assert35(equation3 !== void 0, "Identity selector equation missing");
  assert35.equal(equation3.lawId, "selector-normalization-v1");
  return { id: IDENTITY_DEP, lawId: equation3.lawId, declaration: equation3.declaration, termSha256: sha256(canonicalJson(equation3.term)), dependencies: equation3.dependencies, inputs: artifact.inputs };
}
function buildFamilyArtifact23({ repositoryRoot = process.cwd(), context = loadEvidenceCompilerContext(repositoryRoot, []), surface, sourceOverrides = /* @__PURE__ */ new Map() } = {}) {
  assert35(surface !== void 0, "surface required");
  const expectedText = fs32.readFileSync(path35.resolve(repositoryRoot, EXPECTED7), "utf8");
  const expected = ts.createSourceFile(path35.resolve(repositoryRoot, EXPECTED7), expectedText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert35.equal(expected.parseDiagnostics.length, 0);
  const identity = identityReceipt2({ repositoryRoot, context, surface, sourceOverrides });
  const equations2 = [];
  for (const c of contracts2) {
    const aSource = source4(repositoryRoot, context, c.file, sourceOverrides), a = findFunction13(aSource, c.name), e = findFunction13(expected, c.name);
    const actual = term(aSource, a), wanted = term(expected, e);
    assert35.deepEqual(actual, wanted, `Independent equation changed: ${c.id}`);
    equations2.push({ id: c.id, law: c.law, dependencies: c.dependencies, termSha256: sha256(canonicalJson(actual)), implementation: sourceOverrides.size === 0 ? spanOf(context, a) : { file: c.file, mutationControl: true } });
  }
  if (sourceOverrides.size > 0) return { mutationControlAccepted: false };
  const eq = new Map(equations2.map((x) => [x.id, x])), live = new Map(surface.callables.map((c) => [c.key, c]));
  const proofs = supportedSurfaceKeys22.map((surfaceKey) => {
    const callable = live.get(surfaceKey);
    assert35(callable !== void 0, `Missing ${surfaceKey}`);
    const equation3 = eq.get(equationByKey[surfaceKey]);
    assert35(equation3 !== void 0);
    return { surfaceKey, signatureHash: callable.signatureHash, declaration: callable.declaration, equationId: equation3.id, semantics: { law: equation3.law, completeExpectedTermSha256: equation3.termSha256, dependencies: equation3.dependencies.map((id) => id === IDENTITY_DEP ? { kind: "INDEPENDENT_IDENTITY_EQUATION", ...identity } : { kind: "SAME_FAMILY_COMPLETE_EQUATION", id }) } };
  });
  const inputs3 = /* @__PURE__ */ new Map();
  for (const f of ["experiments/tla-conformance/fungibility-values5-r8/family.mjs", EXPECTED7, "experiments/tla-conformance/identity-values-r7/family.mjs", "experiments/tla-conformance/identity-values-r7/equations.ts.txt", "src/fungibility.ts", "src/facade.ts", "src/selectors.ts"]) addInput7(repositoryRoot, inputs3, f);
  for (const i of identity.inputs ?? []) addInput7(repositoryRoot, inputs3, i.file);
  return { schemaVersion: 1, proofKind: proofKind19, surfaceDigest: surface.digest, domain: "All inputs admitted by the exact five public TypeScript signatures. Three pure implementations are checked against separately authored complete declaration terms; selector normalization is recursively tied to the independent identity-selector equation. No runtime samples or stateful action credit.", allAdmittedInputs: true, sampledInputs: 0, inputs: [...inputs3.values()].sort((a, b) => a.file.localeCompare(b.file)), equations: equations2, identityDependency: { id: identity.id, lawId: identity.lawId, declaration: identity.declaration, termSha256: identity.termSha256, dependencies: identity.dependencies }, proofs };
}

// experiments/tla-conformance/fungibility-read-r9/summary-family.mjs
import assert36 from "node:assert/strict";
import fs33 from "node:fs";
import path36 from "node:path";
var proofKind20 = "fungibility-summary-complete-values-v1";
var supportedSurfaceKeys23 = Object.freeze([
  "export:.#summarizeInventoryFungibility::call[0]",
  "export:./kernel#summarizeInventoryFungibility::call[0]",
  "type:src/facade.ts#InventoryOnceReadSnapshotApi.fungibilitySummary::call[0]"
].sort());
var EXPECTED8 = "experiments/tla-conformance/fungibility-read-r9/equations.expected.ts.txt";
var VALUE5_EVIDENCE = "experiments/tla-conformance/fungibility-values5-r8/evidence.json";
var VALUE5_NORMALIZE_KEY = "export:.#normalizeInventoryFungibilityScope::call[0]";
var SNAPSHOT_SURFACE_KEY = "type:src/facade.ts#InventoryOnceReadSnapshotApi.fungibilitySummary::call[0]";
var SNAPSHOT_CONTRACT = Object.freeze({
  surfaceKey: SNAPSHOT_SURFACE_KEY,
  sourceFile: "src/facade.ts",
  className: "InventoryOnceReadSnapshotImplementation",
  methodName: "fungibilitySummary",
  equation: "result = summarizeInventoryFungibility({ catalog: this.catalog, projection: this.world.projection, fungibilityRevisionId: p0.fungibilityRevisionId, ...(p0.scope === undefined ? {} : { scope: p0.scope }) })",
  law: Object.freeze({
    kind: "direct-return",
    parameterCount: 1,
    defaults: Object.freeze([]),
    optionalParameters: Object.freeze([]),
    expression: "summarizeInventoryFungibility({ catalog: this.catalog, projection: this.world.projection, fungibilityRevisionId: p0.fungibilityRevisionId, ...(p0.scope === undefined ? {} : { scope: p0.scope }) })"
  })
});
var CURRENT_STRICT_DEPENDENCIES = Object.freeze([
  "type:src/catalog.ts#InventoryCatalog.fungibilityRevision::call[0]",
  "type:src/catalog.ts#InventoryCatalog.itemRevision::call[0]",
  "export:./kernel#normalizeInventoryStockSelector::call[0]",
  "export:./kernel#findInventoryPositions::call[0]",
  "export:.#zeroQuantity::call[0]",
  "export:.#inventoryMeasurementAt::call[0]",
  "export:.#addQuantity::call[0]",
  "export:.#compareQuantity::call[0]",
  "export:.#negateQuantity::call[0]",
  "export:.#convertQuantityByReferenceExact::call[0]"
]);
var LOCAL_CONTRACTS = Object.freeze([
  {
    id: "src/fungibility.ts#selectorForFungibilityMember",
    file: "src/fungibility.ts",
    name: "selectorForFungibilityMember",
    law: "Create exactly one normalized selector for the member item/revision while preserving every common orthogonal scope dimension.",
    dependencies: ["export:./kernel#normalizeInventoryStockSelector::call[0]"]
  },
  {
    id: "src/fungibility.ts#selectedFungibilityPositions",
    file: "src/fungibility.ts",
    name: "selectedFungibilityPositions",
    law: "Return exactly the current projection positions selected by the normalized member selector in canonical position-search order.",
    dependencies: ["export:./kernel#findInventoryPositions::call[0]"]
  },
  {
    id: "src/fungibility.ts#summarizeInventoryFungibility",
    file: "src/fungibility.ts",
    name: "summarizeInventoryFungibility",
    law: "For the exact frozen pool revision and normalized scope, sum every member measurement exactly, split physical and deficit magnitudes by sign, convert all three totals through the frozen member-to-pool ratio, preserve each member breakdown, and return exact common-basis totals without altering item identity.",
    dependencies: [
      "type:src/catalog.ts#InventoryCatalog.fungibilityRevision::call[0]",
      "type:src/catalog.ts#InventoryCatalog.itemRevision::call[0]",
      VALUE5_NORMALIZE_KEY,
      "src/fungibility.ts#selectorForFungibilityMember",
      "src/fungibility.ts#selectedFungibilityPositions",
      "export:.#zeroQuantity::call[0]",
      "export:.#inventoryMeasurementAt::call[0]",
      "export:.#addQuantity::call[0]",
      "export:.#compareQuantity::call[0]",
      "export:.#negateQuantity::call[0]",
      "export:.#convertQuantityByReferenceExact::call[0]"
    ]
  }
]);
function source5(repositoryRoot, context, file, sourceOverrides) {
  const changed = sourceOverrides.get(file);
  if (changed !== void 0) {
    return ts.createSourceFile(
      path36.resolve(repositoryRoot, file),
      changed,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
  }
  const current = context.program.getSourceFile(path36.resolve(repositoryRoot, file));
  assert36(current !== void 0 && !current.isDeclarationFile, `Missing ${file}`);
  return current;
}
function findFunction14(sourceFile3, name) {
  const rows = sourceFile3.statements.filter(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name
  );
  assert36.equal(rows.length, 1, `Expected one function ${name}`);
  assert36(rows[0].body !== void 0, `Function ${name} has no body`);
  return rows[0];
}
function tokens3(text) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    text
  );
  const result = [];
  for (; ; ) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    result.push([ts.SyntaxKind[kind], scanner.getTokenText()]);
  }
  return result;
}
function term2(sourceFile3, declaration) {
  return tokens3(declaration.getText(sourceFile3));
}
function readJson2(repositoryRoot, file) {
  return JSON.parse(fs33.readFileSync(path36.resolve(repositoryRoot, file), "utf8"));
}
function addInput8(repositoryRoot, inputs3, file) {
  if (inputs3.has(file)) return;
  inputs3.set(file, {
    file,
    sha256: sha256(fs33.readFileSync(path36.resolve(repositoryRoot, file)))
  });
}
function currentStrictDependencyReceipt(repositoryRoot, surface) {
  return strictDependencyReceipt({
    repositoryRoot,
    surface,
    requirements: CURRENT_STRICT_DEPENDENCIES,
    label: "fungibility-summary dependency"
  }).dependencies;
}
function value5Receipt({ repositoryRoot, context, surface, sourceOverrides }) {
  const artifact = buildFamilyArtifact23({ repositoryRoot, context, surface, sourceOverrides });
  const proof = artifact.proofs.find((row) => row.surfaceKey === VALUE5_NORMALIZE_KEY);
  assert36(proof !== void 0, "Value5 normalize proof missing");
  if (sourceOverrides.size > 0) {
    return { receipt: { surfaceKey: VALUE5_NORMALIZE_KEY, proofKind: proofKind19, mutationControl: true }, inputs: [] };
  }
  assert36.equal(artifact.proofKind, proofKind19);
  assert36.equal(artifact.surfaceDigest, surface.digest);
  assert36.equal(artifact.allAdmittedInputs, true);
  assert36.equal(artifact.sampledInputs, 0);
  assert36.deepEqual(artifact.proofs.map((row) => row.surfaceKey).sort(), [...supportedSurfaceKeys22].sort());
  const recorded = readJson2(repositoryRoot, VALUE5_EVIDENCE);
  assert36.deepEqual(recorded, artifact, "Value5 recorded evidence differs from current rederived family.");
  const evidence = { file: VALUE5_EVIDENCE, sha256: sha256(fs33.readFileSync(path36.resolve(repositoryRoot, VALUE5_EVIDENCE))) };
  return {
    receipt: { surfaceKey: VALUE5_NORMALIZE_KEY, mode: "V", proofKind: proofKind19, evidence, equationId: proof.equationId },
    inputs: artifact.inputs ?? []
  };
}
function buildSummaryValueArtifact({
  repositoryRoot = process.cwd(),
  context = loadEvidenceCompilerContext(repositoryRoot, []),
  surface,
  sourceOverrides = /* @__PURE__ */ new Map()
} = {}) {
  assert36(surface !== void 0, "surface required");
  const expectedText = fs33.readFileSync(path36.resolve(repositoryRoot, EXPECTED8), "utf8");
  const expected = ts.createSourceFile(
    path36.resolve(repositoryRoot, EXPECTED8),
    expectedText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  assert36.equal(expected.parseDiagnostics.length, 0, "Expected equation file must parse.");
  const equations2 = [];
  for (const contract of LOCAL_CONTRACTS) {
    const actualSource = source5(repositoryRoot, context, contract.file, sourceOverrides);
    const actualDeclaration = findFunction14(actualSource, contract.name);
    const expectedDeclaration = findFunction14(expected, contract.name);
    const actualTerm = term2(actualSource, actualDeclaration);
    const expectedTerm = term2(expected, expectedDeclaration);
    assert36.deepEqual(actualTerm, expectedTerm, `Independent equation changed: ${contract.id}`);
    equations2.push({
      id: contract.id,
      law: contract.law,
      dependencies: contract.dependencies,
      termSha256: sha256(canonicalJson(actualTerm)),
      implementation: sourceOverrides.size === 0 ? spanOf(context, actualDeclaration) : { file: contract.file, mutationControl: true }
    });
  }
  const facadeSource = source5(repositoryRoot, context, "src/facade.ts", sourceOverrides);
  const snapshotDeclaration = findClassMethod(
    facadeSource,
    SNAPSHOT_CONTRACT.className,
    SNAPSHOT_CONTRACT.methodName
  );
  const snapshotActualTerm = normalizeCallable(snapshotDeclaration);
  const snapshotExpectedTerm = expectedMethodTerm(SNAPSHOT_CONTRACT);
  assert36.deepEqual(
    snapshotActualTerm,
    snapshotExpectedTerm,
    `${SNAPSHOT_SURFACE_KEY} source equation changed.`
  );
  const snapshotClass = facadeSource.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === SNAPSHOT_CONTRACT.className
  );
  assert36(snapshotClass !== void 0);
  const snapshotHeritage = snapshotClass.heritageClauses?.flatMap(
    (clause) => clause.types.map((type) => type.expression.getText(facadeSource))
  ) ?? [];
  assert36(
    snapshotHeritage.includes("InventoryOnceReadSnapshotApi"),
    "Snapshot implementation must implement InventoryOnceReadSnapshotApi."
  );
  const snapshotEquation = {
    id: "src/facade.ts#InventoryOnceReadSnapshotImplementation.fungibilitySummary",
    law: SNAPSHOT_CONTRACT.equation,
    dependencies: ["src/fungibility.ts#summarizeInventoryFungibility"],
    termSha256: sha256(canonicalJson(snapshotActualTerm)),
    implementation: sourceOverrides.size === 0 ? spanOf(context, snapshotDeclaration) : { file: "src/facade.ts", mutationControl: true }
  };
  equations2.push(snapshotEquation);
  const value5 = value5Receipt({ repositoryRoot, context, surface, sourceOverrides });
  if (sourceOverrides.size > 0) return { mutationControlAccepted: false };
  const currentDependencies = currentStrictDependencyReceipt(repositoryRoot, surface);
  const live = new Map(surface.callables.map((row) => [row.key, row]));
  const summary = equations2.find((row) => row.id === "src/fungibility.ts#summarizeInventoryFungibility");
  assert36(summary !== void 0);
  const proofs = supportedSurfaceKeys23.map((surfaceKey) => {
    const callable = live.get(surfaceKey);
    assert36(callable !== void 0, `Missing ${surfaceKey}`);
    const equation3 = surfaceKey === SNAPSHOT_SURFACE_KEY ? snapshotEquation : summary;
    return {
      surfaceKey,
      signatureHash: callable.signatureHash,
      declaration: callable.declaration,
      equationId: equation3.id,
      semantics: {
        law: equation3.law,
        completeExpectedTermSha256: equation3.termSha256,
        localEquations: equations2.map((row) => ({ id: row.id, termSha256: row.termSha256 })),
        currentStrictDependencies: currentDependencies,
        queuedDependency: value5.receipt,
        ...surfaceKey === SNAPSHOT_SURFACE_KEY ? { sameFamilyDependency: summary.id } : {}
      }
    };
  });
  const inputs3 = /* @__PURE__ */ new Map();
  for (const file of [
    "experiments/tla-conformance/fungibility-read-r9/summary-family.mjs",
    EXPECTED8,
    VALUE5_EVIDENCE,
    "experiments/tla-conformance/fungibility-values5-r8/family.mjs",
    "experiments/tla-conformance/throughput-r7/strict-dependency-receipt.mjs",
    "experiments/tla-conformance/authority-r5/catalog-published-source-equations.mjs",
    "experiments/tla-conformance/authority-r5/catalog-published-source-contracts.mjs",
    "src/fungibility.ts",
    "src/facade.ts",
    "src/catalog.ts",
    "src/projection.ts",
    "src/selectors.ts",
    "src/measurements.ts",
    "src/quantity.ts"
  ]) addInput8(repositoryRoot, inputs3, file);
  for (const input2 of value5.inputs) addInput8(repositoryRoot, inputs3, input2.file);
  return {
    schemaVersion: 1,
    proofKind: proofKind20,
    route: "CERTIFIED_VALUE_EQUATION",
    family: "FungibilitySummary",
    surfaceDigest: surface.digest,
    domain: "All inputs admitted by the two direct summary exports plus the genuine frozen-snapshot fungibilitySummary signature. The full summary declaration and its two private selector helpers are checked against complete independent declaration terms; every external helper is either live-current strict V or the separately verified queued FungibilityValue5 normalize equation. No runtime samples, graph replay, or stateful action credit is used.",
    allAdmittedInputs: true,
    sampledInputs: 0,
    graphRuns: 0,
    replayRuns: 0,
    inputs: [...inputs3.values()].sort((a, b) => a.file.localeCompare(b.file)),
    equations: equations2,
    currentStrictDependencies: currentDependencies,
    queuedDependencies: [value5.receipt],
    proofs
  };
}
var buildFamilyArtifact24 = buildSummaryValueArtifact;

// experiments/tla-conformance/fungibility-plan-r9/value-family.mjs
import assert37 from "node:assert/strict";
import fs34 from "node:fs";
import path37 from "node:path";
var proofKind21 = "fungibility-allocation-plan-complete-values-v1";
var supportedSurfaceKeys24 = Object.freeze([
  "export:.#planInventoryFungibilityAllocation::call[0]",
  "export:./kernel#planInventoryFungibilityAllocation::call[0]"
].sort());
var EXPECTED9 = "experiments/tla-conformance/fungibility-plan-r9/equations.expected.ts.txt";
var VALUE5_EVIDENCE2 = "experiments/tla-conformance/fungibility-values5-r8/evidence.json";
var VALUE5_NORMALIZE_KEY2 = "export:.#normalizeInventoryFungibilityScope::call[0]";
var LOCAL_CONTRACTS2 = Object.freeze([
  ["planInventoryFungibilityAllocation", "Plan one exact common-basis FIFO/FEFO allocation across every member revision, preserving exact member identities, package increments, expiry/increment diagnostics, and active reservation feasibility before returning source lines."],
  ["validateFungibilityReservationEffect", "Accept depletion only without a destination and transfer only with a nonblank destination; reject every malformed reservation effect before allocation search."],
  ["fungibilityAllocationsPreserveReservations", "Apply the complete hypothetical allocation to sparse projection overlays, including destination rows for transfer, then accept exactly when the certified reservation feasibility projection reports Feasible."],
  ["createFungibilitySparseRecordOverlay", "Provide a tombstone-aware sparse record overlay whose get/set/delete/has operations preserve immutable-base reads while retaining only local what-if mutations."],
  ["addFungibilitySimulationIndex", "Insert one exact position identity into one sparse index bucket once and retain deterministic sorted order."],
  ["removeFungibilitySimulationIndex", "Remove exactly one position identity from one sparse index bucket and tombstone the bucket when it becomes empty."],
  ["addFungibilityCandidate", "Convert one exact eligible member source line into common pool units, derive its indivisible allocation increment, and retain the exact evidence needed to map allocator output back to physical identity."],
  ["fungibilityAllocationIncrement", "Return the smallest legal common-basis quantum, requiring whole measured/serialized positions and package multiples while otherwise retaining the member reference quantum."],
  ["positionHasIndependentMeasuredContents", "Return true exactly when any independent axis is required or currently nonzero."],
  ["selectorForFungibilityMember", "Create one normalized stock selector for the exact member item/revision while preserving every common fungibility scope dimension."],
  ["selectedFungibilityPositions", "Return exactly the projection positions selected by the certified stock-selector lookup."],
  ["totalPositivePrimary", "Sum only positive primary-axis quantities from selected non-transfer positions in exact quantity arithmetic."]
].map(([name, law]) => Object.freeze({
  id: `src/fungibility.ts#${name}`,
  name,
  law
})));
var CURRENT_STRICT_DEPENDENCIES2 = Object.freeze([
  "type:src/catalog.ts#InventoryCatalog.fungibilityRevision::call[0]",
  "type:src/catalog.ts#InventoryCatalog.itemRevision::call[0]",
  "type:src/catalog.ts#InventoryCatalog.packagingRevision::call[0]",
  "export:./kernel#assertCanonicalInventoryTime::call[0]",
  "export:.#positiveQuantity::call[0]",
  "export:.#planInventoryAllocation::call[0]",
  "export:.#stockAmount::call[0]",
  "export:.#quantityToDecimalString::call[0]",
  "export:./kernel#allocateInventory::call[0]",
  "export:./kernel#inventoryStockPositionIdentity::call[0]",
  "export:.#convertQuantityByReferenceExact::call[0]",
  "export:.#inventoryAmountForPrimaryAllocation::call[0]",
  "export:.#resolveInventoryAmount::call[0]",
  "export:.#subtractInventoryMeasurements::call[0]",
  "export:.#inventoryMeasurementsAreZero::call[0]",
  "export:.#inventoryContainerIdentity::call[0]",
  "export:./kernel#normalizeInventoryStockPositionKey::call[0]",
  "export:.#zeroInventoryMeasurements::call[0]",
  "export:.#addInventoryMeasurements::call[0]",
  "export:./kernel#inspectInventoryReservationFeasibility::call[0]",
  "export:.#leastCommonQuantityMultiple::call[0]",
  "export:.#inventoryMeasurementAt::call[0]",
  "export:.#compareQuantity::call[0]",
  "export:.#zeroQuantity::call[0]",
  "export:./kernel#normalizeInventoryStockSelector::call[0]",
  "export:./kernel#findInventoryPositions::call[0]",
  "export:.#addQuantity::call[0]"
]);
function source6(repositoryRoot, context, file, sourceOverrides) {
  const changed = sourceOverrides.get(file);
  if (changed !== void 0) {
    return ts.createSourceFile(
      path37.resolve(repositoryRoot, file),
      changed,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
  }
  const current = context.program.getSourceFile(path37.resolve(repositoryRoot, file));
  assert37(current !== void 0 && !current.isDeclarationFile, `Missing ${file}`);
  return current;
}
function findFunction15(sourceFile3, name) {
  const rows = sourceFile3.statements.filter(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name
  );
  assert37.equal(rows.length, 1, `Expected one function ${name}`);
  assert37(rows[0].body !== void 0, `Function ${name} has no body`);
  return rows[0];
}
function tokens4(text) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    text
  );
  const result = [];
  for (; ; ) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    result.push([ts.SyntaxKind[kind], scanner.getTokenText()]);
  }
  return result;
}
function term3(sourceFile3, declaration) {
  return tokens4(declaration.getText(sourceFile3));
}
function readJson3(repositoryRoot, file) {
  return JSON.parse(fs34.readFileSync(path37.resolve(repositoryRoot, file), "utf8"));
}
function addInput9(repositoryRoot, inputs3, file) {
  if (inputs3.has(file)) return;
  inputs3.set(file, {
    file,
    sha256: sha256(fs34.readFileSync(path37.resolve(repositoryRoot, file)))
  });
}
function currentStrictDependencyReceipt2(repositoryRoot, surface) {
  return strictDependencyReceipt({ repositoryRoot, surface, requirements: CURRENT_STRICT_DEPENDENCIES2, label: "fungibility-plan dependency" }).dependencies;
}
function value5Receipt2({ repositoryRoot, context, surface, sourceOverrides }) {
  const artifact = buildFamilyArtifact23({ repositoryRoot, context, surface, sourceOverrides });
  const proof = artifact.proofs.find((row) => row.surfaceKey === VALUE5_NORMALIZE_KEY2);
  assert37(proof !== void 0, "Value5 normalize proof missing");
  if (sourceOverrides.size > 0) return { receipt: { surfaceKey: VALUE5_NORMALIZE_KEY2, mutationControl: true }, inputs: [] };
  assert37.equal(artifact.proofKind, proofKind19);
  assert37.equal(artifact.surfaceDigest, surface.digest);
  assert37.equal(artifact.allAdmittedInputs, true);
  assert37.equal(artifact.sampledInputs, 0);
  assert37.deepEqual(artifact.proofs.map((row) => row.surfaceKey).sort(), [...supportedSurfaceKeys22].sort());
  const recorded = readJson3(repositoryRoot, VALUE5_EVIDENCE2);
  assert37.deepEqual(recorded, artifact, "Value5 recorded evidence differs from current rederived family.");
  const evidence = { file: VALUE5_EVIDENCE2, sha256: sha256(fs34.readFileSync(path37.resolve(repositoryRoot, VALUE5_EVIDENCE2))) };
  return { receipt: { surfaceKey: VALUE5_NORMALIZE_KEY2, mode: "V", proofKind: proofKind19, evidence, equationId: proof.equationId }, inputs: artifact.inputs ?? [] };
}
function buildPlanValueArtifact({
  repositoryRoot = process.cwd(),
  context = loadEvidenceCompilerContext(repositoryRoot, []),
  surface,
  sourceOverrides = /* @__PURE__ */ new Map()
} = {}) {
  assert37(surface !== void 0, "surface required");
  const expectedText = fs34.readFileSync(path37.resolve(repositoryRoot, EXPECTED9), "utf8");
  const expected = ts.createSourceFile(
    path37.resolve(repositoryRoot, EXPECTED9),
    expectedText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  assert37.equal(expected.parseDiagnostics.length, 0, "Expected planner equation file must parse.");
  const actual = source6(repositoryRoot, context, "src/fungibility.ts", sourceOverrides);
  const equations2 = [];
  for (const contract of LOCAL_CONTRACTS2) {
    const actualDeclaration = findFunction15(actual, contract.name);
    const expectedDeclaration = findFunction15(expected, contract.name);
    const actualTerm = term3(actual, actualDeclaration);
    const expectedTerm = term3(expected, expectedDeclaration);
    assert37.deepEqual(actualTerm, expectedTerm, `Independent equation changed: ${contract.id}`);
    equations2.push({
      id: contract.id,
      law: contract.law,
      termSha256: sha256(canonicalJson(actualTerm)),
      implementation: sourceOverrides.size === 0 ? spanOf(context, actualDeclaration) : { file: "src/fungibility.ts", mutationControl: true }
    });
  }
  const value5 = value5Receipt2({ repositoryRoot, context, surface, sourceOverrides });
  if (sourceOverrides.size > 0) return { mutationControlAccepted: false };
  const currentDependencies = currentStrictDependencyReceipt2(repositoryRoot, surface);
  const main = equations2.find(
    (row) => row.id === "src/fungibility.ts#planInventoryFungibilityAllocation"
  );
  assert37(main !== void 0);
  const live = new Map(surface.callables.map((row) => [row.key, row]));
  const proofs = supportedSurfaceKeys24.map((surfaceKey) => {
    const callable = live.get(surfaceKey);
    assert37(callable !== void 0, `Missing ${surfaceKey}`);
    return {
      surfaceKey,
      signatureHash: callable.signatureHash,
      declaration: callable.declaration,
      equationId: main.id,
      semantics: {
        law: main.law,
        completeExpectedTermSha256: main.termSha256,
        localEquations: equations2.map((row) => ({ id: row.id, termSha256: row.termSha256 })),
        currentStrictDependencies: currentDependencies,
        queuedDependency: value5.receipt
      }
    };
  });
  const inputs3 = /* @__PURE__ */ new Map();
  for (const file of [
    "experiments/tla-conformance/fungibility-plan-r9/value-family.mjs",
    EXPECTED9,
    VALUE5_EVIDENCE2,
    "experiments/tla-conformance/fungibility-values5-r8/family.mjs",
    "experiments/tla-conformance/throughput-r7/strict-dependency-receipt.mjs",
    "src/fungibility.ts",
    "src/allocation.ts",
    "src/amounts.ts",
    "src/catalog.ts",
    "src/events.ts",
    "src/measurements.ts",
    "src/model.ts",
    "src/picking.ts",
    "src/projection.ts",
    "src/reservations.ts",
    "src/quantity.ts",
    "src/selectors.ts"
  ]) addInput9(repositoryRoot, inputs3, file);
  for (const input2 of value5.inputs) addInput9(repositoryRoot, inputs3, input2.file);
  return {
    schemaVersion: 1,
    route: "CERTIFIED_VALUE_EQUATION",
    proofKind: proofKind21,
    family: "FungibilityAllocationPlan",
    surfaceDigest: surface.digest,
    domain: "All arguments and worlds admitted by the two direct planner signatures. The complete planner and every private helper it transitively owns are checked against a frozen independent equation program; every imported runtime dependency is live-current strict A/B/V or the separately verified queued FungibilityValue5 normalization equation. The reservation-preservation callback is included in the complete local equation and delegates its final universal claim decision to the already-strict inspectInventoryReservationFeasibility B projection. No samples, native replay, graph replay, or stateful action credit are used.",
    allAdmittedInputs: true,
    sampledInputs: 0,
    graphRuns: 0,
    replayRuns: 0,
    inputs: [...inputs3.values()].sort((a, b) => a.file.localeCompare(b.file)),
    equations: equations2,
    currentStrictDependencies: currentDependencies,
    queuedDependencies: [value5.receipt],
    proofs
  };
}
var buildFamilyArtifact25 = buildPlanValueArtifact;

// experiments/tla-conformance/throughput-r7/registered-families.mjs
var root2 = path38.resolve(path38.dirname(fileURLToPath15(import.meta.url)), "../../..");
var routeInputs = [
  "experiments/tla-conformance/throughput-r7/registered-value-family.mjs",
  "experiments/tla-conformance/value-contracts/surface-binding.mjs"
].map((file) => ({ file, sha256: sha256(fs35.readFileSync(path38.resolve(root2, file))) }));
function registeredBuilder(builder) {
  let cached2;
  return function buildRegisteredArtifact(input2) {
    assert38.equal(path38.resolve(input2.repositoryRoot), root2);
    for (const identity of routeInputs) assert38.equal(sha256(fs35.readFileSync(path38.resolve(root2, identity.file))), identity.sha256, `Loaded route changed: ${identity.file}`);
    if (cached2 !== void 0 && cached2.surfaceDigest === input2.surface.digest) {
      for (const identity of cached2.artifact.inputs) {
        assert38.equal(sha256(fs35.readFileSync(path38.resolve(root2, identity.file))), identity.sha256, `Cached family input changed: ${identity.file}`);
      }
      return cached2.artifact;
    }
    const artifact = builder(input2);
    const identities = new Map(artifact.inputs.map((identity) => [identity.file, identity]));
    for (const identity of routeInputs) {
      const previous = identities.get(identity.file);
      assert38(previous === void 0 || previous.sha256 === identity.sha256, `Conflicting route input: ${identity.file}`);
      identities.set(identity.file, identity);
    }
    const registered = { ...artifact, inputs: [...identities.values()].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0) };
    cached2 = { surfaceDigest: input2.surface.digest, artifact: registered };
    return registered;
  };
}
var registeredValueFamilies = Object.freeze([
  Object.freeze({ proofKind: valueProofKind, buildFamilyArtifact: buildFinalValueArtifact, supportedSurfaceKeys: supportedValueKeys, artifactFile: "experiments/tla-conformance/final-convergence/final-v309.json", reviewedCommit: "FINAL_CONVERGENCE_e1759f7" }),
  Object.freeze({ proofKind: proofKind11, buildFamilyArtifact: buildFamilyArtifact15, supportedSurfaceKeys: supportedSurfaceKeys15, artifactFile: "experiments/tla-conformance/new-source-honest486-r43/value-currentizer-evidence.json", reviewedCommit: "R46_521d2d4" }),
  Object.freeze({ proofKind: proofKind12, buildFamilyArtifact: buildFamilyArtifact16, supportedSurfaceKeys: supportedSurfaceKeys16, artifactFile: "experiments/tla-conformance/authority-values-r40/evidence.json", reviewedCommit: "R40_CURRENT_SOURCE" }),
  Object.freeze({ proofKind, buildFamilyArtifact: registeredBuilder(buildFamilyArtifact), supportedSurfaceKeys, artifactFile: "experiments/tla-conformance/throughput-r7/evidence/queue-reservation-feasibility-v1-values.json", reviewedCommit: "2bdeaf4" }),
  Object.freeze({ proofKind: proofKind3, buildFamilyArtifact: registeredBuilder(buildFamilyArtifact6), supportedSurfaceKeys: supportedSurfaceKeys6, artifactFile: "experiments/tla-conformance/throughput-r7/evidence/queue-composition-open-v1-values.json", reviewedCommit: "118d7c939ad5220ffaa99149e6b93b5fcce80a64" }),
  Object.freeze({ proofKind: proofKind6, buildFamilyArtifact: registeredBuilder(buildFamilyArtifact10), supportedSurfaceKeys: supportedSurfaceKeys10, artifactFile: "experiments/tla-conformance/throughput-r7/evidence/residual-core-v4-values.json", reviewedCommit: "HUB_OWNER_CURRENT_460" }),
  Object.freeze({ proofKind: proofKind7, buildFamilyArtifact: registeredBuilder(buildFamilyArtifact11), supportedSurfaceKeys: supportedSurfaceKeys11, artifactFile: "experiments/tla-conformance/throughput-r7/evidence/queue-catalog-publication-event-v1-values.json", reviewedCommit: "89e60cdbb26fd2333cb9df7427ab52ee39f74af4" }),
  Object.freeze({ proofKind: proofKind8, buildFamilyArtifact: registeredBuilder(buildFamilyArtifact12), supportedSurfaceKeys: supportedSurfaceKeys12, artifactFile: "experiments/tla-conformance/throughput-r7/evidence/queue-surface-direct-v7-values.json", reviewedCommit: "fcf4871d4f8df4abfe212de2f65216ee0032b18d" }),
  Object.freeze({ proofKind: proofKind9, buildFamilyArtifact: registeredBuilder(buildFamilyArtifact13), supportedSurfaceKeys: supportedSurfaceKeys13, artifactFile: "experiments/tla-conformance/throughput-r7/evidence/queue-surface-final-v2-values.json", reviewedCommit: "fcf4871d4f8df4abfe212de2f65216ee0032b18d" }),
  Object.freeze({ proofKind: proofKind5, buildFamilyArtifact: registeredBuilder(buildFamilyArtifact9), supportedSurfaceKeys: supportedSurfaceKeys9, artifactFile: "experiments/tla-conformance/throughput-r7/evidence/queue-migration-materialize-v1-values.json", reviewedCommit: "ed7fd4788d31eb184ab45c99d3d1d47a0c44681c" }),
  Object.freeze({ proofKind: proofKind10, buildFamilyArtifact: registeredBuilder(buildFamilyArtifact14), supportedSurfaceKeys: supportedSurfaceKeys14, artifactFile: "experiments/tla-conformance/throughput-r7/evidence/queue-traceability-apply-v1-values.json", reviewedCommit: "9245decd4de5ab38e292624863f11e378c7283af" }),
  Object.freeze({
    proofKind: proofKind21,
    buildFamilyArtifact: registeredBuilder(buildFamilyArtifact25),
    supportedSurfaceKeys: supportedSurfaceKeys24,
    artifactFile: "experiments/tla-conformance/throughput-r7/evidence/fungibility-plan-values.json",
    reviewedCommit: "08cdfe12cda290174301195c16a35cc9df16b521"
  }),
  Object.freeze({
    proofKind: proofKind20,
    buildFamilyArtifact: registeredBuilder(buildFamilyArtifact24),
    supportedSurfaceKeys: supportedSurfaceKeys23,
    artifactFile: "experiments/tla-conformance/throughput-r7/evidence/fungibility-summary-values.json",
    reviewedCommit: "20de604f6cdfd47958f393c539b12cacc085b434"
  }),
  Object.freeze({
    proofKind: proofKind4,
    buildFamilyArtifact: registeredBuilder(buildFamilyArtifact7),
    supportedSurfaceKeys: supportedSurfaceKeys7,
    artifactFile: "experiments/tla-conformance/throughput-r7/evidence/storage-protocol-values.json",
    reviewedCommit: "4e10792d919d97b8925ae173adfa3343b49ffe99"
  }),
  Object.freeze({
    proofKind: proofKind19,
    buildFamilyArtifact: registeredBuilder(buildFamilyArtifact23),
    supportedSurfaceKeys: supportedSurfaceKeys22,
    artifactFile: "experiments/tla-conformance/throughput-r7/evidence/fungibility-values5.json",
    reviewedCommit: "ffb5da9680af34ff741920b72c0835c4f0a01c8c"
  }),
  Object.freeze({
    proofKind: proofKind18,
    buildFamilyArtifact: registeredBuilder(buildFamilyArtifact22),
    supportedSurfaceKeys: supportedSurfaceKeys21,
    artifactFile: "experiments/tla-conformance/throughput-r7/evidence/migration-traceability-values.json",
    reviewedCommit: "751c990243c676d60aa85e00d329d444aa6997ad"
  }),
  Object.freeze({
    proofKind: proofKind17,
    buildFamilyArtifact: registeredBuilder(buildFamilyArtifact21),
    supportedSurfaceKeys: supportedSurfaceKeys20,
    artifactFile: "experiments/tla-conformance/throughput-r7/evidence/astra-authority-control-values.json",
    reviewedCommit: "e25fc9e8a4680e932a4e5ef492bb586f20478bcb"
  }),
  Object.freeze({
    proofKind: proofKind16,
    buildFamilyArtifact: registeredBuilder(buildFamilyArtifact20),
    supportedSurfaceKeys: supportedSurfaceKeys19,
    artifactFile: "experiments/tla-conformance/throughput-r7/evidence/catalog-read-values.json",
    reviewedCommit: null,
    reviewedSource: { kind: "HUB_REVIEWED_CONTENT_SNAPSHOT", receipt: "experiments/tla-conformance/authority-r5/catalog-read-hub-integration-receipt.json" }
  }),
  Object.freeze({
    proofKind: TRANSFER_CORRECTION_VALUE_PROOF_KIND,
    buildFamilyArtifact: registeredBuilder(buildFamilyArtifact8),
    supportedSurfaceKeys: supportedSurfaceKeys8,
    artifactFile: "experiments/tla-conformance/throughput-r7/evidence/transfer-correction-values.json",
    reviewedCommit: null,
    reviewedSource: { kind: "HUB_REVIEWED_CONTENT_SNAPSHOT", receipt: "experiments/tla-conformance/transfer-surface-r6/source-equations-r7/hub-integration-receipt.json" }
  }),
  Object.freeze({
    proofKind: proofKind2,
    buildFamilyArtifact: registeredBuilder(buildFamilyArtifact4),
    supportedSurfaceKeys: supportedSurfaceKeys4,
    artifactFile: "experiments/tla-conformance/throughput-r7/evidence/catalog-foundation-values.json",
    reviewedCommit: null,
    reviewedSource: { kind: "REVIEWED_CONTENT_SNAPSHOT", receipt: "experiments/tla-conformance/catalog-foundation-r7/import-source-receipt.json" }
  }),
  Object.freeze({
    proofKind: EVENT_VALUES_PROOF_KIND,
    buildFamilyArtifact: registeredBuilder(buildFamilyArtifact5),
    supportedSurfaceKeys: supportedSurfaceKeys5,
    artifactFile: "experiments/tla-conformance/throughput-r7/evidence/event-values.json",
    reviewedCommit: null,
    reviewedSource: { kind: "HUB_REVIEWED_CONTENT_SNAPSHOT", receipt: "experiments/tla-conformance/quantity-values-r7/event-values/hub-integration-receipt.json" }
  }),
  Object.freeze({
    proofKind: proofKind13,
    buildFamilyArtifact: registeredBuilder(buildFamilyArtifact17),
    supportedSurfaceKeys: supportedSurfaceKeys17,
    artifactFile: "experiments/tla-conformance/throughput-r7/evidence/migration-helper-values.json",
    reviewedCommit: null,
    reviewedSource: { kind: "REVIEWED_CONTENT_SNAPSHOT", receipt: "experiments/tla-conformance/migration-helper-causal-r7/import-source-receipt.json" }
  }),
  Object.freeze({
    proofKind: proofKind15,
    buildFamilyArtifact: registeredBuilder(buildFamilyArtifact19),
    supportedSurfaceKeys: supportedSurfaceKeys18,
    artifactFile: "experiments/tla-conformance/throughput-r7/evidence/migration-helper-frontier-values.json",
    reviewedCommit: "79f7e7575303a0b1c04b1634f717dda915b911a5"
  }),
  Object.freeze({
    proofKind: QUANTITY_VALUES_PROOF_KIND,
    buildFamilyArtifact: registeredBuilder(buildFamilyArtifact3),
    supportedSurfaceKeys: supportedSurfaceKeys3,
    artifactFile: "experiments/tla-conformance/throughput-r7/evidence/quantity-values.json",
    reviewedCommit: "5d13503b7baceff5515e8d82b390f0949080440a"
  }),
  Object.freeze({
    proofKind: identityValuesProofKind,
    buildFamilyArtifact: registeredBuilder(buildFamilyArtifact2),
    supportedSurfaceKeys: supportedSurfaceKeys2,
    artifactFile: "experiments/tla-conformance/throughput-r7/evidence/identity-values.json",
    reviewedCommit: "02cf9387d669fd8655a71933849862cac8693cd9"
  })
]);

// experiments/tla-conformance/value-contracts/surface-binding.mjs
var contractsPath = fileURLToPath16(new URL("./contracts.json", import.meta.url));
var producerFiles8 = [
  "experiments/tla-conformance/value-contracts/contracts.json",
  "experiments/tla-conformance/value-contracts/verify.mjs",
  "experiments/tla-conformance/value-contracts/surface-binding.mjs",
  "experiments/tla-conformance/surface-bindings/lib/compiler-surface.mjs",
  "node_modules/typescript/package.json"
];
function buildValueContractArtifact({ repositoryRoot, context, surface }) {
  const specification = JSON.parse(fs36.readFileSync(contractsPath, "utf8"));
  const keys = specification.contracts.flatMap((contract) => contract.surfaceKeys).sort(compareCodeUnits);
  if (keys.length !== new Set(keys).size) throw new Error("Independent value contracts repeat a surface key.");
  const proofs = [];
  for (const surfaceKey of keys) {
    const candidates = surface.callables.filter((callable2) => callable2.key === surfaceKey);
    if (candidates.length !== 1) throw new Error(`Value callable '${surfaceKey}' is missing or ambiguous.`);
    const callable = candidates[0];
    const declaration = callable.declaration;
    const source7 = context.program.getSourceFile(path39.resolve(repositoryRoot, declaration.file));
    if (source7 === void 0 || source7.isDeclarationFile || !declaration.file.startsWith("src/")) throw new Error(`Value callable '${surfaceKey}' has no package implementation.`);
    const implementation = nodeAtExactSpan(source7, declaration.start.offset, declaration.end.offset);
    if (implementation === void 0 || !ts.isFunctionDeclaration(implementation) || implementation.body === void 0) throw new Error(`Value callable '${surfaceKey}' is not an exact source function.`);
    const verified = verifyValueSemantics(context, surfaceKey, implementation);
    if (verified.status !== "PROVED") throw new Error(`Value equation failed for '${surfaceKey}': ${JSON.stringify(verified.diagnostics)}`);
    proofs.push({ surfaceKey, signatureHash: callable.signatureHash, declaration, semantics: verified.proof });
  }
  return {
    schemaVersion: 1,
    mode: "V",
    proofKind: "independent-closed-return-equations-v1",
    surfaceDigest: surface.digest,
    producers: producerFiles8.map((file) => ({ file, sha256: sha256(fs36.readFileSync(path39.resolve(repositoryRoot, file))) })),
    proofs
  };
}
var dispatchPasses = /* @__PURE__ */ new WeakMap();
function verifyValueContractBinding({ repositoryRoot, context, surface, binding }) {
  try {
    const reference = binding.evidence;
    if (binding.mode !== "V" || reference === void 0 || !/^[0-9a-f]{64}$/u.test(reference.sha256 ?? "")) throw new Error("Value evidence reference is incomplete.");
    const digest = assuranceFileSha256(repositoryRoot, reference.file);
    if (digest !== reference.sha256) throw new Error("Value evidence hash drifted.");
    let pass = dispatchPasses.get(context);
    if (pass === void 0) {
      pass = /* @__PURE__ */ new Map();
      dispatchPasses.set(context, pass);
    }
    const key = `${reference.file}:${digest}`;
    let recorded = pass.get(key);
    if (recorded === void 0) {
      recorded = JSON.parse(readAssuranceFile(repositoryRoot, reference.file));
      pass.set(key, recorded);
    }
    if (registeredValueFamilies.some((family) => family.proofKind === recorded.proofKind)) {
      return verifyRegisteredValueBinding({ repositoryRoot, context, surface, binding, registrations: registeredValueFamilies });
    }
    const current = recorded.proofKind === catalogProofKind ? buildCatalogFamilyArtifact({ repositoryRoot, context, surface }) : buildValueContractArtifact({ repositoryRoot, context, surface });
    if (canonicalJson(recorded) !== canonicalJson(current)) throw new Error("Recorded value proof differs from current independent source equations.");
    if (!current.proofs.some((proof) => proof.surfaceKey === binding.surfaceKey)) throw new Error("No independent value equation for this callable.");
    return [];
  } catch (error) {
    return [{ code: "VALUE_SEMANTIC_PROOF_REJECTED", detail: error instanceof Error ? error.message : String(error) }];
  }
}

// experiments/tla-conformance/throughput-r7/registered-producer-family.mjs
import assert39 from "node:assert/strict";
import path40 from "node:path";
var passes3 = /* @__PURE__ */ new WeakMap();
var recordedPasses2 = /* @__PURE__ */ new WeakMap();
function ownedFile2(root3, file) {
  return assuranceRepositoryPath(root3, file);
}
function verifyInputs2(root3, context, inputs3) {
  assert39(Array.isArray(inputs3) && inputs3.length > 0, "Registered producer needs its complete semantic input set.");
  const seen = /* @__PURE__ */ new Set();
  for (const input2 of inputs3) {
    assert39.equal(typeof input2.file, "string");
    assert39(!seen.has(input2.file), "Registered producer input is duplicated.");
    seen.add(input2.file);
    assert39.match(input2.sha256, /^[0-9a-f]{64}$/u);
    const absolute = ownedFile2(root3, input2.file);
    assert39.equal(assuranceFileSha256(root3, input2.file), input2.sha256, `Registered producer input changed: ${input2.file}`);
    if (input2.file.startsWith("src/") && input2.file.endsWith(".ts")) {
      const source7 = context.program.getSourceFile(path40.resolve(root3, input2.file));
      assert39(source7 !== void 0, `Compiler omitted registered producer source: ${input2.file}`);
      assert39.equal(assuranceCompilerSourceSha256(root3, input2.file, source7.text), input2.sha256, `Compiler snapshot is stale: ${input2.file}`);
    }
  }
}
function verifyRegisteredProducerBinding({ repositoryRoot, context, surface, binding, registrations }) {
  try {
    assert39(binding.mode === "A" || binding.mode === "B", "Registered producer binding must remain A or B.");
    const file = ownedFile2(repositoryRoot, binding.evidence.file);
    const digest = assuranceFileSha256(repositoryRoot, binding.evidence.file);
    assert39.equal(digest, binding.evidence.sha256, "Registered producer evidence changed.");
    let recordedPass = recordedPasses2.get(context);
    if (recordedPass === void 0) {
      recordedPass = /* @__PURE__ */ new Map();
      recordedPasses2.set(context, recordedPass);
    }
    const recordedKey = `${file}:${digest}`;
    let recorded = recordedPass.get(recordedKey);
    if (recorded === void 0) {
      const document = JSON.parse(readAssuranceFile(repositoryRoot, binding.evidence.file).toString("utf8"));
      recorded = { document, canonical: canonicalJson(document) };
      recordedPass.set(recordedKey, recorded);
    }
    const matching = registrations.filter(
      (registration2) => registration2.proofKind === recorded.document.proofKind
    );
    assert39.equal(matching.length, 1, "Exactly one trusted producer registration must own this proof kind.");
    const registration = matching[0];
    assert39.equal(typeof registration.buildFamilyArtifact, "function");
    assert39(Array.isArray(registration.supportedSurfaceRows));
    assert39.equal(
      new Set(registration.supportedSurfaceRows.map((row) => `${row.surfaceKey}
${row.mode}`)).size,
      registration.supportedSurfaceRows.length,
      "Trusted producer registration repeats a surface/mode pair."
    );
    assert39(
      registration.supportedSurfaceRows.some(
        (row) => row.surfaceKey === binding.surfaceKey && row.mode === binding.mode
      ),
      "Binding is outside the trusted producer registration."
    );
    let compilerPass = passes3.get(context);
    if (compilerPass === void 0) {
      compilerPass = /* @__PURE__ */ new Map();
      passes3.set(context, compilerPass);
    }
    const registrationIdentity = canonicalJson(registration.supportedSurfaceRows);
    let cached2 = compilerPass.get(registration);
    if (cached2 !== void 0 && cached2.surfaceDigest === surface.digest && cached2.members === registrationIdentity && cached2.builder === registration.buildFamilyArtifact) {
      verifyInputs2(repositoryRoot, context, cached2.artifact.inputs);
    } else {
      const artifact = registration.buildFamilyArtifact({ repositoryRoot, context, surface });
      assert39.equal(artifact.schemaVersion, 1);
      assert39.equal(artifact.proofKind, registration.proofKind);
      assert39.equal(artifact.route, "REGISTERED_CERTIFIED_PRODUCER");
      assert39.equal(artifact.sampledInputs, 0, "Registered producer cannot be sample-backed.");
      assert39.equal(artifact.allAdmittedInputs, true);
      assert39(
        typeof artifact.domain === "string" && artifact.domain.length > 0 || artifact.domain !== null && typeof artifact.domain === "object" && !Array.isArray(artifact.domain) && Object.keys(artifact.domain).length > 0,
        "Registered producer needs an explicit complete domain."
      );
      const artifactSurface = artifact.surfaceDigest ?? artifact.sourceHub?.surfaceDigest;
      assert39.equal(artifactSurface, surface.digest, "Registered producer surface identity changed.");
      assert39(Array.isArray(artifact.proofs) && artifact.proofs.length > 0);
      verifyInputs2(repositoryRoot, context, artifact.inputs);
      const proofPairs = artifact.proofs.map((proof) => `${proof.surfaceKey}
${proof.mode}`);
      assert39.equal(new Set(proofPairs).size, proofPairs.length, "Registered producer repeats a proof pair.");
      assert39.deepEqual(
        [...proofPairs].sort(),
        registration.supportedSurfaceRows.map((row) => `${row.surfaceKey}
${row.mode}`).sort(),
        "Current producer membership differs from its trusted registration."
      );
      const live = new Map(surface.callables.map((callable) => [callable.key, callable]));
      for (const proof of artifact.proofs) {
        assert39(proof.mode === "A" || proof.mode === "B", "Registered producer emitted a non-A/B proof.");
        const callable = live.get(proof.surfaceKey);
        assert39(callable !== void 0, "Registered producer claims a non-public callable.");
        assert39.equal(proof.signatureHash, callable.signatureHash);
        assert39.deepEqual(proof.declaration, callable.declaration);
      }
      cached2 = {
        surfaceDigest: surface.digest,
        members: registrationIdentity,
        builder: registration.buildFamilyArtifact,
        artifact,
        canonical: canonicalJson(artifact)
      };
      compilerPass.set(registration, cached2);
    }
    assert39.equal(
      recorded.canonical,
      cached2.canonical,
      "Recorded producer family differs from independently rederived current producer truth."
    );
    assert39(
      cached2.artifact.proofs.some(
        (proof) => proof.surfaceKey === binding.surfaceKey && proof.mode === binding.mode
      ),
      "No exact producer proof exists for this surface/mode pair."
    );
    return [];
  } catch (error) {
    return [{
      code: "REGISTERED_PRODUCER_PROOF_REJECTED",
      detail: error instanceof Error ? error.message : String(error)
    }];
  }
}

// experiments/tla-conformance/surface-bindings/lib/binding-checker.mjs
var EXECUTION_RECORD_FIELDS = Object.freeze([
  "edgeId",
  "action",
  "formalEnabled",
  "outcome",
  "expectedSourceState",
  "actualSourceState",
  "expectedState",
  "actualState",
  "expectedResult",
  "actualResult",
  "checked",
  "checkpoint"
]);
var GRAPH_EDGE_RECORD_FIELDS = Object.freeze([
  "edgeId",
  "fromStateId",
  "toStateId",
  "action",
  "formalEnabled",
  "expectedOutcome",
  "sourceState",
  "expectedState",
  "expectedResult"
]);
var REVERSE_EDGE_RECORD_FIELDS = Object.freeze([
  "edgeId",
  "action",
  "sourceState",
  "targetState",
  "originalNextAccepted"
]);
var BINDING_SCHEMA_VERSION = 1;
function red(code, surfaceKey, detail) {
  return { severity: "HARD_RED", code, surfaceKey, detail };
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
function bindingReadReferences(binding) {
  if (binding.source?.readCall !== void 0 && binding.source?.readCalls === void 0) {
    return [binding.source.readCall];
  }
  if (binding.source?.readCall === void 0 && Array.isArray(binding.source?.readCalls) && binding.source.readCalls.length > 0) {
    return binding.source.readCalls;
  }
  return [];
}
function sourceReferences(binding) {
  if (binding.mode === "A") {
    return [
      binding.source?.actionCall,
      binding.source?.stateCheckCall,
      binding.source?.resultCheckCall,
      binding.source?.enablednessCheckCall,
      binding.source?.reverseNextCheckCall
    ].filter((reference) => reference !== void 0);
  }
  if (binding.mode === "B") {
    return [
      ...bindingReadReferences(binding),
      binding.source?.projectionCall,
      binding.source?.projectionCheckCall
    ].filter((reference) => reference !== void 0);
  }
  return [];
}
function loadEvidenceCompilerContext(repositoryRoot, evidenceFileNames) {
  const base = loadCompilerContext(repositoryRoot);
  const evidenceFiles = new Set(
    evidenceFileNames.map((fileName) => path41.resolve(base.repositoryRoot, fileName))
  );
  if (evidenceFiles.size === 0) return base;
  const program = ts.createProgram({
    rootNames: [...base.parsed.fileNames, ...evidenceFiles].sort(),
    options: {
      ...base.parsed.options,
      rootDir: void 0,
      declaration: false,
      noEmit: true,
      // Experiment proof harnesses intentionally use explicit .ts imports; this compiler never emits.
      allowImportingTsExtensions: true
    }
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => base.repositoryRoot,
        getNewLine: () => "\n"
      })
    );
  }
  return { ...base, program, checker: program.getTypeChecker() };
}
function evidenceCompilerContext(repositoryRoot, bindings) {
  const evidenceFiles = [];
  for (const binding of bindings) {
    for (const reference of sourceReferences(binding)) {
      if (isNonEmptyString(reference?.file)) {
        if (repositoryOwnedPath(repositoryRoot, reference.file) === void 0) {
          throw new Error(`Evidence source '${reference.file}' leaves the repository.`);
        }
        evidenceFiles.push(reference.file);
      }
    }
  }
  return loadEvidenceCompilerContext(repositoryRoot, evidenceFiles);
}
function isTestOnlyPath(relativePath4) {
  return /(^|\/)(?:test|tests|fixtures?|__tests__)(\/|$)/u.test(relativePath4) || /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(relativePath4);
}
function repositoryOwnedPath(repositoryRoot, relativePath4) {
  if (!isNonEmptyString(relativePath4) || path41.isAbsolute(relativePath4)) return void 0;
  const absolutePath = path41.resolve(repositoryRoot, relativePath4);
  const normalized = path41.relative(repositoryRoot, absolutePath);
  return normalized.startsWith(`..${path41.sep}`) || path41.isAbsolute(normalized) ? void 0 : absolutePath;
}
function resolveSymbol4(checker, symbol) {
  return (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
}
function callTargetDeclarationIds(context, call) {
  const symbol = context.checker.getSymbolAtLocation(call.expression);
  if (symbol === void 0) return [];
  return [...resolveSymbol4(context.checker, symbol).declarations ?? []].map((declaration) => spanOf(context, declaration)).map((span) => `${span.file}:${span.start.offset}:${span.end.offset}`).sort();
}
function enclosingImportDeclaration(node) {
  let current = node;
  while (current !== void 0) {
    if (ts.isImportDeclaration(current)) return current;
    current = current.parent;
  }
  return void 0;
}
function importedSourceForCall(context, call) {
  const possibleSymbols = [];
  const direct = context.checker.getSymbolAtLocation(call.expression);
  if (direct !== void 0) possibleSymbols.push(direct);
  if (ts.isPropertyAccessExpression(call.expression)) {
    const receiver = context.checker.getSymbolAtLocation(call.expression.expression);
    if (receiver !== void 0) possibleSymbols.push(receiver);
  }
  for (const symbol of possibleSymbols) {
    for (const declaration of symbol.declarations ?? []) {
      const importDeclaration = enclosingImportDeclaration(declaration);
      if (importDeclaration === void 0 || !ts.isStringLiteral(importDeclaration.moduleSpecifier)) {
        continue;
      }
      const resolved = ts.resolveModuleName(
        importDeclaration.moduleSpecifier.text,
        call.getSourceFile().fileName,
        context.program.getCompilerOptions(),
        ts.sys
      ).resolvedModule;
      if (resolved !== void 0) {
        return normalizeRelativePath(context.repositoryRoot, resolved.resolvedFileName);
      }
    }
  }
  return void 0;
}
function callUsesExactEntrypoint(context, call, callable, surface) {
  if (!callable.key.startsWith("export:")) return true;
  const separator = callable.key.indexOf("#", "export:".length);
  if (separator < 0) return false;
  const exportKey = callable.key.slice("export:".length, separator);
  const expectedSource3 = surface.entrypoints.find(
    (entrypoint) => entrypoint.key === exportKey
  )?.source;
  const importedSource = importedSourceForCall(context, call);
  return expectedSource3 !== void 0 && importedSource === expectedSource3;
}
function surfaceDeclarationIds(callable) {
  return [callable.declaration, ...callable.symbolDeclarations].map((span) => `${span.file}:${span.start.offset}:${span.end.offset}`).sort();
}
function literalTruth(expression) {
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword || expression.kind === ts.SyntaxKind.NullKeyword || ts.isNumericLiteral(expression) && Number(expression.text) === 0 || ts.isStringLiteral(expression) && expression.text.length === 0) {
    return false;
  }
  return void 0;
}
function isStaticallyUnreachable(node) {
  let current = node;
  while (current.parent !== void 0) {
    const parent = current.parent;
    if (ts.isIfStatement(parent)) {
      const truth = literalTruth(parent.expression);
      if (truth === false && parent.thenStatement === current) return true;
      if (truth === true && parent.elseStatement === current) return true;
    }
    if ((ts.isWhileStatement(parent) || ts.isForStatement(parent)) && parent.statement === current && parent.expression !== void 0 && literalTruth(parent.expression) === false) {
      return true;
    }
    if (ts.isBlock(parent) || ts.isSourceFile(parent)) {
      const containingStatement = parent.statements.find(
        (statement) => statement === current || statement.getStart() <= current.getStart() && statement.getEnd() >= current.getEnd()
      );
      if (containingStatement !== void 0) {
        for (const statement of parent.statements) {
          if (statement === containingStatement) break;
          if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) {
            return true;
          }
        }
      }
    }
    current = parent;
  }
  return false;
}
function resolveCallReference(context, reference, label, diagnostics, surfaceKey) {
  if (reference === null || typeof reference !== "object" || !isNonEmptyString(reference.file) || !Number.isSafeInteger(reference.start) || !Number.isSafeInteger(reference.end) || !isNonEmptyString(reference.sourceHash) || !isNonEmptyString(reference.astHash)) {
    diagnostics.push(
      red("INVALID_SOURCE_REFERENCE", surfaceKey, `${label} is incomplete.`)
    );
    return void 0;
  }
  if (isTestOnlyPath(reference.file)) {
    diagnostics.push(
      red(
        "TEST_ONLY_REFERENCE",
        surfaceKey,
        `${label} points to test/fixture source '${reference.file}'.`
      )
    );
    return void 0;
  }
  const absoluteFile = repositoryOwnedPath(context.repositoryRoot, reference.file);
  if (absoluteFile === void 0) {
    diagnostics.push(
      red("EVIDENCE_PATH_ESCAPE", surfaceKey, `${label} is not repository-relative.`)
    );
    return void 0;
  }
  const source7 = context.program.getSourceFile(absoluteFile);
  if (source7 === void 0) {
    diagnostics.push(
      red("MISSING_SOURCE_FILE", surfaceKey, `${label} file is not compiled.`)
    );
    return void 0;
  }
  const actualSourceHash = sha256(source7.getFullText());
  if (actualSourceHash !== reference.sourceHash) {
    diagnostics.push(
      red("SOURCE_REFERENCE_DRIFT", surfaceKey, `${label} source hash changed.`)
    );
  }
  const node = nodeAtExactSpan(source7, reference.start, reference.end);
  if (node === void 0 || !ts.isCallExpression(node)) {
    diagnostics.push(
      red(
        "FALSE_CALL_REFERENCE",
        surfaceKey,
        `${label} does not identify one exact CallExpression.`
      )
    );
    return void 0;
  }
  const actualAstHash = sha256(
    source7.getFullText().slice(node.getStart(source7), node.getEnd())
  );
  if (actualAstHash !== reference.astHash) {
    diagnostics.push(
      red("CALL_REFERENCE_DRIFT", surfaceKey, `${label} AST hash changed.`)
    );
  }
  if (isStaticallyUnreachable(node)) {
    diagnostics.push(
      red("UNREACHABLE_CALL_REFERENCE", surfaceKey, `${label} is unreachable.`)
    );
  }
  return node;
}
function sameSymbol(checker, left, right) {
  const leftSymbol = checker.getSymbolAtLocation(left);
  const rightSymbol = checker.getSymbolAtLocation(right);
  return leftSymbol !== void 0 && leftSymbol === rightSymbol;
}
function assignedVariableDeclaration(call) {
  let current = call;
  while (current.parent !== void 0) {
    const parent = current.parent;
    if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
      return parent;
    }
    if (ts.isAwaitExpression(parent) || ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent)) {
      current = parent;
      continue;
    }
    break;
  }
  return void 0;
}
function callFeedsCall(context, sourceCall, sinkCall) {
  if (sourceCall.getStart() >= sinkCall.getStart() && sourceCall.getEnd() <= sinkCall.getEnd()) {
    return true;
  }
  const declaration = assignedVariableDeclaration(sourceCall);
  if (declaration === void 0 || !ts.isIdentifier(declaration.name) || !ts.isVariableDeclarationList(declaration.parent) || (declaration.parent.flags & ts.NodeFlags.Const) === 0) {
    return false;
  }
  let found = false;
  function visit(node) {
    if (ts.isIdentifier(node) && sameSymbol(context.checker, declaration.name, node)) {
      found = true;
    }
    ts.forEachChild(node, visit);
  }
  for (const argument of sinkCall.arguments) visit(argument);
  return found;
}
function checkResultIsEnforced(context, call) {
  const signature = context.checker.getResolvedSignature(call);
  const returnType = signature === void 0 ? context.checker.getTypeAtLocation(call) : context.checker.getReturnTypeOfSignature(signature);
  if ((returnType.flags & ts.TypeFlags.Void) !== 0 || (returnType.flags & ts.TypeFlags.Never) !== 0) {
    return true;
  }
  let current = call;
  while (ts.isAwaitExpression(current.parent) || ts.isParenthesizedExpression(current.parent) || ts.isAsExpression(current.parent)) {
    current = current.parent;
  }
  return !ts.isExpressionStatement(current.parent);
}
function checkInputExpressions(call) {
  const inputs3 = [...call.arguments];
  if (ts.isPropertyAccessExpression(call.expression) && ts.isCallExpression(call.expression.expression)) {
    inputs3.push(...call.expression.expression.arguments);
  }
  return inputs3;
}
function hasOnlyLiteralCheckInputs(call) {
  const inputs3 = checkInputExpressions(call);
  return inputs3.length > 0 && inputs3.every((input2) => literalTruth(input2) !== void 0);
}
function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}
function hasExactFields(value, fields2) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...fields2].sort());
}
function verifyDigestFile(repositoryRoot, reference, label, diagnostics, surfaceKey) {
  if (!hasExactFields(reference, ["file", "sha256"]) || !isNonEmptyString(reference.file) || !isSha256(reference.sha256)) {
    diagnostics.push(red("INVALID_DIGEST_FILE", surfaceKey, `${label} is incomplete.`));
    return;
  }
  const absoluteFile = repositoryOwnedPath(repositoryRoot, reference.file);
  if (absoluteFile === void 0) {
    diagnostics.push(red("EVIDENCE_PATH_ESCAPE", surfaceKey, `${label} leaves the repository.`));
    return;
  }
  try {
    if (sha256(fs37.readFileSync(absoluteFile)) !== reference.sha256) {
      diagnostics.push(red("DIGEST_FILE_DRIFT", surfaceKey, `${label} SHA-256 changed.`));
    }
  } catch (error) {
    diagnostics.push(
      red(
        "MISSING_DIGEST_FILE",
        surfaceKey,
        `${label}: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  }
}
function hasExactStateFields(state2, fields2) {
  return state2 !== null && typeof state2 === "object" && !Array.isArray(state2) && canonicalJson(Object.keys(state2).sort()) === canonicalJson([...fields2].sort());
}
function isActionShape(action) {
  return hasExactFields(action, ["operator", "arguments"]) && isNonEmptyString(action.operator) && Array.isArray(action.arguments);
}
function formalActionOperators(binding) {
  const singular = binding.formal?.action;
  const grouped = binding.formal?.actions;
  if (isNonEmptyString(singular) && grouped === void 0) return [singular];
  if (singular === void 0 && Array.isArray(grouped) && grouped.length > 0 && new Set(grouped).size === grouped.length && grouped.every((action) => isNonEmptyString(action))) {
    return grouped;
  }
  return void 0;
}
function hasRegisteredProducerBindingShape(binding) {
  return (binding?.mode === "A" || binding?.mode === "B") && hasExactFields(binding, ["surfaceKey", "mode", "evidence"]) && hasExactFields(binding.evidence, ["file", "sha256"]) && isNonEmptyString(binding.evidence.file) && isSha256(binding.evidence.sha256);
}
function hasExactBindingShape(binding) {
  if (binding === null || typeof binding !== "object" || Array.isArray(binding)) {
    return false;
  }
  if (binding.mode === "HARD_RED") {
    return hasExactFields(binding, ["surfaceKey", "mode", "reason"]) && isNonEmptyString(binding.reason);
  }
  if (binding.mode === "C") {
    return hasExactFields(binding, ["surfaceKey", "mode", "targetSurfaceKey"]) && isNonEmptyString(binding.targetSurfaceKey);
  }
  if (binding.mode === "V") {
    return hasExactFields(binding, ["surfaceKey", "mode", "evidence"]) && hasExactFields(binding.evidence, ["file", "sha256"]) && isNonEmptyString(binding.evidence.file) && isSha256(binding.evidence.sha256);
  }
  if (hasRegisteredProducerBindingShape(binding)) return true;
  if (binding.mode === "A") {
    const formalFields = binding.formal?.actions === void 0 ? ["model", "source", "sourceHash", "variables", "action"] : ["model", "source", "sourceHash", "variables", "actions"];
    return hasExactFields(binding, ["surfaceKey", "mode", "formal", "source", "execution"]) && hasExactFields(binding.formal, formalFields) && hasExactFields(
      binding.source,
      [
        "actionCall",
        "stateCheckCall",
        "resultCheckCall",
        "enablednessCheckCall",
        "reverseNextCheckCall"
      ]
    ) && hasExactFields(binding.execution, ["file", "sha256"]);
  }
  if (binding.mode === "B") {
    const sourceFields = binding.source?.readCalls === void 0 ? ["readCall", "projectionCall", "projectionCheckCall"] : ["readCalls", "projectionCall", "projectionCheckCall"];
    const readReferences = bindingReadReferences(binding);
    return hasExactFields(binding, ["surfaceKey", "mode", "formal", "source", "execution"]) && hasExactFields(binding.formal, ["model", "source", "sourceHash", "variables"]) && hasExactFields(binding.source, sourceFields) && readReferences.length > 0 && new Set(readReferences.map((reference) => canonicalJson(reference))).size === readReferences.length && hasExactFields(binding.execution, ["file", "sha256"]);
  }
  return false;
}
function requireExactFields(value, fields2, label, diagnostics, surfaceKey) {
  if (!hasExactFields(value, fields2)) {
    diagnostics.push(
      red("EXECUTION_SCHEMA_SHAPE", surfaceKey, `${label} fields do not match schema v2.`)
    );
    return false;
  }
  return true;
}
function verifyExecutionEvidence(repositoryRoot, binding, callable, diagnostics) {
  const reference = binding.execution;
  if (reference === null || typeof reference !== "object" || !isNonEmptyString(reference.file) || !isNonEmptyString(reference.sha256)) {
    diagnostics.push(
      red("MISSING_EXECUTION_EVIDENCE", binding.surfaceKey, "Execution evidence is required.")
    );
    return;
  }
  const absoluteFile = repositoryOwnedPath(repositoryRoot, reference.file);
  if (absoluteFile === void 0) {
    diagnostics.push(
      red("EVIDENCE_PATH_ESCAPE", binding.surfaceKey, "Execution evidence leaves the repository.")
    );
    return;
  }
  let bytes2;
  let evidence;
  try {
    bytes2 = fs37.readFileSync(absoluteFile);
    evidence = JSON.parse(bytes2.toString("utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    diagnostics.push(
      red("INVALID_EXECUTION_EVIDENCE", binding.surfaceKey, message)
    );
    return;
  }
  if (sha256(bytes2) !== reference.sha256) {
    diagnostics.push(
      red("EXECUTION_EVIDENCE_DRIFT", binding.surfaceKey, "Evidence SHA-256 changed.")
    );
  }
  if (!requireExactFields(
    evidence,
    [
      "schemaVersion",
      "status",
      "producer",
      "model",
      "graph",
      "checkpointEquivalence",
      "executions",
      "reverse",
      "surfaceObservations"
    ],
    "Execution evidence",
    diagnostics,
    binding.surfaceKey
  )) return;
  if (evidence.schemaVersion !== 2 || evidence.status !== "PASS" || evidence.model?.name !== binding.formal?.model || evidence.model?.source !== binding.formal?.source || evidence.model?.sourceHash !== binding.formal?.sourceHash) {
    diagnostics.push(
      red(
        "FORMAL_EVIDENCE_DRIFT",
        binding.surfaceKey,
        "Model name/source/hash or PASS schema v2 does not match the binding."
      )
    );
  }
  if (!requireExactFields(
    evidence.producer,
    ["command", "files"],
    "Evidence producer",
    diagnostics,
    binding.surfaceKey
  ) || !isNonEmptyString(evidence.producer?.command) || !Array.isArray(evidence.producer?.files) || evidence.producer.files.length === 0) {
    diagnostics.push(
      red("MISSING_EVIDENCE_PRODUCER", binding.surfaceKey, "Evidence has no executable producer.")
    );
  } else {
    const requiredProducerRoles = /* @__PURE__ */ new Set([
      "graph-exporter",
      "implementation-driver",
      "original-next-validator",
      "evidence-builder"
    ]);
    const producerPathsByRole = /* @__PURE__ */ new Map();
    for (const [index, producerFile] of evidence.producer.files.entries()) {
      if (!requireExactFields(
        producerFile,
        ["role", "file", "sha256"],
        `Producer file ${index}`,
        diagnostics,
        binding.surfaceKey
      ) || !requiredProducerRoles.has(producerFile.role)) {
        diagnostics.push(
          red("INVALID_EVIDENCE_PRODUCER", binding.surfaceKey, `Producer file ${index} has an invalid role.`)
        );
        continue;
      }
      const rolePaths = producerPathsByRole.get(producerFile.role) ?? /* @__PURE__ */ new Set();
      rolePaths.add(producerFile.file);
      producerPathsByRole.set(producerFile.role, rolePaths);
      verifyDigestFile(
        repositoryRoot,
        { file: producerFile.file, sha256: producerFile.sha256 },
        `Producer file ${index}`,
        diagnostics,
        binding.surfaceKey
      );
    }
    for (const role of requiredProducerRoles) {
      if (!producerPathsByRole.has(role)) {
        diagnostics.push(
          red("MISSING_EVIDENCE_PRODUCER_ROLE", binding.surfaceKey, `Producer omits '${role}'.`)
        );
      }
    }
    const driverPaths = producerPathsByRole.get("implementation-driver") ?? /* @__PURE__ */ new Set();
    const reversePaths = producerPathsByRole.get("original-next-validator") ?? /* @__PURE__ */ new Set();
    if ([...reversePaths].some((fileName) => driverPaths.has(fileName))) {
      diagnostics.push(
        red("NONINDEPENDENT_REVERSE_PRODUCER", binding.surfaceKey, "Original-Next validator is the implementation driver.")
      );
    }
  }
  if (requireExactFields(
    evidence.model,
    ["name", "source", "sourceHash", "config", "variables", "actions"],
    "Model evidence",
    diagnostics,
    binding.surfaceKey
  )) {
    verifyDigestFile(
      repositoryRoot,
      evidence.model.config,
      "Authoritative CFG",
      diagnostics,
      binding.surfaceKey
    );
  }
  const boundActionOperators = binding.mode === "A" ? formalActionOperators(binding) : void 0;
  if (binding.mode === "A" && (boundActionOperators === void 0 || !Array.isArray(evidence.model?.actions) || boundActionOperators.some((action) => !evidence.model.actions.includes(action)))) {
    diagnostics.push(
      red("ACTION_BINDING_DRIFT", binding.surfaceKey, "Bound action is absent from model evidence.")
    );
  }
  const declaredVariables = Array.isArray(evidence.model?.variables) ? evidence.model.variables : [];
  const declaredActions = Array.isArray(evidence.model?.actions) ? evidence.model.actions : [];
  if (declaredVariables.length === 0 || new Set(declaredVariables).size !== declaredVariables.length || declaredVariables.some((variable) => !isNonEmptyString(variable))) {
    diagnostics.push(
      red("MISSING_FORMAL_VARIABLES", binding.surfaceKey, "Evidence has invalid formal variables.")
    );
  }
  if (declaredActions.length === 0 || new Set(declaredActions).size !== declaredActions.length || declaredActions.some((action) => !isNonEmptyString(action))) {
    diagnostics.push(
      red("MISSING_FORMAL_ACTIONS", binding.surfaceKey, "Evidence has invalid formal actions.")
    );
  }
  const requestedVariables = binding.formal?.variables;
  if (!Array.isArray(requestedVariables) || requestedVariables.length === 0 || requestedVariables.some((variable) => !declaredVariables.includes(variable))) {
    diagnostics.push(
      red("VARIABLE_BINDING_DRIFT", binding.surfaceKey, "Bound projection variables do not match the model.")
    );
  }
  const graphShapeValid = requireExactFields(
    evidence.graph,
    ["origin", "completeness", "bounds", "stateFields", "nodes", "edges"],
    "Graph evidence",
    diagnostics,
    binding.surfaceKey
  );
  const stateFields = Array.isArray(evidence.graph?.stateFields) ? evidence.graph.stateFields : [];
  const graphNodes = Array.isArray(evidence.graph?.nodes) ? evidence.graph.nodes : [];
  const graphEdges = Array.isArray(evidence.graph?.edges) ? evidence.graph.edges : [];
  if (!graphShapeValid || evidence.graph?.origin !== "authoritative-tla-init" || evidence.graph?.completeness !== "complete-reachable-edge-multiset" || evidence.graph?.bounds !== "authoritative-cfg" || stateFields.length === 0 || new Set(stateFields).size !== stateFields.length || canonicalJson([...stateFields].sort()) !== canonicalJson([...declaredVariables].sort()) || graphNodes.length === 0 || graphEdges.length === 0) {
    diagnostics.push(
      red("INCOMPLETE_GRAPH_EVIDENCE", binding.surfaceKey, "Graph is not a complete authoritative-CFG multiset from Init.")
    );
  }
  const nodeById = /* @__PURE__ */ new Map();
  const initialStateIds = [];
  for (const node of graphNodes) {
    if (!requireExactFields(
      node,
      ["stateId", "initial", "state"],
      "Graph node",
      diagnostics,
      binding.surfaceKey
    )) continue;
    if (!isNonEmptyString(node.stateId) || nodeById.has(node.stateId)) {
      diagnostics.push(
        red("DUPLICATE_OR_INVALID_GRAPH_NODE", binding.surfaceKey, "Graph node ids are not unique.")
      );
      continue;
    }
    if (!hasExactStateFields(node.state, stateFields)) {
      diagnostics.push(
        red("PROJECTION_SHAPE_DRIFT", binding.surfaceKey, `Node '${node.stateId}' projection keys drifted.`)
      );
    }
    nodeById.set(node.stateId, node);
    if (node.initial === true) initialStateIds.push(node.stateId);
    else if (node.initial !== false) {
      diagnostics.push(
        red("INVALID_INIT_MARKER", binding.surfaceKey, `Node '${node.stateId}' has a non-boolean Init marker.`)
      );
    }
  }
  if (initialStateIds.length === 0) {
    diagnostics.push(red("MISSING_REAL_INIT", binding.surfaceKey, "Graph has no authoritative Init state."));
  }
  const graphEdgeById = /* @__PURE__ */ new Map();
  const outgoingByState = /* @__PURE__ */ new Map();
  for (const edge of graphEdges) {
    if (!requireExactFields(
      edge,
      GRAPH_EDGE_RECORD_FIELDS,
      "Graph edge",
      diagnostics,
      binding.surfaceKey
    )) continue;
    if (!isNonEmptyString(edge.edgeId) || graphEdgeById.has(edge.edgeId)) {
      diagnostics.push(
        red("DUPLICATE_OR_INVALID_GRAPH_EDGE", binding.surfaceKey, "Graph edge occurrence ids are not unique.")
      );
      continue;
    }
    graphEdgeById.set(edge.edgeId, edge);
    const sourceNode = nodeById.get(edge.fromStateId);
    const targetNode = nodeById.get(edge.toStateId);
    if (sourceNode === void 0 || targetNode === void 0) {
      diagnostics.push(
        red("MISSING_GRAPH_ENDPOINT", binding.surfaceKey, `Edge '${edge.edgeId}' has a missing endpoint.`)
      );
    } else if (canonicalJson(edge.sourceState) !== canonicalJson(sourceNode.state) || canonicalJson(edge.expectedState) !== canonicalJson(targetNode.state)) {
      diagnostics.push(
        red("GRAPH_STATE_MISMATCH", binding.surfaceKey, `Edge '${edge.edgeId}' states differ from its nodes.`)
      );
    }
    if (!isActionShape(edge.action) || !declaredActions.includes(edge.action?.operator) || edge.formalEnabled !== true || !["accepted", "rejected"].includes(edge.expectedOutcome)) {
      diagnostics.push(
        red("INVALID_GRAPH_EDGE", binding.surfaceKey, `Edge '${edge.edgeId}' lacks exact action/enabledness/outcome.`)
      );
    }
    const outgoing = outgoingByState.get(edge.fromStateId) ?? [];
    outgoing.push(edge.toStateId);
    outgoingByState.set(edge.fromStateId, outgoing);
  }
  const reachedStateIds = new Set(initialStateIds);
  const reachabilityQueue = [...initialStateIds];
  for (let index = 0; index < reachabilityQueue.length; index += 1) {
    const stateId = reachabilityQueue[index];
    for (const targetId of outgoingByState.get(stateId) ?? []) {
      if (!reachedStateIds.has(targetId)) {
        reachedStateIds.add(targetId);
        reachabilityQueue.push(targetId);
      }
    }
  }
  if (reachedStateIds.size !== nodeById.size) {
    diagnostics.push(
      red("UNREACHABLE_GRAPH_NODE", binding.surfaceKey, "Graph contains a state outside the Init closure.")
    );
  }
  const executions = Array.isArray(evidence.executions) ? evidence.executions : [];
  const graphEdgeIds = [...graphEdgeById.keys()];
  const executedEdgeIds = executions.map((execution) => execution?.edgeId);
  if (executedEdgeIds.some((edgeId) => !isNonEmptyString(edgeId)) || new Set(executedEdgeIds).size !== executedEdgeIds.length) {
    diagnostics.push(
      red("DUPLICATE_EXECUTED_EDGE", binding.surfaceKey, "Executed edge ids are not unique.")
    );
  }
  if (canonicalJson([...graphEdgeIds].sort()) !== canonicalJson([...executedEdgeIds].sort())) {
    diagnostics.push(
      red("MISSING_OR_EXTRA_EXECUTED_EDGE", binding.surfaceKey, "Replay is not the exact graph-edge multiset.")
    );
  }
  const relevantExecutions = executions.filter(
    (execution) => binding.mode === "A" ? boundActionOperators?.includes(execution?.action?.operator) === true : true
  );
  if (relevantExecutions.length === 0) {
    diagnostics.push(
      red("UNEXECUTED_SEMANTIC_BINDING", binding.surfaceKey, "No real execution covers this binding.")
    );
  }
  const forkConcreteIds = [];
  for (const execution of executions) {
    if (!requireExactFields(
      execution,
      EXECUTION_RECORD_FIELDS,
      "Execution",
      diagnostics,
      binding.surfaceKey
    )) continue;
    const graphEdge = graphEdgeById.get(execution.edgeId);
    const stateKeys = Object.keys(execution.actualState ?? {}).sort();
    if (Array.isArray(declaredVariables) && canonicalJson(stateKeys) !== canonicalJson([...declaredVariables].sort())) {
      diagnostics.push(
        red("PROJECTION_SHAPE_DRIFT", binding.surfaceKey, `Edge '${execution.edgeId}' projection keys drifted.`)
      );
    }
    if (graphEdge === void 0 || canonicalJson(graphEdge.action) !== canonicalJson(execution.action) || graphEdge.formalEnabled !== execution.formalEnabled || graphEdge.expectedOutcome !== execution.outcome || canonicalJson(graphEdge.sourceState) !== canonicalJson(execution.expectedSourceState) || canonicalJson(execution.expectedSourceState) !== canonicalJson(execution.actualSourceState) || canonicalJson(graphEdge.expectedState) !== canonicalJson(execution.expectedState) || canonicalJson(graphEdge.expectedResult) !== canonicalJson(execution.expectedResult) || canonicalJson(execution.expectedState) !== canonicalJson(execution.actualState) || canonicalJson(execution.expectedResult) !== canonicalJson(execution.actualResult) || !hasExactFields(execution.checked, ["sourceState", "state", "result", "enabledness"]) || execution.checked?.sourceState !== true || execution.checked?.state !== true || execution.checked?.result !== true || execution.checked?.enabledness !== true) {
      diagnostics.push(
        red("UNCHECKED_OR_MISMATCHED_EXECUTION", binding.surfaceKey, `Edge '${execution.edgeId}' is not exact.`)
      );
      break;
    }
    if (!hasExactFields(
      execution.checkpoint,
      [
        "forkConcreteId",
        "sourceConcreteDigest",
        "targetConcreteDigest",
        "sourceFromInit",
        "abstractStateSeeded"
      ]
    ) || !isNonEmptyString(execution.checkpoint?.forkConcreteId) || !isSha256(execution.checkpoint?.sourceConcreteDigest) || !isSha256(execution.checkpoint?.targetConcreteDigest) || execution.checkpoint?.sourceFromInit !== true || execution.checkpoint?.abstractStateSeeded !== false) {
      diagnostics.push(
        red("MISSING_DETACHED_FORK", binding.surfaceKey, `Edge '${execution.edgeId}' lacks an Init-derived detached fork.`)
      );
      break;
    }
    forkConcreteIds.push(execution.checkpoint.forkConcreteId);
  }
  if (new Set(forkConcreteIds).size !== forkConcreteIds.length) {
    diagnostics.push(
      red("SHARED_CHECKPOINT_FORK", binding.surfaceKey, "Sibling executions reuse one concrete fork.")
    );
  }
  if (!requireExactFields(
    evidence.checkpointEquivalence,
    ["kind", "completeRepresentativeExploration", "evidence"],
    "Checkpoint equivalence",
    diagnostics,
    binding.surfaceKey
  ) || !["injective-concrete-state", "finite-all-representatives"].includes(
    evidence.checkpointEquivalence?.kind
  ) || evidence.checkpointEquivalence?.completeRepresentativeExploration !== true) {
    diagnostics.push(
      red("UNSOUND_CHECKPOINT_QUOTIENT", binding.surfaceKey, "Hidden-history equivalence is not proved exhaustively.")
    );
  } else {
    verifyDigestFile(
      repositoryRoot,
      evidence.checkpointEquivalence.evidence,
      "Checkpoint equivalence evidence",
      diagnostics,
      binding.surfaceKey
    );
  }
  const reverseEdges = Array.isArray(evidence.reverse?.edges) ? evidence.reverse.edges : [];
  if (!requireExactFields(
    evidence.reverse,
    ["validator", "importsImplementationTransition", "edges"],
    "Reverse evidence",
    diagnostics,
    binding.surfaceKey
  ) || evidence.reverse?.validator !== "original-tla-next" || evidence.reverse?.importsImplementationTransition !== false) {
    diagnostics.push(
      red("INVALID_REVERSE_PROOF", binding.surfaceKey, "Reverse evidence is not independent original TLA Next.")
    );
  }
  const reverseEdgeIds = reverseEdges.map((edge) => edge?.edgeId);
  if (reverseEdgeIds.some((edgeId) => !isNonEmptyString(edgeId)) || new Set(reverseEdgeIds).size !== reverseEdgeIds.length || canonicalJson([...reverseEdgeIds].sort()) !== canonicalJson([...graphEdgeIds].sort())) {
    diagnostics.push(
      red("MISSING_OR_EXTRA_REVERSE_EDGE", binding.surfaceKey, "Reverse proof is not the exact graph-edge multiset.")
    );
  }
  for (const reverseEdge of reverseEdges) {
    if (!requireExactFields(
      reverseEdge,
      REVERSE_EDGE_RECORD_FIELDS,
      "Reverse edge",
      diagnostics,
      binding.surfaceKey
    )) continue;
    const graphEdge = graphEdgeById.get(reverseEdge.edgeId);
    if (graphEdge === void 0 || canonicalJson(reverseEdge.action) !== canonicalJson(graphEdge.action) || canonicalJson(reverseEdge.sourceState) !== canonicalJson(graphEdge.sourceState) || canonicalJson(reverseEdge.targetState) !== canonicalJson(graphEdge.expectedState) || reverseEdge.originalNextAccepted !== true) {
      diagnostics.push(
        red("REVERSE_EDGE_MISMATCH", binding.surfaceKey, `Reverse edge '${reverseEdge.edgeId}' is not exact.`)
      );
      break;
    }
  }
  const observations = Array.isArray(evidence.surfaceObservations) ? evidence.surfaceObservations : [];
  const observationKeys = /* @__PURE__ */ new Set();
  for (const [index, observation] of observations.entries()) {
    const validFields = requireExactFields(
      observation,
      ["surfaceKey", "sourceReference", "edgeIds"],
      `Surface observation ${index}`,
      diagnostics,
      binding.surfaceKey
    );
    const sourceReference = observation?.sourceReference;
    const validReference = hasExactFields(
      sourceReference,
      ["file", "start", "end", "sourceHash", "astHash"]
    ) && isNonEmptyString(sourceReference.file) && Number.isSafeInteger(sourceReference.start) && sourceReference.start >= 0 && Number.isSafeInteger(sourceReference.end) && sourceReference.end > sourceReference.start && isSha256(sourceReference.sourceHash) && isSha256(sourceReference.astHash);
    const edgeIds = observation?.edgeIds;
    const validEdgeIds = Array.isArray(edgeIds) && edgeIds.length > 0 && new Set(edgeIds).size === edgeIds.length && edgeIds.every((edgeId) => graphEdgeById.has(edgeId));
    const observationKey = canonicalJson([
      observation?.surfaceKey,
      sourceReference
    ]);
    if (!validFields || !isNonEmptyString(observation?.surfaceKey) || !validReference || !validEdgeIds || observationKeys.has(observationKey)) {
      diagnostics.push(
        red("INVALID_SURFACE_OBSERVATION", binding.surfaceKey, `Surface observation ${index} is invalid or duplicate.`)
      );
    }
    observationKeys.add(observationKey);
  }
  const expectedReferences = binding.mode === "A" ? [binding.source?.actionCall] : bindingReadReferences(binding);
  const expectedObservationEdgeIds = relevantExecutions.map((execution) => execution?.edgeId).filter((edgeId) => isNonEmptyString(edgeId)).sort();
  for (const expectedReference of expectedReferences) {
    const matchingObservation = observations.find(
      (observation) => observation?.surfaceKey === callable.key && canonicalJson(observation?.sourceReference) === canonicalJson(expectedReference)
    );
    if (matchingObservation === void 0 || !requireExactFields(
      matchingObservation,
      ["surfaceKey", "sourceReference", "edgeIds"],
      "Surface observation",
      diagnostics,
      binding.surfaceKey
    ) || !Array.isArray(matchingObservation.edgeIds) || new Set(matchingObservation.edgeIds).size !== matchingObservation.edgeIds.length || canonicalJson([...matchingObservation.edgeIds].sort()) !== canonicalJson(expectedObservationEdgeIds)) {
      diagnostics.push(
        red("FAKE_SURFACE_ASSOCIATION", binding.surfaceKey, "Runtime evidence did not observe this exact compiler callsite on every relevant edge.")
      );
    }
  }
}
function implementationNode(context, callable) {
  const spans = [callable.declaration, ...callable.symbolDeclarations];
  const found = [];
  for (const span of spans) {
    const source7 = context.program.getSourceFile(
      path41.resolve(context.repositoryRoot, span.file)
    );
    if (source7 === void 0) continue;
    const node = nodeAtExactSpan(source7, span.start.offset, span.end.offset);
    if (node === void 0) continue;
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && node.body !== void 0) {
      found.push(node);
    } else if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && node.initializer !== void 0 && (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer))) {
      found.push(node.initializer);
    }
  }
  const unique = [...new Set(found)];
  return unique.length === 1 ? unique[0] : void 0;
}
function unwrapDelegateExpression(expression) {
  let current = expression;
  while (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current) || ts.isAsExpression(current)) {
    current = current.expression;
  }
  return current;
}
function exportEntrypointForKey(surfaceKey) {
  if (!surfaceKey.startsWith("export:")) return void 0;
  const separator = surfaceKey.indexOf("#", "export:".length);
  return separator < 0 ? void 0 : surfaceKey.slice("export:".length, separator);
}
function inspectCompilerDelegate(context, callable, surface) {
  const implementation = implementationNode(context, callable);
  if (implementation === void 0) {
    return { status: "not-delegate", code: "MISSING_UNIQUE_DELEGATE_BODY", targetSurfaceKeys: [] };
  }
  let expression;
  if (ts.isBlock(implementation.body)) {
    if (implementation.body.statements.length !== 1 || !ts.isReturnStatement(implementation.body.statements[0]) || implementation.body.statements[0].expression === void 0) {
      return { status: "not-delegate", code: "IMPURE_DELEGATE", targetSurfaceKeys: [] };
    }
    expression = implementation.body.statements[0].expression;
  } else {
    expression = implementation.body;
  }
  const call = unwrapDelegateExpression(expression);
  if (!ts.isCallExpression(call)) {
    return { status: "not-delegate", code: "IMPURE_DELEGATE", targetSurfaceKeys: [] };
  }
  const parameters = implementation.parameters;
  if (call.arguments.length !== parameters.length) {
    return { status: "not-delegate", code: "IMPURE_DELEGATE", targetSurfaceKeys: [] };
  }
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index];
    const argument = call.arguments[index];
    const argumentExpression = ts.isSpreadElement(argument) ? argument.expression : argument;
    if (!ts.isIdentifier(parameter.name) || !ts.isIdentifier(argumentExpression) || !sameSymbol(context.checker, parameter.name, argumentExpression) || parameter.dotDotDotToken !== void 0 !== ts.isSpreadElement(argument)) {
      return { status: "not-delegate", code: "IMPURE_DELEGATE", targetSurfaceKeys: [] };
    }
  }
  const targetIds = new Set(callTargetDeclarationIds(context, call));
  const declarationTargetKeys = surface.callables.filter(
    (target) => target.key !== callable.key && surfaceDeclarationIds(target).some((id) => targetIds.has(id))
  ).map((target) => target.key).sort();
  const sourceEntrypoint = exportEntrypointForKey(callable.key);
  const sameEntrypointTargets = sourceEntrypoint === void 0 ? [] : declarationTargetKeys.filter(
    (targetKey) => exportEntrypointForKey(targetKey) === sourceEntrypoint
  );
  const targetSurfaceKeys = sameEntrypointTargets.length === 1 ? sameEntrypointTargets : declarationTargetKeys;
  if (targetSurfaceKeys.length === 0) {
    return { status: "not-delegate", code: "FALSE_DELEGATE_TARGET", targetSurfaceKeys };
  }
  return {
    status: "compiler-proven-candidate",
    code: null,
    implementation: spanOf(context, implementation),
    call: sourceReferenceForCall(context, call),
    targetSurfaceKeys
  };
}
function verifyDelegate(context, binding, callable, callableByKey, bindingByKey, diagnostics) {
  const target = callableByKey.get(binding.targetSurfaceKey);
  const targetBinding = bindingByKey.get(binding.targetSurfaceKey);
  if (target === void 0) {
    diagnostics.push(red("MISSING_DELEGATE_TARGET", binding.surfaceKey, "C target is not a surface key."));
    return;
  }
  if (targetBinding === void 0 || !["A", "B"].includes(targetBinding.mode)) {
    diagnostics.push(red("UNBOUND_DELEGATE_TARGET", binding.surfaceKey, "C target must be directly bound A or B."));
    return;
  }
  const inspection = inspectCompilerDelegate(context, callable, {
    callables: [...callableByKey.values()]
  });
  if (inspection.status !== "compiler-proven-candidate") {
    diagnostics.push(
      red(
        inspection.code,
        binding.surfaceKey,
        "C body is not one exact parameter-preserving return call."
      )
    );
    return;
  }
  if (!inspection.targetSurfaceKeys.includes(target.key)) {
    diagnostics.push(
      red("FALSE_DELEGATE_TARGET", binding.surfaceKey, "Compiler target differs from declared C target.")
    );
  }
}
function checkBindings({ repositoryRoot, surface, registries, registeredProducerFamilies = [], compilerContext }) {
  const diagnostics = [];
  const bindings = [];
  const registryOwners = /* @__PURE__ */ new Set();
  for (const registry of registries) {
    if (!hasExactFields(registry, ["schemaVersion", "owner", "bindings"]) || registry.schemaVersion !== BINDING_SCHEMA_VERSION || !isNonEmptyString(registry.owner) || !Array.isArray(registry.bindings)) {
      diagnostics.push(red("INVALID_BINDING_REGISTRY", "<registry>", "Registry schema/owner/bindings are invalid."));
      continue;
    }
    if (registryOwners.has(registry.owner)) {
      diagnostics.push(
        red("DUPLICATE_REGISTRY_OWNER", "<registry>", `Owner '${registry.owner}' has multiple registries.`)
      );
    }
    registryOwners.add(registry.owner);
    bindings.push(...registry.bindings);
  }
  const callableByKey = new Map(surface.callables.map((callable) => [callable.key, callable]));
  const bindingByKey = /* @__PURE__ */ new Map();
  for (const binding of bindings) {
    if (!isNonEmptyString(binding?.surfaceKey)) {
      diagnostics.push(red("MISSING_BINDING_KEY", "<binding>", "Binding has no surfaceKey."));
      continue;
    }
    if (bindingByKey.has(binding.surfaceKey)) {
      diagnostics.push(red("DUPLICATE_BINDING", binding.surfaceKey, "Surface has more than one binding."));
      continue;
    }
    bindingByKey.set(binding.surfaceKey, binding);
    if (!callableByKey.has(binding.surfaceKey)) {
      diagnostics.push(red("UNKNOWN_SURFACE_BINDING", binding.surfaceKey, "Binding key is not compiler reachable."));
    }
  }
  for (const callable of surface.callables) {
    if (!bindingByKey.has(callable.key)) {
      diagnostics.push(red("MISSING_BINDING", callable.key, "Compiler-reachable callable is unbound."));
    }
  }
  let context;
  try {
    context = compilerContext ?? evidenceCompilerContext(repositoryRoot, [...bindingByKey.values()]);
    if (path41.resolve(repositoryRoot) !== context.repositoryRoot) throw new Error("Binder compiler context belongs to another repository.");
    for (const binding of bindingByKey.values()) {
      for (const reference of sourceReferences(binding)) {
        if (isNonEmptyString(reference?.file) && context.program.getSourceFile(path41.resolve(repositoryRoot, reference.file)) === void 0) throw new Error("Shared compiler omitted a bound evidence source.");
      }
    }
  } catch (error) {
    diagnostics.push(
      red(
        "EVIDENCE_COMPILATION_FAILED",
        "<program>",
        error instanceof Error ? error.message : String(error)
      )
    );
    return diagnostics;
  }
  for (const binding of bindingByKey.values()) {
    const callable = callableByKey.get(binding.surfaceKey);
    if (callable === void 0) continue;
    if (!["A", "B", "C", "V", "HARD_RED"].includes(binding.mode)) {
      diagnostics.push(red("INVALID_BINDING_MODE", binding.surfaceKey, "Mode must be A, B, C, V, or HARD_RED."));
      continue;
    }
    if (!hasExactBindingShape(binding)) {
      diagnostics.push(
        red(
          "BINDING_SCHEMA_SHAPE",
          binding.surfaceKey,
          "Binding fields do not match its exact mode schema."
        )
      );
      continue;
    }
    if (binding.mode === "HARD_RED") {
      diagnostics.push(
        red("EXPLICIT_HARD_RED", binding.surfaceKey, binding.reason ?? "Explicitly unsupported/unbound.")
      );
      continue;
    }
    if (binding.mode === "C") {
      verifyDelegate(context, binding, callable, callableByKey, bindingByKey, diagnostics);
      continue;
    }
    if (binding.mode === "V") {
      for (const issue of verifyValueContractBinding({ repositoryRoot, context, surface, binding })) {
        diagnostics.push(red(issue.code, binding.surfaceKey, issue.detail));
      }
      continue;
    }
    if (hasRegisteredProducerBindingShape(binding)) {
      for (const issue of verifyRegisteredProducerBinding({
        repositoryRoot,
        context,
        surface,
        binding,
        registrations: registeredProducerFamilies
      })) {
        diagnostics.push(red(issue.code, binding.surfaceKey, issue.detail));
      }
      continue;
    }
    if (!isNonEmptyString(binding.formal?.model) || !isNonEmptyString(binding.formal?.source) || !isNonEmptyString(binding.formal?.sourceHash)) {
      diagnostics.push(red("MISSING_FORMAL_IDENTITY", binding.surfaceKey, "A/B needs exact model identity/hash."));
    }
    if (isNonEmptyString(binding.formal?.source)) {
      const formalSource = repositoryOwnedPath(repositoryRoot, binding.formal.source);
      if (formalSource === void 0) {
        diagnostics.push(red("EVIDENCE_PATH_ESCAPE", binding.surfaceKey, "Formal source leaves the repository."));
        continue;
      }
      try {
        const actualFormalHash = sha256(
          fs37.readFileSync(formalSource)
        );
        if (actualFormalHash !== binding.formal.sourceHash) {
          diagnostics.push(red("FORMAL_SOURCE_DRIFT", binding.surfaceKey, "Authoritative model source hash changed."));
        }
      } catch (error) {
        diagnostics.push(
          red(
            "MISSING_FORMAL_SOURCE",
            binding.surfaceKey,
            error instanceof Error ? error.message : String(error)
          )
        );
      }
    }
    if (binding.mode === "A" && formalActionOperators(binding) === void 0) {
      diagnostics.push(
        red(
          "MISSING_FORMAL_ACTION",
          binding.surfaceKey,
          "A needs exactly one action or one non-empty unique action set."
        )
      );
    }
    const references = sourceReferences(binding);
    const readReferences = binding.mode === "B" ? bindingReadReferences(binding) : [];
    const expectedCount = binding.mode === "A" ? 5 : readReferences.length + 2;
    if (references.length !== expectedCount) {
      diagnostics.push(red("MISSING_SEMANTIC_CALLS", binding.surfaceKey, `${binding.mode} source evidence is incomplete.`));
      continue;
    }
    const nodes = references.map(
      (reference, index) => resolveCallReference(
        context,
        reference,
        binding.mode === "A" ? ["action", "state check", "result check", "enabledness check", "reverse Next check"][index] : ["read", "projection", "projection check"][index],
        diagnostics,
        binding.surfaceKey
      )
    );
    const semanticCalls = binding.mode === "A" ? nodes.slice(0, 1) : nodes.slice(0, -2);
    for (const semanticCall of semanticCalls) {
      if (semanticCall === void 0) continue;
      const targetIds = new Set(surfaceDeclarationIds(callable));
      if (!callTargetDeclarationIds(context, semanticCall).some((id) => targetIds.has(id)) || !callUsesExactEntrypoint(context, semanticCall, callable, surface)) {
        diagnostics.push(red("FALSE_SURFACE_ASSOCIATION", binding.surfaceKey, "Compiler-resolved call differs from surface key."));
      }
    }
    const checkCalls = binding.mode === "A" ? nodes.slice(1) : nodes.slice(2);
    for (const checkCall of checkCalls) {
      if (checkCall !== void 0 && !checkResultIsEnforced(context, checkCall)) {
        diagnostics.push(
          red("IGNORED_CHECK_RESULT", binding.surfaceKey, "A semantic check returns a value that is discarded.")
        );
      }
      if (checkCall !== void 0 && hasOnlyLiteralCheckInputs(checkCall)) {
        diagnostics.push(
          red("CONSTANT_CHECK_INPUT", binding.surfaceKey, "A semantic check receives only literal constants.")
        );
      }
    }
    if (binding.mode === "A" && nodes[0] !== void 0 && nodes[2] !== void 0 && !callFeedsCall(context, nodes[0], nodes[2])) {
      diagnostics.push(
        red("ACTION_RESULT_NOT_CHECKED", binding.surfaceKey, "The real action result does not feed its result check.")
      );
    }
    if (binding.mode === "B" && nodes.at(-2) !== void 0 && nodes.at(-1) !== void 0) {
      const projectionCall = nodes.at(-2);
      const projectionCheckCall = nodes.at(-1);
      for (const readCall of nodes.slice(0, -2)) {
        if (readCall !== void 0 && !callFeedsCall(context, readCall, projectionCall)) {
          diagnostics.push(red("READ_DOES_NOT_FEED_PROJECTION", binding.surfaceKey, "Every declared read must feed the projection."));
        }
      }
      if (!callFeedsCall(context, projectionCall, projectionCheckCall)) {
        diagnostics.push(red("PROJECTION_NOT_CHECKED", binding.surfaceKey, "Projection result does not feed check."));
      }
      const projectionType = context.checker.getTypeAtLocation(projectionCall);
      if ((projectionType.flags & ts.TypeFlags.Void) !== 0) {
        diagnostics.push(red("EMPTY_PROJECTION", binding.surfaceKey, "Projection call returns void."));
      }
    }
    verifyExecutionEvidence(repositoryRoot, binding, callable, diagnostics);
  }
  return diagnostics.sort((left, right) => {
    const keyComparison = compareCodeUnits(left.surfaceKey, right.surfaceKey);
    return keyComparison !== 0 ? keyComparison : compareCodeUnits(left.code, right.code);
  });
}
function sourceReferenceForCall(context, call) {
  const span = spanOf(context, call);
  return {
    file: span.file,
    start: span.start.offset,
    end: span.end.offset,
    sourceHash: span.sourceHash,
    astHash: span.astHash
  };
}

// experiments/tla-conformance/final-convergence/current-review-assurance.mjs
var import_formal_implementation_surface = __toESM(require_formal_implementation_surface(), 1);
import assert40 from "node:assert/strict";
import crypto4 from "node:crypto";
import fs38 from "node:fs";
import path42 from "node:path";
import { execFileSync as execFileSync4 } from "node:child_process";

// scripts/repository-assurance-state.mjs
import { createHash as createHash2 } from "node:crypto";
import { spawnSync } from "node:child_process";
var excludedPaths = /* @__PURE__ */ new Set([
  "formal/implementation-conformance/EXECUTABLE_ASSURANCE_REPORT.json"
]);
function includedPath(path45) {
  return path45.length > 0 && !path45.startsWith(".chatgpt/") && !excludedPaths.has(path45);
}
function hashAssuranceEntries(entries) {
  const hash = createHash2("sha256");
  const writeLength = (length2) => {
    const encoded = Buffer.allocUnsafe(8);
    encoded.writeBigUInt64BE(BigInt(length2));
    hash.update(encoded);
  };
  for (const entry of [...entries].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)) {
    const pathBytes = Buffer.from(entry.path);
    writeLength(pathBytes.length);
    hash.update(pathBytes);
    hash.update(Buffer.from([entry.kind]));
    const modeBytes = Buffer.from(entry.mode);
    writeLength(modeBytes.length);
    hash.update(modeBytes);
    writeLength(entry.payload.length);
    hash.update(entry.payload);
  }
  return hash.digest("hex");
}
function repositoryAssuranceCommittedStateSha256(repositoryRoot, commit) {
  const listed = spawnSync(
    "git",
    ["ls-tree", "-rz", "--full-tree", commit],
    { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (listed.error !== void 0 || listed.status !== 0) {
    throw new Error(`Unable to enumerate committed repository assurance state '${commit}'.`);
  }
  const rows = [];
  for (const record of listed.stdout.split("\0")) {
    if (record.length === 0) continue;
    const tab = record.indexOf("	");
    if (tab < 0) throw new Error("Malformed git ls-tree assurance record.");
    const header = record.slice(0, tab).split(" ");
    const path45 = record.slice(tab + 1);
    if (!includedPath(path45)) continue;
    if (header.length !== 3 || header[1] !== "blob" || !/^[a-f0-9]{40,64}$/u.test(header[2])) throw new Error(`Unsupported committed assurance entry '${path45}'.`);
    const kind = header[0] === "120000" ? 1 : header[0] === "100644" || header[0] === "100755" ? 0 : void 0;
    if (kind === void 0) throw new Error(`Unsupported committed assurance mode for '${path45}'.`);
    rows.push({ path: path45, kind, mode: header[0], objectId: header[2] });
  }
  const batch = spawnSync("git", ["cat-file", "--batch"], {
    cwd: repositoryRoot,
    input: rows.map((row) => row.objectId + "\n").join(""),
    maxBuffer: 256 * 1024 * 1024
  });
  if (batch.error !== void 0 || batch.status !== 0) throw new Error("Unable to read committed assurance object batch.");
  let offset = 0;
  const entries = [];
  for (const row of rows) {
    const end = batch.stdout.indexOf(10, offset);
    if (end < 0) throw new Error("Truncated committed assurance batch header.");
    const fields2 = batch.stdout.subarray(offset, end).toString("ascii").split(" ");
    if (fields2.length !== 3 || fields2[0] !== row.objectId || fields2[1] !== "blob" || !/^(0|[1-9][0-9]*)$/u.test(fields2[2])) throw new Error("Committed assurance batch identity mismatch.");
    const size = Number(fields2[2]);
    offset = end + 1;
    if (!Number.isSafeInteger(size) || offset + size >= batch.stdout.length || batch.stdout[offset + size] !== 10) throw new Error("Truncated committed assurance batch payload.");
    entries.push({ path: row.path, kind: row.kind, mode: row.mode, payload: batch.stdout.subarray(offset, offset + size) });
    offset += size + 1;
  }
  if (offset !== batch.stdout.length) throw new Error("Unexpected trailing committed assurance batch output.");
  return hashAssuranceEntries(entries);
}

// experiments/tla-conformance/final-convergence/current-review-assurance.mjs
var CURRENT_REVIEW_ASSURANCE_RECEIPT = "experiments/tla-conformance/final-convergence/current-pr-review-assurance-receipt.json";
var CURRENT_REVIEW_ASSURANCE_REPORT = "formal/implementation-conformance/EXECUTABLE_ASSURANCE_REPORT.json";
var CURRENT_REVIEW_ASSURANCE_FULL_LOG = "experiments/tla-conformance/final-convergence/current-pr-review-full.log";
var CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD = "f5ea450f5436bc6be1a6cdaac34dee8744ba61c1";
var AUTHORITATIVE_PATHS = Object.freeze(["src", "formal", "scripts", "test", "package.json", "tsconfig.json", "tsconfig.test.json"]);
function sha2564(file) {
  return crypto4.createHash("sha256").update(fs38.readFileSync(file)).digest("hex");
}
function canonicalJson2(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson2).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson2(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function currentReviewSurfaceSha256(repositoryRoot, context) {
  const surface = import_formal_implementation_surface.default.discoverImplementationSurface({ repositoryRoot, program: context?.program });
  return crypto4.createHash("sha256").update(canonicalJson2(surface)).digest("hex");
}
function repositoryPath(repositoryRoot, file) {
  return assuranceRepositoryPath(repositoryRoot, file);
}
function regularFile(repositoryRoot, file, label) {
  const target = repositoryPath(repositoryRoot, file);
  const stat = fs38.lstatSync(target);
  assert40.equal(stat.isFile(), true, `${label} is not a regular file.`);
  return target;
}
function committedFileSha256(repositoryRoot, commit, file) {
  const bytes2 = execFileSync4("git", ["show", `${commit}:${file}`], {
    cwd: repositoryRoot,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024
  });
  return crypto4.createHash("sha256").update(bytes2).digest("hex");
}
function assertCurrentReviewAssuranceContent({
  receipt,
  report,
  reportSha256,
  fullLogSha256,
  independentlyDerivedSurfaceSha256,
  independentlyDerivedRepositoryStateSha256
}) {
  assert40.equal(receipt.schemaVersion, 1, "Current review assurance receipt schema is unsupported.");
  assert40.equal(receipt.status, "CURRENT_PR_REVIEW_FULL_ASSURANCE_VERIFIED", "Current review assurance receipt status is invalid.");
  assert40.match(receipt.certifiedHead, /^[a-f0-9]{40}$/u, "Current review assurance certified head is invalid.");
  assert40.equal(receipt.report.file, CURRENT_REVIEW_ASSURANCE_REPORT, "Current review assurance report path is not package-owned.");
  assert40.equal(receipt.fullLog.file, CURRENT_REVIEW_ASSURANCE_FULL_LOG, "Current review assurance full-log path is not package-owned.");
  assert40.equal(reportSha256, receipt.report.sha256, "Current review assurance report bytes changed.");
  assert40.equal(fullLogSha256, receipt.fullLog.sha256, "Current review assurance full-log bytes changed.");
  assert40.equal(report.repositoryHead, receipt.certifiedHead, "Current review assurance report certifies the wrong commit.");
  assert40.equal(report.fullFormal, true, "Current review assurance report is not a full-formal run.");
  assert40.match(report.surfaceSha256, /^[a-f0-9]{64}$/u, "Current review assurance report surface digest is invalid.");
  assert40.match(receipt.surfaceSha256, /^[a-f0-9]{64}$/u, "Current review assurance receipt surface digest is invalid.");
  assert40.equal(report.surfaceSha256, independentlyDerivedSurfaceSha256, "Current review assurance report surface digest is not independently source-derived.");
  assert40.equal(receipt.surfaceSha256, independentlyDerivedSurfaceSha256, "Current review assurance receipt surface digest is not independently source-derived.");
  assert40.equal(report.apiEntries, 510, "Current review assurance API census changed.");
  assert40.equal(report.compilerCallGraphUnresolvedApis, 0, "Current review assurance has unresolved public APIs.");
  assert40.equal(report.repositoryStateSha256, receipt.repositoryStateSha256, "Current review assurance state receipt disagrees with the report.");
  assert40.equal(independentlyDerivedRepositoryStateSha256, receipt.repositoryStateSha256, "Current review assurance was not produced from the exact clean committed evidence state.");
  assert40.equal(report.fullLogSha256, receipt.fullLog.sha256, "Current review assurance report is not bound to the tracked full log.");
}
function verifyCurrentReviewAssurance(repositoryRoot, context) {
  const root3 = path42.resolve(repositoryRoot);
  const receiptPath = regularFile(root3, CURRENT_REVIEW_ASSURANCE_RECEIPT, "Current review assurance receipt");
  execFileSync4("git", ["merge-base", "--is-ancestor", CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD, "HEAD"], { cwd: root3, stdio: "ignore" });
  assert40.equal(
    sha2564(receiptPath),
    committedFileSha256(root3, CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD, CURRENT_REVIEW_ASSURANCE_RECEIPT),
    "Current review assurance receipt differs from its immutable evidence commit."
  );
  const receipt = JSON.parse(fs38.readFileSync(receiptPath, "utf8"));
  assert40.match(receipt.certifiedHead, /^[a-f0-9]{40}$/u, "Current review assurance certified head is invalid.");
  assert40.equal(
    execFileSync4("git", ["rev-parse", `${CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD}^`], { cwd: root3, encoding: "utf8" }).trim(),
    receipt.certifiedHead,
    "Immutable current-review evidence commit is not the direct child of the certified repair head."
  );
  execFileSync4("git", ["merge-base", "--is-ancestor", receipt.certifiedHead, "HEAD"], { cwd: root3, stdio: "ignore" });
  assert40.equal(receipt.report.file, CURRENT_REVIEW_ASSURANCE_REPORT, "Current review assurance report path is not package-owned.");
  assert40.equal(receipt.fullLog.file, CURRENT_REVIEW_ASSURANCE_FULL_LOG, "Current review assurance full-log path is not package-owned.");
  const reportPath = regularFile(root3, CURRENT_REVIEW_ASSURANCE_REPORT, "Current review assurance report");
  const logPath = regularFile(root3, CURRENT_REVIEW_ASSURANCE_FULL_LOG, "Current review assurance full log");
  assert40.equal(
    sha2564(reportPath),
    committedFileSha256(root3, CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD, CURRENT_REVIEW_ASSURANCE_REPORT),
    "Current review assurance report differs from its immutable evidence commit."
  );
  assert40.equal(
    sha2564(logPath),
    committedFileSha256(root3, CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD, CURRENT_REVIEW_ASSURANCE_FULL_LOG),
    "Current review assurance full log differs from its immutable evidence commit."
  );
  const reportSha256 = sha2564(reportPath);
  const fullLogSha256 = sha2564(logPath);
  const report = JSON.parse(fs38.readFileSync(reportPath, "utf8"));
  assertCurrentReviewAssuranceContent({
    receipt,
    report,
    reportSha256,
    fullLogSha256,
    independentlyDerivedSurfaceSha256: currentReviewSurfaceSha256(root3, context),
    independentlyDerivedRepositoryStateSha256: repositoryAssuranceCommittedStateSha256(root3, receipt.certifiedHead)
  });
  const dirtyAuthoritativePaths = execFileSync4(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all", "--", ...AUTHORITATIVE_PATHS],
    { cwd: root3, encoding: "utf8" }
  ).trim();
  assert40.equal(
    dirtyAuthoritativePaths,
    "",
    "Current review assurance requires a clean authoritative worktree."
  );
  const authoritativeDelta = execFileSync4(
    "git",
    ["diff", "--name-only", receipt.certifiedHead, "HEAD", "--", ...AUTHORITATIVE_PATHS],
    { cwd: root3, encoding: "utf8" }
  ).split(/\r?\n/u).filter(Boolean).sort();
  assert40.deepEqual(
    authoritativeDelta,
    [CURRENT_REVIEW_ASSURANCE_REPORT],
    "Proof integration changed authoritative product/assurance bytes after the certified full run."
  );
  return {
    receipt,
    reference: {
      file: CURRENT_REVIEW_ASSURANCE_RECEIPT,
      sha256: sha2564(receiptPath),
      evidenceHead: CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD,
      certifiedHead: receipt.certifiedHead,
      repositoryStateSha256: receipt.repositoryStateSha256,
      fullLogSha256: receipt.fullLog.sha256,
      surfaceSha256: receipt.surfaceSha256
    }
  };
}

// experiments/tla-conformance/final-convergence/build-final-registry.mjs
import assert41 from "node:assert/strict";
var DIRECTORY4 = "experiments/tla-conformance/final-convergence/";
function buildFinalRegistry(root3) {
  const valueFile = DIRECTORY4 + "final-v309.json", producerFile = DIRECTORY4 + "final-a121-b58.json";
  const value = JSON.parse(readAssuranceFile(root3, valueFile)), producer = JSON.parse(readAssuranceFile(root3, producerFile));
  assert41.equal(value.proofKind, "final-convergence-value-v309-v1");
  assert41.equal(producer.proofKind, "final-convergence-producer-a121-b58-v1");
  assert41.equal(value.proofs.length, 309);
  assert41.equal(producer.proofs.length, 179);
  assert41.equal(value.surfaceDigest, producer.surfaceDigest);
  const values = new Set(value.proofs.map((row) => row.surfaceKey));
  const producers = new Map(producer.proofs.map((row) => [row.surfaceKey, row.mode]));
  assert41.equal(values.size, 309);
  assert41.equal(producers.size, 179);
  const valueRef = { file: valueFile, sha256: assuranceFileSha256(root3, valueFile) };
  const producerRef = { file: producerFile, sha256: assuranceFileSha256(root3, producerFile) };
  const bindings = epochRegistryRows.map((row) => {
    if (row.mode === "HARD_RED") return structuredClone(row);
    if (row.mode === "V") {
      assert41(values.has(row.surfaceKey));
      return { surfaceKey: row.surfaceKey, mode: row.mode, evidence: valueRef };
    }
    assert41.equal(producers.get(row.surfaceKey), row.mode);
    return { surfaceKey: row.surfaceKey, mode: row.mode, evidence: producerRef };
  });
  assert41.equal(bindings.length, 535);
  return { schemaVersion: 1, owner: "InventoryOnceEpochMilliseconds", bindings };
}

// experiments/tla-conformance/final-convergence/final-selftest.mjs
import assert42 from "node:assert/strict";
import fs39 from "node:fs";
import path43 from "node:path";
function runFinalAdversarialChecks(ROOT3, context) {
  const VALUE_FILE = "experiments/tla-conformance/final-convergence/final-v309.json";
  const PRODUCER_FILE = "experiments/tla-conformance/final-convergence/final-a121-b58.json";
  const surface = context.surface;
  const valueRegistration = Object.freeze({ proofKind: valueProofKind, buildFamilyArtifact: buildFinalValueArtifact, supportedSurfaceKeys: supportedValueKeys });
  const producerRegistration = Object.freeze({ proofKind: producerProofKind, buildFamilyArtifact: buildFinalProducerArtifact, supportedSurfaceRows: supportedProducerRows });
  function evidence(file) {
    return { file, sha256: sha256(fs39.readFileSync(path43.resolve(ROOT3, file))) };
  }
  function writeTemp(name, document) {
    const file = `experiments/tla-conformance/final-convergence/${name}`;
    fs39.writeFileSync(finalConvergenceRepositoryPath(ROOT3, file), `${JSON.stringify(document, null, 2)}
`);
    return file;
  }
  const valueEvidence = evidence(VALUE_FILE);
  const producerEvidence = evidence(PRODUCER_FILE);
  const valueKey2 = supportedValueKeys[0];
  const producerA = supportedProducerRows.find((row) => row.mode === "A");
  const producerB = supportedProducerRows.find((row) => row.mode === "B");
  assert42(producerA !== void 0 && producerB !== void 0);
  assert42.deepEqual(verifyRegisteredValueBinding({ repositoryRoot: ROOT3, context, surface, binding: { surfaceKey: valueKey2, mode: "V", evidence: valueEvidence }, registrations: [valueRegistration] }), []);
  assert42.equal(verifyRegisteredValueBinding({ repositoryRoot: ROOT3, context, surface, binding: { surfaceKey: valueKey2, mode: "A", evidence: valueEvidence }, registrations: [valueRegistration] })[0]?.code, "VALUE_FAMILY_PROOF_REJECTED");
  const tamperedValue = JSON.parse(fs39.readFileSync(finalConvergenceRepositoryPath(ROOT3, VALUE_FILE), "utf8"));
  tamperedValue.proofs[0].semantics = { ...tamperedValue.proofs[0].semantics, finalConvergenceTamper: true };
  const tamperedValueFile = writeTemp(".tampered-v309.json", tamperedValue);
  try {
    assert42.equal(verifyRegisteredValueBinding({ repositoryRoot: ROOT3, context, surface, binding: { surfaceKey: tamperedValue.proofs[0].surfaceKey, mode: "V", evidence: evidence(tamperedValueFile) }, registrations: [valueRegistration] })[0]?.code, "VALUE_FAMILY_PROOF_REJECTED");
  } finally {
    fs39.rmSync(finalConvergenceRepositoryPath(ROOT3, tamperedValueFile), { force: true });
  }
  for (const row of [producerA, producerB]) {
    assert42.deepEqual(verifyRegisteredProducerBinding({ repositoryRoot: ROOT3, context, surface, binding: { surfaceKey: row.surfaceKey, mode: row.mode, evidence: producerEvidence }, registrations: [producerRegistration] }), []);
  }
  assert42.equal(verifyRegisteredProducerBinding({ repositoryRoot: ROOT3, context, surface, binding: { surfaceKey: producerA.surfaceKey, mode: producerA.mode === "A" ? "B" : "A", evidence: producerEvidence }, registrations: [producerRegistration] })[0]?.code, "REGISTERED_PRODUCER_PROOF_REJECTED");
  const tamperedProducer = JSON.parse(fs39.readFileSync(finalConvergenceRepositoryPath(ROOT3, PRODUCER_FILE), "utf8"));
  tamperedProducer.proofs[0].semantics = { ...tamperedProducer.proofs[0].semantics, finalConvergenceTamper: true };
  const tamperedProducerFile = writeTemp(".tampered-a121-b58.json", tamperedProducer);
  try {
    const row = tamperedProducer.proofs[0];
    assert42.equal(verifyRegisteredProducerBinding({ repositoryRoot: ROOT3, context, surface, binding: { surfaceKey: row.surfaceKey, mode: row.mode, evidence: evidence(tamperedProducerFile) }, registrations: [producerRegistration] })[0]?.code, "REGISTERED_PRODUCER_PROOF_REJECTED");
  } finally {
    fs39.rmSync(finalConvergenceRepositoryPath(ROOT3, tamperedProducerFile), { force: true });
  }
  for (const [file, buildArtifact] of [
    ["authority-producer17.json", buildFinalProducerArtifact],
    ["authority-value3.json", buildFinalValueArtifact],
    ["r137-v15.json", buildFinalValueArtifact],
    ["readworld-producer24.json", buildFinalProducerArtifact],
    ["wrapper-producer11.json", buildFinalProducerArtifact],
    ["r170-pristine-repro-transport.json", buildFinalProducerArtifact]
  ]) {
    const target = finalConvergenceRepositoryPath(ROOT3, `experiments/tla-conformance/final-convergence/${file}`);
    const original = fs39.readFileSync(target), times = fs39.statSync(target);
    try {
      const forged = JSON.parse(original.toString("utf8"));
      if (Array.isArray(forged.proofs)) forged.proofs[0].semantics = { ...forged.proofs[0].semantics, systemicUnprovedAuthority: true };
      else {
        forged.affectedStrictRows = [];
        const { contentSha256, ...core } = forged;
        forged.contentSha256 = sha256(JSON.stringify(core));
      }
      fs39.writeFileSync(target, `${JSON.stringify(forged, null, 2)}
`);
      fs39.utimesSync(target, times.atime, times.mtime);
      assert42.throws(() => buildArtifact({ repositoryRoot: ROOT3, context, surface }), /Frozen assurance evidence differs from immutable proof input/u, `Re-signed ${file} must not acquire proof credit.`);
    } finally {
      fs39.writeFileSync(target, original);
      fs39.utimesSync(target, times.atime, times.mtime);
    }
  }
  return { status: "FINAL_CONVERGENCE_ADVERSARIAL_PASS", surfaceDigest: surface.digest, valueRows: supportedValueKeys.length, producerRows: supportedProducerRows.length, controls: { honestValueAccepted: true, wrongValueModeRejected: true, resignedValueTamperRejected: true, honestAandBAccepted: true, wrongProducerModeRejected: true, resignedProducerTamperRejected: true, immutableHistoricalAuthorityTamperRejected: true, sameMtimeEvidenceDriftRejected: true } };
}

// experiments/tla-conformance/final-convergence/run-final-verifier.mjs
var DIRECTORY5 = "experiments/tla-conformance/final-convergence/";
function createFinalCompilerContext(root3) {
  const configPath = path44.join(root3, "tsconfig.test.json");
  const config = ts3.readConfigFile(configPath, ts3.sys.readFile);
  if (config.error !== void 0) throw new Error(ts3.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts3.parseJsonConfigFileContent(config.config, ts3.sys, root3, void 0, configPath);
  if (parsed.errors.length !== 0) throw new Error("Invalid shared assurance compiler configuration.");
  const program = ts3.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const context = loadCompilerContext(root3, program);
  context.surface = discoverCompilerSurface(root3, context);
  return context;
}
function verifyFinalCurrentReview(root3, context) {
  return verifyCurrentReviewAssurance(root3, context);
}
function buildFinalTransport(root3, context) {
  return buildFinalHeadTransport({ repositoryRoot: root3, context, surface: context.surface });
}
function buildFinalValues(root3, context) {
  return buildFinalValueArtifact({ repositoryRoot: root3, context, surface: context.surface });
}
function buildFinalProducers(root3, context) {
  return buildFinalProducerArtifact({ repositoryRoot: root3, context, surface: context.surface });
}
function buildFinalRegistryArtifact(root3) {
  return buildFinalRegistry(root3);
}
function verifyFinalBindings(root3, context) {
  const registry = JSON.parse(readAssuranceFile(root3, DIRECTORY5 + "final-surface-bindings.json"));
  const counts = {};
  for (const row of registry.bindings) counts[row.mode] = (counts[row.mode] ?? 0) + 1;
  assert43.deepEqual(counts, { A: 121, V: 309, B: 58, HARD_RED: 47 });
  assert43.deepEqual(registry.bindings.filter((row) => row.mode === "HARD_RED"), epochRegistryRows.filter((row) => row.mode === "HARD_RED"));
  assert43.deepEqual(registry.bindings.filter((row) => row.mode === "V").map((row) => row.surfaceKey).sort(), [...supportedValueKeys].sort());
  assert43.deepEqual(registry.bindings.filter((row) => row.mode === "A" || row.mode === "B").map((row) => ({ surfaceKey: row.surfaceKey, mode: row.mode })).sort((a, b) => a.surfaceKey < b.surfaceKey ? -1 : a.surfaceKey > b.surfaceKey ? 1 : 0), supportedProducerRows);
  const diagnostics = checkBindings({ repositoryRoot: root3, surface: context.surface, registries: [registry], compilerContext: context, registeredProducerFamilies: [{ proofKind: producerProofKind, buildFamilyArtifact: buildFinalProducerArtifact, supportedSurfaceRows: supportedProducerRows }] });
  const unexpectedRows = diagnostics.filter((row) => row.code !== "EXPLICIT_HARD_RED");
  assert43.deepEqual(unexpectedRows, [], "Central binder rejected a current strict row.");
  assert43.equal(diagnostics.length, 47);
  return {
    status: "FINAL_BINDER_GREEN",
    surfaceDigest: context.surface.digest,
    callables: context.surface.callables.length,
    diagnostics: 47,
    byCode: { EXPLICIT_HARD_RED: 47 },
    hardRed: 47,
    unexpected: 0,
    unexpectedRows: [],
    valueAccepted: 309,
    producerAccepted: 179,
    strictAccepted: 488
  };
}
function verifyFinalRegistry(root3) {
  const current = JSON.parse(readAssuranceFile(root3, DIRECTORY5 + "final-surface-bindings.json"));
  assert43.deepEqual(buildFinalRegistry(root3), current, "Exact final registry is stale.");
  return { status: "FINAL_535_REGISTRY_BUILT", counts: { A: 121, B: 58, V: 309, HARD_RED: 47 } };
}
function verifyFinalAdversarial(root3, context) {
  return runFinalAdversarialChecks(root3, context);
}
export {
  buildFinalProducers,
  buildFinalRegistryArtifact,
  buildFinalTransport,
  buildFinalValues,
  createFinalCompilerContext,
  verifyFinalAdversarial,
  verifyFinalBindings,
  verifyFinalCurrentReview,
  verifyFinalRegistry
};
