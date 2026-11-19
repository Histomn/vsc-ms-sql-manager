/**
 * Automatic table aliases: choosing a table in `FROM` / `JOIN` completion inserts
 * `Table alias` (for example `AGRMNT_ACC_MNT aam`) instead of just the name.
 */
import { generateSmartAlias } from './sqlCompletionService';
import { maskStringsAndComments } from './crossDatabaseResolver';

// Short T-SQL keywords that must not be used as an alias
const RESERVED_ALIASES = new Set([
  'add', 'all', 'and', 'any', 'as', 'asc', 'at', 'by', 'dbcc', 'del', 'desc', 'do', 'end', 'for', 'go', 'if', 'in',
  'into', 'is', 'key', 'no', 'not', 'null', 'of', 'off', 'on', 'or', 'set', 'to', 'top', 'use', 'view',
]);

/** Keywords that may follow a table reference (so no alias is present yet). */
const FOLLOWING_KEYWORDS =
  /^\s*(?:where|join|inner|left|right|full|cross|outer|on|order|group|having|union|except|intersect|with|for|option|natural|pivot|unpivot|tablesample)\b/i;

/** An alias for `tableName` that is not reserved and not in `used` (lowercase names/aliases). */
export function createUniqueAlias(tableName: string, used: Set<string>): string {
  let base = generateSmartAlias(tableName).replace(/[^A-Za-z0-9_]/g, '');
  if (!base) base = 't';
  if (/^\d/.test(base)) base = `a${base}`;

  let candidate = base;
  let counter = 2;
  while (used.has(candidate.toLowerCase()) || RESERVED_ALIASES.has(candidate.toLowerCase())) {
    candidate = `${base}${counter++}`;
  }
  return candidate;
}

/** True when the cursor is right after `DELETE ... FROM` (T-SQL does not allow an alias there). */
export function isDeleteFromContext(textUntilCursor: string): boolean {
  const masked = maskStringsAndComments(textUntilCursor);
  const statement = masked.slice(Math.max(masked.lastIndexOf(';') + 1, 0));
  return /\bdelete\s+(?:top\s*\([^)]*\)\s*(?:percent\s+)?|top\s+\d+\s+)?from\s+[^\s,()]*$/i.test(statement);
}

/** True when the cursor directly follows `FROM` or `JOIN` (optionally with a partial name). */
export function isTableReferencePosition(textUntilCursor: string): boolean {
  return /\b(?:from|join)\s+[^\s,()]*$/i.test(maskStringsAndComments(textUntilCursor));
}

/** True when the rest of the line already contains an alias (or anything that is not a clause keyword). */
export function hasTextAfterCursor(restOfLine: string): boolean {
  const trimmed = restOfLine.trim();
  if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith(')') || trimmed.startsWith(',')) return false;
  return !FOLLOWING_KEYWORDS.test(restOfLine);
}