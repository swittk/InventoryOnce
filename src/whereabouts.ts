import { compareInventoryIdentityText } from "./ordering.js";
import {
  InventoryEventKind,
  type InventoryCommittedEvent,
} from "./events.js";
import {
  InventoryStockWhereaboutsState,
  inventoryStockPositionIdentity,
  type InventoryStockPosition,
} from "./model.js";
import type { InventoryProjectionState } from "./projection.js";
import { inventorySparseRecordValue } from "./sparse-record.js";

/** Physical/lifecycle meaning one retained event has for a whereabouts cohort. */
export enum InventoryWhereaboutsAction {
  /** Stock intentionally ceased to have a direct placement while remaining inventory. */
  Detached = "detached",
  /** Stock became genuinely missing while remaining accounted-for inventory. */
  MarkedMissing = "marked-missing",
  /** Detached or missing stock regained one known direct placement. */
  Placed = "placed",
  /** Stock in this cohort left the inventory world through issue/dispense/use. */
  Issued = "issued",
  /** Stock in this cohort was explicitly destroyed/discarded. */
  Scrapped = "scrapped",
  /** A physical count changed the accounted quantity in this cohort. */
  CountAdjusted = "count-adjusted",
  /** An append-only correction changed the retained interpretation of this cohort. */
  Corrected = "corrected",
  /** Another conserved dimension change affected this cohort without resolving it. */
  Reclassified = "reclassified",
}

/** One retained event and its exact physical meaning for a single whereabouts cohort. */
export interface InventoryWhereaboutsHistoryEvent {
  /** Complete immutable event retaining actor, source reference, reason, and exact effects. */
  readonly event: InventoryCommittedEvent;
  /** Cohort-specific meanings derived from the event's exact conserved movement. */
  readonly actions: readonly InventoryWhereaboutsAction[];
}

/** Complete append-only history plus any current stock for one whereabouts cohort. */
export interface InventoryWhereaboutsLifecycle {
  /** Stable kernel-owned identity shared by every unresolved split of this cohort. */
  readonly whereaboutsId: string;
  /** Item identities that have participated in this cohort's retained history. */
  readonly itemIds: readonly string[];
  /** Current unresolved stock rows; empty means the cohort is fully resolved. */
  readonly currentPositions: readonly InventoryStockPosition[];
  /** First retained event that introduced this lifecycle identity. */
  readonly originEvent: InventoryCommittedEvent;
  /** Every retained event touching/correcting this cohort in durable sequence order. */
  readonly history: readonly InventoryWhereaboutsHistoryEvent[];
  /** Whether no current detached/missing stock remains for this cohort. */
  readonly resolved: boolean;
}

/** Filters for append-only whereabouts lifecycle/history reads. */
export interface InventoryWhereaboutsHistoryQuery {
  /** Optional exact lifecycle identities. */
  readonly whereaboutsIds?: readonly string[];
  /** Optional item identities that must occur in the lifecycle. */
  readonly itemIds?: readonly string[];
  /** Optional physical outcomes/actions that must occur in retained history. */
  readonly actions?: readonly InventoryWhereaboutsAction[];
  /** Optional resolution state; omission returns current and resolved lifecycles. */
  readonly resolved?: boolean;
}

