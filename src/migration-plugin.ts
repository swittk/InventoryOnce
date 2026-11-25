import type { InventoryCatalog } from "./catalog.js";
import {
  defineInventoryMigration,
  type InventoryMigrationDeclaration,
  type InventoryMigrationPlan,
} from "./migrations.js";

/** Paging request passed to one application-owned legacy query. */
export interface InventoryLegacyQueryPageInput {
  /** Opaque cursor returned by the previous page; absent on first read. */
  readonly cursor?: string;
  /** Maximum legacy rows requested in this page. */
  readonly limit: number;
}

/** One typed page returned by an application-owned legacy query. */
export interface InventoryLegacyQueryPage<Row extends object> {
  /** Typed legacy rows read from Parse, SQL, files, or another source. */
  readonly rows: readonly Row[];
  /** Opaque cursor for the next page; absent when exhausted. */
  readonly nextCursor?: string;
}

/** One named typed legacy read; only this function knows application storage. */
export interface InventoryLegacyQuery<Row extends object> {
  /** Stable name used in diagnostics/parallel compatibility reads. */
  readonly queryId: string;
  /** Read one bounded page from legacy storage. */
  readonly readPage: (
    input: InventoryLegacyQueryPageInput,
  ) => Promise<InventoryLegacyQueryPage<Row>>;
}

/** Limits used whenever InventoryOnce drains one declared legacy query. */
export interface InventoryLegacyQueryReadOptions {
  /** Requested page size. */
  readonly pageSize: number;
  /** Hard safety bound blocking a broken query from paging forever. */
  readonly maxPages: number;
  /** Hard safety bound blocking unexpectedly huge legacy reads. */
  readonly maxRows: number;
}

/** Reader passed into migration plugins and reusable by compatibility code. */
export interface InventoryLegacyQueryReader {
  /** Drain one typed declared query under configured paging/row bounds. */
  readAll<Row extends object>(
    query: InventoryLegacyQuery<Row>,
  ): Promise<readonly Row[]>;
}

/** Complete side-effect-free native target reconstructed from one legacy source. */
export interface InventoryMigrationSourceBundle {
  /** Frozen item/package/fungibility catalogue reconstructed from legacy definitions. */
  readonly catalog: InventoryCatalog;
  /** Canonical opening/traceability declaration reconstructed from legacy rows. */
  readonly declaration: InventoryMigrationDeclaration;
}

/** Declarative source plugin that owns both legacy reads and native catalogue reconstruction. */
export interface InventoryMigrationSourcePlugin {
  /** Stable plugin identity such as `legacy-inventory-v1`. */
  readonly pluginId: string;
  /**
   * Read named typed queries and return one complete side-effect-free native bundle.
   * This function must not write InventoryOnce or legacy storage.
   */
  readonly createBundle: (
    reader: InventoryLegacyQueryReader,
  ) => Promise<InventoryMigrationSourceBundle>;
}

/** Declarative plugin translating one legacy installation into InventoryOnce facts. */
export interface InventoryMigrationPlugin {
  /** Stable plugin identity such as `legacy-inventory-v1`. */
  readonly pluginId: string;
  /**
   * Read named typed queries and return one side-effect-free declaration.
   * This function must not write InventoryOnce storage.
   */
  readonly createDeclaration: (
    reader: InventoryLegacyQueryReader,
  ) => Promise<InventoryMigrationDeclaration>;
}

/** Inputs for reading and compiling one complete legacy-source plugin. */
export interface CreateInventoryMigrationPlanFromSourcePluginInput {
  /** Plugin owning application-specific reads plus native catalogue translation. */
  readonly plugin: InventoryMigrationSourcePlugin;
  /** Optional paging/row bounds. */
  readonly queryReadOptions?: Partial<InventoryLegacyQueryReadOptions>;
}

/** Result of compiling one complete source plugin through normal catalogue/event invariants. */
export interface InventoryMigrationSourcePlan {
  /** Frozen native catalogue reconstructed by the source plugin. */
  readonly catalog: InventoryCatalog;
  /** Validated deterministic migration plan. */
  readonly plan: InventoryMigrationPlan;
}

/** Inputs for reading/compiling one migration plugin. */
export interface CreateInventoryMigrationPlanFromPluginInput {
  /** Frozen catalogue used to validate translated facts. */
  readonly catalog: InventoryCatalog;
  /** Plugin owning application-specific legacy reads/translation. */
  readonly plugin: InventoryMigrationPlugin;
  /** Optional paging/row bounds. */
  readonly queryReadOptions?: Partial<InventoryLegacyQueryReadOptions>;
}

