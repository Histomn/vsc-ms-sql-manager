/**
 * Helpers for cross-database and EXEC autocomplete:
 *  - parsing `db.`, `db.schema.` and `db..` prefixes
 *  - detecting an EXEC / EXECUTE context
 *  - small formatting utilities
 */
import type { DatabaseSchema, StoredProcedureInfo } from '../types/schema';

const ID = '(\\[[^\\]]*\\]|[\\w$#@]+)'; // complete identifier, optionally bracketed
const PART = '(\\[[^\\]]*\\]?|[\\w$#@]*)'; // identifier being typed (may be empty / unterminated)
const PRE = '(?:^|[^\\w$#@\\].])'; // character before the first identifier

const DEFAULT_SCHEMA_RE = new RegExp(`${PRE}${ID}\\.\\.${PART}$`);
const THREE_PART_RE = new RegExp(`${PRE}${ID}\\.${ID}\\.${PART}$`);
const TWO_PART_RE = new RegExp(`${PRE}${ID}\\.${PART}$`);

export type QualifiedPrefix =
  /** `first.partial` - first is a database, a schema or an alias */
  | { kind: 'two'; first: string; partial: string }
  /** `db.schema.partial` */
  | { kind: 'three'; db: string; schema: string; partial: string }
  /** `db..partial` (default schema) */
  | { kind: 'defaultSchema'; db: string; partial: string };

export function unbracket(identifier: string): string {
  const m = /^\[(.*?)\]?$/.exec(identifier);
  return m ? m[1] : identifier;
}

/** Parses the qualified name ending at the cursor, or returns null. */
export function parseQualifiedPrefix(lineUntilCursor: string): QualifiedPrefix | null {
  let m = DEFAULT_SCHEMA_RE.exec(lineUntilCursor);
  if (m) return { kind: 'defaultSchema', db: unbracket(m[1]), partial: unbracket(m[2]) };

  m = THREE_PART_RE.exec(lineUntilCursor);
  if (m) return { kind: 'three', db: unbracket(m[1]), schema: unbracket(m[2]), partial: unbracket(m[3]) };

  m = TWO_PART_RE.exec(lineUntilCursor);
  if (m) return { kind: 'two', first: unbracket(m[1]), partial: unbracket(m[2]) };

  return null;
}

/** True when the cursor follows `EXEC` / `EXECUTE` (optionally `@rc =`) on the current line. */
export function isExecContext(lineUntilCursor: string): boolean {
  return /\b(?:exec|execute)\s+(?:@\w+\s*=\s*)?[^\s,()]*$/i.test(lineUntilCursor);
}

/** Case-insensitive lookup of a database name in the known list. */
export function findDatabaseName(name: string, databases: string[]): string | null {
  const lower = name.toLowerCase();
  return databases.find((d) => d.toLowerCase() === lower) ?? null;
}

/** Distinct schema names that contain tables, views or procedures. */
export function getSchemaNames(schema: DatabaseSchema): string[] {
  const names = new Map<string, string>();
  const add = (s?: string) => {
    if (s && !names.has(s.toLowerCase())) names.set(s.toLowerCase(), s);
  };
  schema.tables?.forEach((t) => add(t.schema));
  schema.views?.forEach((v) => add(v.schema));
  schema.storedProcedures?.forEach((p) => add(p.schema));
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

/** Wraps the identifier in brackets when it is not a plain identifier. */
export function quoteIfNeeded(name: string): string {
  return /^[A-Za-z_][\w$#@]*$/.test(name) ? name : `[${name.replace(/]/g, ']]')}]`;
}

/** e.g. `@id int, @name varchar OUT` */
export function formatProcedureParameters(sp: StoredProcedureInfo): string {
  return (sp.parameters ?? [])
    .map((p) => `${p.name} ${p.type}${p.mode === 'INOUT' ? ' OUT' : ''}${p.defaultValue ? ' = default' : ''}`)
    .join(', ');
}
