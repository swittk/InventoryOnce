import { compareInventoryIdentityText } from "./ordering.js";
import {
  extendInventoryCatalog,
  inventoryCatalogFromSnapshot,
  type InventoryCatalog,
  type InventoryItemDefinitionRevision,
  type InventoryPackagingDefinitionRevision,
} from "./catalog.js";
import { createInventoryOnce } from "./facade.js";
import type { ItemId } from "./model.js";
import {
  parseQuantity,
  positiveQuantity,
  quantityToDecimalString,
  unitCode,
} from "./quantity.js";
import type { InventoryDurableStorage } from "./storage.js";
import type { InventoryWorldState } from "./world.js";
import { inventorySparseRecordValue } from "./sparse-record.js";

/** One exact package unit expressed as a quantity of the scalar item's primary unit. */
export interface InventoryScalarPackageLevel {
  /** Exact normalized package unit identity. */
  readonly unit: string;
  /** Positive exact plain-decimal quantity of primary units. */
  readonly primaryQuantity: string;
}

/** Optional partial scalar unit/package declaration carried by one application command. */
export interface InventoryScalarCatalogSeed {
  /** Complete primary unit when the command declares or changes it. */
  readonly primaryUnit?: string;
  /** Complete package list; omission preserves the active revision's list. */
  readonly packageLevels?: readonly InventoryScalarPackageLevel[];
}

/** Fully normalized physical declaration supplied to an application revision-id factory. */
export interface InventoryScalarCatalogDeclaration {
  /** Stable item whose physical unit/package meaning is declared. */
  readonly itemId: ItemId;
  /** Exact normalized primary unit. */
  readonly primaryUnit: string;
  /** Canonically ordered complete package list. */
  readonly packageLevels: readonly InventoryScalarPackageLevel[];
}

/** Immutable definitions created by an application-specific identity factory. */
export interface InventoryScalarCatalogDefinitions {
  /** Exact candidate scalar item revision. */
  readonly item: InventoryItemDefinitionRevision;
  /** Exact package revisions belonging to that item revision. */
  readonly packaging: readonly InventoryPackagingDefinitionRevision[];
}

/** Kind of durable scalar-catalog publication selected by the native lifecycle. */
export enum InventoryScalarCatalogPublicationKind {
  /** Move the active pointer to an already-retained matching revision. */
  ActivateExisting = "activate-existing",
  /** Publish the first retained revision for a stable item. */
  FirstRevision = "first-revision",
  /** Append a new revision and make it active. */
  AppendAndActivate = "append-and-activate",
  /** Append a command-scoped historical revision without changing the active pointer. */
  AppendOnly = "append-only",
}

/** Inputs for selecting, appending, or activating one scalar unit/package revision. */
export interface EnsureInventoryScalarCatalogRevisionInput {
  /** Durable published inventory world. */
  readonly storage: InventoryDurableStorage;
  /** Stable item identity. */
  readonly itemId: ItemId;
  /** Primary or package unit used by this command. */
  readonly requestedUnit: string;
  /** Optional frozen partial physical declaration from the application command. */
  readonly seed?: InventoryScalarCatalogSeed;
  /** Whether this command may append a previously unseen immutable revision. */
  readonly allowCreate: boolean;
  /** Whether this command may move the active revision pointer. */
  readonly activateRevision?: boolean;
  /** Stable retry identity for any catalogue publication. */
  readonly operationId: string;
  /** Canonical physical/publication occurrence time. */
  readonly occurredAtEpochMs: number;
  /** Application-specific deterministic revision-id factory used only when append is required. */
  readonly defineRevision?: (
    declaration: InventoryScalarCatalogDeclaration
  ) => InventoryScalarCatalogDefinitions;
  /** Optional application audit reason selected after the native transition kind is known. */
  readonly reason?:
    | string
    | ((kind: InventoryScalarCatalogPublicationKind) => string);
}

