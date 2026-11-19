/**
 * Resolves the database object (table, view or stored procedure) written at a
 * text offset, e.g. `dbo.Users`, `usp_get_users` or `AR.dbo.AGRMNT_ACC_MNT`.
 */
import type { DatabaseSchema } from '../types/schema';
import { findDatabaseName, unbracket } from './crossDatabaseCompletion';
import { maskStringsAndComments, type CrossDatabaseContext } from './crossDatabaseResolver';

export type DbObjectKind = 'table' | 'view' | 'procedure';

export interface DbObjectRef {
  kind: DbObjectKind;
  /** Set only when the object lives in a database other than the connected one. */
  database?: string;
  schema: string;
  name: string;
}

const IDENT = '(?:\\[[^\\]]+\\]|[\\w$#@]+)';
// up to four dot-separated parts; empty parts allowed for `db..name`
const CHAIN_RE = new RegExp(`${IDENT}(?:\\.(?:\\[[^\\]]+\\]|[\\w$#@]*)){0,3}`, 'g');

interface Part {
  text: string;
  start: number;
  end: number;
}

function splitParts(chain: string, chainStart: number): Part[] {
  const parts: Part[] = [];
  const re = /\[[^\]]+\]|[\w$#@]+|(?<=\.)(?=\.)/g;
  let m: RegExpExecArray | null;
  // Empty segments (`db..name`) are represented by zero-length matches
  while ((m = re.exec(chain)) !== null) {
    parts.push({ text: m[0], start: chainStart + m.index, end: chainStart + m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return parts;
}

export function resolveObjectAtOffset(
  sql: string,
  offset: number,
  base: DatabaseSchema,
  cross?: CrossDatabaseContext
): DbObjectRef | null {
  const masked = maskStringsAndComments(sql);
  const re = new RegExp(CHAIN_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (offset < start || offset > end) continue;

    const parts = splitParts(m[0], start);
    if (parts.length === 0 || parts.length > 3) return null;
    const last = parts[parts.length - 1];
    if (offset < last.start || offset > last.end || last.text === '') return null;

    const name = unbracket(last.text);
    const schemaPart = parts.length >= 2 ? unbracket(parts[parts.length - 2].text) : '';
    const schemaFilter: string | null = parts.length >= 2 ? (schemaPart || 'dbo') : null;

    let data = base;
    let database: string | undefined;
    if (parts.length === 3) {
      const dbName = findDatabaseName(unbracket(parts[0].text), cross?.databases ?? []);
      if (!dbName) return null;
      if (cross?.currentDatabase?.toLowerCase() !== dbName.toLowerCase()) {
        const loaded = cross?.getLoadedSchema(dbName);
        if (!loaded) return null;
        data = loaded;
        database = dbName;
      }
    }

    const lower = name.toLowerCase();
    const matches = (o: { schema: string; name: string }) =>
      o.name.toLowerCase() === lower && (!schemaFilter || o.schema.toLowerCase() === schemaFilter.toLowerCase());

    const table = data.tables?.find(matches);
    if (table) return { kind: 'table', database, schema: table.schema, name: table.name };
    const view = data.views?.find(matches);
    if (view) return { kind: 'view', database, schema: view.schema, name: view.name };
    const proc = data.storedProcedures?.find(matches);
    if (proc) return { kind: 'procedure', database, schema: proc.schema, name: proc.name };
    return null;
  }
  return null;
}
