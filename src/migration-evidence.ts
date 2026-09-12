import {
  inventoryMetadataFingerprint,
  type InventoryIntentFingerprintValue,
} from "./canonical.js";
import type { InventoryMetadata } from "./model.js";

/** Stable pointer back to one exact legacy fact/query row. */
export interface InventoryMigrationSourceReference {
  /** Legacy query/table/class name. */
  readonly sourceType: string;
  /** Stable legacy row/object identity. */
  readonly sourceId: string;
  /** Optional plain explanation of unusual source meaning. */
  readonly note?: string;
}

/** Non-physical disposition retained for one legacy source row. */
export enum InventoryMigrationSourceDispositionKind {
  /** Current snapshot truth supersedes this row; it remains audit evidence and must never replay. */
  SnapshotSupersededDoNotReplay = "snapshot-superseded-do-not-replay",
}

/** One immutable legacy-row disposition included in migration and durable replay identity. */
export interface InventoryMigrationSourceDisposition {
  /** Stable identity inside this migration. */
  readonly dispositionId: string;
  /** Exact non-physical treatment. */
  readonly kind: InventoryMigrationSourceDispositionKind;
  /** Exact legacy row retained as audit evidence. */
  readonly source: InventoryMigrationSourceReference;
  /** Canonical opening-snapshot time whose truth supersedes this row. */
  readonly snapshotAtEpochMs: number;
  /** Plain explicit reason; never inferred as completed or aborted. */
  readonly reason: string;
  /** Optional bounded JSON-safe audit evidence. */
  readonly evidence?: InventoryMetadata;
}


/** Canonical field-by-field row used by migration intent and durable retry equality. */
export function inventoryMigrationSourceDispositionFingerprint(
  disposition: InventoryMigrationSourceDisposition,
): readonly InventoryIntentFingerprintValue[] {
  return [
    disposition.dispositionId,
    disposition.kind,
    disposition.source.sourceType,
    disposition.source.sourceId,
    disposition.source.note ?? null,
    disposition.snapshotAtEpochMs,
    disposition.reason,
    inventoryMetadataFingerprint(disposition.evidence),
  ];
}