/** Published world plus the exact immutable revision interpreting one scalar command. */
export interface EnsureInventoryScalarCatalogRevisionResult {
  /** Latest published world after an optional catalogue event. */
  readonly world: InventoryWorldState;
  /** Exact retained catalogue from that world. */
  readonly catalog: InventoryCatalog;
  /** Exact item revision selected for the caller. */
  readonly itemRevisionId: string;
  /** True when this call advanced catalogue truth. */
  readonly published: boolean;
  /** True when the durable catalogue publication replayed. */
  readonly replayed: boolean;
}

/** Resolve one scalar unit/package declaration through native retained catalogue truth. */
export async function ensureInventoryScalarCatalogRevision({
  storage,
  itemId,
  requestedUnit,
  seed,
  allowCreate,
  activateRevision = false,
  operationId,
  occurredAtEpochMs,
  defineRevision,
  reason,
}: EnsureInventoryScalarCatalogRevisionInput): Promise<EnsureInventoryScalarCatalogRevisionResult> {
  const world = await storage.readWorld();
  const catalog = inventoryCatalogFromSnapshot(world.catalog);
  const normalizedItemId = requireCatalogIdentity(itemId, "itemId");
  const normalizedRequestedUnit = normalizeCatalogUnit(requestedUnit);
  const activeRevisionId = inventorySparseRecordValue(
    catalog.activeItemRevisionIds,
    normalizedItemId
  );
  const activeItem =
    activeRevisionId === undefined
      ? undefined
      : catalog.itemRevision(activeRevisionId);
  const hasSeed =
    seed?.primaryUnit !== undefined || seed?.packageLevels !== undefined;

  if (!hasSeed && activeItem !== undefined) {
    assertScalarUnitResolves(
      catalog,
      normalizedItemId,
      activeItem.revisionId,
      normalizedRequestedUnit
    );
    return unchangedScalarCatalog(world, catalog, activeItem.revisionId);
  }
  if (
    !hasSeed &&
    activeItem === undefined &&
    !allowCreate &&
    !activateRevision
  ) {
    throw new Error(
      `Unknown active inventory item '${normalizedItemId}'; this command cannot invent item definition truth.`
    );
  }

  const activePackages =
    activeItem === undefined
      ? []
      : scalarPackageLevelsForRevision(
          catalog,
          normalizedItemId,
          activeItem.revisionId
        );
  const primaryUnit = normalizeCatalogUnit(
    seed?.primaryUnit ?? activeItem?.primaryAxis.unit ?? normalizedRequestedUnit
  );
  if (
    activeItem !== undefined &&
    primaryUnit !== activeItem.primaryAxis.unit &&
    seed?.packageLevels === undefined
  ) {
    throw new Error(
      "Changing an inventory primary unit requires an explicit complete package-level declaration."
    );
  }
  const packageLevels = normalizeScalarPackageLevels(
    seed?.packageLevels,
    primaryUnit,
    activePackages
  );
  assertScalarRequestedUnitDeclared(
    normalizedRequestedUnit,
    primaryUnit,
    packageLevels
  );
  const declaration: InventoryScalarCatalogDeclaration = {
    itemId: normalizedItemId,
    primaryUnit,
    packageLevels,
  };
  const matching = matchingScalarPhysicalRevisions(catalog, declaration);
  const selected = selectScalarPhysicalRevision(
    matching,
    activeRevisionId,
    normalizedItemId
  );

  if (selected !== undefined) {
    assertScalarUnitResolves(
      catalog,
      normalizedItemId,
      selected.revisionId,
      normalizedRequestedUnit
    );
    if (!activateRevision || selected.revisionId === activeRevisionId) {
      return unchangedScalarCatalog(world, catalog, selected.revisionId);
    }
    return publishScalarCatalog({
      storage,
      catalog,
      itemId: normalizedItemId,
      requestedUnit: normalizedRequestedUnit,
      selectedItemRevisionId: selected.revisionId,
      operationId,
      occurredAtEpochMs,
      activeItemRevisionIds: { [normalizedItemId]: selected.revisionId },
      reason: scalarCatalogPublicationReason(
        reason,
        InventoryScalarCatalogPublicationKind.ActivateExisting
      ),
    });
  }

  if (!allowCreate) {
    throw new Error(
      `Inventory command for '${normalizedItemId}' references an unretained unit/package revision.`
    );
  }
  if (defineRevision === undefined) {
    throw new Error(
      `Inventory scalar declaration for '${normalizedItemId}' needs a deterministic revision factory before it can be appended.`
    );
  }
  const definitions = defineRevision(declaration);
  assertScalarDefinitionsMatchDeclaration(definitions, declaration);
  return publishScalarCatalog({
    storage,
    catalog,
    itemId: normalizedItemId,
    requestedUnit: normalizedRequestedUnit,
    selectedItemRevisionId: definitions.item.revisionId,
    operationId,
    occurredAtEpochMs,
    itemRevisions: [definitions.item],
    packagingRevisions: definitions.packaging,
    activeItemRevisionIds:
      activeItem === undefined || activateRevision
        ? { [normalizedItemId]: definitions.item.revisionId }
        : {},
    reason: scalarCatalogPublicationReason(
      reason,
      activeItem === undefined
        ? InventoryScalarCatalogPublicationKind.FirstRevision
        : activateRevision
        ? InventoryScalarCatalogPublicationKind.AppendAndActivate
        : InventoryScalarCatalogPublicationKind.AppendOnly
    ),
  });
}

