/** One source marker proving a guard or negative regression remains present. */
export interface AssuranceReference {
  /** Repository-relative file containing the guard or test marker. */
  readonly file: string;
  /** Exact source marker required in the referenced file. */
  readonly contains?: string;
  /** Exact test title required in the referenced file. */
  readonly testTitle?: string;
}

/** One malformed-input invariant bound to implementation guards and executable evidence. */
export interface MalformedInputAssuranceEntry {
  /** Stable malformed-input assurance identity. */
  readonly id: string;
  /** Plain-language invariant this entry requires. */
  readonly invariant: string;
  /** Implementation guard markers that must remain present. */
  readonly guards: readonly AssuranceReference[];
  /** Negative regression evidence that must remain present. */
  readonly behaviorEvidence: readonly AssuranceReference[];
}

/** Runtime-validated malformed-input assurance manifest. */
export interface MalformedInputAssuranceManifest {
  /** Checked manifest format version. */
  readonly schemaVersion: number;
  /** Decoded malformed-input assurance entries. */
  readonly entries: readonly MalformedInputAssuranceEntry[];
}

/** Decode one unknown assurance reference and reject malformed JSON shape. */
function decodeAssuranceReference(value: unknown, label: string): AssuranceReference {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.file !== "string" || record.file.length === 0) {
    throw new Error(`${label}.file must be a non-empty string.`);
  }
  if (record.contains !== undefined && typeof record.contains !== "string") {
    throw new Error(`${label}.contains must be a string when present.`);
  }
  if (record.testTitle !== undefined && typeof record.testTitle !== "string") {
    throw new Error(`${label}.testTitle must be a string when present.`);
  }
  return {
    file: record.file,
    ...(record.contains === undefined ? {} : { contains: record.contains }),
    ...(record.testTitle === undefined ? {} : { testTitle: record.testTitle }),
  };
}

/** Decode one malformed-input assurance entry before test traversal. */
function decodeMalformedInputAssuranceEntry(
  value: unknown,
  index: number
): MalformedInputAssuranceEntry {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Malformed input assurance entry ${index} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) {
    throw new Error(`Malformed input assurance entry ${index}.id must be a non-empty string.`);
  }
  if (typeof record.invariant !== "string" || record.invariant.length === 0) {
    throw new Error(`Malformed input assurance entry ${index}.invariant must be a non-empty string.`);
  }
  if (!Array.isArray(record.guards) || !Array.isArray(record.behaviorEvidence)) {
    throw new Error(`Malformed input assurance entry ${index} must declare guard/evidence arrays.`);
  }
  return {
    id: record.id,
    invariant: record.invariant,
    guards: record.guards.map((entry, guardIndex) =>
      decodeAssuranceReference(entry, `Malformed input assurance entry ${index}.guards[${guardIndex}]`)
    ),
    behaviorEvidence: record.behaviorEvidence.map((entry, evidenceIndex) =>
      decodeAssuranceReference(
        entry,
        `Malformed input assurance entry ${index}.behaviorEvidence[${evidenceIndex}]`
      )
    ),
  };
}

/** Decode and runtime-validate malformed-input assurance JSON before any nested access. */
export function decodeMalformedInputAssuranceManifest(
  value: unknown
): MalformedInputAssuranceManifest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Malformed input assurance manifest must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new Error("Malformed input assurance manifest schemaVersion must be 1.");
  }
  if (!Array.isArray(record.entries)) {
    throw new Error("Malformed input assurance manifest entries must be an array.");
  }
  return {
    schemaVersion: 1,
    entries: record.entries.map(decodeMalformedInputAssuranceEntry),
  };
}
