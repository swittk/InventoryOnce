import type { InventoryCatalog } from "./catalog.js";
import { inventoryEventIdForOperation, type InventoryCommandHeader } from "./commands.js";
import {
  createInventoryProjectionDelta,
} from "./corrections.js";
import {
  InventoryEventKind,
  defineInventoryEvent,
  type InventoryEventDraft,
  type InventoryHistoricalAssertion,
} from "./events.js";
import {
  replayInventoryHistoricalScenario,
  type InventoryHistoricalReplayResult,
} from "./historical-replay.js";
import { InventoryDeficitPolicy, type InventoryProjectionState } from "./projection.js";

/** Inputs for one append-only atomic late-history repair envelope. */
export interface CreateInventoryHistoricalRepairInput extends InventoryCommandHeader {
  /** Frozen catalogue used to validate every embedded ordinary assertion. */
  readonly catalog: InventoryCatalog;
  /** Current published projection whose effective history is being repaired. */
  readonly projection: InventoryProjectionState;
  /** Durable time this system learns the embedded earlier assertions. */
  readonly recordedAtEpochMs: number;
  /** New ordinary historical assertions with stable identities and optional anchors. */
  readonly assertions: readonly InventoryHistoricalAssertion[];
  /** Earlier embedded assertion identities removed from latest effective history. */
  readonly omittedAssertionIds?: readonly string[];
  /** Optional indexed transitive event component; omission replays complete retained history. */
  readonly historyEvents?: readonly import("./events.js").InventoryCommittedEvent[];
}

/** Complete uncommitted repair event plus the desired replay used to derive it. */
export interface InventoryHistoricalRepairEventPlan {
  /** Exact event draft ready for the ordinary durable coordinator. */
  readonly event: InventoryEventDraft;
  /** Desired effective projection and typed impact behind the event delta. */
  readonly replay: InventoryHistoricalReplayResult;
}

/** Typed planning error for v1 historical assertions that would mutate metadata masters. */
export class InventoryHistoricalRepairMetadataError extends Error {
  /** Preserve one stable error identity for side-effect-free plan conversion. */
  constructor() {
    super(
      "Historical repair cannot create/change lot or placement-node metadata; assert metadata through existing lots/placement APIs first."
    );
    this.name = "InventoryHistoricalRepairMetadataError";
  }
}

/** Derive one historical-repair envelope without mutating current inventory. */
export function createInventoryHistoricalRepairEvent(
  input: CreateInventoryHistoricalRepairInput,
  deficitPolicy: InventoryDeficitPolicy
): InventoryHistoricalRepairEventPlan {
  const reason = input.reason?.trim();
  if (reason === undefined || reason.length === 0) {
    throw new Error("Historical repair needs an explicit reason.");
  }
  if (
    input.assertions.length === 0 &&
    (input.omittedAssertionIds?.length ?? 0) === 0
  ) {
    throw new Error("Historical repair must add or omit at least one assertion.");
  }
  const replay = replayInventoryHistoricalScenario({
    catalog: input.catalog,
    projection: input.projection,
    deficitPolicy,
    assertions: input.assertions.map(
      /** Bind assertion order and the proposed next durable envelope sequence. */
      (assertion, assertionOrder) => ({
        assertion,
        recordedAtEpochMs: input.recordedAtEpochMs,
        durableOrder: input.projection.lastRecordSequence + 1,
        assertionOrder,
      })
    ),
    omittedAssertionIds: input.omittedAssertionIds ?? [],
    ...(input.historyEvents === undefined
      ? {}
      : { sourceEvents: input.historyEvents }),
  });
  assertHistoricalRepairMetadataIsAdditive(
    replay.actualProjection,
    replay.projection
  );
  const delta = createInventoryProjectionDelta(
    replay.actualProjection,
    replay.projection
  );
  const event = defineInventoryEvent({
    catalog: input.catalog,
    event: {
      eventId: inventoryEventIdForOperation(input.operationId),
      operationId: input.operationId,
      kind: InventoryEventKind.HistoricalRepair,
      occurredAtEpochMs: input.occurredAtEpochMs,
      stockEffects: delta.stockEffects,
      positiveLayerProvenanceOverrides:
        delta.positiveLayerProvenanceOverrides,
      lotDefinitions: [],
      placementNodeDefinitions: [],
      placementChanges: delta.placementChanges,
      traceabilityChanges: delta.traceabilityChanges,
      ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      ...(input.sourcePartyId === undefined
        ? {}
        : { sourcePartyId: input.sourcePartyId }),
      ...(input.destinationPartyId === undefined
        ? {}
        : { destinationPartyId: input.destinationPartyId }),
      ...(input.sourceReference === undefined
        ? {}
        : { sourceReference: input.sourceReference }),
      reason,
      historicalRepair: {
        assertions: input.assertions,
        omittedAssertionIds: input.omittedAssertionIds ?? [],
      },
      historicalImpact: replay.impact,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    },
  });
  return { event, replay };
}

/** Historical repairs reuse metadata already asserted through existing metadata APIs. */
function assertHistoricalRepairMetadataIsAdditive(
  actual: InventoryProjectionState,
  desired: InventoryProjectionState
): void {
  if (
    JSON.stringify(actual.lots) !== JSON.stringify(desired.lots) ||
    JSON.stringify(actual.placementNodes) !== JSON.stringify(desired.placementNodes)
  ) {
    throw new InventoryHistoricalRepairMetadataError();
  }
}