/** Build indexed whereabouts lifecycles from retained cohort event sequences plus current stock. */
export function inventoryWhereaboutsLifecycles(
  projection: InventoryProjectionState,
  onlyWhereaboutsIds?: ReadonlySet<string>
): readonly InventoryWhereaboutsLifecycle[] {
  /** Cohort ids selected directly from the rebuildable projection index. */
  const lifecycleIds =
    onlyWhereaboutsIds === undefined
      ? Object.keys(projection.eventSequencesByWhereaboutsId)
      : [...onlyWhereaboutsIds];
  lifecycleIds.sort(compareInventoryIdentityText);
  /** Mutable history/item accumulator keyed by exact lifecycle identity. */
  const builders = new Map<
    string,
    {
      /** Retained event records in durable sequence order. */
      readonly history: InventoryWhereaboutsHistoryEvent[];
      /** Every item identity named by those retained events. */
      readonly itemIds: Set<string>;
      /** Current unresolved rows added after indexed history replay. */
      readonly currentPositions: InventoryStockPosition[];
    }
  >();
  for (const whereaboutsId of lifecycleIds) {
    const sequences =
      inventorySparseRecordValue(
        projection.eventSequencesByWhereaboutsId,
        whereaboutsId
      ) ?? [];
    if (sequences.length === 0) continue;
    const builder = {
      history: [] as InventoryWhereaboutsHistoryEvent[],
      itemIds: new Set<string>(),
      currentPositions: [] as InventoryStockPosition[],
    };
    for (const sequence of sequences) {
      const eventId = projection.eventIdsBySequence[String(sequence)];
      if (eventId === undefined) {
        throw new Error(
          "Whereabouts history is missing indexed event sequence " +
            String(sequence) +
            "."
        );
      }
      const event = inventorySparseRecordValue(projection.events, eventId);
      if (event === undefined || event.recordSequence !== sequence) {
        throw new Error(
          "Whereabouts history index disagrees at event sequence " +
            String(sequence) +
            "."
        );
      }
      builder.history.push({
        event,
        actions: inventoryWhereaboutsActionsForEvent(event, whereaboutsId),
      });
      for (const itemId of inventoryItemIdsTouchedByWhereaboutsEvent(
        projection,
        event,
        whereaboutsId
      )) {
        builder.itemIds.add(itemId);
      }
    }
    builders.set(whereaboutsId, builder);
  }
  /** Candidate rows for these cohorts, without enumerating unrelated item positions. */
  let candidatePositions: readonly InventoryStockPosition[];
  if (onlyWhereaboutsIds === undefined) {
    candidatePositions = Object.values(projection.positions);
  } else {
    const selectedPositionIds = new Set<string>();
    const selectedPositions: InventoryStockPosition[] = [];
    for (const builder of builders.values()) {
      for (const itemId of builder.itemIds) {
        const positionIds =
          inventorySparseRecordValue(projection.positionIdsByItemId, itemId) ?? [];
        for (const positionId of positionIds) {
          if (selectedPositionIds.has(positionId)) continue;
          selectedPositionIds.add(positionId);
          const position = inventorySparseRecordValue(
            projection.positions,
            positionId
          );
          if (position === undefined) {
            throw new Error(
              "Whereabouts item-position index references a missing current stock row."
            );
          }
          selectedPositions.push(position);
        }
      }
    }
    candidatePositions = selectedPositions;
  }
  for (const position of candidatePositions) {
    const whereaboutsId = position.key.whereaboutsId;
    if (
      whereaboutsId === undefined ||
      (onlyWhereaboutsIds !== undefined &&
        !onlyWhereaboutsIds.has(whereaboutsId))
    ) {
      continue;
    }
    const builder = builders.get(whereaboutsId);
    if (builder === undefined) {
      throw new Error(
        "Current whereabouts '" +
          whereaboutsId +
          "' has no retained originating event."
      );
    }
    builder.itemIds.add(position.key.itemId);
    builder.currentPositions.push(position);
  }
  const result: InventoryWhereaboutsLifecycle[] = [];
  for (const [whereaboutsId, builder] of builders) {
    const origin = builder.history[0]?.event;
    if (origin === undefined) {
      throw new Error(
        "Whereabouts '" + whereaboutsId + "' has no retained origin event."
      );
    }
    builder.currentPositions.sort(compareInventoryWhereaboutsPosition);
    const itemIds = [...builder.itemIds];
    itemIds.sort(compareInventoryIdentityText);
    result.push({
      whereaboutsId,
      itemIds,
      currentPositions: builder.currentPositions,
      originEvent: origin,
      history: builder.history,
      resolved: builder.currentPositions.length === 0,
    });
  }
  result.sort(compareInventoryWhereaboutsLifecycle);
  return result;
}

