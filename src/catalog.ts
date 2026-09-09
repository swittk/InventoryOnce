import { compareInventoryIdentityText } from "./ordering.js";
import {
  inventoryIntentFingerprint,
  inventoryMetadataFingerprint,
  type InventoryIntentFingerprintValue,
} from "./canonical.js";
import { inventorySha256 } from "./digest.js";
import {
  inventoryMeasurementsEqual,
  inventoryMeasurementsFingerprint,
  multiplyInventoryMeasurementsByWholeNumber,
  positiveInventoryMeasurements,
  scalarInventoryMeasurements,
  type InventoryMeasurementAxisId,
  type InventoryMeasurementVector,
} from "./measurements.js";
import {
  assertInventoryIdentity,
  type InventoryDimensionId,
  type InventoryMetadata,
  type InventoryMetadataValue,
  type ItemId,
  type ItemRevisionId,
} from "./model.js";
import {
  parseQuantity,
  positiveQuantity,
  quantity,
  unitCode,
  type Quantity,
  type UnitCode,
} from "./quantity.js";

/** Whether one measurement axis is the stock authority or measured independently. */
export enum InventoryMeasurementAxisRole {
  /** Required axis used for on-hand, reservations, and zero/non-zero stock identity. */
  Primary = "primary",
  /** Exact measurement that may vary independently from primary quantity. */
  Independent = "independent",
}

/** Whether one independently measured axis must be supplied on every stock event. */
export enum InventoryMeasurementRequirement {
  /** Events may omit this independently measured axis when it was not observed. */
  Optional = "optional",
  /** Every event touching positive stock must supply this independently measured axis. */
  Required = "required",
}

/** One item-definition measurement axis. */
export interface InventoryMeasurementAxisDefinition {
  /** Stable axis identity such as `pieces`, `volume`, or `weight`. */
  readonly axisId: InventoryMeasurementAxisId;
  /** Whether this is the one primary or an independently measured axis. */
  readonly role: InventoryMeasurementAxisRole;
  /** Physical unit for every durable value on this axis. */
  readonly unit: UnitCode;
  /** Whether an independently measured axis must appear on each positive stock vector. */
  readonly requirement: InventoryMeasurementRequirement;
}

/** Whether a traceability dimension is forbidden, optional, or required for an item. */
export enum InventoryTrackingRequirement {
  /** Dimension must not appear on stock for this item. */
  Forbidden = "forbidden",
  /** Dimension may appear when known/needed. */
  Optional = "optional",
  /** Every non-zero stock position must name this dimension. */
  Required = "required",
}

/** Lot/serial tracking rules frozen in one item-definition revision. */
export interface InventoryTrackingPolicy {
  /** Lot/batch identity rule. */
  readonly lot: InventoryTrackingRequirement;
  /** Individual serial identity rule. */
  readonly serial: InventoryTrackingRequirement;
}

/** One explicitly allowed extra stock dimension for this item revision. */
export interface InventoryDimensionDefinition {
  /** Stable dimension id that may appear on stock positions/selectors. */
  readonly dimensionId: InventoryDimensionId;
  /** Plain purpose text for generated docs and migration diagnostics. */
  readonly description: string;
}

/** Immutable definition revision for one inventory item. */
export interface InventoryItemDefinitionRevision {
  /** Stable item identity shared across definition revisions. */
  readonly itemId: ItemId;
  /** Immutable definition identity frozen into every event. */
  readonly revisionId: ItemRevisionId;
  /** Required primary measurement axis. */
  readonly primaryAxis: InventoryMeasurementAxisDefinition;
  /** Optional independently measured axes. */
  readonly independentAxes: readonly InventoryMeasurementAxisDefinition[];
  /** Axis used by broad reservations; defaults to primary. */
  readonly reservationAxisId: InventoryMeasurementAxisId;
  /** Frozen lot/serial rules. */
  readonly tracking: InventoryTrackingPolicy;
  /** Extra position dimensions explicitly allowed by this revision. */
  readonly qualifiedDimensions: readonly InventoryDimensionDefinition[];
  /** External identifiers that help resolve this item revision. */
  readonly identifiers?: Readonly<Record<string, string>>;
  /** Extra application metadata that does not change inventory math. */
  readonly metadata?: InventoryMetadata;
}

/** One frozen inner-package relationship used for hierarchy/traceability presentation. */
export interface InventoryInnerPackageDefinition {
  /** Exact child package revision. */
  readonly packagingRevisionId: string;
  /** Positive whole number of child packages inside one parent package. */
  readonly count: number;
}

/** Immutable product-specific package revision. */
export interface InventoryPackagingDefinitionRevision {
  /** Stable exact package identity such as `drug-a-box-20-v1`. */
  readonly revisionId: string;
  /** Item whose stock this package contains. */
  readonly itemId: ItemId;
  /** Item definition used to validate/freeze the package contents axes. */
  readonly itemRevisionId: ItemRevisionId;
  /** Human transaction unit such as box, blister, bottle, case, or pallet. */
  readonly packageUnit: UnitCode;
  /** Exact fixed contents of one whole package in item measurement axes. */
  readonly fixedContents: InventoryMeasurementVector;
  /** Optional exact child-package composition; fixed contents remain the arithmetic authority. */
  readonly innerPackage?: InventoryInnerPackageDefinition;
  /** GTIN/barcode/vendor identifiers that select this exact revision. */
  readonly identifiers?: Readonly<Record<string, string>>;
  /** Extra application metadata that does not change package math. */
  readonly metadata?: InventoryMetadata;
}

/** Stable identity shared by every immutable revision of one mutual-fungibility pool. */
export type InventoryFungibilityPoolId = string;

/** Immutable identity for one exact mutual-fungibility definition revision. */
export type InventoryFungibilityRevisionId = string;

/** One exact item-axis contribution to a revisioned mutual-fungibility pool. */
export interface InventoryFungibilityMemberDefinition {
  /** Exact retained item definition revision whose stock may satisfy this pool. */
  readonly itemRevisionId: ItemRevisionId;
  /** Exact item measurement axis converted into the common pool basis. */
  readonly measurementAxisId: InventoryMeasurementAxisId;
  /** Positive reference amount in the member axis/unit. */
  readonly memberQuantity: Quantity;
  /** Positive exactly equivalent amount in the pool basis unit. */
  readonly poolQuantity: Quantity;
}

/** Immutable mutual-interchangeability pool revision; it never merges member item identity. */
export interface InventoryFungibilityPoolDefinitionRevision {
  /** Stable pool identity shared across revisions. */
  readonly poolId: InventoryFungibilityPoolId;
  /** Exact immutable pool-definition revision. */
  readonly revisionId: InventoryFungibilityRevisionId;
  /** Stable semantic axis identity such as `dose-equivalent`. */
  readonly basisAxisId: InventoryMeasurementAxisId;
  /** Exact unit used for all common-basis quantities in this revision. */
  readonly basisUnit: UnitCode;
  /** At least two exact member item revisions, sorted by item revision identity. */
  readonly members: readonly InventoryFungibilityMemberDefinition[];
  /** External identifiers that help resolve this exact pool revision. */
  readonly identifiers?: Readonly<Record<string, string>>;
  /** Extra application metadata that does not change conversion arithmetic. */
  readonly metadata?: InventoryMetadata;
}

/** Inputs for validating one pool revision against its retained item definitions. */
export interface DefineInventoryFungibilityPoolInput {
  /** Candidate immutable pool revision. */
  readonly definition: InventoryFungibilityPoolDefinitionRevision;
  /** Retained item revisions available to resolve every member. */
  readonly itemRevisions: readonly InventoryItemDefinitionRevision[];
}

/** One ergonomic scalar member mapping its primary axis into the pool basis. */
export interface DefineScalarInventoryFungibilityMemberInput {
  /** Exact retained item revision participating in the pool. */
  readonly item: InventoryItemDefinitionRevision;
  /** Positive member primary-axis reference text; defaults to `1`. */
  readonly memberQuantity?: string;
  /** Positive pool-basis reference text; defaults to `1`. */
  readonly poolQuantity?: string;
}

/** Inputs for the common primary-axis mutual-fungibility helper. */
export interface DefineScalarInventoryFungibilityPoolInput {
  /** Stable pool identity shared across revisions. */
  readonly poolId: InventoryFungibilityPoolId;
  /** Exact immutable pool revision identity. */
  readonly revisionId: InventoryFungibilityRevisionId;
  /** Common-basis unit such as `dose-equivalent`. */
  readonly basisUnit: string;
  /** Optional common-basis axis identity; defaults to `fungible`. */
  readonly basisAxisId?: InventoryMeasurementAxisId;
  /** At least two exact scalar item revisions. */
  readonly members: readonly DefineScalarInventoryFungibilityMemberInput[];
  /** External identifiers that help resolve this pool revision. */
  readonly identifiers?: Readonly<Record<string, string>>;
  /** Extra application metadata. */
  readonly metadata?: InventoryMetadata;
}

/** Stable identity shared by immutable heterogeneous package-composition revisions. */
export type InventoryCompositionId = string;
/** Exact immutable heterogeneous package-composition revision identity. */
export type InventoryCompositionRevisionId = string;

/** How one frozen composition output expresses its exact amount. */
export enum InventoryCompositionOutputAmountKind {
  /** Exact measured vector in the output item revision's axes. */
  Measured = "measured",
  /** Whole count of one exact output packaging revision. */
  Package = "package",
}

/** Exact measured output produced by opening one source package. */
export interface InventoryCompositionMeasuredOutputAmount {
  /** Discriminator for direct measured output. */
  readonly kind: InventoryCompositionOutputAmountKind.Measured;
  /** Exact positive primary plus independent measurements. */
  readonly measurements: InventoryMeasurementVector;
}

/** Exact whole packaged output produced by opening one source package. */
export interface InventoryCompositionPackageOutputAmount {
  /** Discriminator for whole packaged output. */
  readonly kind: InventoryCompositionOutputAmountKind.Package;
  /** Exact immutable output package revision. */
  readonly packagingRevisionId: string;
  /** Positive whole output package count per one source package. */
  readonly packageCount: number;
}

/** One exact output amount in a frozen heterogeneous composition. */
export type InventoryCompositionOutputAmount =
  | InventoryCompositionMeasuredOutputAmount
  | InventoryCompositionPackageOutputAmount;

/** How one composition output obtains its lot/batch identity. */
export enum InventoryCompositionOutputLotPolicy {
  /** Output has no lot identity; only valid when the item does not require one. */
  None = "none",
  /** Output requires and reuses the source package lot identity and current lot metadata. */
  InheritSource = "inherit-source",
  /** Output reuses source lot identity when present, otherwise remains unqualified. */
  InheritSourceWhenPresent = "inherit-source-when-present",
  /** Opening command must supply an explicit output lot identity. */
  Explicit = "explicit",
}

/** One named component line produced by opening one source package. */
export interface InventoryCompositionOutputDefinition {
  /** Stable output-line identity inside this composition revision. */
  readonly outputId: string;
  /** Exact retained item revision produced by this line. */
  readonly itemRevisionId: ItemRevisionId;
  /** Exact amount produced per one source package. */
  readonly amount: InventoryCompositionOutputAmount;
  /** Explicit lot identity policy; opening never guesses across item revisions. */
  readonly lotPolicy: InventoryCompositionOutputLotPolicy;
  /** Extra application facts that do not alter component arithmetic. */
  readonly metadata?: InventoryMetadata;
}

/** Immutable heterogeneous package decomposition revision. */
export interface InventoryCompositionDefinitionRevision {
  /** Stable composition identity shared across definition revisions. */
  readonly compositionId: InventoryCompositionId;
  /** Exact immutable composition revision. */
  readonly revisionId: InventoryCompositionRevisionId;
  /** Exact source package revision consumed once by this composition. */
  readonly sourcePackagingRevisionId: string;
  /** Non-empty exact output vector produced by one source package. */
  readonly outputs: readonly InventoryCompositionOutputDefinition[];
  /** External identifiers that help resolve this exact composition revision. */
  readonly identifiers?: Readonly<Record<string, string>>;
  /** Extra application metadata that does not alter composition arithmetic. */
  readonly metadata?: InventoryMetadata;
}

/** Inputs for validating one heterogeneous composition against retained items/packages. */
export interface DefineInventoryCompositionInput {
  /** Candidate immutable composition revision. */
  readonly definition: InventoryCompositionDefinitionRevision;
  /** Retained item revisions available to validate every output. */
  readonly itemRevisions: readonly InventoryItemDefinitionRevision[];
  /** Retained package revisions available to validate source/packaged outputs. */
  readonly packagingRevisions: readonly InventoryPackagingDefinitionRevision[];
}

/** Stable identity shared by immutable physical transformation-definition revisions. */
export type InventoryTransformationId = string;
/** Exact immutable physical transformation-definition revision identity. */
export type InventoryTransformationRevisionId = string;

/** One exact measured input/output line in a reusable physical transformation definition. */
export interface InventoryTransformationDefinitionLine {
  /** Stable line identity inside this definition revision. */
  readonly lineId: string;
  /** Exact item/form revision consumed or produced by this line. */
  readonly itemRevisionId: ItemRevisionId;
  /** Exact positive measured quantity required/produced per one transformation execution. */
  readonly amount: InventoryMeasurementVector;
  /** Extra application facts that do not alter transformation arithmetic. */
  readonly metadata?: InventoryMetadata;
}

/** Immutable reusable physical transformation definition; execution remains `stock.transform()`. */
export interface InventoryTransformationDefinitionRevision {
  /** Stable transformation identity shared across definition revisions. */
  readonly transformationId: InventoryTransformationId;
  /** Exact immutable definition revision identity. */
  readonly revisionId: InventoryTransformationRevisionId;
  /** Non-empty exact measured inputs. */
  readonly inputs: readonly InventoryTransformationDefinitionLine[];
  /** Non-empty exact measured outputs. */
  readonly outputs: readonly InventoryTransformationDefinitionLine[];
  /** External/vendor identities useful for application mapping. */
  readonly identifiers?: Readonly<Record<string, string>>;
  /** Extra application metadata that does not alter physical arithmetic. */
  readonly metadata?: InventoryMetadata;
}

/** Inputs for validating one transformation definition against retained item/form revisions. */
export interface DefineInventoryTransformationInput {
  /** Candidate immutable transformation definition revision. */
  readonly definition: InventoryTransformationDefinitionRevision;
  /** Retained item/form revisions available to resolve every input/output line. */
  readonly itemRevisions: readonly InventoryItemDefinitionRevision[];
}

/** Stable read-only inventory collection identity shared across revisions. */
export type InventoryCollectionId = string;
/** Exact immutable read-only collection revision identity. */
export type InventoryCollectionRevisionId = string;

/** What one collection member reference points at. */
export enum InventoryCollectionMemberKind {
  /** Exact retained item definition revision. */
  ItemRevision = "item-revision",
  /** Exact retained nested collection revision. */
  CollectionRevision = "collection-revision",
}

/** One exact member reference in a read-only collection revision. */
export interface InventoryCollectionMemberDefinition {
  /** Item-revision or nested-collection reference kind. */
  readonly kind: InventoryCollectionMemberKind;
  /** Exact item or collection revision identity. */
  readonly revisionId: string;
}

/** One item-axis conversion contributing to a read-only collection roll-up. */
export interface InventoryCollectionRollupMemberDefinition {
  /** Exact flattened member item revision. */
  readonly itemRevisionId: ItemRevisionId;
  /** Exact member measurement axis converted into the roll-up basis. */
  readonly measurementAxisId: InventoryMeasurementAxisId;
  /** Positive reference amount in the member axis/unit. */
  readonly memberQuantity: Quantity;
  /** Positive exactly corresponding amount in the roll-up basis unit. */
  readonly rollupQuantity: Quantity;
}

