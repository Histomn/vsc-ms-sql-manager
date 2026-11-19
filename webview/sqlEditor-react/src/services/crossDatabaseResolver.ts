/**
 * Cross-database name resolution for analysis features (autocomplete columns,
 * "Expand *", hover, validation).
 *
 * Those features resolve tables by name against a single DatabaseSchema. To
 * support `OtherDb.schema.Table` / `OtherDb..Table` without rewriting each of
 * them, the query text is prepared like this:
 *
 *  - the `OtherDb.` prefix is replaced by spaces, so the text keeps exactly the
 *    same length and every line/column position stays valid;
 *  - the referenced tables and views of OtherDb are added to a copy of the
 *    schema (replacing same-named local objects, only for referenced ones).
 */
import type { DatabaseSchema, TableInfo, ViewInfo } from '../types/schema';
import { unbracket } from './crossDatabaseCompletion';

export interface CrossDatabaseContext {
  /** Names of the databases on the connected server. */
  databases: string[];
  /** Database the editor is currently connected to. */
  currentDatabase: string | null;
  /** Lazily loads (and caches) the schema of another database. */
  requestSchema: (database: string) => Promise<DatabaseSchema | null>;
  /** Returns an already loaded schema of another database, if any. */
  getLoadedSchema: (database: string) => DatabaseSchema | undefined;
  /** Changes whenever another database's schema finished loading. */
  version: number;
}

export interface CrossDatabaseReference {
  /** Canonical database name (as listed in `databases`). */
  database: string;
  /** Schema as written, or null for `db..table`. */
  schema: string | null;
  name: string;
  /** Offset of the first character of the reference. */
  start: number;
  /** Offset just after the database part and its dot (`Db.`), or after `Db..`. */
  prefixEnd: number;
}

/** Replaces string literals and comments with spaces (same length). */
export function maskStringsAndComments(sql: string): string {
  const out = sql.split('');
  const n = sql.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
    }
  };
  let i = 0;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      const eol = sql.indexOf('\n', i);
      const end = eol === -1 ? n : eol;
      blank(i, end);
      i = end;
    } else if (ch === '/' && next === '*') {
      const close = sql.indexOf('*/', i + 2);
      const end = close === -1 ? n : close + 2;
      blank(i, end);
      i = end;
    } else if (ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j++;
      }
      blank(i, j + 1);
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

const IDENT = '(\\[[^\\]]+\\]|[\\w$#@]+)';
// db . schema? . name   (not preceded by an identifier char or dot)
const REFERENCE_RE = new RegExp(`(?<![\\w$#@\\].])${IDENT}\\.${IDENT}?\\.${IDENT}`, 'g');

/** Finds `Db.schema.name` and `Db..name` references whose first part is a known database. */
export function findCrossDatabaseReferences(sql: string, databases: string[]): CrossDatabaseReference[] {
  if (!sql || databases.length === 0) return [];
  const lowerToName = new Map(databases.map((d) => [d.toLowerCase(), d]));
  const masked = maskStringsAndComments(sql);
  const refs: CrossDatabaseReference[] = [];

  const re = new RegExp(REFERENCE_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const database = lowerToName.get(unbracket(m[1]).toLowerCase());
    if (!database) continue;
    const hasSchema = m[2] !== undefined;
    const firstPartEnd = m.index + m[1].length; // position of the first dot
    refs.push({
      database,
      schema: hasSchema ? unbracket(m[2]) : null,
      name: unbracket(m[3]),
      start: m.index,
      prefixEnd: hasSchema ? firstPartEnd + 1 : firstPartEnd + 2,
    });
  }
  return refs;
}

export interface PreparedQuery {
  /** Text with resolved `Db.` prefixes blanked out (same length as the input). */
  sql: string;
  /** Schema extended with the referenced objects of other databases. */
  schema: DatabaseSchema;
  /** Databases referenced in the text whose schema is not loaded yet. */
  missing: string[];
}

/**
 * Prepares `sql` and `base` for analysis. Returns the inputs unchanged when
 * the text contains no cross-database references.
 */
export function prepareCrossDatabaseQuery(
  sql: string,
  base: DatabaseSchema,
  ctx: Pick<CrossDatabaseContext, 'databases' | 'currentDatabase' | 'getLoadedSchema'> | undefined
): PreparedQuery {
  if (!ctx) return { sql, schema: base, missing: [] };
  const refs = findCrossDatabaseReferences(sql, ctx.databases);
  if (refs.length === 0) return { sql, schema: base, missing: [] };

  const current = ctx.currentDatabase?.toLowerCase();
  const chars = sql.split('');
  const missing = new Set<string>();
  const addedTables: TableInfo[] = [];
  const addedViews: ViewInfo[] = [];

  for (const ref of refs) {
    const isCurrent = current !== undefined && ref.database.toLowerCase() === current;
    let data: DatabaseSchema | undefined;
    if (!isCurrent) {
      data = ctx.getLoadedSchema(ref.database);
      if (!data) {
        missing.add(ref.database);
        continue; // leave the text untouched until the schema is available
      }
      const schemaName = (ref.schema ?? 'dbo').toLowerCase();
      const nameLower = ref.name.toLowerCase();
      const table = data.tables?.find((t) => t.name.toLowerCase() === nameLower && t.schema.toLowerCase() === schemaName);
      const view = data.views?.find((v) => v.name.toLowerCase() === nameLower && v.schema.toLowerCase() === schemaName);
      if (table) addedTables.push(table);
      else if (view) addedViews.push(view);
    }
    for (let k = ref.start; k < ref.prefixEnd; k++) {
      if (chars[k] !== '\n' && chars[k] !== '\r') chars[k] = ' ';
    }
  }

  const sameObject = (a: { schema: string; name: string }, b: { schema: string; name: string }) =>
    a.schema.toLowerCase() === b.schema.toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase();

  let schema = base;
  if (addedTables.length > 0 || addedViews.length > 0) {
    schema = {
      ...base,
      tables: [...(base.tables ?? []).filter((t) => ![...addedTables, ...addedViews].some((a) => sameObject(a, t))), ...addedTables],
      views: [...(base.views ?? []).filter((v) => ![...addedTables, ...addedViews].some((a) => sameObject(a, v))), ...addedViews],
    };
  }

  return { sql: chars.join(''), schema, missing: [...missing] };
}