/** Resolve an application reason or stable native default for one publication kind. */
function scalarCatalogPublicationReason(
  reason:
    | string
    | ((kind: InventoryScalarCatalogPublicationKind) => string)
    | undefined,
  kind: InventoryScalarCatalogPublicationKind
): string {
  if (typeof reason === "function") return reason(kind);
  if (reason !== undefined) return reason;
  if (kind === InventoryScalarCatalogPublicationKind.ActivateExisting) {
    return "Activate an existing immutable scalar inventory definition revision.";
  }
  if (kind === InventoryScalarCatalogPublicationKind.FirstRevision) {
    return "Publish the first immutable scalar inventory definition revision.";
  }
  if (kind === InventoryScalarCatalogPublicationKind.AppendAndActivate) {
    return "Append and activate an immutable scalar inventory definition revision.";
  }
  return "Append an immutable command-scoped scalar inventory definition revision.";
}

/** Inputs for one durable scalar catalogue append or active-pointer publication. */
interface PublishScalarCatalogInput {
  /** Durable inventory authority storage. */
  readonly storage: InventoryDurableStorage;
  /** Current exact retained catalogue. */
  readonly catalog: InventoryCatalog;
  /** Stable item being selected. */
  readonly itemId: ItemId;
  /** Exact command unit that must resolve inside the selected retained revision. */
  readonly requestedUnit: string;
  /** Exact revision selected after publication. */
  readonly selectedItemRevisionId: string;
  /** Stable publication retry identity. */
  readonly operationId: string;
  /** Canonical publication occurrence time. */
  readonly occurredAtEpochMs: number;
  /** New immutable item revisions. */
  readonly itemRevisions?: readonly InventoryItemDefinitionRevision[];
  /** New immutable package revisions. */
  readonly packagingRevisions?: readonly InventoryPackagingDefinitionRevision[];
  /** Active item pointers changed by this publication. */
  readonly activeItemRevisionIds?: Readonly<Record<string, string>>;
  /** Human/operator reason retained on the catalogue event. */
  readonly reason: string;
}

