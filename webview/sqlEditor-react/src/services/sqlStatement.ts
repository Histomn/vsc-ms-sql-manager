/**
 * Finds the SQL statement under the cursor.
 *
 * Statements are separated by `;` or by a line that contains only `GO`
 * (case-insensitive). Separators inside string literals, bracketed or quoted
 * identifiers and comments are ignored.
 */

export interface StatementRange {
  /** Statement text (trimmed). */
  text: string;
  /** Offset of the first character of the trimmed statement. */
  start: number;
  /** Offset just after the last character of the trimmed statement. */
  end: number;
}

interface Segment {
  start: number;
  end: number;
}

function splitSegments(sql: string): Segment[] {
  const segments: Segment[] = [];
  let segStart = 0;
  let i = 0;
  const n = sql.length;

  const isGoLine = (from: number): number => {
    // Returns the offset of the end of the line if the line from `from`
    // consists only of GO (optionally with a count) and whitespace, else -1.
    let eol = sql.indexOf('\n', from);
    if (eol === -1) eol = n;
    const line = sql.substring(from, eol).replace(/\r$/, '');
    return /^\s*go(\s+\d+)?\s*$/i.test(line) ? eol : -1;
  };

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === '-' && next === '-') {
      const eol = sql.indexOf('\n', i);
      i = eol === -1 ? n : eol;
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = sql.indexOf('*/', i + 2);
      i = close === -1 ? n : close + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      i++;
      while (i < n) {
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) { i += 2; continue; }
          break;
        }
        i++;
      }
      i++;
      continue;
    }
    if (ch === '[') {
      i++;
      while (i < n) {
        if (sql[i] === ']') {
          if (sql[i + 1] === ']') { i += 2; continue; }
          break;
        }
        i++;
      }
      i++;
      continue;
    }
    if (ch === ';') {
      segments.push({ start: segStart, end: i + 1 });
      segStart = i + 1;
      i++;
      continue;
    }
    if (ch === '\n') {
      const goEnd = isGoLine(i + 1);
      if (goEnd !== -1) {
        segments.push({ start: segStart, end: i });
        segStart = goEnd;
        i = goEnd;
        continue;
      }
      i++;
      continue;
    }
    // GO on the very first line of the text
    if (i === 0) {
      const goEnd = isGoLine(0);
      if (goEnd !== -1) {
        segStart = goEnd;
        i = goEnd;
        continue;
      }
    }
    i++;
  }
  segments.push({ start: segStart, end: n });
  return segments;
}

function trimRange(sql: string, seg: Segment): StatementRange | null {
  let s = seg.start;
  let e = seg.end;
  while (s < e && /\s/.test(sql[s])) s++;
  while (e > s && /\s/.test(sql[e - 1])) e--;
  if (s >= e) return null;
  return { text: sql.substring(s, e), start: s, end: e };
}

/**
 * Returns the statement containing `offset`. When the cursor is in blank space
 * between statements, the closest preceding statement is returned, or the next
 * one if there is none before the cursor.
 */
export function getStatementAtOffset(sql: string, offset: number): StatementRange | null {
  const segments = splitSegments(sql);
  const ranges: Array<{ seg: Segment; range: StatementRange | null }> = segments.map((seg) => ({
    seg,
    range: trimRange(sql, seg),
  }));

  // Segment that contains the cursor (segments are contiguous; a segment
  // ending in ';' owns the offset right after the ';').
  let containing = ranges.findIndex(({ seg }) => offset <= seg.end);
  if (containing === -1) containing = ranges.length - 1;

  const hit = ranges[containing];
  if (hit?.range) {
    // Cursor sits right after the terminating ';' of the previous statement
    // but in the following (blank) segment: handled by the fall-through below.
    return hit.range;
  }

  for (let k = containing - 1; k >= 0; k--) {
    if (ranges[k].range) return ranges[k].range;
  }
  for (let k = containing + 1; k < ranges.length; k++) {
    if (ranges[k].range) return ranges[k].range;
  }
  return null;
}