/** Filter complete lifecycle history without rescanning application-owned storage. */
export function findInventoryWhereaboutsHistory(
  projection: InventoryProjectionState,
  query: InventoryWhereaboutsHistoryQuery = {}
): readonly InventoryWhereaboutsLifecycle[] {
  const whereaboutsIds = normalizeOptionalWhereaboutsFilter(
    query.whereaboutsIds,
    "whereaboutsIds"
  );
  const itemIds = normalizeOptionalWhereaboutsFilter(query.itemIds, "itemIds");
  const actions =
    query.actions === undefined
      ? undefined
      : normalizeWhereaboutsActions(query.actions);
  const result: InventoryWhereaboutsLifecycle[] = [];
  for (const lifecycle of inventoryWhereaboutsLifecycles(
    projection,
    whereaboutsIds
  )) {
    if (
      whereaboutsIds !== undefined &&
      !whereaboutsIds.has(lifecycle.whereaboutsId)
    ) {
      continue;
    }
    if (
      itemIds !== undefined &&
      !lifecycle.itemIds.some(
        /** Match one lifecycle item against the requested identity set. */
        (itemId) => itemIds.has(itemId)
      )
    ) {
      continue;
    }
    if (query.resolved !== undefined && lifecycle.resolved !== query.resolved) {
      continue;
    }
    if (
      actions !== undefined &&
      !lifecycle.history.some(
        /** Match at least one retained event action against the requested outcomes. */
        (entry) =>
          entry.actions.some(
            /** Match one retained action against the requested action filter. */
            (action) => actions.has(action)
          )
      )
    ) {
      continue;
    }
    result.push(lifecycle);
  }
  return result;
}

/** Return every item identity directly touched by one whereabouts event/correction root. */
function inventoryItemIdsTouchedByWhereaboutsEvent(
  projection: InventoryProjectionState,
  event: InventoryCommittedEvent,
  whereaboutsId: string
): ReadonlySet<string> {
  const result = new Set<string>();
  addDirectInventoryItemIds(result, event, whereaboutsId);
  if (event.correction !== undefined) {
    const corrected = inventorySparseRecordValue(
      projection.events,
      event.correction.correctsEventId
    );
    if (corrected !== undefined) {
      addDirectInventoryItemIds(result, corrected, whereaboutsId);
    }
  }
  return result;
}

/** Add item identities from stock/provenance evidence belonging to one exact cohort. */
function addDirectInventoryItemIds(
  result: Set<string>,
  event: InventoryCommittedEvent,
  whereaboutsId: string
): void {
  for (const effect of event.stockEffects) {
    if (effect.position.whereaboutsId === whereaboutsId) {
      result.add(effect.position.itemId);
    }
  }
  for (const transfer of event.positiveLayerProvenanceTransfers ?? []) {
    if (transfer.from.whereaboutsId === whereaboutsId) {
      result.add(transfer.from.itemId);
    }
    if (transfer.to.whereaboutsId === whereaboutsId) {
      result.add(transfer.to.itemId);
    }
  }
  for (const override of event.positiveLayerProvenanceOverrides ?? []) {
    if (override.position.whereaboutsId === whereaboutsId) {
      result.add(override.position.itemId);
    }
  }
}