/** Publish one exact retained catalogue and return its selected scalar revision. */
async function publishScalarCatalog({
  storage,
  catalog,
  itemId,
  requestedUnit,
  selectedItemRevisionId,
  operationId,
  occurredAtEpochMs,
  itemRevisions = [],
  packagingRevisions = [],
  activeItemRevisionIds = {},
  reason,
}: PublishScalarCatalogInput): Promise<EnsureInventoryScalarCatalogRevisionResult> {
  const extended = extendInventoryCatalog({
    catalog,
    itemRevisions,
    packagingRevisions,
    activeItemRevisionIds,
  });
  const inventory = createInventoryOnce({ catalog: extended, storage });
  const publication = await inventory.catalog.publish({
    operationId: requireCatalogIdentity(operationId, "operationId"),
    occurredAtEpochMs,
    reason,
  });
  const publishedWorld = await storage.readWorld();
  const publishedCatalog = inventoryCatalogFromSnapshot(publishedWorld.catalog);
  assertScalarRevisionBelongsToItem(
    publishedCatalog,
    itemId,
    selectedItemRevisionId
  );
  assertScalarUnitResolves(
    publishedCatalog,
    itemId,
    selectedItemRevisionId,
    requestedUnit
  );
  return {
    world: publishedWorld,
    catalog: publishedCatalog,
    itemRevisionId: selectedItemRevisionId,
    published: !publication.replayed,
    replayed: publication.replayed,
  };
}

/** Return one unchanged published catalogue selection. */
function unchangedScalarCatalog(
  world: InventoryWorldState,
  catalog: InventoryCatalog,
  itemRevisionId: string
): EnsureInventoryScalarCatalogRevisionResult {
  return {
    world,
    catalog,
    itemRevisionId,
    published: false,
    replayed: false,
  };
}

/** Find retained scalar revisions with the same physical primary/package declaration. */
function matchingScalarPhysicalRevisions(
  catalog: InventoryCatalog,
  declaration: InventoryScalarCatalogDeclaration
): readonly InventoryItemDefinitionRevision[] {
  const matching: InventoryItemDefinitionRevision[] = [];
  for (const revision of catalog.itemRevisions) {
    if (
      revision.itemId !== declaration.itemId ||
      revision.primaryAxis.unit !== declaration.primaryUnit ||
      revision.independentAxes.length !== 0
    ) {
      continue;
    }
    const packageLevels = scalarPackageLevelsForRevision(
      catalog,
      declaration.itemId,
      revision.revisionId
    );
    if (scalarPackageLevelsEqual(packageLevels, declaration.packageLevels)) {
      matching.push(revision);
    }
  }
  matching.sort(
    /** Select deterministically when no active physical match exists. */
    (left, right) => compareInventoryIdentityText(left.revisionId, right.revisionId)
  );
  return matching;
}

/** Prefer the active physical match; otherwise require one unambiguous retained meaning. */
function selectScalarPhysicalRevision(
  matching: readonly InventoryItemDefinitionRevision[],
  activeRevisionId: string | undefined,
  itemId: ItemId
): InventoryItemDefinitionRevision | undefined {
  if (activeRevisionId !== undefined) {
    const active = matching.find(
      /** Find the matching revision already selected by the active pointer. */
      (revision) => revision.revisionId === activeRevisionId
    );
    if (active !== undefined) return active;
  }
  if (matching.length <= 1) return matching[0];
  throw new Error(
    `Inventory unit/package declaration for '${itemId}' matches ${matching.length} retained revisions; supply exact revision identity.`
  );
}

