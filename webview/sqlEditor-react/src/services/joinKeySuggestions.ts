/**
 * Join key recommendations for `JOIN ... ON |`.
 *
 * Suggests complete conditions such as `aam.AGRMNT_ID = a.AGRMNT_ID` for columns
 * that exist (with a compatible type) in both the table being joined and one of
 * the tables already in the query. Foreign keys between the two tables rank first.
 */
import type { DatabaseSchema } from '../types/schema';
import { maskStringsAndComments } from './crossDatabaseResolver';
import { getColumnsForTable, type TableInQuery } from './sqlCompletionService';

export interface JoinKeySuggestion {
  /** Full condition, e.g. `aam.AGRMNT_ID = a.AGRMNT_ID` */
  text: string;
  detail: string;
  /** Lower sorts first. */
  priority: number;
}

const NAME = '((?:\\[[^\\]]+\\]|\\w+)(?:\\.(?:\\[[^\\]]+\\]|\\w*)){0,2})';
const ALIAS = '(?:\\s+(?:as\\s+)?(\\[[^\\]]+\\]|\\w+))?';
const JOIN_ON_RE = new RegExp(`\\bjoin\\s+${NAME}${ALIAS}\\s+on\\b`, 'gi');

// Columns shared by almost every table for audit/technical reasons
const IGNORED_COLUMN = /^(row_?version|rowguid|timestamp|dtm_(crt|upd)|usr_(crt|upd)|(created|updated|modified)(_|by|at|on|date|time)|.*_(created|updated|modified)(_?(by|at|on|date|time))?)$/i;

function unbracket(s: string): string {
  return s.replace(/^\[|\]$/g, '');
}

/** Finds the `JOIN table [alias] ON` the cursor is in, from the text before the cursor. */
function findJoinTarget(textUntilCursor: string): { table: string; alias?: string } | null {
  const masked = maskStringsAndComments(textUntilCursor);
  let last: RegExpExecArray | null = null;
  const re = new RegExp(JOIN_ON_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) last = m;
  if (!last) return null;
  const parts = last[1].split('.').map(unbracket).filter((p) => p !== '');
  const table = parts[parts.length - 1];
  const alias = last[2] ? unbracket(last[2]) : undefined;
  return table ? { table, alias } : null;
}

export function getJoinKeySuggestions(
  textUntilCursor: string,
  tablesBeforeCursor: TableInQuery[],
  schema: DatabaseSchema
): JoinKeySuggestion[] {
  const target = findJoinTarget(textUntilCursor);
  if (!target) return [];

  const targetEntry = tablesBeforeCursor.find((t) =>
    target.alias
      ? t.alias.toLowerCase() === target.alias.toLowerCase()
      : t.table.toLowerCase() === target.table.toLowerCase()
  );
  if (!targetEntry) return [];

  const targetColumns = getColumnsForTable(targetEntry.schema, targetEntry.table, schema);
  const targetAlias = targetEntry.alias || targetEntry.table;
  const suggestions = new Map<string, JoinKeySuggestion>();

  for (const other of tablesBeforeCursor) {
    if (other === targetEntry) continue;
    const otherAlias = other.alias || other.table;
    const otherColumns = getColumnsForTable(other.schema, other.table, schema);
    const otherByName = new Map(otherColumns.map((c) => [c.name.toLowerCase(), c]));

    // Foreign keys between the two tables
    for (const fk of schema.foreignKeys ?? []) {
      const fromT = fk.fromTable.toLowerCase();
      const toT = fk.toTable.toLowerCase();
      const a = other.table.toLowerCase();
      const b = targetEntry.table.toLowerCase();
      let text: string | null = null;
      if (fromT === a && toT === b) text = `${otherAlias}.${fk.fromColumn} = ${targetAlias}.${fk.toColumn}`;
      else if (fromT === b && toT === a) text = `${otherAlias}.${fk.toColumn} = ${targetAlias}.${fk.fromColumn}`;
      if (text && !suggestions.has(text.toLowerCase())) {
        suggestions.set(text.toLowerCase(), { text, detail: 'Join key (foreign key)', priority: 0 });
      }
    }

    // Same column name and type in both tables
    for (const col of targetColumns) {
      const match = otherByName.get(col.name.toLowerCase());
      if (!match || IGNORED_COLUMN.test(col.name)) continue;
      if (match.type && col.type && match.type.toLowerCase() !== col.type.toLowerCase()) continue;
      const text = `${otherAlias}.${match.name} = ${targetAlias}.${col.name}`;
      if (suggestions.has(text.toLowerCase())) continue;
      const looksLikeKey = /(^|_)(id|no|code|key|num|number)$/i.test(col.name);
      suggestions.set(text.toLowerCase(), {
        text,
        detail: 'Join key (same column name)',
        priority: looksLikeKey ? 1 : 2,
      });
    }
  }

  return [...suggestions.values()].sort((x, y) => x.priority - y.priority); // stable: keeps table order
}