/** Derive one event's physical meaning for an exact whereabouts lifecycle identity. */
function inventoryWhereaboutsActionsForEvent(
  event: InventoryCommittedEvent,
  whereaboutsId: string
): readonly InventoryWhereaboutsAction[] {
  const actions = new Set<InventoryWhereaboutsAction>();
  if (event.kind === InventoryEventKind.Correction) {
    actions.add(InventoryWhereaboutsAction.Corrected);
    return [...actions];
  }
  const hasNegativeEffect = event.stockEffects.some(
    /** Match one outbound effect from this exact unresolved cohort. */
    (effect) =>
      effect.position.whereaboutsId === whereaboutsId &&
      effect.measurementsDelta.primary.quantity.amountMinor < 0
  );
  if (event.kind === InventoryEventKind.Issue && hasNegativeEffect) {
    actions.add(InventoryWhereaboutsAction.Issued);
  }
  if (event.kind === InventoryEventKind.Scrap && hasNegativeEffect) {
    actions.add(InventoryWhereaboutsAction.Scrapped);
  }
  if (
    event.kind === InventoryEventKind.CountAdjustment &&
    event.stockEffects.some(
      /** Match one counted row in this exact unresolved cohort. */
      (effect) => effect.position.whereaboutsId === whereaboutsId
    )
  ) {
    actions.add(InventoryWhereaboutsAction.CountAdjusted);
  }
  for (const transfer of event.positiveLayerProvenanceTransfers ?? []) {
    const fromId = transfer.from.whereaboutsId;
    const toId = transfer.to.whereaboutsId;
    if (toId === whereaboutsId && fromId !== whereaboutsId) {
      if (
        transfer.to.whereaboutsState ===
        InventoryStockWhereaboutsState.Detached
      ) {
        actions.add(InventoryWhereaboutsAction.Detached);
      } else if (
        transfer.to.whereaboutsState === InventoryStockWhereaboutsState.Missing
      ) {
        actions.add(InventoryWhereaboutsAction.MarkedMissing);
      }
    } else if (fromId === whereaboutsId && toId === whereaboutsId) {
      if (
        transfer.to.whereaboutsState === InventoryStockWhereaboutsState.Missing &&
        transfer.from.whereaboutsState !== InventoryStockWhereaboutsState.Missing
      ) {
        actions.add(InventoryWhereaboutsAction.MarkedMissing);
      } else {
        actions.add(InventoryWhereaboutsAction.Reclassified);
      }
    } else if (fromId === whereaboutsId && toId !== whereaboutsId) {
      if (transfer.to.placementNodeId !== undefined) {
        actions.add(InventoryWhereaboutsAction.Placed);
      } else {
        actions.add(InventoryWhereaboutsAction.Reclassified);
      }
    }
  }
  if (actions.size === 0) {
    const createsCohortDirectly =
      event.kind === InventoryEventKind.Opening ||
      event.kind === InventoryEventKind.Receipt;
    const positiveUnresolved = createsCohortDirectly
      ? event.stockEffects.find(
          /** Find an unresolved destination when an opening/import created the cohort directly. */
          (effect) =>
            effect.position.whereaboutsId === whereaboutsId &&
            effect.measurementsDelta.primary.quantity.amountMinor > 0
        )?.position
      : undefined;
    if (
      positiveUnresolved?.whereaboutsState ===
      InventoryStockWhereaboutsState.Detached
    ) {
      actions.add(InventoryWhereaboutsAction.Detached);
    } else if (
      positiveUnresolved?.whereaboutsState ===
      InventoryStockWhereaboutsState.Missing
    ) {
      actions.add(InventoryWhereaboutsAction.MarkedMissing);
    } else {
      actions.add(InventoryWhereaboutsAction.Reclassified);
    }
  }
  const ordered = [...actions];
  ordered.sort(compareInventoryIdentityText);
  return ordered;
}

/** Normalize one optional identity set and reject ambiguous empty filters. */
function normalizeOptionalWhereaboutsFilter(
  values: readonly string[] | undefined,
  label: string
): ReadonlySet<string> | undefined {
  if (values === undefined) return undefined;
  if (values.length === 0) {
    throw new Error(`Whereabouts history ${label} must be omitted instead of empty.`);
  }
  const result = new Set<string>();
  for (const value of values) {
    if (
      typeof value !== "string" ||
      value.trim().length === 0 ||
      value !== value.trim()
    ) {
      throw new Error(
        `Whereabouts history ${label} contains an invalid identity.`
      );
    }
    result.add(value);
  }
  return result;
}

/** Normalize one action filter and reject empty/unknown runtime values. */
function normalizeWhereaboutsActions(
  values: readonly InventoryWhereaboutsAction[]
): ReadonlySet<InventoryWhereaboutsAction> {
  if (values.length === 0) {
    throw new Error("Whereabouts history actions must be omitted instead of empty.");
  }
  const supported = new Set<InventoryWhereaboutsAction>(
    Object.values(InventoryWhereaboutsAction)
  );
  const result = new Set<InventoryWhereaboutsAction>();
  for (const value of values) {
    if (!supported.has(value)) {
      throw new Error(
        `Whereabouts history contains unknown action '${String(value)}'.`
      );
    }
    result.add(value);
  }
  return result;
}

/** Stable current-position ordering inside one lifecycle. */
function compareInventoryWhereaboutsPosition(
  left: InventoryStockPosition,
  right: InventoryStockPosition
): number {
  return compareInventoryIdentityText(
    inventoryStockPositionIdentity(left.key),
    inventoryStockPositionIdentity(right.key)
  );
}

/** Stable lifecycle ordering by first durable occurrence, then exact identity. */
function compareInventoryWhereaboutsLifecycle(
  left: InventoryWhereaboutsLifecycle,
  right: InventoryWhereaboutsLifecycle
): number {
  const bySequence =
    left.originEvent.recordSequence - right.originEvent.recordSequence;
  if (bySequence !== 0) return bySequence;
  return compareInventoryIdentityText(left.whereaboutsId, right.whereaboutsId);
}