/** Normalize one explicit package list or preserve the active list when omitted. */
function normalizeScalarPackageLevels(
  supplied: readonly InventoryScalarPackageLevel[] | undefined,
  primaryUnit: string,
  active: readonly InventoryScalarPackageLevel[]
): readonly InventoryScalarPackageLevel[] {
  if (supplied === undefined) return active;
  const quantityByUnit = new Map<string, string>();
  for (const level of supplied) {
    const unit = normalizeCatalogUnit(level.unit);
    const primaryQuantity = canonicalPositiveDecimal(
      level.primaryQuantity,
      primaryUnit,
      `package '${unit}' primary quantity`
    );
    if (unit === primaryUnit) {
      if (primaryQuantity !== "1") {
        throw new Error(
          `Inventory package '${unit}' aliases primary unit '${primaryUnit}' with quantity ${primaryQuantity}; the primary alias must be 1.`
        );
      }
      continue;
    }
    const existing = quantityByUnit.get(unit);
    if (existing !== undefined && existing !== primaryQuantity) {
      throw new Error(
        `Inventory package unit '${unit}' has conflicting primary quantities ${existing} and ${primaryQuantity}.`
      );
    }
    quantityByUnit.set(unit, primaryQuantity);
  }
  const normalized = [...quantityByUnit].map(
    /** Convert one normalized map entry back to a package declaration. */
    ([unit, primaryQuantity]) => ({ unit, primaryQuantity })
  );
  normalized.sort(compareScalarPackageLevel);
  return normalized;
}

/** Read simple scalar package declarations belonging to one exact item revision. */
function scalarPackageLevelsForRevision(
  catalog: InventoryCatalog,
  itemId: ItemId,
  itemRevisionId: string
): readonly InventoryScalarPackageLevel[] {
  const item = assertScalarRevisionBelongsToItem(
    catalog,
    itemId,
    itemRevisionId
  );
  if (item.independentAxes.length !== 0) {
    throw new Error(
      `Inventory item revision '${itemRevisionId}' is not a scalar definition.`
    );
  }
  const levels: InventoryScalarPackageLevel[] = [];
  for (const packaging of catalog.packagingRevisions) {
    if (
      packaging.itemId !== itemId ||
      packaging.itemRevisionId !== itemRevisionId
    ) {
      continue;
    }
    const level = scalarPackageLevelFromDefinition(packaging, item);
    if (level.unit === item.primaryAxis.unit) {
      if (level.primaryQuantity !== "1") {
        throw new Error(
          `Inventory package '${level.unit}' aliases primary unit '${item.primaryAxis.unit}' with quantity ${level.primaryQuantity}; the primary alias must be 1.`
        );
      }
      continue;
    }
    levels.push(level);
  }
  levels.sort(compareScalarPackageLevel);
  return levels;
}

/** Convert one exact simple scalar package definition to its physical declaration. */
function scalarPackageLevelFromDefinition(
  packaging: InventoryPackagingDefinitionRevision,
  item: InventoryItemDefinitionRevision
): InventoryScalarPackageLevel {
  if (
    packaging.fixedContents.primary.axisId !== item.primaryAxis.axisId ||
    packaging.fixedContents.primary.quantity.unit !== item.primaryAxis.unit ||
    packaging.fixedContents.independent.length !== 0
  ) {
    throw new Error(
      `Inventory package revision '${packaging.revisionId}' is not a simple scalar package.`
    );
  }
  return {
    unit: packaging.packageUnit,
    primaryQuantity: canonicalPositiveDecimal(
      quantityToDecimalString(packaging.fixedContents.primary.quantity),
      item.primaryAxis.unit,
      `package revision '${packaging.revisionId}' primary quantity`
    ),
  };
}

/** Require a command unit to name the primary axis or one immutable package. */
function assertScalarRequestedUnitDeclared(
  requestedUnit: string,
  primaryUnit: string,
  packageLevels: readonly InventoryScalarPackageLevel[]
): void {
  if (
    requestedUnit !== primaryUnit &&
    !packageLevels.some(
      /** Return whether this package declaration exposes the requested unit. */
      (level) => level.unit === requestedUnit
    )
  ) {
    throw new Error(
      `Inventory command unit '${requestedUnit}' is neither primary unit '${primaryUnit}' nor a declared package revision.`
    );
  }
}