/** Optional explicit read-only scalar roll-up; it grants no substitution rights. */
export interface InventoryCollectionRollupDefinition {
  /** Stable roll-up identity inside this collection revision. */
  readonly rollupId: string;
  /** Semantic basis axis such as `pack-count`. */
  readonly basisAxisId: InventoryMeasurementAxisId;
  /** Exact common basis unit. */
  readonly basisUnit: UnitCode;
  /** Exact member conversions participating in this read-only total. */
  readonly members: readonly InventoryCollectionRollupMemberDefinition[];
}

/** Immutable read-only taxonomy/grouping revision over exact retained identities. */
export interface InventoryCollectionDefinitionRevision {
  /** Stable collection identity shared across revisions. */
  readonly collectionId: InventoryCollectionId;
  /** Exact immutable collection revision identity. */
  readonly revisionId: InventoryCollectionRevisionId;
  /** Non-empty exact item/nested-collection members. */
  readonly members: readonly InventoryCollectionMemberDefinition[];
  /** Optional explicitly compatible scalar views; membership alone has no scalar meaning. */
  readonly rollups?: readonly InventoryCollectionRollupDefinition[];
  /** External identifiers that help resolve this exact collection revision. */
  readonly identifiers?: Readonly<Record<string, string>>;
  /** Extra application metadata that does not grant fungibility. */
  readonly metadata?: InventoryMetadata;
}

/** Inputs for validating one collection revision against retained item/collection revisions. */
export interface DefineInventoryCollectionInput {
  /** Candidate immutable collection revision. */
  readonly definition: InventoryCollectionDefinitionRevision;
  /** Retained item revisions available to resolve exact item members and roll-ups. */
  readonly itemRevisions: readonly InventoryItemDefinitionRevision[];
  /** Retained collection revisions available to resolve nested members. */
  readonly collectionRevisions: readonly InventoryCollectionDefinitionRevision[];
}

/** Inputs for constructing one complete immutable inventory catalogue. */
export interface InventoryCatalogInput {
  /** Every retained item definition revision, including historical revisions. */
  readonly itemRevisions: readonly InventoryItemDefinitionRevision[];
  /** Current active item revision id by item id. */
  readonly activeItemRevisionIds: Readonly<Record<string, ItemRevisionId>>;
  /** Every retained exact package revision. */
  readonly packagingRevisions?: readonly InventoryPackagingDefinitionRevision[];
  /** Every retained heterogeneous package-composition revision. */
  readonly compositionRevisions?: readonly InventoryCompositionDefinitionRevision[];
  /** Current active composition revision id by stable composition id. */
  readonly activeCompositionRevisionIds?: Readonly<
    Record<string, InventoryCompositionRevisionId>
  >;
  /** Every retained reusable physical transformation definition revision. */
  readonly transformationRevisions?: readonly InventoryTransformationDefinitionRevision[];
  /** Current active transformation revision id by stable transformation id. */
  readonly activeTransformationRevisionIds?: Readonly<
    Record<string, InventoryTransformationRevisionId>
  >;
  /** Every retained read-only collection/taxonomy revision. */
  readonly collectionRevisions?: readonly InventoryCollectionDefinitionRevision[];
  /** Current active collection revision id by stable collection id. */
  readonly activeCollectionRevisionIds?: Readonly<
    Record<string, InventoryCollectionRevisionId>
  >;
  /** Every retained exact mutual-fungibility pool revision. */
  readonly fungibilityRevisions?: readonly InventoryFungibilityPoolDefinitionRevision[];
  /** Current active fungibility revision id by stable pool id. */
  readonly activeFungibilityRevisionIds?: Readonly<
    Record<string, InventoryFungibilityRevisionId>
  >;
}

/** Inputs for retaining existing definitions while publishing new item/package revisions. */
export interface ExtendInventoryCatalogInput {
  /** Existing validated catalogue whose immutable revisions must remain unchanged. */
  readonly catalog: InventoryCatalog;
  /** New immutable item revisions to append. */
  readonly itemRevisions?: readonly InventoryItemDefinitionRevision[];
  /** Active revision changes by stable item identity. */
  readonly activeItemRevisionIds?: Readonly<Record<string, ItemRevisionId>>;
  /** New immutable package revisions to append. */
  readonly packagingRevisions?: readonly InventoryPackagingDefinitionRevision[];
  /** New immutable heterogeneous composition revisions to append. */
  readonly compositionRevisions?: readonly InventoryCompositionDefinitionRevision[];
  /** Active composition revision changes by stable composition identity. */
  readonly activeCompositionRevisionIds?: Readonly<
    Record<string, InventoryCompositionRevisionId>
  >;
  /** New immutable physical transformation definition revisions to append. */
  readonly transformationRevisions?: readonly InventoryTransformationDefinitionRevision[];
  /** Active transformation revision changes by stable transformation identity. */
  readonly activeTransformationRevisionIds?: Readonly<
    Record<string, InventoryTransformationRevisionId>
  >;
  /** New immutable read-only collection revisions to append. */
  readonly collectionRevisions?: readonly InventoryCollectionDefinitionRevision[];
  /** Active collection revision changes by stable collection identity. */
  readonly activeCollectionRevisionIds?: Readonly<
    Record<string, InventoryCollectionRevisionId>
  >;
  /** New immutable mutual-fungibility pool revisions to append. */
  readonly fungibilityRevisions?: readonly InventoryFungibilityPoolDefinitionRevision[];
  /** Active pool revision changes by stable pool identity. */
  readonly activeFungibilityRevisionIds?: Readonly<
    Record<string, InventoryFungibilityRevisionId>
  >;
}

/** Inputs for the common one-axis item helper. */
export interface DefineScalarInventoryItemInput {
  /** Stable item identity. */
  readonly itemId: ItemId;
  /** Immutable definition revision identity. */
  readonly revisionId: ItemRevisionId;
  /** Primary stock/reservation unit. */
  readonly unit: string;
  /** Optional primary axis id; defaults to `primary`. */
  readonly axisId?: InventoryMeasurementAxisId;
  /** Optional lot/serial policy; both default to optional. */
  readonly tracking?: Partial<InventoryTrackingPolicy>;
  /** Optional explicitly allowed extra stock dimensions. */
  readonly qualifiedDimensions?: readonly InventoryDimensionDefinition[];
  /** External identifiers that help resolve this item. */
  readonly identifiers?: Readonly<Record<string, string>>;
  /** Extra application metadata. */
  readonly metadata?: InventoryMetadata;
}

/** Inputs for the common fixed-content scalar package helper. */
export interface DefineScalarInventoryPackagingInput {
  /** Stable exact package revision identity. */
  readonly revisionId: string;
  /** Frozen item revision whose primary axis this package contains. */
  readonly item: InventoryItemDefinitionRevision;
  /** Human transaction unit such as `box`, `blister`, or `case`. */
  readonly packageUnit: string;
  /** Exact positive plain-decimal quantity of the item's primary axis in one package. */
  readonly contains: string;
  /** Optional exact child-package composition. */
  readonly innerPackage?: InventoryInnerPackageDefinition;
  /** GTIN/barcode/vendor identifiers that select this exact package revision. */
  readonly identifiers?: Readonly<Record<string, string>>;
  /** Extra application metadata. */
  readonly metadata?: InventoryMetadata;
}