/** Validate one named legacy query once when an application declares it. */
export function defineInventoryLegacyQuery<Row extends object>(
  query: InventoryLegacyQuery<Row>,
): InventoryLegacyQuery<Row> {
  if (query.queryId.trim().length === 0) {
    throw new Error("Inventory legacy queryId must not be empty.");
  }
  return query;
}

/** Validate one complete legacy-source plugin once when an application declares it. */
export function defineInventoryMigrationSourcePlugin(
  plugin: InventoryMigrationSourcePlugin,
): InventoryMigrationSourcePlugin {
  if (plugin.pluginId.trim().length === 0) {
    throw new Error("Inventory migration source pluginId must not be empty.");
  }
  return plugin;
}

/** Validate one migration plugin once when an application declares it. */
export function defineInventoryMigrationPlugin(
  plugin: InventoryMigrationPlugin,
): InventoryMigrationPlugin {
  if (plugin.pluginId.trim().length === 0) {
    throw new Error("Inventory migration pluginId must not be empty.");
  }
  return plugin;
}

/** Drain one typed legacy query with repeated-cursor and size safety checks. */
export async function readAllInventoryLegacyQuery<Row extends object>(
  query: InventoryLegacyQuery<Row>,
  options: Partial<InventoryLegacyQueryReadOptions> = {},
): Promise<readonly Row[]> {
  const pageSize = options.pageSize ?? 500;
  const maxPages = options.maxPages ?? 10_000;
  const maxRows = options.maxRows ?? 1_000_000;
  assertPositiveSafeInteger(pageSize, "legacy query pageSize");
  assertPositiveSafeInteger(maxPages, "legacy query maxPages");
  assertPositiveSafeInteger(maxRows, "legacy query maxRows");

  /** Rows kept in source query order so translation remains deterministic. */
  const rows: Row[] = [];
  /** Cursors already followed; seeing one again means the query is looping. */
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = await query.readPage({
      ...(cursor === undefined ? {} : { cursor }),
      limit: pageSize,
    });
    for (const row of page.rows) {
      if (rows.length === maxRows) {
        throw new Error(
          `Inventory legacy query '${query.queryId}' exceeded its ${maxRows}-row safety bound.`,
        );
      }
      rows.push(row);
    }
    if (page.nextCursor === undefined) return rows;
    if (page.nextCursor.trim().length === 0) {
      throw new Error(
        `Inventory legacy query '${query.queryId}' returned an empty next cursor.`,
      );
    }
    if (seenCursors.has(page.nextCursor)) {
      throw new Error(
        `Inventory legacy query '${query.queryId}' returned a repeated cursor.`,
      );
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new Error(
    `Inventory legacy query '${query.queryId}' exceeded its ${maxPages}-page safety bound.`,
  );
}

/** Create the small typed reader shared by migration and temporary compatibility paths. */
export function createInventoryLegacyQueryReader(
  options: Partial<InventoryLegacyQueryReadOptions> = {},
): InventoryLegacyQueryReader {
  return {
    /** Reuse the same bounded query draining for every plugin-declared query. */
    readAll: <Row extends object>(
      query: InventoryLegacyQuery<Row>,
    ): Promise<readonly Row[]> => readAllInventoryLegacyQuery(query, options),
  };
}

/** Run application-owned reads, then compile their complete native bundle through normal invariants. */
export async function createInventoryMigrationPlanFromSourcePlugin({
  plugin,
  queryReadOptions,
}: CreateInventoryMigrationPlanFromSourcePluginInput): Promise<InventoryMigrationSourcePlan> {
  const bundle = await plugin.createBundle(
    createInventoryLegacyQueryReader(queryReadOptions),
  );
  return {
    catalog: bundle.catalog,
    plan: defineInventoryMigration({
      catalog: bundle.catalog,
      declaration: bundle.declaration,
    }),
  };
}

/** Run application-owned reads, then compile their declaration through normal InventoryOnce invariants. */
export async function createInventoryMigrationPlanFromPlugin({
  catalog,
  plugin,
  queryReadOptions,
}: CreateInventoryMigrationPlanFromPluginInput): Promise<InventoryMigrationPlan> {
  const declaration = await plugin.createDeclaration(
    createInventoryLegacyQueryReader(queryReadOptions),
  );
  return defineInventoryMigration({ catalog, declaration });
}

/** Reject unsafe paging bounds before a query starts. */
function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Inventory ${label} must be a positive safe integer.`);
  }
}