/** Prove a command unit resolves inside one exact retained scalar revision. */
function assertScalarUnitResolves(
  catalog: InventoryCatalog,
  itemId: ItemId,
  itemRevisionId: string,
  requestedUnit: string
): void {
  const item = assertScalarRevisionBelongsToItem(
    catalog,
    itemId,
    itemRevisionId
  );
  if (item.primaryAxis.unit === requestedUnit) return;
  let matchingPackages = 0;
  for (const packaging of catalog.packagingRevisions) {
    if (
      packaging.itemId === itemId &&
      packaging.itemRevisionId === itemRevisionId &&
      packaging.packageUnit === requestedUnit
    ) {
      matchingPackages += 1;
    }
  }
  if (matchingPackages !== 1) {
    throw new Error(
      `Inventory command unit '${requestedUnit}' resolves to ${matchingPackages} package revisions for exact item revision '${itemRevisionId}'.`
    );
  }
}

/** Require a retained revision to belong to the requested stable item. */
function assertScalarRevisionBelongsToItem(
  catalog: InventoryCatalog,
  itemId: ItemId,
  itemRevisionId: string
): InventoryItemDefinitionRevision {
  const item = catalog.itemRevision(itemRevisionId);
  if (item.itemId !== itemId) {
    throw new Error(
      `Inventory revision '${itemRevisionId}' belongs to '${item.itemId}', not '${itemId}'.`
    );
  }
  return item;
}

/** Validate one application-created candidate against the normalized declaration. */
function assertScalarDefinitionsMatchDeclaration(
  definitions: InventoryScalarCatalogDefinitions,
  declaration: InventoryScalarCatalogDeclaration
): void {
  if (
    definitions.item.itemId !== declaration.itemId ||
    definitions.item.primaryAxis.unit !== declaration.primaryUnit ||
    definitions.item.independentAxes.length !== 0
  ) {
    throw new Error(
      "Inventory scalar revision factory returned an item with different physical declaration."
    );
  }
  const levels = definitions.packaging.map(
    /** Convert each candidate package to its exact scalar declaration. */
    (packaging) => {
      if (
        packaging.itemId !== definitions.item.itemId ||
        packaging.itemRevisionId !== definitions.item.revisionId
      ) {
        throw new Error(
          "Inventory scalar revision factory returned a package for another item revision."
        );
      }
      return scalarPackageLevelFromDefinition(packaging, definitions.item);
    }
  );
  levels.sort(compareScalarPackageLevel);
  if (!scalarPackageLevelsEqual(levels, declaration.packageLevels)) {
    throw new Error(
      "Inventory scalar revision factory returned a different package declaration."
    );
  }
}

/** Compare complete normalized scalar package lists exactly. */
function scalarPackageLevelsEqual(
  left: readonly InventoryScalarPackageLevel[],
  right: readonly InventoryScalarPackageLevel[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      /** Compare one same-index canonical package declaration. */
      (level, index) =>
        level.unit === right[index]?.unit &&
        level.primaryQuantity === right[index]?.primaryQuantity
    )
  );
}

/** Sort package identity independently of application UI order. */
function compareScalarPackageLevel(
  left: InventoryScalarPackageLevel,
  right: InventoryScalarPackageLevel
): number {
  const unitOrder = compareInventoryIdentityText(left.unit, right.unit);
  return unitOrder === 0
    ? compareInventoryIdentityText(left.primaryQuantity, right.primaryQuantity)
    : unitOrder;
}

/** Normalize one non-empty inventory unit without applying application vocabulary aliases. */
function normalizeCatalogUnit(value: string): string {
  return unitCode(value);
}

/** Require one stable non-empty catalogue/application identity. */
function requireCatalogIdentity(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Inventory ${label} must not be empty.`);
  }
  return normalized;
}

/** Parse one positive exact quantity and render its minimal plain-decimal identity. */
function canonicalPositiveDecimal(
  value: string,
  unit: string,
  label: string
): string {
  const quantity = positiveQuantity(parseQuantity(value, unit), label);
  const rendered = quantityToDecimalString(quantity);
  if (!rendered.includes(".")) return rendered;
  return rendered.replace(/0+$/, "").replace(/\.$/, "");
}