/** Build the common single-axis item revision without hiding its frozen revision identity. */
export function defineScalarInventoryItem(
  input: DefineScalarInventoryItemInput
): InventoryItemDefinitionRevision {
  const axisId = input.axisId ?? "primary";
  return defineInventoryItem({
    itemId: input.itemId,
    revisionId: input.revisionId,
    primaryAxis: {
      axisId,
      role: InventoryMeasurementAxisRole.Primary,
      unit: unitCode(input.unit),
      requirement: InventoryMeasurementRequirement.Required,
    },
    independentAxes: [],
    reservationAxisId: axisId,
    tracking: {
      lot: input.tracking?.lot ?? InventoryTrackingRequirement.Optional,
      serial: input.tracking?.serial ?? InventoryTrackingRequirement.Optional,
    },
    qualifiedDimensions: input.qualifiedDimensions ?? [],
    ...(input.identifiers === undefined
      ? {}
      : { identifiers: input.identifiers }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  });
}

/** Validate and normalize one measured item definition revision. */
export function defineInventoryItem(
  input: InventoryItemDefinitionRevision
): InventoryItemDefinitionRevision {
  assertInventoryIdentity(input.itemId, "itemId");
  assertInventoryIdentity(input.revisionId, "item revisionId");
  assertMeasurementAxis(
    input.primaryAxis,
    InventoryMeasurementAxisRole.Primary
  );
  if (
    input.primaryAxis.requirement !== InventoryMeasurementRequirement.Required
  ) {
    throw new Error("Primary item measurement axis must be required.");
  }
  const independentAxes = [...input.independentAxes];
  independentAxes.sort(compareMeasurementAxisDefinition);
  const seenAxes = new Set<string>([input.primaryAxis.axisId]);
  for (const axis of independentAxes) {
    assertMeasurementAxis(axis, InventoryMeasurementAxisRole.Independent);
    if (seenAxes.has(axis.axisId)) {
      throw new Error(`Duplicate item measurement axis '${axis.axisId}'.`);
    }
    seenAxes.add(axis.axisId);
  }
  if (!seenAxes.has(input.reservationAxisId)) {
    throw new Error("reservationAxisId must name one item measurement axis.");
  }
  const qualifiedDimensions = [...input.qualifiedDimensions];
  qualifiedDimensions.sort(compareDimensionDefinition);
  let previousDimensionId: string | undefined;
  for (const dimension of qualifiedDimensions) {
    assertInventoryIdentity(dimension.dimensionId, "qualified dimension id");
    if (dimension.description.trim().length === 0) {
      throw new Error(
        `Qualified dimension '${dimension.dimensionId}' needs a description.`
      );
    }
    if (dimension.dimensionId === previousDimensionId) {
      throw new Error(
        `Duplicate qualified dimension '${dimension.dimensionId}'.`
      );
    }
    previousDimensionId = dimension.dimensionId;
  }
  return cloneAndFreezeInventoryItemRevision({
    ...input,
    independentAxes,
    qualifiedDimensions,
  });
}

/** Build one fixed-content scalar package revision from a frozen item definition. */
export function defineScalarInventoryPackaging(
  input: DefineScalarInventoryPackagingInput
): InventoryPackagingDefinitionRevision {
  const fixedContents = scalarInventoryMeasurements(
    input.item.primaryAxis.axisId,
    parseQuantity(input.contains, input.item.primaryAxis.unit)
  );
  return defineInventoryPackaging(
    {
      revisionId: input.revisionId,
      itemId: input.item.itemId,
      itemRevisionId: input.item.revisionId,
      packageUnit: unitCode(input.packageUnit),
      fixedContents,
      ...(input.innerPackage === undefined
        ? {}
        : { innerPackage: input.innerPackage }),
      ...(input.identifiers === undefined
        ? {}
        : { identifiers: input.identifiers }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    },
    input.item
  );
}

/** Validate one exact fixed-content package revision against its frozen item definition. */
export function defineInventoryPackaging(
  input: InventoryPackagingDefinitionRevision,
  item: InventoryItemDefinitionRevision
): InventoryPackagingDefinitionRevision {
  assertInventoryIdentity(input.revisionId, "packaging revisionId");
  if (
    input.itemId !== item.itemId ||
    input.itemRevisionId !== item.revisionId
  ) {
    throw new Error(
      "Packaging revision must name the exact supplied item definition revision."
    );
  }
  positiveInventoryMeasurements(input.fixedContents, "Package fixed contents");
  assertMeasurementsMatchItem(item, input.fixedContents, false);
  if (input.innerPackage !== undefined) {
    assertInventoryIdentity(
      input.innerPackage.packagingRevisionId,
      "inner packaging revisionId"
    );
    if (
      !Number.isSafeInteger(input.innerPackage.count) ||
      input.innerPackage.count <= 0
    ) {
      throw new Error("Inner package count must be a positive safe integer.");
    }
  }
  return cloneAndFreezeInventoryPackagingRevision(input);
}

/** Build one common primary-axis fungibility revision without hiding exact member revisions. */
export function defineScalarInventoryFungibilityPool(
  input: DefineScalarInventoryFungibilityPoolInput
): InventoryFungibilityPoolDefinitionRevision {
  const basisUnit = unitCode(input.basisUnit);
  const itemRevisions: InventoryItemDefinitionRevision[] = [];
  const members: InventoryFungibilityMemberDefinition[] = [];
  for (const member of input.members) {
    itemRevisions.push(member.item);
    members.push({
      itemRevisionId: member.item.revisionId,
      measurementAxisId: member.item.primaryAxis.axisId,
      memberQuantity: parseQuantity(
        member.memberQuantity ?? "1",
        member.item.primaryAxis.unit
      ),
      poolQuantity: parseQuantity(member.poolQuantity ?? "1", basisUnit),
    });
  }
  return defineInventoryFungibilityPool({
    definition: {
      poolId: input.poolId,
      revisionId: input.revisionId,
      basisAxisId: input.basisAxisId ?? "fungible",
      basisUnit,
      members,
      ...(input.identifiers === undefined
        ? {}
        : { identifiers: input.identifiers }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    },
    itemRevisions,
  });
}

/** Validate one immutable mutual-fungibility pool against exact retained item revisions. */
export function defineInventoryFungibilityPool({
  definition,
  itemRevisions,
}: DefineInventoryFungibilityPoolInput): InventoryFungibilityPoolDefinitionRevision {
  assertInventoryIdentity(definition.poolId, "fungibility poolId");
  assertInventoryIdentity(definition.revisionId, "fungibility revisionId");
  assertInventoryIdentity(definition.basisAxisId, "fungibility basisAxisId");
  const basisUnit = unitCode(definition.basisUnit);
  if (definition.members.length < 2) {
    throw new Error(
      "Mutual-fungibility pool revision needs at least two member item revisions."
    );
  }
  const itemByRevisionId = new Map<
    ItemRevisionId,
    InventoryItemDefinitionRevision
  >();
  for (const item of itemRevisions) {
    const normalized = defineInventoryItem(item);
    itemByRevisionId.set(normalized.revisionId, normalized);
  }
  const members: InventoryFungibilityMemberDefinition[] = [];
  const seenItemRevisionIds = new Set<ItemRevisionId>();
  for (const rawMember of definition.members) {
    if (seenItemRevisionIds.has(rawMember.itemRevisionId)) {
      throw new Error(
        `Fungibility pool revision repeats item revision '${rawMember.itemRevisionId}'.`
      );
    }
    seenItemRevisionIds.add(rawMember.itemRevisionId);
    const item = itemByRevisionId.get(rawMember.itemRevisionId);
    if (item === undefined) {
      throw new Error(
        `Fungibility pool revision references unknown item revision '${rawMember.itemRevisionId}'.`
      );
    }
    const axis = findItemMeasurementAxis(item, rawMember.measurementAxisId);
    const memberQuantity = cloneAndFreezeQuantity(
      positiveQuantity(
        rawMember.memberQuantity,
        "Fungibility member reference quantity"
      )
    );
    const poolQuantity = cloneAndFreezeQuantity(
      positiveQuantity(
        rawMember.poolQuantity,
        "Fungibility pool reference quantity"
      )
    );
    if (memberQuantity.unit !== axis.unit) {
      throw new Error(
        `Fungibility member '${rawMember.itemRevisionId}' reference quantity uses a different unit from axis '${axis.axisId}'.`
      );
    }
    if (poolQuantity.unit !== basisUnit) {
      throw new Error(
        `Fungibility member '${rawMember.itemRevisionId}' pool quantity must use basis unit '${basisUnit}'.`
      );
    }
    members.push(
      Object.freeze({
        itemRevisionId: rawMember.itemRevisionId,
        measurementAxisId: rawMember.measurementAxisId,
        memberQuantity,
        poolQuantity,
      })
    );
  }
  members.sort(compareFungibilityMember);
  return cloneAndFreezeInventoryFungibilityRevision({
    poolId: definition.poolId,
    revisionId: definition.revisionId,
    basisAxisId: definition.basisAxisId,
    basisUnit,
    members,
    ...(definition.identifiers === undefined
      ? {}
      : { identifiers: definition.identifiers }),
    ...(definition.metadata === undefined
      ? {}
      : { metadata: definition.metadata }),
  });
}

/** Validate one immutable heterogeneous package-composition revision. */
export function defineInventoryComposition({
  definition,
  itemRevisions,
  packagingRevisions,
}: DefineInventoryCompositionInput): InventoryCompositionDefinitionRevision {
  assertInventoryIdentity(definition.compositionId, "compositionId");
  assertInventoryIdentity(definition.revisionId, "composition revisionId");
  assertInventoryIdentity(
    definition.sourcePackagingRevisionId,
    "composition source packaging revisionId"
  );
  if (definition.outputs.length === 0) {
    throw new Error(
      "Inventory composition revision needs at least one output line."
    );
  }
  /** Exact item revisions used by this standalone composition check; duplicate ids must not overwrite. */
  const itemByRevisionId = new Map<
    ItemRevisionId,
    InventoryItemDefinitionRevision
  >();
  for (const rawItem of itemRevisions) {
    const item = defineInventoryItem(rawItem);
    // This helper is public; do not let a duplicate input silently replace the first definition.
    if (itemByRevisionId.has(item.revisionId)) {
      throw new Error(
        `Duplicate inventory item revision '${item.revisionId}'.`
      );
    }
    itemByRevisionId.set(item.revisionId, item);
  }
  /** Exact package revisions used by this standalone composition check; duplicate ids must not overwrite. */
  const packagingByRevisionId = new Map<
    string,
    InventoryPackagingDefinitionRevision
  >();
  for (const rawPackaging of packagingRevisions) {
    const item = itemByRevisionId.get(rawPackaging.itemRevisionId);
    if (item === undefined) {
      throw new Error(
        `Composition catalogue package '${rawPackaging.revisionId}' references unknown item revision.`
      );
    }
    const packaging = defineInventoryPackaging(rawPackaging, item);
    // The source lookup and packaged output lookup must see one immutable definition per id.
    if (packagingByRevisionId.has(packaging.revisionId)) {
      throw new Error(
        `Duplicate inventory packaging revision '${packaging.revisionId}'.`
      );
    }
    packagingByRevisionId.set(packaging.revisionId, packaging);
  }
  const sourcePackaging = packagingByRevisionId.get(
    definition.sourcePackagingRevisionId
  );
  if (sourcePackaging === undefined) {
    throw new Error(
      `Composition revision '${definition.revisionId}' references unknown source package '${definition.sourcePackagingRevisionId}'.`
    );
  }
  const outputs: InventoryCompositionOutputDefinition[] = [];
  const seenOutputIds = new Set<string>();
  for (const rawOutput of definition.outputs) {
    assertInventoryIdentity(rawOutput.outputId, "composition outputId");
    if (seenOutputIds.has(rawOutput.outputId)) {
      throw new Error(
        `Composition revision repeats outputId '${rawOutput.outputId}'.`
      );
    }
    seenOutputIds.add(rawOutput.outputId);
    const item = itemByRevisionId.get(rawOutput.itemRevisionId);
    if (item === undefined) {
      throw new Error(
        `Composition output '${rawOutput.outputId}' references unknown item revision '${rawOutput.itemRevisionId}'.`
      );
    }
    if (item.itemId === sourcePackaging.itemId) {
      throw new Error(
        `Composition output '${rawOutput.outputId}' uses the source package item '${item.itemId}'; use homogeneous pack/unpack or define a distinct trade-item pack.`
      );
    }
    outputs.push(
      normalizeInventoryCompositionOutput(
        rawOutput,
        item,
        packagingByRevisionId
      )
    );
  }
  outputs.sort(compareCompositionOutput);
  return cloneAndFreezeInventoryCompositionRevision({
    compositionId: definition.compositionId,
    revisionId: definition.revisionId,
    sourcePackagingRevisionId: definition.sourcePackagingRevisionId,
    outputs,
    ...(definition.identifiers === undefined
      ? {}
      : { identifiers: definition.identifiers }),
    ...(definition.metadata === undefined
      ? {}
      : { metadata: definition.metadata }),
  });
}

/** Validate one composition output against its exact item/package definitions. */
function normalizeInventoryCompositionOutput(
  output: InventoryCompositionOutputDefinition,
  item: InventoryItemDefinitionRevision,
  packagingByRevisionId: ReadonlyMap<
    string,
    InventoryPackagingDefinitionRevision
  >
): InventoryCompositionOutputDefinition {
  assertCompositionOutputLotPolicy(output, item);
  if (output.amount.kind === InventoryCompositionOutputAmountKind.Measured) {
    assertMeasurementsMatchItem(item, output.amount.measurements);
    positiveInventoryMeasurements(
      output.amount.measurements,
      `Composition output '${output.outputId}'`
    );
    const metadata = cloneAndFreezeInventoryMetadata(output.metadata);
    return Object.freeze({
      outputId: output.outputId,
      itemRevisionId: output.itemRevisionId,
      amount: Object.freeze({
        kind: InventoryCompositionOutputAmountKind.Measured,
        measurements: cloneAndFreezeInventoryMeasurements(
          output.amount.measurements
        ),
      }),
      lotPolicy: output.lotPolicy,
      ...(metadata === undefined ? {} : { metadata }),
    });
  }
  if (
    !Number.isSafeInteger(output.amount.packageCount) ||
    output.amount.packageCount <= 0
  ) {
    throw new Error(
      `Composition output '${output.outputId}' packageCount must be a positive safe integer.`
    );
  }
  const packaging = packagingByRevisionId.get(
    output.amount.packagingRevisionId
  );
  if (packaging === undefined) {
    throw new Error(
      `Composition output '${output.outputId}' references unknown package '${output.amount.packagingRevisionId}'.`
    );
  }
  if (packaging.itemRevisionId !== item.revisionId) {
    throw new Error(
      `Composition output '${output.outputId}' package belongs to another item revision.`
    );
  }
  const metadata = cloneAndFreezeInventoryMetadata(output.metadata);
  return Object.freeze({
    outputId: output.outputId,
    itemRevisionId: output.itemRevisionId,
    amount: Object.freeze({
      kind: InventoryCompositionOutputAmountKind.Package,
      packagingRevisionId: packaging.revisionId,
      packageCount: output.amount.packageCount,
    }),
    lotPolicy: output.lotPolicy,
    ...(metadata === undefined ? {} : { metadata }),
  });
}

/** Validate that lot identity is explicit and compatible with the output item. */
function assertCompositionOutputLotPolicy(
  output: InventoryCompositionOutputDefinition,
  item: InventoryItemDefinitionRevision
): void {
  const policy = output.lotPolicy;
  if (!Object.values(InventoryCompositionOutputLotPolicy).includes(policy)) {
    throw new Error(
      `Composition output '${output.outputId}' has an unknown lot policy.`
    );
  }
  if (
    (policy === InventoryCompositionOutputLotPolicy.None ||
      policy ===
        InventoryCompositionOutputLotPolicy.InheritSourceWhenPresent) &&
    item.tracking.lot === InventoryTrackingRequirement.Required
  ) {
    throw new Error(
      `Composition output '${output.outputId}' requires a lot policy that supplies a lotId.`
    );
  }
  if (
    policy !== InventoryCompositionOutputLotPolicy.None &&
    item.tracking.lot === InventoryTrackingRequirement.Forbidden
  ) {
    throw new Error(
      `Composition output '${output.outputId}' cannot use a lot because its item forbids lot tracking.`
    );
  }
}

/** Normalized read-only collection definitions plus pre-flattened member item revisions. */
interface InventoryCollectionNormalizationResult {
  /** Immutable collection revisions sorted by stable/revision identity. */
  readonly revisions: readonly InventoryCollectionDefinitionRevision[];
  /** Exact collection revision lookup. */
  readonly byRevisionId: ReadonlyMap<
    InventoryCollectionRevisionId,
    InventoryCollectionDefinitionRevision
  >;
  /** Pre-flattened exact item revisions by collection revision. */
  readonly itemRevisionIdsByRevisionId: ReadonlyMap<
    InventoryCollectionRevisionId,
    readonly ItemRevisionId[]
  >;
}

/** Validate one reusable transformation definition against exact retained item/form revisions. */
export function defineInventoryTransformation({
  definition,
  itemRevisions,
}: DefineInventoryTransformationInput): InventoryTransformationDefinitionRevision {
  assertInventoryIdentity(definition.transformationId, "transformationId");
  assertInventoryIdentity(definition.revisionId, "transformation revisionId");
  if (definition.inputs.length === 0 || definition.outputs.length === 0) {
    throw new Error(
      "Inventory transformation definitions require at least one input and one output."
    );
  }
  const itemByRevisionId = new Map<
    ItemRevisionId,
    InventoryItemDefinitionRevision
  >();
  for (const item of itemRevisions) itemByRevisionId.set(item.revisionId, item);
  const seenLineIds = new Set<string>();
  /** Validate/freeze one side of the transformation definition. */
  const normalizeLines = (
    lines: readonly InventoryTransformationDefinitionLine[],
    side: "input" | "output"
  ): readonly InventoryTransformationDefinitionLine[] => {
    const normalized: InventoryTransformationDefinitionLine[] = [];
    for (const line of lines) {
      assertInventoryIdentity(line.lineId, `transformation ${side} lineId`);
      if (seenLineIds.has(line.lineId)) {
        throw new Error(
          `Duplicate inventory transformation line '${line.lineId}'.`
        );
      }
      seenLineIds.add(line.lineId);
      const item = itemByRevisionId.get(line.itemRevisionId);
      if (item === undefined) {
        throw new Error(
          `Inventory transformation '${definition.revisionId}' ${side} '${line.lineId}' references unknown item revision '${line.itemRevisionId}'.`
        );
      }
      assertMeasurementsMatchItem(item, line.amount);
      positiveInventoryMeasurements(
        line.amount,
        `Inventory transformation '${definition.revisionId}' ${side} '${line.lineId}'`
      );
      const metadata = cloneAndFreezeInventoryMetadata(line.metadata);
      normalized.push(
        Object.freeze({
          lineId: line.lineId,
          itemRevisionId: line.itemRevisionId,
          amount: cloneAndFreezeInventoryMeasurements(line.amount),
          ...(metadata === undefined ? {} : { metadata }),
        })
      );
    }
    normalized.sort(compareTransformationLine);
    return Object.freeze(normalized);
  };
  const inputs = normalizeLines(definition.inputs, "input");
  const outputs = normalizeLines(definition.outputs, "output");
  const identifiers = cloneAndFreezeInventoryIdentifiers(
    definition.identifiers
  );
  const metadata = cloneAndFreezeInventoryMetadata(definition.metadata);
  return Object.freeze({
    transformationId: definition.transformationId,
    revisionId: definition.revisionId,
    inputs,
    outputs,
    ...(identifiers === undefined ? {} : { identifiers }),
    ...(metadata === undefined ? {} : { metadata }),
  });
}

/** Validate one immutable collection revision and all nested references. */
export function defineInventoryCollection({
  definition,
  itemRevisions,
  collectionRevisions,
}: DefineInventoryCollectionInput): InventoryCollectionDefinitionRevision {
  const retained: InventoryCollectionDefinitionRevision[] = [];
  for (const candidate of collectionRevisions) {
    if (candidate.revisionId !== definition.revisionId)
      retained.push(candidate);
  }
  retained.push(definition);
  const normalized = normalizeInventoryCollectionDefinitions(
    retained,
    itemRevisions
  );
  const result = normalized.byRevisionId.get(definition.revisionId);
  if (result === undefined) {
    throw new Error(
      "Inventory collection normalization lost the requested revision."
    );
  }
  return result;
}

/** Normalize arbitrary-order nested collection revisions and reject cycles/ambiguous roll-ups. */
function normalizeInventoryCollectionDefinitions(
  rawRevisions: readonly InventoryCollectionDefinitionRevision[],
  itemRevisions: readonly InventoryItemDefinitionRevision[]
): InventoryCollectionNormalizationResult {
  const itemByRevisionId = new Map<
    ItemRevisionId,
    InventoryItemDefinitionRevision
  >();
  for (const rawItem of itemRevisions) {
    const item = defineInventoryItem(rawItem);
    itemByRevisionId.set(item.revisionId, item);
  }
  const rawByRevisionId = new Map<
    InventoryCollectionRevisionId,
    InventoryCollectionDefinitionRevision
  >();
  for (const raw of rawRevisions) {
    assertInventoryIdentity(raw.collectionId, "collectionId");
    assertInventoryIdentity(raw.revisionId, "collection revisionId");
    if (rawByRevisionId.has(raw.revisionId)) {
      throw new Error(
        `Duplicate inventory collection revision '${raw.revisionId}'.`
      );
    }
    if (raw.members.length === 0) {
      throw new Error(
        `Inventory collection revision '${raw.revisionId}' needs at least one member.`
      );
    }
    rawByRevisionId.set(raw.revisionId, raw);
  }
  const normalizedByRevisionId = new Map<
    InventoryCollectionRevisionId,
    InventoryCollectionDefinitionRevision
  >();
  const flattenedByRevisionId = new Map<
    InventoryCollectionRevisionId,
    readonly ItemRevisionId[]
  >();
  const visiting = new Set<InventoryCollectionRevisionId>();

  /** Resolve one collection recursively so nested definitions may appear in any caller order. */
  const resolve = (
    revisionId: InventoryCollectionRevisionId
  ): InventoryCollectionDefinitionRevision => {
    const existing = normalizedByRevisionId.get(revisionId);
    if (existing !== undefined) return existing;
    if (visiting.has(revisionId)) {
      throw new Error(
        `Inventory collection graph contains a cycle at '${revisionId}'.`
      );
    }
    const raw = rawByRevisionId.get(revisionId);
    if (raw === undefined) {
      throw new Error(
        `Unknown nested inventory collection revision '${revisionId}'.`
      );
    }
    visiting.add(revisionId);
    const members: InventoryCollectionMemberDefinition[] = [];
    const flattened = new Set<ItemRevisionId>();
    const seenMembers = new Set<string>();
    for (const member of raw.members) {
      assertInventoryIdentity(
        member.revisionId,
        "collection member revisionId"
      );
      const identity = inventoryIntentFingerprint([
        member.kind,
        member.revisionId,
      ]);
      if (seenMembers.has(identity)) {
        throw new Error(
          `Inventory collection '${revisionId}' repeats member '${member.revisionId}'.`
        );
      }
      seenMembers.add(identity);
      if (member.kind === InventoryCollectionMemberKind.ItemRevision) {
        if (!itemByRevisionId.has(member.revisionId)) {
          throw new Error(
            `Inventory collection '${revisionId}' references unknown item revision '${member.revisionId}'.`
          );
        }
        flattened.add(member.revisionId);
      } else {
        resolve(member.revisionId);
        const nestedItems = flattenedByRevisionId.get(member.revisionId);
        if (nestedItems === undefined) {
          throw new Error(
            "Nested inventory collection lost its flattened item set."
          );
        }
        for (const itemRevisionId of nestedItems) flattened.add(itemRevisionId);
      }
      members.push(Object.freeze({ ...member }));
    }
    members.sort(compareCollectionMember);
    const flattenedItems = [...flattened];
    flattenedItems.sort();
    const rollups = normalizeInventoryCollectionRollups(
      raw.rollups ?? [],
      flattened,
      itemByRevisionId,
      revisionId
    );
    const normalized = cloneAndFreezeInventoryCollectionRevision({
      collectionId: raw.collectionId,
      revisionId: raw.revisionId,
      members,
      ...(rollups.length === 0 ? {} : { rollups }),
      ...(raw.identifiers === undefined
        ? {}
        : { identifiers: raw.identifiers }),
      ...(raw.metadata === undefined ? {} : { metadata: raw.metadata }),
    });
    visiting.delete(revisionId);
    normalizedByRevisionId.set(revisionId, normalized);
    flattenedByRevisionId.set(revisionId, Object.freeze(flattenedItems));
    return normalized;
  };

  for (const revisionId of rawByRevisionId.keys()) resolve(revisionId);
  const revisions = [...normalizedByRevisionId.values()];
  revisions.sort(compareCollectionRevision);
  return {
    revisions: Object.freeze(revisions),
    byRevisionId: normalizedByRevisionId,
    itemRevisionIdsByRevisionId: flattenedByRevisionId,
  };
}

/** Validate optional read-only roll-ups against the flattened collection member set. */
function normalizeInventoryCollectionRollups(
  rawRollups: readonly InventoryCollectionRollupDefinition[],
  flattenedItemRevisionIds: ReadonlySet<ItemRevisionId>,
  itemByRevisionId: ReadonlyMap<
    ItemRevisionId,
    InventoryItemDefinitionRevision
  >,
  collectionRevisionId: InventoryCollectionRevisionId
): readonly InventoryCollectionRollupDefinition[] {
  const rollups: InventoryCollectionRollupDefinition[] = [];
  const seenRollupIds = new Set<string>();
  for (const raw of rawRollups) {
    assertInventoryIdentity(raw.rollupId, "collection rollupId");
    assertInventoryIdentity(raw.basisAxisId, "collection rollup basisAxisId");
    if (seenRollupIds.has(raw.rollupId)) {
      throw new Error(
        `Inventory collection '${collectionRevisionId}' repeats rollupId '${raw.rollupId}'.`
      );
    }
    seenRollupIds.add(raw.rollupId);
    if (raw.members.length === 0) {
      throw new Error(
        `Inventory collection roll-up '${raw.rollupId}' needs at least one conversion member.`
      );
    }
    const members: InventoryCollectionRollupMemberDefinition[] = [];
    const seenMemberRevisionIds = new Set<ItemRevisionId>();
    for (const member of raw.members) {
      if (!flattenedItemRevisionIds.has(member.itemRevisionId)) {
        throw new Error(
          `Collection roll-up '${raw.rollupId}' references item revision '${member.itemRevisionId}' outside collection membership.`
        );
      }
      if (seenMemberRevisionIds.has(member.itemRevisionId)) {
        throw new Error(
          `Collection roll-up '${raw.rollupId}' repeats item revision '${member.itemRevisionId}'.`
        );
      }
      seenMemberRevisionIds.add(member.itemRevisionId);
      const item = itemByRevisionId.get(member.itemRevisionId);
      if (item === undefined) {
        throw new Error(
          `Collection roll-up '${raw.rollupId}' references unknown item revision '${member.itemRevisionId}'.`
        );
      }
      const axis =
        item.primaryAxis.axisId === member.measurementAxisId
          ? item.primaryAxis
          : findIndependentAxis(item, member.measurementAxisId);
      if (axis === undefined) {
        throw new Error(
          `Collection roll-up '${raw.rollupId}' references unknown item axis '${member.measurementAxisId}'.`
        );
      }
      positiveQuantity(
        member.memberQuantity,
        "Collection roll-up member quantity"
      );
      positiveQuantity(
        member.rollupQuantity,
        "Collection roll-up basis quantity"
      );
      if (member.memberQuantity.unit !== axis.unit) {
        throw new Error(
          `Collection roll-up '${raw.rollupId}' member quantity unit differs from item axis.`
        );
      }
      if (member.rollupQuantity.unit !== raw.basisUnit) {
        throw new Error(
          `Collection roll-up '${raw.rollupId}' basis quantity unit differs from roll-up basis unit.`
        );
      }
      members.push(
        Object.freeze({
          itemRevisionId: member.itemRevisionId,
          measurementAxisId: member.measurementAxisId,
          memberQuantity: cloneAndFreezeQuantity(member.memberQuantity),
          rollupQuantity: cloneAndFreezeQuantity(member.rollupQuantity),
        })
      );
    }
    members.sort(compareCollectionRollupMember);
    rollups.push(
      Object.freeze({
        rollupId: raw.rollupId,
        basisAxisId: raw.basisAxisId,
        basisUnit: unitCode(raw.basisUnit),
        members: Object.freeze(members),
      })
    );
  }
  rollups.sort(compareCollectionRollup);
  return Object.freeze(rollups);
}

/** Private validated pieces used only after the public catalogue input passes every check. */
interface InventoryCatalogParts {
  /** Normalized item revision array. */
  readonly itemRevisions: readonly InventoryItemDefinitionRevision[];
  /** Normalized package revision array. */
  readonly packagingRevisions: readonly InventoryPackagingDefinitionRevision[];
  /** Exact item lookup. */
  readonly itemByRevisionId: ReadonlyMap<
    ItemRevisionId,
    InventoryItemDefinitionRevision
  >;
  /** Active item lookup. */
  readonly activeItemById: ReadonlyMap<ItemId, InventoryItemDefinitionRevision>;
  /** Normalized active item revision ids retained for durable catalogue snapshots. */
  readonly activeItemRevisionIds: Readonly<Record<string, ItemRevisionId>>;
  /** Exact package lookup. */
  readonly packagingByRevisionId: ReadonlyMap<
    string,
    InventoryPackagingDefinitionRevision
  >;
  /** Normalized heterogeneous composition revisions. */
  readonly compositionRevisions: readonly InventoryCompositionDefinitionRevision[];
  /** Exact composition lookup. */
  readonly compositionByRevisionId: ReadonlyMap<
    InventoryCompositionRevisionId,
    InventoryCompositionDefinitionRevision
  >;
  /** Exact source-package lookup; one package revision has at most one composition. */
  readonly compositionBySourcePackagingRevisionId: ReadonlyMap<
    string,
    InventoryCompositionDefinitionRevision
  >;
  /** Active composition lookup by stable composition identity. */
  readonly activeCompositionById: ReadonlyMap<
    InventoryCompositionId,
    InventoryCompositionDefinitionRevision
  >;
  /** Normalized active composition revision ids retained in durable snapshots. */
  readonly activeCompositionRevisionIds: Readonly<
    Record<string, InventoryCompositionRevisionId>
  >;
  /** Normalized reusable physical transformation definition revisions. */
  readonly transformationRevisions: readonly InventoryTransformationDefinitionRevision[];
  /** Exact transformation definition lookup. */
  readonly transformationByRevisionId: ReadonlyMap<
    InventoryTransformationRevisionId,
    InventoryTransformationDefinitionRevision
  >;
  /** Active transformation lookup by stable transformation identity. */
  readonly activeTransformationById: ReadonlyMap<
    InventoryTransformationId,
    InventoryTransformationDefinitionRevision
  >;
  /** Normalized active transformation revision ids retained in durable snapshots. */
  readonly activeTransformationRevisionIds: Readonly<
    Record<string, InventoryTransformationRevisionId>
  >;
  /** Normalized read-only collection revisions. */
  readonly collectionRevisions: readonly InventoryCollectionDefinitionRevision[];
  /** Exact collection lookup. */
  readonly collectionByRevisionId: ReadonlyMap<
    InventoryCollectionRevisionId,
    InventoryCollectionDefinitionRevision
  >;
  /** Active collection lookup by stable collection identity. */
  readonly activeCollectionById: ReadonlyMap<
    InventoryCollectionId,
    InventoryCollectionDefinitionRevision
  >;
  /** Normalized active collection revision ids retained in durable snapshots. */
  readonly activeCollectionRevisionIds: Readonly<
    Record<string, InventoryCollectionRevisionId>
  >;
  /** Pre-flattened exact member item revisions by collection revision. */
  readonly collectionItemRevisionIdsByRevisionId: ReadonlyMap<
    InventoryCollectionRevisionId,
    readonly ItemRevisionId[]
  >;
  /** Normalized mutual-fungibility pool revisions. */
  readonly fungibilityRevisions: readonly InventoryFungibilityPoolDefinitionRevision[];
  /** Exact fungibility revision lookup. */
  readonly fungibilityByRevisionId: ReadonlyMap<
    InventoryFungibilityRevisionId,
    InventoryFungibilityPoolDefinitionRevision
  >;
  /** Active fungibility revision lookup by stable pool identity. */
  readonly activeFungibilityById: ReadonlyMap<
    InventoryFungibilityPoolId,
    InventoryFungibilityPoolDefinitionRevision
  >;
  /** Normalized active fungibility revision ids retained in durable snapshots. */
  readonly activeFungibilityRevisionIds: Readonly<
    Record<string, InventoryFungibilityRevisionId>
  >;
}

/** Immutable validated catalogue used to interpret every command/event revision. */
export class InventoryCatalog {
  /** Normalized immutable item revisions retained for migration/export/documentation. */
  readonly itemRevisions: readonly InventoryItemDefinitionRevision[];
  /** Normalized immutable package revisions retained for historical interpretation. */
  readonly packagingRevisions: readonly InventoryPackagingDefinitionRevision[];
  /** Current active revision id by stable item identity. */
  readonly activeItemRevisionIds: Readonly<Record<string, ItemRevisionId>>;
  /** Normalized immutable heterogeneous package-composition revisions. */
  readonly compositionRevisions: readonly InventoryCompositionDefinitionRevision[];
  /** Current active composition revision id by stable composition identity. */
  readonly activeCompositionRevisionIds: Readonly<
    Record<string, InventoryCompositionRevisionId>
  >;
  /** Normalized immutable reusable physical transformation definitions. */
  readonly transformationRevisions: readonly InventoryTransformationDefinitionRevision[];
  /** Current active transformation revision id by stable transformation identity. */
  readonly activeTransformationRevisionIds: Readonly<
    Record<string, InventoryTransformationRevisionId>
  >;
  /** Normalized immutable read-only collection revisions. */
  readonly collectionRevisions: readonly InventoryCollectionDefinitionRevision[];
  /** Current active collection revision id by stable collection identity. */
  readonly activeCollectionRevisionIds: Readonly<
    Record<string, InventoryCollectionRevisionId>
  >;
  /** Normalized immutable mutual-fungibility pool revisions. */
  readonly fungibilityRevisions: readonly InventoryFungibilityPoolDefinitionRevision[];
  /** Current active fungibility revision id by stable pool identity. */
  readonly activeFungibilityRevisionIds: Readonly<
    Record<string, InventoryFungibilityRevisionId>
  >;
  /** Collision-free normalized content fingerprint for this complete retained catalogue. */
  readonly digest: string;
  /** Exact item revision lookup. */
  private readonly itemByRevisionId: ReadonlyMap<
    ItemRevisionId,
    InventoryItemDefinitionRevision
  >;
  /** Active item revision lookup by stable item identity. */
  private readonly activeItemById: ReadonlyMap<
    ItemId,
    InventoryItemDefinitionRevision
  >;
  /** Exact package revision lookup. */
  private readonly packagingByRevisionId: ReadonlyMap<
    string,
    InventoryPackagingDefinitionRevision
  >;
  /** Exact heterogeneous composition revision lookup. */
  private readonly compositionByRevisionId: ReadonlyMap<
    InventoryCompositionRevisionId,
    InventoryCompositionDefinitionRevision
  >;
  /** Exact composition lookup by source package revision. */
  private readonly compositionBySourcePackagingRevisionId: ReadonlyMap<
    string,
    InventoryCompositionDefinitionRevision
  >;
  /** Active composition lookup by stable composition identity. */
  private readonly activeCompositionById: ReadonlyMap<
    InventoryCompositionId,
    InventoryCompositionDefinitionRevision
  >;
  /** Exact transformation definition lookup. */
  private readonly transformationByRevisionId: ReadonlyMap<
    InventoryTransformationRevisionId,
    InventoryTransformationDefinitionRevision
  >;
  /** Active transformation lookup by stable transformation identity. */
  private readonly activeTransformationById: ReadonlyMap<
    InventoryTransformationId,
    InventoryTransformationDefinitionRevision
  >;
  /** Exact read-only collection revision lookup. */
  private readonly collectionByRevisionId: ReadonlyMap<
    InventoryCollectionRevisionId,
    InventoryCollectionDefinitionRevision
  >;
  /** Active collection lookup by stable collection identity. */
  private readonly activeCollectionById: ReadonlyMap<
    InventoryCollectionId,
    InventoryCollectionDefinitionRevision
  >;
  /** Pre-flattened exact member item revisions by collection revision. */
  private readonly collectionItemRevisionIdsByRevisionId: ReadonlyMap<
    InventoryCollectionRevisionId,
    readonly ItemRevisionId[]
  >;
  /** Exact mutual-fungibility revision lookup. */
  private readonly fungibilityByRevisionId: ReadonlyMap<
    InventoryFungibilityRevisionId,
    InventoryFungibilityPoolDefinitionRevision
  >;
  /** Active mutual-fungibility revision lookup by stable pool identity. */
  private readonly activeFungibilityById: ReadonlyMap<
    InventoryFungibilityPoolId,
    InventoryFungibilityPoolDefinitionRevision
  >;

  /** Build one catalogue only after the public static validator returned trusted parts. */
  private constructor(args: InventoryCatalogParts) {
    this.itemRevisions = args.itemRevisions;
    this.packagingRevisions = args.packagingRevisions;
    this.activeItemRevisionIds = args.activeItemRevisionIds;
    this.compositionRevisions = args.compositionRevisions;
    this.activeCompositionRevisionIds = args.activeCompositionRevisionIds;
    this.collectionRevisions = args.collectionRevisions;
    this.activeCollectionRevisionIds = args.activeCollectionRevisionIds;
    this.fungibilityRevisions = args.fungibilityRevisions;
    this.activeFungibilityRevisionIds = args.activeFungibilityRevisionIds;
    this.itemByRevisionId = args.itemByRevisionId;
    this.activeItemById = args.activeItemById;
    this.packagingByRevisionId = args.packagingByRevisionId;
    this.compositionByRevisionId = args.compositionByRevisionId;
    this.compositionBySourcePackagingRevisionId =
      args.compositionBySourcePackagingRevisionId;
    this.activeCompositionById = args.activeCompositionById;
    this.transformationRevisions = args.transformationRevisions;
    this.activeTransformationRevisionIds = args.activeTransformationRevisionIds;
    this.transformationByRevisionId = args.transformationByRevisionId;
    this.activeTransformationById = args.activeTransformationById;
    this.collectionByRevisionId = args.collectionByRevisionId;
    this.activeCollectionById = args.activeCollectionById;
    this.collectionItemRevisionIdsByRevisionId =
      args.collectionItemRevisionIdsByRevisionId;
    this.fungibilityByRevisionId = args.fungibilityByRevisionId;
    this.activeFungibilityById = args.activeFungibilityById;
    this.digest = inventoryCatalogDigest({
      itemRevisions: this.itemRevisions,
      activeItemRevisionIds: this.activeItemRevisionIds,
      packagingRevisions: this.packagingRevisions,
      compositionRevisions: this.compositionRevisions,
      activeCompositionRevisionIds: this.activeCompositionRevisionIds,
      transformationRevisions: this.transformationRevisions,
      activeTransformationRevisionIds: this.activeTransformationRevisionIds,
      collectionRevisions: this.collectionRevisions,
      activeCollectionRevisionIds: this.activeCollectionRevisionIds,
      fungibilityRevisions: this.fungibilityRevisions,
      activeFungibilityRevisionIds: this.activeFungibilityRevisionIds,
    });
  }

  /** Validate public catalogue input and return one safe immutable catalogue. */
  static define(input: InventoryCatalogInput): InventoryCatalog {
    return new InventoryCatalog(createInventoryCatalogParts(input));
  }

  /** Return the current active definition revision for one item or fail closed. */
  activeItem(itemId: ItemId): InventoryItemDefinitionRevision {
    const item = this.activeItemById.get(itemId);
    if (item === undefined)
      throw new Error(`Unknown active inventory item '${itemId}'.`);
    return item;
  }

  /** Return one exact historical/current item definition revision or fail closed. */
  itemRevision(revisionId: ItemRevisionId): InventoryItemDefinitionRevision {
    const item = this.itemByRevisionId.get(revisionId);
    if (item === undefined)
      throw new Error(`Unknown inventory item revision '${revisionId}'.`);
    return item;
  }

  /** List every retained immutable form/item revision for one stable item identity. */
  itemRevisionsForItem(
    itemId: ItemId
  ): readonly InventoryItemDefinitionRevision[] {
    const result = this.itemRevisions.filter(
      /** Keep only exact revisions belonging to this stable item identity. */
      (item) => item.itemId === itemId
    );
    return Object.freeze(result);
  }

  /** Return one exact package definition revision or fail closed. */
  packagingRevision(revisionId: string): InventoryPackagingDefinitionRevision {
    const packaging = this.packagingByRevisionId.get(revisionId);
    if (packaging === undefined) {
      throw new Error(`Unknown inventory packaging revision '${revisionId}'.`);
    }
    return packaging;
  }

  /** Return the active heterogeneous composition revision for one stable composition. */
  activeComposition(
    compositionId: InventoryCompositionId
  ): InventoryCompositionDefinitionRevision {
    const composition = this.activeCompositionById.get(compositionId);
    if (composition === undefined) {
      throw new Error(
        `Unknown active inventory composition '${compositionId}'.`
      );
    }
    return composition;
  }

  /** Return one exact historical/current heterogeneous composition revision. */
  compositionRevision(
    revisionId: InventoryCompositionRevisionId
  ): InventoryCompositionDefinitionRevision {
    const composition = this.compositionByRevisionId.get(revisionId);
    if (composition === undefined) {
      throw new Error(
        `Unknown inventory composition revision '${revisionId}'.`
      );
    }
    return composition;
  }

  /** Return the one exact composition attached to a source package revision. */
  compositionForSourcePackagingRevision(
    packagingRevisionId: string
  ): InventoryCompositionDefinitionRevision {
    const composition =
      this.compositionBySourcePackagingRevisionId.get(packagingRevisionId);
    if (composition === undefined) {
      throw new Error(
        `Inventory packaging revision '${packagingRevisionId}' has no heterogeneous composition.`
      );
    }
    return composition;
  }

  /** Return the active reusable physical transformation definition for one stable identity. */
  activeTransformation(
    transformationId: InventoryTransformationId
  ): InventoryTransformationDefinitionRevision {
    const definition = this.activeTransformationById.get(transformationId);
    if (definition === undefined) {
      throw new Error(
        `Unknown active inventory transformation '${transformationId}'.`
      );
    }
    return definition;
  }

  /** Return one exact historical/current transformation definition revision. */
  transformationRevision(
    revisionId: InventoryTransformationRevisionId
  ): InventoryTransformationDefinitionRevision {
    const definition = this.transformationByRevisionId.get(revisionId);
    if (definition === undefined) {
      throw new Error(
        `Unknown inventory transformation revision '${revisionId}'.`
      );
    }
    return definition;
  }

  /** List retained transformation definitions touching one item identity. */
  transformationsForItem(
    itemId: ItemId
  ): readonly InventoryTransformationDefinitionRevision[] {
    const result = this.transformationRevisions.filter(
      /** Keep revisions where at least one exact input/output belongs to this item. */
      (definition) =>
        [...definition.inputs, ...definition.outputs].some(
          /** Check one transformation line's stable item identity. */
          (line) => this.itemRevision(line.itemRevisionId).itemId === itemId
        )
    );
    return Object.freeze(result);
  }

  /** List current active definitions that consume one exact item/form revision. */
  transformationsFromRevision(
    itemRevisionId: ItemRevisionId
  ): readonly InventoryTransformationDefinitionRevision[] {
    const result: InventoryTransformationDefinitionRevision[] = [];
    for (const definition of this.activeTransformationById.values()) {
      if (
        definition.inputs.some(
          /** Check one exact input-form revision. */
          (line) => line.itemRevisionId === itemRevisionId
        )
      )
        result.push(definition);
    }
    result.sort(compareTransformationRevision);
    return Object.freeze(result);
  }

  /** List current active definitions that produce one exact item/form revision. */
  transformationsToRevision(
    itemRevisionId: ItemRevisionId
  ): readonly InventoryTransformationDefinitionRevision[] {
    const result: InventoryTransformationDefinitionRevision[] = [];
    for (const definition of this.activeTransformationById.values()) {
      if (
        definition.outputs.some(
          /** Check one exact output-form revision. */
          (line) => line.itemRevisionId === itemRevisionId
        )
      )
        result.push(definition);
    }
    result.sort(compareTransformationRevision);
    return Object.freeze(result);
  }

  /** List current active definitions that connect one exact input/output form pair. */
  transformationsBetweenRevisions(
    fromRevisionId: ItemRevisionId,
    toRevisionId: ItemRevisionId
  ): readonly InventoryTransformationDefinitionRevision[] {
    return Object.freeze(
      this.transformationsFromRevision(fromRevisionId).filter(
        /** Keep definitions that also produce the requested destination form. */
        (definition) =>
          definition.outputs.some(
            /** Check one exact destination-form revision. */
            (line) => line.itemRevisionId === toRevisionId
          )
      )
    );
  }

  /** Return the active read-only collection revision for one stable collection. */
  activeCollection(
    collectionId: InventoryCollectionId
  ): InventoryCollectionDefinitionRevision {
    const collection = this.activeCollectionById.get(collectionId);
    if (collection === undefined) {
      throw new Error(`Unknown active inventory collection '${collectionId}'.`);
    }
    return collection;
  }

  /** Return one exact historical/current read-only collection revision. */
  collectionRevision(
    revisionId: InventoryCollectionRevisionId
  ): InventoryCollectionDefinitionRevision {
    const collection = this.collectionByRevisionId.get(revisionId);
    if (collection === undefined) {
      throw new Error(`Unknown inventory collection revision '${revisionId}'.`);
    }
    return collection;
  }

  /** Return pre-flattened exact item revisions in one read-only collection. */
  collectionItemRevisionIds(
    revisionId: InventoryCollectionRevisionId
  ): readonly ItemRevisionId[] {
    const members = this.collectionItemRevisionIdsByRevisionId.get(revisionId);
    if (members === undefined) {
      throw new Error(`Unknown inventory collection revision '${revisionId}'.`);
    }
    return members;
  }

  /** Return the active mutual-fungibility revision for one stable pool or fail closed. */
  activeFungibilityPool(
    poolId: InventoryFungibilityPoolId
  ): InventoryFungibilityPoolDefinitionRevision {
    const pool = this.activeFungibilityById.get(poolId);
    if (pool === undefined) {
      throw new Error(`Unknown active inventory fungibility pool '${poolId}'.`);
    }
    return pool;
  }

  /** Return one exact historical/current mutual-fungibility revision or fail closed. */
  fungibilityRevision(
    revisionId: InventoryFungibilityRevisionId
  ): InventoryFungibilityPoolDefinitionRevision {
    const pool = this.fungibilityByRevisionId.get(revisionId);
    if (pool === undefined) {
      throw new Error(
        `Unknown inventory fungibility revision '${revisionId}'.`
      );
    }
    return pool;
  }

  /** Return one item measurement-axis definition or fail closed. */
  measurementAxis(
    item: InventoryItemDefinitionRevision,
    axisId: InventoryMeasurementAxisId
  ): InventoryMeasurementAxisDefinition {
    if (item.primaryAxis.axisId === axisId) return item.primaryAxis;
    for (const axis of item.independentAxes) {
      if (axis.axisId === axisId) return axis;
    }
    throw new Error(
      `Item revision '${item.revisionId}' has no measurement axis '${axisId}'.`
    );
  }
}

/** Durable copy of every definition needed to interpret retained inventory facts after restart. */
export interface InventoryCatalogSnapshot {
  /** Collision-free normalized fingerprint of the full snapshot content. */
  readonly digest: string;
  /** Every retained immutable item definition revision. */
  readonly itemRevisions: readonly InventoryItemDefinitionRevision[];
  /** Current active revision id by stable item identity. */
  readonly activeItemRevisionIds: Readonly<Record<string, ItemRevisionId>>;
  /** Every retained immutable package definition revision. */
  readonly packagingRevisions: readonly InventoryPackagingDefinitionRevision[];
  /** Every retained immutable heterogeneous composition revision. */
  readonly compositionRevisions: readonly InventoryCompositionDefinitionRevision[];
  /** Current active composition revision id by stable composition identity. */
  readonly activeCompositionRevisionIds: Readonly<
    Record<string, InventoryCompositionRevisionId>
  >;
  /** Every retained immutable physical transformation definition revision. */
  readonly transformationRevisions: readonly InventoryTransformationDefinitionRevision[];
  /** Current active transformation revision id by stable transformation identity. */
  readonly activeTransformationRevisionIds: Readonly<
    Record<string, InventoryTransformationRevisionId>
  >;
  /** Every retained immutable read-only collection revision. */
  readonly collectionRevisions: readonly InventoryCollectionDefinitionRevision[];
  /** Current active collection revision id by stable collection identity. */
  readonly activeCollectionRevisionIds: Readonly<
    Record<string, InventoryCollectionRevisionId>
  >;
  /** Every retained immutable mutual-fungibility pool revision. */
  readonly fungibilityRevisions: readonly InventoryFungibilityPoolDefinitionRevision[];
  /** Current active fungibility revision id by stable pool identity. */
  readonly activeFungibilityRevisionIds: Readonly<
    Record<string, InventoryFungibilityRevisionId>
  >;
}

/** Create the only catalogue snapshot valid for a revision-zero empty world. */
export function emptyInventoryCatalogSnapshot(): InventoryCatalogSnapshot {
  const input: InventoryCatalogInput = {
    itemRevisions: [],
    activeItemRevisionIds: {},
    packagingRevisions: [],
    compositionRevisions: [],
    activeCompositionRevisionIds: {},
    transformationRevisions: [],
    activeTransformationRevisionIds: {},
    collectionRevisions: [],
    activeCollectionRevisionIds: {},
    fungibilityRevisions: [],
    activeFungibilityRevisionIds: {},
  };
  return {
    digest: inventoryCatalogDigest(input),
    itemRevisions: [],
    activeItemRevisionIds: {},
    packagingRevisions: [],
    compositionRevisions: [],
    activeCompositionRevisionIds: {},
    transformationRevisions: [],
    activeTransformationRevisionIds: {},
    collectionRevisions: [],
    activeCollectionRevisionIds: {},
    fungibilityRevisions: [],
    activeFungibilityRevisionIds: {},
  };
}

/** Copy one validated catalogue into durable restart-safe truth. */
export function inventoryCatalogSnapshot(
  catalog: InventoryCatalog
): InventoryCatalogSnapshot {
  return {
    digest: catalog.digest,
    itemRevisions: catalog.itemRevisions,
    activeItemRevisionIds: catalog.activeItemRevisionIds,
    packagingRevisions: catalog.packagingRevisions,
    compositionRevisions: catalog.compositionRevisions,
    activeCompositionRevisionIds: catalog.activeCompositionRevisionIds,
    transformationRevisions: catalog.transformationRevisions,
    activeTransformationRevisionIds: catalog.activeTransformationRevisionIds,
    collectionRevisions: catalog.collectionRevisions,
    activeCollectionRevisionIds: catalog.activeCollectionRevisionIds,
    fungibilityRevisions: catalog.fungibilityRevisions,
    activeFungibilityRevisionIds: catalog.activeFungibilityRevisionIds,
  };
}

/** Rebuild and verify one durable catalogue snapshot before it interprets retained history. */
export function inventoryCatalogFromSnapshot(
  snapshot: InventoryCatalogSnapshot
): InventoryCatalog {
  const catalog = defineInventoryCatalog(snapshot);
  if (catalog.digest !== snapshot.digest) {
    throw new Error(
      "Durable inventory catalogue snapshot digest does not match its definitions."
    );
  }
  return catalog;
}

/** Reject a process catalogue that drops or changes an already-retained revision identity. */
export function assertInventoryCatalogRetainsSnapshot(
  catalog: InventoryCatalog,
  retained: InventoryCatalogSnapshot
): void {
  const retainedCatalog = inventoryCatalogFromSnapshot(retained);
  for (const retainedItem of retainedCatalog.itemRevisions) {
    const supplied = catalog.itemRevision(retainedItem.revisionId);
    if (
      inventoryItemRevisionDigest(supplied) !==
      inventoryItemRevisionDigest(retainedItem)
    ) {
      throw new Error(
        `Inventory item revision '${retainedItem.revisionId}' changed after it entered durable truth.`
      );
    }
  }
  for (const retainedPackaging of retainedCatalog.packagingRevisions) {
    const supplied = catalog.packagingRevision(retainedPackaging.revisionId);
    if (
      inventoryPackagingRevisionDigest(supplied) !==
      inventoryPackagingRevisionDigest(retainedPackaging)
    ) {
      throw new Error(
        `Inventory packaging revision '${retainedPackaging.revisionId}' changed after it entered durable truth.`
      );
    }
  }
  for (const retainedComposition of retainedCatalog.compositionRevisions) {
    const supplied = catalog.compositionRevision(
      retainedComposition.revisionId
    );
    if (
      inventoryCompositionRevisionDigest(supplied) !==
      inventoryCompositionRevisionDigest(retainedComposition)
    ) {
      throw new Error(
        `Inventory composition revision '${retainedComposition.revisionId}' changed after it entered durable truth.`
      );
    }
  }
  for (const retainedTransformation of retainedCatalog.transformationRevisions) {
    const supplied = catalog.transformationRevision(
      retainedTransformation.revisionId
    );
    if (
      inventoryTransformationRevisionDigest(supplied) !==
      inventoryTransformationRevisionDigest(retainedTransformation)
    ) {
      throw new Error(
        `Inventory transformation revision '${retainedTransformation.revisionId}' changed after it entered durable truth.`
      );
    }
  }
  for (const retainedCollection of retainedCatalog.collectionRevisions) {
    const supplied = catalog.collectionRevision(retainedCollection.revisionId);
    if (
      inventoryCollectionRevisionDigest(supplied) !==
      inventoryCollectionRevisionDigest(retainedCollection)
    ) {
      throw new Error(
        `Inventory collection revision '${retainedCollection.revisionId}' changed after it entered durable truth.`
      );
    }
  }
  for (const retainedPool of retainedCatalog.fungibilityRevisions) {
    const supplied = catalog.fungibilityRevision(retainedPool.revisionId);
    if (
      inventoryFungibilityRevisionDigest(supplied) !==
      inventoryFungibilityRevisionDigest(retainedPool)
    ) {
      throw new Error(
        `Inventory fungibility revision '${retainedPool.revisionId}' changed after it entered durable truth.`
      );
    }
  }
}

/** Validate/normalize one complete retained catalogue into trusted private parts. */
function createInventoryCatalogParts(
  input: InventoryCatalogInput
): InventoryCatalogParts {
  const itemRevisions: InventoryItemDefinitionRevision[] = [];
  const itemByRevisionId = new Map<
    ItemRevisionId,
    InventoryItemDefinitionRevision
  >();
  for (const rawItem of input.itemRevisions) {
    const item = defineInventoryItem(rawItem);
    if (itemByRevisionId.has(item.revisionId)) {
      throw new Error(
        `Duplicate inventory item revision '${item.revisionId}'.`
      );
    }
    itemByRevisionId.set(item.revisionId, item);
    itemRevisions.push(item);
  }
  itemRevisions.sort(compareItemRevision);

  const activeItemById = new Map<ItemId, InventoryItemDefinitionRevision>();
  const activeItemRevisionIds: Record<string, ItemRevisionId> = {};
  const activeItemEntries = Object.entries(input.activeItemRevisionIds);
  for (const [itemId, revisionId] of activeItemEntries) {
    const item = itemByRevisionId.get(revisionId);
    if (item === undefined) {
      throw new Error(
        `Active item '${itemId}' references unknown revision '${revisionId}'.`
      );
    }
    if (item.itemId !== itemId) {
      throw new Error(
        `Active revision '${revisionId}' belongs to a different item.`
      );
    }
    activeItemById.set(itemId, item);
    Object.defineProperty(activeItemRevisionIds, itemId, {
      value: revisionId,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  const retainedItemIds = new Set<ItemId>();
  for (const item of itemRevisions) retainedItemIds.add(item.itemId);
  for (const itemId of retainedItemIds) {
    if (!activeItemById.has(itemId)) {
      throw new Error(
        `Inventory item '${itemId}' has no active definition revision.`
      );
    }
  }

  const packagingRevisions: InventoryPackagingDefinitionRevision[] = [];
  const packagingByRevisionId = new Map<
    string,
    InventoryPackagingDefinitionRevision
  >();
  for (const rawPackaging of input.packagingRevisions ?? []) {
    const item = itemByRevisionId.get(rawPackaging.itemRevisionId);
    if (item === undefined) {
      throw new Error(
        `Packaging revision '${rawPackaging.revisionId}' references unknown item revision '${rawPackaging.itemRevisionId}'.`
      );
    }
    const packaging = defineInventoryPackaging(rawPackaging, item);
    if (packagingByRevisionId.has(packaging.revisionId)) {
      throw new Error(
        `Duplicate inventory packaging revision '${packaging.revisionId}'.`
      );
    }
    packagingByRevisionId.set(packaging.revisionId, packaging);
    packagingRevisions.push(packaging);
  }
  packagingRevisions.sort(comparePackagingRevision);
  validateInnerPackaging(packagingRevisions, packagingByRevisionId);

  const compositionRevisions: InventoryCompositionDefinitionRevision[] = [];
  const compositionByRevisionId = new Map<
    InventoryCompositionRevisionId,
    InventoryCompositionDefinitionRevision
  >();
  const compositionBySourcePackagingRevisionId = new Map<
    string,
    InventoryCompositionDefinitionRevision
  >();
  for (const rawComposition of input.compositionRevisions ?? []) {
    const composition = defineInventoryComposition({
      definition: rawComposition,
      itemRevisions,
      packagingRevisions,
    });
    if (compositionByRevisionId.has(composition.revisionId)) {
      throw new Error(
        `Duplicate inventory composition revision '${composition.revisionId}'.`
      );
    }
    const sourceOwner = compositionBySourcePackagingRevisionId.get(
      composition.sourcePackagingRevisionId
    );
    if (sourceOwner !== undefined) {
      throw new Error(
        `Packaging revision '${composition.sourcePackagingRevisionId}' has more than one heterogeneous composition.`
      );
    }
    compositionByRevisionId.set(composition.revisionId, composition);
    compositionBySourcePackagingRevisionId.set(
      composition.sourcePackagingRevisionId,
      composition
    );
    compositionRevisions.push(composition);
  }
  compositionRevisions.sort(compareCompositionRevision);
  validateCompositionGraph(
    compositionRevisions,
    compositionBySourcePackagingRevisionId
  );

  const activeCompositionById = new Map<
    InventoryCompositionId,
    InventoryCompositionDefinitionRevision
  >();
  const activeCompositionRevisionIds: Record<
    string,
    InventoryCompositionRevisionId
  > = {};
  for (const [compositionId, revisionId] of Object.entries(
    input.activeCompositionRevisionIds ?? {}
  )) {
    const composition = compositionByRevisionId.get(revisionId);
    if (composition === undefined) {
      throw new Error(
        `Active composition '${compositionId}' references unknown revision '${revisionId}'.`
      );
    }
    if (composition.compositionId !== compositionId) {
      throw new Error(
        `Active composition revision '${revisionId}' belongs to another composition.`
      );
    }
    activeCompositionById.set(compositionId, composition);
    activeCompositionRevisionIds[compositionId] = revisionId;
  }
  const retainedCompositionIds = new Set<InventoryCompositionId>();
  for (const composition of compositionRevisions) {
    retainedCompositionIds.add(composition.compositionId);
  }
  for (const compositionId of retainedCompositionIds) {
    if (!activeCompositionById.has(compositionId)) {
      throw new Error(
        `Inventory composition '${compositionId}' has no active definition revision.`
      );
    }
  }

  const transformationRevisions: InventoryTransformationDefinitionRevision[] =
    [];
  const transformationByRevisionId = new Map<
    InventoryTransformationRevisionId,
    InventoryTransformationDefinitionRevision
  >();
  for (const rawTransformation of input.transformationRevisions ?? []) {
    const transformation = defineInventoryTransformation({
      definition: rawTransformation,
      itemRevisions,
    });
    if (transformationByRevisionId.has(transformation.revisionId)) {
      throw new Error(
        `Duplicate inventory transformation revision '${transformation.revisionId}'.`
      );
    }
    transformationByRevisionId.set(transformation.revisionId, transformation);
    transformationRevisions.push(transformation);
  }
  transformationRevisions.sort(compareTransformationRevision);

  const activeTransformationById = new Map<
    InventoryTransformationId,
    InventoryTransformationDefinitionRevision
  >();
  const activeTransformationRevisionIds: Record<
    string,
    InventoryTransformationRevisionId
  > = {};
  for (const [transformationId, revisionId] of Object.entries(
    input.activeTransformationRevisionIds ?? {}
  )) {
    const transformation = transformationByRevisionId.get(revisionId);
    if (transformation === undefined) {
      throw new Error(
        `Active transformation '${transformationId}' references unknown revision '${revisionId}'.`
      );
    }
    if (transformation.transformationId !== transformationId) {
      throw new Error(
        `Active transformation revision '${revisionId}' belongs to another transformation.`
      );
    }
    activeTransformationById.set(transformationId, transformation);
    activeTransformationRevisionIds[transformationId] = revisionId;
  }
  const retainedTransformationIds = new Set<InventoryTransformationId>();
  for (const transformation of transformationRevisions) {
    retainedTransformationIds.add(transformation.transformationId);
  }
  for (const transformationId of retainedTransformationIds) {
    if (!activeTransformationById.has(transformationId)) {
      throw new Error(
        `Inventory transformation '${transformationId}' has no active definition revision.`
      );
    }
  }

  const normalizedCollections = normalizeInventoryCollectionDefinitions(
    input.collectionRevisions ?? [],
    itemRevisions
  );
  const collectionRevisions = normalizedCollections.revisions;
  const collectionByRevisionId = normalizedCollections.byRevisionId;
  const collectionItemRevisionIdsByRevisionId =
    normalizedCollections.itemRevisionIdsByRevisionId;
  const activeCollectionById = new Map<
    InventoryCollectionId,
    InventoryCollectionDefinitionRevision
  >();
  const activeCollectionRevisionIds: Record<
    string,
    InventoryCollectionRevisionId
  > = {};
  for (const [collectionId, revisionId] of Object.entries(
    input.activeCollectionRevisionIds ?? {}
  )) {
    const collection = collectionByRevisionId.get(revisionId);
    if (collection === undefined) {
      throw new Error(
        `Active collection '${collectionId}' references unknown revision '${revisionId}'.`
      );
    }
    if (collection.collectionId !== collectionId) {
      throw new Error(
        `Active collection revision '${revisionId}' belongs to another collection.`
      );
    }
    activeCollectionById.set(collectionId, collection);
    activeCollectionRevisionIds[collectionId] = revisionId;
  }
  const retainedCollectionIds = new Set<InventoryCollectionId>();
  for (const collection of collectionRevisions) {
    retainedCollectionIds.add(collection.collectionId);
  }
  for (const collectionId of retainedCollectionIds) {
    if (!activeCollectionById.has(collectionId)) {
      throw new Error(
        `Inventory collection '${collectionId}' has no active definition revision.`
      );
    }
  }

  const fungibilityRevisions: InventoryFungibilityPoolDefinitionRevision[] = [];
  const fungibilityByRevisionId = new Map<
    InventoryFungibilityRevisionId,
    InventoryFungibilityPoolDefinitionRevision
  >();
  for (const rawPool of input.fungibilityRevisions ?? []) {
    const pool = defineInventoryFungibilityPool({
      definition: rawPool,
      itemRevisions,
    });
    if (fungibilityByRevisionId.has(pool.revisionId)) {
      throw new Error(
        `Duplicate inventory fungibility revision '${pool.revisionId}'.`
      );
    }
    fungibilityByRevisionId.set(pool.revisionId, pool);
    fungibilityRevisions.push(pool);
  }
  fungibilityRevisions.sort(compareFungibilityRevision);

  const activeFungibilityById = new Map<
    InventoryFungibilityPoolId,
    InventoryFungibilityPoolDefinitionRevision
  >();
  const activeFungibilityRevisionIds: Record<
    string,
    InventoryFungibilityRevisionId
  > = {};
  const activePoolEntries = Object.entries(
    input.activeFungibilityRevisionIds ?? {}
  );
  for (const [poolId, revisionId] of activePoolEntries) {
    const pool = fungibilityByRevisionId.get(revisionId);
    if (pool === undefined) {
      throw new Error(
        `Active fungibility pool '${poolId}' references unknown revision '${revisionId}'.`
      );
    }
    if (pool.poolId !== poolId) {
      throw new Error(
        `Active fungibility revision '${revisionId}' belongs to another pool.`
      );
    }
    activeFungibilityById.set(poolId, pool);
    activeFungibilityRevisionIds[poolId] = revisionId;
  }
  const retainedPoolIds = new Set<InventoryFungibilityPoolId>();
  for (const pool of fungibilityRevisions) retainedPoolIds.add(pool.poolId);
  for (const poolId of retainedPoolIds) {
    if (!activeFungibilityById.has(poolId)) {
      throw new Error(
        `Inventory fungibility pool '${poolId}' has no active definition revision.`
      );
    }
  }

  return {
    itemRevisions: Object.freeze(itemRevisions),
    packagingRevisions: Object.freeze(packagingRevisions),
    itemByRevisionId,
    activeItemById,
    activeItemRevisionIds: Object.freeze(activeItemRevisionIds),
    packagingByRevisionId,
    compositionRevisions: Object.freeze(compositionRevisions),
    compositionByRevisionId,
    compositionBySourcePackagingRevisionId,
    activeCompositionById,
    activeCompositionRevisionIds: Object.freeze(activeCompositionRevisionIds),
    transformationRevisions: Object.freeze(transformationRevisions),
    transformationByRevisionId,
    activeTransformationById,
    activeTransformationRevisionIds: Object.freeze(
      activeTransformationRevisionIds
    ),
    collectionRevisions,
    collectionByRevisionId,
    activeCollectionById,
    activeCollectionRevisionIds: Object.freeze(activeCollectionRevisionIds),
    collectionItemRevisionIdsByRevisionId,
    fungibilityRevisions: Object.freeze(fungibilityRevisions),
    fungibilityByRevisionId,
    activeFungibilityById,
    activeFungibilityRevisionIds: Object.freeze(activeFungibilityRevisionIds),
  };
}

/** Return one collision-free complete catalogue fingerprint independent of caller object key order. */
function inventoryCatalogDigest(input: InventoryCatalogInput): string {
  const itemDigests = input.itemRevisions.map(inventoryItemRevisionDigest);
  itemDigests.sort();
  const packagingDigests = (input.packagingRevisions ?? []).map(
    inventoryPackagingRevisionDigest
  );
  packagingDigests.sort();
  const activeEntries = Object.entries(input.activeItemRevisionIds);
  activeEntries.sort(
    /** Sort active item entries before fingerprinting caller-owned record keys. */
    ([left], [right]) => compareInventoryIdentityText(left, right)
  );
  const compositionDigests = (input.compositionRevisions ?? []).map(
    inventoryCompositionRevisionDigest
  );
  compositionDigests.sort();
  const activeCompositionEntries = Object.entries(
    input.activeCompositionRevisionIds ?? {}
  );
  activeCompositionEntries.sort(
    /** Sort active composition entries before fingerprinting caller-owned keys. */
    ([left], [right]) => compareInventoryIdentityText(left, right)
  );
  const transformationDigests = (input.transformationRevisions ?? []).map(
    inventoryTransformationRevisionDigest
  );
  transformationDigests.sort();
  const activeTransformationEntries = Object.entries(
    input.activeTransformationRevisionIds ?? {}
  );
  activeTransformationEntries.sort(
    /** Sort active transformation entries before fingerprinting caller-owned keys. */
    ([left], [right]) => compareInventoryIdentityText(left, right)
  );
  const collectionDigests = (input.collectionRevisions ?? []).map(
    inventoryCollectionRevisionDigest
  );
  collectionDigests.sort();
  const activeCollectionEntries = Object.entries(
    input.activeCollectionRevisionIds ?? {}
  );
  activeCollectionEntries.sort(
    /** Sort active collection entries before fingerprinting caller-owned keys. */
    ([left], [right]) => compareInventoryIdentityText(left, right)
  );
  const fungibilityDigests = (input.fungibilityRevisions ?? []).map(
    inventoryFungibilityRevisionDigest
  );
  fungibilityDigests.sort();
  const activeFungibilityEntries = Object.entries(
    input.activeFungibilityRevisionIds ?? {}
  );
  activeFungibilityEntries.sort(
    /** Sort active fungibility entries before fingerprinting caller-owned record keys. */
    ([left], [right]) => compareInventoryIdentityText(left, right)
  );
  const fingerprintParts: InventoryIntentFingerprintValue[] = [
    itemDigests,
    activeEntries.map(
      /** Turn one active item row into stable fingerprint parts. */
      ([itemId, revisionId]) => [itemId, revisionId]
    ),
    packagingDigests,
    compositionDigests,
    activeCompositionEntries.map(
      /** Turn one active composition row into stable fingerprint parts. */
      ([compositionId, revisionId]) => [compositionId, revisionId]
    ),
    collectionDigests,
    activeCollectionEntries.map(
      /** Turn one active collection row into stable fingerprint parts. */
      ([collectionId, revisionId]) => [collectionId, revisionId]
    ),
    fungibilityDigests,
    activeFungibilityEntries.map(
      /** Turn one active pool row into stable fingerprint parts. */
      ([poolId, revisionId]) => [poolId, revisionId]
    ),
  ];
  // Old durable catalogues did not have transformation-definition fields. Keep their digest
  // byte-for-byte stable when the new family is empty, then append the new family when present.
  if (
    transformationDigests.length !== 0 ||
    activeTransformationEntries.length !== 0
  ) {
    fingerprintParts.push(
      transformationDigests,
      activeTransformationEntries.map(
        /** Turn one active transformation row into stable fingerprint parts. */
        ([transformationId, revisionId]) => [transformationId, revisionId]
      )
    );
  }
  return inventorySha256(inventoryIntentFingerprint(fingerprintParts));
}

/** Fingerprint every field whose change would reinterpret one retained item revision. */
function inventoryItemRevisionDigest(
  item: InventoryItemDefinitionRevision
): string {
  return inventorySha256(
    inventoryIntentFingerprint([
      item.itemId,
      item.revisionId,
      measurementAxisDefinitionDigest(item.primaryAxis),
      item.independentAxes.map(measurementAxisDefinitionDigest),
      item.reservationAxisId,
      item.tracking.lot,
      item.tracking.serial,
      item.qualifiedDimensions.map(
        /** Keep each exact allowed dimension id and description in the revision content. */
        (dimension) => [dimension.dimensionId, dimension.description]
      ),
      stringRecordDigest(item.identifiers),
      inventoryMetadataFingerprint(item.metadata),
    ])
  );
}

/** Fingerprint every field whose change would reinterpret one retained package revision. */
function inventoryPackagingRevisionDigest(
  packaging: InventoryPackagingDefinitionRevision
): string {
  return inventorySha256(
    inventoryIntentFingerprint([
      packaging.revisionId,
      packaging.itemId,
      packaging.itemRevisionId,
      packaging.packageUnit,
      inventoryMeasurementsFingerprint(packaging.fixedContents),
      packaging.innerPackage === undefined
        ? null
        : [
            packaging.innerPackage.packagingRevisionId,
            packaging.innerPackage.count,
          ],
      stringRecordDigest(packaging.identifiers),
      inventoryMetadataFingerprint(packaging.metadata),
    ])
  );
}

/** Fingerprint every field whose change would reinterpret one composition revision. */
function inventoryCompositionRevisionDigest(
  composition: InventoryCompositionDefinitionRevision
): string {
  return inventorySha256(
    inventoryIntentFingerprint([
      composition.compositionId,
      composition.revisionId,
      composition.sourcePackagingRevisionId,
      composition.outputs.map(
        /** Keep one exact output identity/item/amount in composition meaning. */
        (output) => [
          output.outputId,
          output.itemRevisionId,
          output.amount.kind,
          output.lotPolicy,
          output.amount.kind === InventoryCompositionOutputAmountKind.Measured
            ? inventoryMeasurementsFingerprint(output.amount.measurements)
            : [output.amount.packagingRevisionId, output.amount.packageCount],
          inventoryMetadataFingerprint(output.metadata),
        ]
      ),
      stringRecordDigest(composition.identifiers),
      inventoryMetadataFingerprint(composition.metadata),
    ])
  );
}

/** Fingerprint every field whose change would reinterpret one transformation definition revision. */
function inventoryTransformationRevisionDigest(
  definition: InventoryTransformationDefinitionRevision
): string {
  /** Turn one exact line into immutable transformation-meaning fingerprint parts. */
  const lineDigest = (line: InventoryTransformationDefinitionLine) => [
    line.lineId,
    line.itemRevisionId,
    inventoryMeasurementsFingerprint(line.amount),
    inventoryMetadataFingerprint(line.metadata),
  ];
  return inventorySha256(
    inventoryIntentFingerprint([
      definition.transformationId,
      definition.revisionId,
      definition.inputs.map(lineDigest),
      definition.outputs.map(lineDigest),
      stringRecordDigest(definition.identifiers),
      inventoryMetadataFingerprint(definition.metadata),
    ])
  );
}

/** Fingerprint every field whose change would reinterpret one read-only collection revision. */
function inventoryCollectionRevisionDigest(
  collection: InventoryCollectionDefinitionRevision
): string {
  return inventorySha256(
    inventoryIntentFingerprint([
      collection.collectionId,
      collection.revisionId,
      collection.members.map(
        /** Keep exact member kind and revision identity. */
        (member) => [member.kind, member.revisionId]
      ),
      (collection.rollups ?? []).map(
        /** Keep exact read-only scalar conversion semantics. */
        (rollup) => [
          rollup.rollupId,
          rollup.basisAxisId,
          rollup.basisUnit,
          rollup.members.map(
            /** Keep one exact member-axis/reference conversion. */
            (member) => [
              member.itemRevisionId,
              member.measurementAxisId,
              quantityDefinitionDigest(member.memberQuantity),
              quantityDefinitionDigest(member.rollupQuantity),
            ]
          ),
        ]
      ),
      stringRecordDigest(collection.identifiers),
      inventoryMetadataFingerprint(collection.metadata),
    ])
  );
}

/** Fingerprint every field whose change would reinterpret one retained fungibility revision. */
function inventoryFungibilityRevisionDigest(
  pool: InventoryFungibilityPoolDefinitionRevision
): string {
  return inventorySha256(
    inventoryIntentFingerprint([
      pool.poolId,
      pool.revisionId,
      pool.basisAxisId,
      pool.basisUnit,
      pool.members.map(
        /** Keep one exact member revision/axis/reference equivalence in pool meaning. */
        (member) => [
          member.itemRevisionId,
          member.measurementAxisId,
          quantityDefinitionDigest(member.memberQuantity),
          quantityDefinitionDigest(member.poolQuantity),
        ]
      ),
      stringRecordDigest(pool.identifiers),
      inventoryMetadataFingerprint(pool.metadata),
    ])
  );
}

/** Stable exact quantity fingerprint used inside retained catalogue definitions. */
function quantityDefinitionDigest(value: Quantity): string {
  return inventoryIntentFingerprint([
    value.amountMinor,
    value.decimals,
    value.unit,
  ]);
}

/** Fingerprint one measurement-axis definition used inside an item revision. */
function measurementAxisDefinitionDigest(
  axis: InventoryMeasurementAxisDefinition
): string {
  return inventoryIntentFingerprint([
    axis.axisId,
    axis.role,
    axis.unit,
    axis.requirement,
  ]);
}

/** Fingerprint one optional string map without depending on caller key insertion order. */
function stringRecordDigest(
  values: Readonly<Record<string, string>> | undefined
): string {
  if (values === undefined) return "";
  const entries = Object.entries(values);
  entries.sort(
    /** Sort external identifier keys before adding them to revision meaning. */
    ([left], [right]) => compareInventoryIdentityText(left, right)
  );
  return inventoryIntentFingerprint(entries);
}

/** Copy and freeze one item revision so later caller mutation cannot reinterpret retained facts. */
function cloneAndFreezeInventoryItemRevision(
  item: InventoryItemDefinitionRevision
): InventoryItemDefinitionRevision {
  const primaryAxis = Object.freeze({ ...item.primaryAxis });
  const independentAxes = Object.freeze(
    item.independentAxes.map(
      /** Copy and freeze one independently measured axis. */
      (axis) => Object.freeze({ ...axis })
    )
  );
  const tracking = Object.freeze({ ...item.tracking });
  const qualifiedDimensions = Object.freeze(
    item.qualifiedDimensions.map(
      /** Copy and freeze one configured extra stock dimension. */
      (dimension) => Object.freeze({ ...dimension })
    )
  );
  const identifiers = cloneAndFreezeInventoryIdentifiers(item.identifiers);
  const metadata = cloneAndFreezeInventoryMetadata(item.metadata);
  return Object.freeze({
    itemId: item.itemId,
    revisionId: item.revisionId,
    primaryAxis,
    independentAxes,
    reservationAxisId: item.reservationAxisId,
    tracking,
    qualifiedDimensions,
    ...(identifiers === undefined ? {} : { identifiers }),
    ...(metadata === undefined ? {} : { metadata }),
  });
}

/** Copy and freeze one exact quantity without retaining a caller-owned object alias. */
function cloneAndFreezeQuantity(value: Quantity): Quantity {
  return Object.freeze(
    quantity({
      amountMinor: value.amountMinor,
      decimals: value.decimals,
      unit: value.unit,
    })
  );
}

/** Copy and freeze one heterogeneous composition revision and every output value. */
function cloneAndFreezeInventoryCompositionRevision(
  composition: InventoryCompositionDefinitionRevision
): InventoryCompositionDefinitionRevision {
  const outputs = Object.freeze(
    composition.outputs.map(
      /** Copy one exact output amount without retaining caller aliases. */
      (output): InventoryCompositionOutputDefinition => {
        const amount: InventoryCompositionOutputAmount =
          output.amount.kind === InventoryCompositionOutputAmountKind.Measured
            ? Object.freeze({
                kind: InventoryCompositionOutputAmountKind.Measured,
                measurements: cloneAndFreezeInventoryMeasurements(
                  output.amount.measurements
                ),
              })
            : Object.freeze({
                kind: InventoryCompositionOutputAmountKind.Package,
                packagingRevisionId: output.amount.packagingRevisionId,
                packageCount: output.amount.packageCount,
              });
        const metadata = cloneAndFreezeInventoryMetadata(output.metadata);
        return Object.freeze({
          outputId: output.outputId,
          itemRevisionId: output.itemRevisionId,
          amount,
          lotPolicy: output.lotPolicy,
          ...(metadata === undefined ? {} : { metadata }),
        });
      }
    )
  );
  const identifiers = cloneAndFreezeInventoryIdentifiers(
    composition.identifiers
  );
  const metadata = cloneAndFreezeInventoryMetadata(composition.metadata);
  return Object.freeze({
    compositionId: composition.compositionId,
    revisionId: composition.revisionId,
    sourcePackagingRevisionId: composition.sourcePackagingRevisionId,
    outputs,
    ...(identifiers === undefined ? {} : { identifiers }),
    ...(metadata === undefined ? {} : { metadata }),
  });
}

/** Copy and freeze one read-only collection revision and every nested conversion value. */
function cloneAndFreezeInventoryCollectionRevision(
  collection: InventoryCollectionDefinitionRevision
): InventoryCollectionDefinitionRevision {
  const members = Object.freeze(
    collection.members.map(
      /** Copy one exact item/nested-collection member reference. */
      (member) =>
        Object.freeze({
          kind: member.kind,
          revisionId: member.revisionId,
        })
    )
  );
  const rollups =
    collection.rollups === undefined
      ? undefined
      : Object.freeze(
          collection.rollups.map(
            /** Copy one explicit read-only roll-up and its exact member conversions. */
            (rollup) =>
              Object.freeze({
                rollupId: rollup.rollupId,
                basisAxisId: rollup.basisAxisId,
                basisUnit: rollup.basisUnit,
                members: Object.freeze(
                  rollup.members.map(
                    /** Copy one exact member-to-basis reference conversion. */
                    (member) =>
                      Object.freeze({
                        itemRevisionId: member.itemRevisionId,
                        measurementAxisId: member.measurementAxisId,
                        memberQuantity: cloneAndFreezeQuantity(
                          member.memberQuantity
                        ),
                        rollupQuantity: cloneAndFreezeQuantity(
                          member.rollupQuantity
                        ),
                      })
                  )
                ),
              })
          )
        );
  const identifiers = cloneAndFreezeInventoryIdentifiers(
    collection.identifiers
  );
  const metadata = cloneAndFreezeInventoryMetadata(collection.metadata);
  return Object.freeze({
    collectionId: collection.collectionId,
    revisionId: collection.revisionId,
    members,
    ...(rollups === undefined ? {} : { rollups }),
    ...(identifiers === undefined ? {} : { identifiers }),
    ...(metadata === undefined ? {} : { metadata }),
  });
}

/** Copy and freeze one fungibility revision plus every member/reference value. */
function cloneAndFreezeInventoryFungibilityRevision(
  pool: InventoryFungibilityPoolDefinitionRevision
): InventoryFungibilityPoolDefinitionRevision {
  const members = Object.freeze(
    pool.members.map(
      /** Copy one exact member conversion without retaining nested caller aliases. */
      (member) =>
        Object.freeze({
          itemRevisionId: member.itemRevisionId,
          measurementAxisId: member.measurementAxisId,
          memberQuantity: cloneAndFreezeQuantity(member.memberQuantity),
          poolQuantity: cloneAndFreezeQuantity(member.poolQuantity),
        })
    )
  );
  const identifiers = cloneAndFreezeInventoryIdentifiers(pool.identifiers);
  const metadata = cloneAndFreezeInventoryMetadata(pool.metadata);
  return Object.freeze({
    poolId: pool.poolId,
    revisionId: pool.revisionId,
    basisAxisId: pool.basisAxisId,
    basisUnit: pool.basisUnit,
    members,
    ...(identifiers === undefined ? {} : { identifiers }),
    ...(metadata === undefined ? {} : { metadata }),
  });
}

/** Copy and freeze one package revision plus every nested measurement/package/source value. */
function cloneAndFreezeInventoryPackagingRevision(
  packaging: InventoryPackagingDefinitionRevision
): InventoryPackagingDefinitionRevision {
  const fixedContents = cloneAndFreezeInventoryMeasurements(
    packaging.fixedContents
  );
  const innerPackage =
    packaging.innerPackage === undefined
      ? undefined
      : Object.freeze({ ...packaging.innerPackage });
  const identifiers = cloneAndFreezeInventoryIdentifiers(packaging.identifiers);
  const metadata = cloneAndFreezeInventoryMetadata(packaging.metadata);
  return Object.freeze({
    revisionId: packaging.revisionId,
    itemId: packaging.itemId,
    itemRevisionId: packaging.itemRevisionId,
    packageUnit: packaging.packageUnit,
    fixedContents,
    ...(innerPackage === undefined ? {} : { innerPackage }),
    ...(identifiers === undefined ? {} : { identifiers }),
    ...(metadata === undefined ? {} : { metadata }),
  });
}

/** Copy and freeze one exact measurement vector without retaining any caller array/object alias. */
function cloneAndFreezeInventoryMeasurements(
  measurements: InventoryMeasurementVector
): InventoryMeasurementVector {
  const primary = Object.freeze({
    axisId: measurements.primary.axisId,
    quantity: Object.freeze({ ...measurements.primary.quantity }),
  });
  const independent = Object.freeze(
    measurements.independent.map(
      /** Copy and freeze one independently measured value. */
      (measured) =>
        Object.freeze({
          axisId: measured.axisId,
          quantity: Object.freeze({ ...measured.quantity }),
        })
    )
  );
  return Object.freeze({ primary, independent });
}

/** Copy and freeze one optional external-identifier map. */
function cloneAndFreezeInventoryIdentifiers(
  identifiers: Readonly<Record<string, string>> | undefined
): Readonly<Record<string, string>> | undefined {
  return identifiers === undefined
    ? undefined
    : Object.freeze({ ...identifiers });
}

/** Copy and freeze optional JSON-safe metadata all the way down. */
function cloneAndFreezeInventoryMetadata(
  metadata: InventoryMetadata | undefined
): InventoryMetadata | undefined {
  if (metadata === undefined) return undefined;
  const result: Record<string, InventoryMetadataValue> = {};
  for (const [key, value] of Object.entries(metadata)) {
    Object.defineProperty(result, key, {
      value: cloneAndFreezeInventoryMetadataValue(value),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return Object.freeze(result);
}

/** Copy and freeze one recursive JSON-safe metadata value. */
function cloneAndFreezeInventoryMetadataValue(
  value: InventoryMetadataValue
): InventoryMetadataValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Inventory metadata numbers must be finite.");
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneAndFreezeInventoryMetadataValue));
  }
  const result: Record<string, InventoryMetadataValue> = {};
  for (const [key, child] of Object.entries(value)) {
    Object.defineProperty(result, key, {
      value: cloneAndFreezeInventoryMetadataValue(child),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return Object.freeze(result);
}

/** Validate/normalize one complete retained catalogue and freeze every cross-reference. */
export function defineInventoryCatalog(
  input: InventoryCatalogInput
): InventoryCatalog {
  return InventoryCatalog.define(input);
}

/**
 * Append immutable definitions and optionally move active pointers without mutating the old catalogue.
 * Repeating an identical revision is a no-op; redefining an existing revision identity fails closed.
 */
export function extendInventoryCatalog({
  catalog,
  itemRevisions = [],
  activeItemRevisionIds = {},
  packagingRevisions = [],
  compositionRevisions = [],
  activeCompositionRevisionIds = {},
  transformationRevisions = [],
  activeTransformationRevisionIds = {},
  collectionRevisions = [],
  activeCollectionRevisionIds = {},
  fungibilityRevisions = [],
  activeFungibilityRevisionIds = {},
}: ExtendInventoryCatalogInput): InventoryCatalog {
  const extended = defineInventoryCatalog({
    itemRevisions: mergeInventoryCatalogRevisionFamily(
      catalog.itemRevisions,
      itemRevisions,
      /** Read one immutable item revision identity. */
      (revision) => revision.revisionId,
      inventoryItemRevisionDigest,
      "item"
    ),
    activeItemRevisionIds: {
      ...catalog.activeItemRevisionIds,
      ...activeItemRevisionIds,
    },
    packagingRevisions: mergeInventoryCatalogRevisionFamily(
      catalog.packagingRevisions,
      packagingRevisions,
      /** Read one immutable packaging revision identity. */
      (revision) => revision.revisionId,
      inventoryPackagingRevisionDigest,
      "packaging"
    ),
    compositionRevisions: mergeInventoryCatalogRevisionFamily(
      catalog.compositionRevisions,
      compositionRevisions,
      /** Read one immutable composition revision identity. */
      (revision) => revision.revisionId,
      inventoryCompositionRevisionDigest,
      "composition"
    ),
    activeCompositionRevisionIds: {
      ...catalog.activeCompositionRevisionIds,
      ...activeCompositionRevisionIds,
    },
    transformationRevisions: mergeInventoryCatalogRevisionFamily(
      catalog.transformationRevisions,
      transformationRevisions,
      /** Read one immutable transformation revision identity. */
      (revision) => revision.revisionId,
      inventoryTransformationRevisionDigest,
      "transformation"
    ),
    activeTransformationRevisionIds: {
      ...catalog.activeTransformationRevisionIds,
      ...activeTransformationRevisionIds,
    },
    collectionRevisions: mergeInventoryCatalogRevisionFamily(
      catalog.collectionRevisions,
      collectionRevisions,
      /** Read one immutable collection revision identity. */
      (revision) => revision.revisionId,
      inventoryCollectionRevisionDigest,
      "collection"
    ),
    activeCollectionRevisionIds: {
      ...catalog.activeCollectionRevisionIds,
      ...activeCollectionRevisionIds,
    },
    fungibilityRevisions: mergeInventoryCatalogRevisionFamily(
      catalog.fungibilityRevisions,
      fungibilityRevisions,
      /** Read one immutable fungibility revision identity. */
      (revision) => revision.revisionId,
      inventoryFungibilityRevisionDigest,
      "fungibility"
    ),
    activeFungibilityRevisionIds: {
      ...catalog.activeFungibilityRevisionIds,
      ...activeFungibilityRevisionIds,
    },
  });
  return extended.digest === catalog.digest ? catalog : extended;
}

/** Merge one immutable revision family while proving repeated identities retain identical meaning. */
function mergeInventoryCatalogRevisionFamily<T>(
  retained: readonly T[],
  appended: readonly T[],
  revisionId: (revision: T) => string,
  digest: (revision: T) => string,
  label: string
): readonly T[] {
  const byRevisionId = new Map<string, T>();
  for (const revision of retained) {
    byRevisionId.set(revisionId(revision), revision);
  }
  for (const revision of appended) {
    const id = revisionId(revision);
    const existing = byRevisionId.get(id);
    if (existing !== undefined) {
      if (digest(existing) !== digest(revision)) {
        throw new Error(
          `Inventory ${label} revision '${id}' cannot be redefined.`
        );
      }
      continue;
    }
    byRevisionId.set(id, revision);
  }
  return [...byRevisionId.values()];
}

/** Require one stock/event measurement vector to match a frozen item revision. */
export function assertMeasurementsMatchItem(
  item: InventoryItemDefinitionRevision,
  measurements: InventoryMeasurementVector,
  requireConfiguredAxes = true
): void {
  if (
    measurements.primary.axisId !== item.primaryAxis.axisId ||
    measurements.primary.quantity.unit !== item.primaryAxis.unit
  ) {
    throw new Error(
      `Item revision '${item.revisionId}' primary measurement must be ` +
        `'${item.primaryAxis.axisId}' in '${item.primaryAxis.unit}'.`
    );
  }
  const suppliedIndependentAxes = new Set<string>();
  for (const measured of measurements.independent) {
    const axis = findIndependentAxis(item, measured.axisId);
    if (axis === undefined) {
      throw new Error(
        `Item revision '${item.revisionId}' has no independent axis '${measured.axisId}'.`
      );
    }
    if (axis.unit !== measured.quantity.unit) {
      throw new Error(
        `Item axis '${measured.axisId}' must use '${axis.unit}', not '${measured.quantity.unit}'.`
      );
    }
    suppliedIndependentAxes.add(measured.axisId);
  }
  if (!requireConfiguredAxes) return;
  for (const axis of item.independentAxes) {
    if (
      axis.requirement === InventoryMeasurementRequirement.Required &&
      !suppliedIndependentAxes.has(axis.axisId)
    ) {
      throw new Error(
        `Required item measurement axis '${axis.axisId}' is missing.`
      );
    }
  }
}

/** Validate item tracking rules and allowed qualified dimensions for one position-like shape. */
export function assertPositionMatchesItem(
  item: InventoryItemDefinitionRevision,
  position: {
    /** Optional lot identity being validated. */
    readonly lotId?: string;
    /** Optional serial identity being validated. */
    readonly serialId?: string;
    /** Optional qualified dimensions being validated. */
    readonly qualifiedDimensions?: readonly {
      /** Dimension identity. */
      readonly dimensionId: InventoryDimensionId;
      /** Dimension value. */
      readonly valueId: string;
    }[];
  }
): void {
  assertTrackingRequirement("lot", item.tracking.lot, position.lotId);
  assertTrackingRequirement("serial", item.tracking.serial, position.serialId);
  const allowedDimensions = new Set<string>();
  for (const dimension of item.qualifiedDimensions) {
    allowedDimensions.add(dimension.dimensionId);
  }
  for (const dimension of position.qualifiedDimensions ?? []) {
    if (!allowedDimensions.has(dimension.dimensionId)) {
      throw new Error(
        `Item revision '${item.revisionId}' does not allow dimension '${dimension.dimensionId}'.`
      );
    }
  }
}

/** Check child-package composition, exact arithmetic, and package graph cycles. */
function validateInnerPackaging(
  revisions: readonly InventoryPackagingDefinitionRevision[],
  byId: ReadonlyMap<string, InventoryPackagingDefinitionRevision>
): void {
  for (const revision of revisions) {
    const inner = revision.innerPackage;
    if (inner === undefined) continue;
    const child = byId.get(inner.packagingRevisionId);
    if (child === undefined) {
      throw new Error(
        `Packaging revision '${revision.revisionId}' references unknown child '${inner.packagingRevisionId}'.`
      );
    }
    if (child.itemId !== revision.itemId) {
      throw new Error(
        "Nested package revisions must contain the same inventory item."
      );
    }
    // Matching units are not enough: an old package definition cannot silently become part of a new item revision.
    if (child.itemRevisionId !== revision.itemRevisionId) {
      throw new Error(
        "Nested package revisions must use the exact same item revision."
      );
    }
    const expected = multiplyInventoryMeasurementsByWholeNumber(
      child.fixedContents,
      inner.count
    );
    if (!inventoryMeasurementsEqual(revision.fixedContents, expected)) {
      throw new Error(
        `Packaging revision '${revision.revisionId}' fixed contents do not equal ` +
          `${inner.count} × child '${child.revisionId}'.`
      );
    }
  }
  for (const revision of revisions) {
    const seen = new Set<string>();
    let current: InventoryPackagingDefinitionRevision | undefined = revision;
    while (current !== undefined) {
      if (seen.has(current.revisionId)) {
        throw new Error(
          `Packaging revision graph contains a cycle at '${current.revisionId}'.`
        );
      }
      seen.add(current.revisionId);
      const childId: string | undefined =
        current.innerPackage?.packagingRevisionId;
      current = childId === undefined ? undefined : byId.get(childId);
    }
  }
}

/** Reject recursive heterogeneous package decompositions while permitting acyclic nested kits. */
function validateCompositionGraph(
  revisions: readonly InventoryCompositionDefinitionRevision[],
  bySourcePackagingRevisionId: ReadonlyMap<
    string,
    InventoryCompositionDefinitionRevision
  >
): void {
  const visited = new Set<string>();
  const visiting = new Set<string>();

  /** Visit one source package and every packaged output that itself has a composition. */
  const visit = (sourcePackagingRevisionId: string): void => {
    if (visited.has(sourcePackagingRevisionId)) return;
    if (visiting.has(sourcePackagingRevisionId)) {
      throw new Error(
        `Inventory composition graph contains a cycle at package '${sourcePackagingRevisionId}'.`
      );
    }
    const composition = bySourcePackagingRevisionId.get(
      sourcePackagingRevisionId
    );
    if (composition === undefined) return;
    visiting.add(sourcePackagingRevisionId);
    for (const output of composition.outputs) {
      if (output.amount.kind !== InventoryCompositionOutputAmountKind.Package) {
        continue;
      }
      visit(output.amount.packagingRevisionId);
    }
    visiting.delete(sourcePackagingRevisionId);
    visited.add(sourcePackagingRevisionId);
  };

  for (const revision of revisions) {
    visit(revision.sourcePackagingRevisionId);
  }
}

/** Require one item measurement-axis declaration to use the expected role and valid identity. */
function assertMeasurementAxis(
  axis: InventoryMeasurementAxisDefinition,
  expectedRole: InventoryMeasurementAxisRole
): void {
  assertInventoryIdentity(axis.axisId, "measurement axisId");
  if (axis.role !== expectedRole) {
    throw new Error(
      `Measurement axis '${axis.axisId}' must have role '${expectedRole}'.`
    );
  }
}

/** Return one exact item measurement axis or fail closed. */
function findItemMeasurementAxis(
  item: InventoryItemDefinitionRevision,
  axisId: InventoryMeasurementAxisId
): InventoryMeasurementAxisDefinition {
  if (item.primaryAxis.axisId === axisId) return item.primaryAxis;
  const independent = findIndependentAxis(item, axisId);
  if (independent === undefined) {
    throw new Error(
      `Item revision '${item.revisionId}' has no measurement axis '${axisId}'.`
    );
  }
  return independent;
}

/** Return one independently measured item axis when declared. */
function findIndependentAxis(
  item: InventoryItemDefinitionRevision,
  axisId: InventoryMeasurementAxisId
): InventoryMeasurementAxisDefinition | undefined {
  for (const axis of item.independentAxes) {
    if (axis.axisId === axisId) return axis;
  }
  return undefined;
}

/** Apply one required/optional/forbidden tracking rule to a supplied identity. */
function assertTrackingRequirement(
  label: string,
  requirement: InventoryTrackingRequirement,
  value: string | undefined
): void {
  if (
    requirement === InventoryTrackingRequirement.Required &&
    value === undefined
  ) {
    throw new Error(`Item requires ${label} identity.`);
  }
  if (
    requirement === InventoryTrackingRequirement.Forbidden &&
    value !== undefined
  ) {
    throw new Error(`Item forbids ${label} identity.`);
  }
}

/** Sort composition output lines by their stable output identity. */
function compareCompositionOutput(
  left: InventoryCompositionOutputDefinition,
  right: InventoryCompositionOutputDefinition
): number {
  return compareInventoryIdentityText(left.outputId, right.outputId);
}

/** Sort composition revisions by stable composition then exact revision identity. */
function compareCompositionRevision(
  left: InventoryCompositionDefinitionRevision,
  right: InventoryCompositionDefinitionRevision
): number {
  const compositionOrder = compareInventoryIdentityText(left.compositionId, right.compositionId);
  return compositionOrder === 0
    ? compareInventoryIdentityText(left.revisionId, right.revisionId)
    : compositionOrder;
}

/** Sort one transformation definition's exact line identities deterministically. */
function compareTransformationLine(
  left: InventoryTransformationDefinitionLine,
  right: InventoryTransformationDefinitionLine
): number {
  return compareInventoryIdentityText(left.lineId, right.lineId);
}

/** Sort transformation revisions by stable transformation then exact revision identity. */
function compareTransformationRevision(
  left: InventoryTransformationDefinitionRevision,
  right: InventoryTransformationDefinitionRevision
): number {
  const transformationOrder = compareInventoryIdentityText(left.transformationId, right.transformationId);
  return transformationOrder === 0
    ? compareInventoryIdentityText(left.revisionId, right.revisionId)
    : transformationOrder;
}

/** Sort read-only collection members by reference kind then exact revision identity. */
function compareCollectionMember(
  left: InventoryCollectionMemberDefinition,
  right: InventoryCollectionMemberDefinition
): number {
  const kindOrder = compareInventoryIdentityText(left.kind, right.kind);
  return kindOrder === 0
    ? compareInventoryIdentityText(left.revisionId, right.revisionId)
    : kindOrder;
}

/** Sort collection revisions by stable collection then exact revision identity. */
function compareCollectionRevision(
  left: InventoryCollectionDefinitionRevision,
  right: InventoryCollectionDefinitionRevision
): number {
  const collectionOrder = compareInventoryIdentityText(left.collectionId, right.collectionId);
  return collectionOrder === 0
    ? compareInventoryIdentityText(left.revisionId, right.revisionId)
    : collectionOrder;
}

/** Sort one collection roll-up's member conversions by exact item revision. */
function compareCollectionRollupMember(
  left: InventoryCollectionRollupMemberDefinition,
  right: InventoryCollectionRollupMemberDefinition
): number {
  return compareInventoryIdentityText(left.itemRevisionId, right.itemRevisionId);
}

/** Sort collection roll-ups by stable roll-up identity. */
function compareCollectionRollup(
  left: InventoryCollectionRollupDefinition,
  right: InventoryCollectionRollupDefinition
): number {
  return compareInventoryIdentityText(left.rollupId, right.rollupId);
}

/** Sort pool members by exact item revision identity. */
function compareFungibilityMember(
  left: InventoryFungibilityMemberDefinition,
  right: InventoryFungibilityMemberDefinition
): number {
  return compareInventoryIdentityText(left.itemRevisionId, right.itemRevisionId);
}

/** Sort fungibility revisions by stable pool then exact revision identity. */
function compareFungibilityRevision(
  left: InventoryFungibilityPoolDefinitionRevision,
  right: InventoryFungibilityPoolDefinitionRevision
): number {
  const poolOrder = compareInventoryIdentityText(left.poolId, right.poolId);
  return poolOrder === 0
    ? compareInventoryIdentityText(left.revisionId, right.revisionId)
    : poolOrder;
}

/** Sort item revisions by stable item then revision identity. */
function compareItemRevision(
  left: InventoryItemDefinitionRevision,
  right: InventoryItemDefinitionRevision
): number {
  const itemOrder = compareInventoryIdentityText(left.itemId, right.itemId);
  return itemOrder === 0
    ? compareInventoryIdentityText(left.revisionId, right.revisionId)
    : itemOrder;
}

/** Sort package revisions by stable item then revision identity. */
function comparePackagingRevision(
  left: InventoryPackagingDefinitionRevision,
  right: InventoryPackagingDefinitionRevision
): number {
  const itemOrder = compareInventoryIdentityText(left.itemId, right.itemId);
  return itemOrder === 0
    ? compareInventoryIdentityText(left.revisionId, right.revisionId)
    : itemOrder;
}

/** Sort measurement-axis definitions by stable axis identity. */
function compareMeasurementAxisDefinition(
  left: InventoryMeasurementAxisDefinition,
  right: InventoryMeasurementAxisDefinition
): number {
  return compareInventoryIdentityText(left.axisId, right.axisId);
}

/** Sort extra dimension definitions by stable dimension identity. */
function compareDimensionDefinition(
  left: InventoryDimensionDefinition,
  right: InventoryDimensionDefinition
): number {
  return compareInventoryIdentityText(left.dimensionId, right.dimensionId);
}
