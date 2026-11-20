import { describe, it, expect } from 'vitest';
import { getStatementAtOffset, getStatementBoundsAtOffset } from './sqlStatement';
import { parseKeybinding, parseKeybindings, type MonacoKeyApi } from './keybindingParser';

const at = (sql: string, marker = '|') => {
  const offset = sql.indexOf(marker);
  return getStatementAtOffset(sql.replace(marker, ''), offset)?.text ?? null;
};

describe('getStatementAtOffset', () => {
  it('returns the single statement', () => {
    expect(at('SELECT 1|')).toBe('SELECT 1');
  });

  it('picks the statement the cursor is in', () => {
    const sql = 'SELECT 1;\nSELEC|T 2;\nSELECT 3;';
    expect(at(sql)).toBe('SELECT 2;');
  });

  it('picks the previous statement when the cursor is right after a semicolon', () => {
    expect(at('SELECT 1;|\nSELECT 2;')).toBe('SELECT 1;');
  });

  it('handles multi-line statements', () => {
    const sql = 'SELECT a,\n  b|\nFROM t;\nSELECT 2;';
    expect(at(sql)).toBe('SELECT a,\n  b\nFROM t;');
  });

  it('ignores semicolons in strings, comments and brackets', () => {
    expect(at("SELECT 'a;b', [x;y] -- c;\n, 1|")).toBe("SELECT 'a;b', [x;y] -- c;\n, 1");
    expect(at('SELECT 1 /* ; */ + 2|;')).toBe('SELECT 1 /* ; */ + 2;');
  });

  it('splits on GO lines', () => {
    const sql = 'SELECT 1\nGO\nSELECT |2\nGO\nSELECT 3';
    expect(at(sql)).toBe('SELECT 2');
  });

  it('does not treat identifiers starting with go as a batch separator', () => {
    expect(at('SELECT 1\ngoto_x|')).toBe('SELECT 1\ngoto_x');
  });

  it('falls back to the previous statement in blank space', () => {
    expect(at('SELECT 1;\n\n|\n')).toBe('SELECT 1;');
  });

  it('falls back to the next statement when nothing precedes the cursor', () => {
    expect(at('|\n\nSELECT 1;')).toBe('SELECT 1;');
  });

  it('returns null for empty text', () => {
    expect(getStatementAtOffset('  \n ', 1)).toBeNull();
  });
});

const api: MonacoKeyApi = {
  KeyCode: { KeyE: 35, Enter: 3, F5: 63, Digit1: 22, UpArrow: 16 },
  KeyMod: { CtrlCmd: 2048, Shift: 1024, Alt: 512, WinCtrl: 256 },
};

describe('parseKeybinding', () => {
  it('parses single keys', () => {
    expect(parseKeybinding('f5', api)).toBe(63);
    expect(parseKeybinding('1', api)).toBe(22);
  });

  it('parses modifiers case-insensitively', () => {
    expect(parseKeybinding('Ctrl+Shift+E', api)).toBe(2048 | 1024 | 35);
    expect(parseKeybinding('alt + enter', api)).toBe(512 | 3);
  });

  it('rejects invalid chords', () => {
    expect(parseKeybinding('ctrl+', api)).toBeNull();
    expect(parseKeybinding('ctrl+shift', api)).toBeNull();
    expect(parseKeybinding('ctrl+e+f5', api)).toBeNull();
    expect(parseKeybinding('ctrl+nope', api)).toBeNull();
  });
});

describe('parseKeybindings', () => {
  it('parses a comma-separated list and skips invalid entries', () => {
    expect(parseKeybindings('f5, ctrl+shift+e, bogus', api)).toEqual([63, 2048 | 1024 | 35]);
  });

  it('returns an empty list for empty input', () => {
    expect(parseKeybindings('', api)).toEqual([]);
    expect(parseKeybindings(undefined, api)).toEqual([]);
  });
});
describe('getStatementBoundsAtOffset', () => {
  const bounds = (sql: string) => {
    const offset = sql.indexOf('|');
    const clean = sql.replace('|', '');
    const b = getStatementBoundsAtOffset(clean, offset);
    return clean.slice(b.start, b.end);
  };

  it('returns the whole statement the cursor is in, untrimmed', () => {
    expect(bounds('SELECT 1;\nSELECT a FROM t WHERE x|\nORDER BY a;\nSELECT 3')).toBe('\nSELECT a FROM t WHERE x\nORDER BY a;');
  });

  it('puts the position right after a semicolon (and the blank text after it) into the next statement', () => {
    expect(bounds('SELECT 1;|')).toBe('');
    expect(bounds('SELECT 1;\n\n|')).toBe('\n\n');
    expect(bounds('SELECT 1; SELECT 2|')).toBe(' SELECT 2');
  });

  it('keeps a cursor at the end of a statement before ; in that statement', () => {
    expect(bounds('SELECT 1|;\nSELECT 2;')).toBe('SELECT 1;');
  });

  it('splits on GO lines, including a cursor at the end of the last line before GO', () => {
    expect(bounds('SELECT 1|\nGO\nSELECT 2')).toBe('SELECT 1');
    expect(bounds('SELECT 1\nGO\nSELECT 2|')).toBe('\nSELECT 2');
  });

  it('ignores semicolons inside strings, comments and brackets', () => {
    expect(bounds("SELECT ';', [a;b] -- ;\n, x|")).toBe("SELECT ';', [a;b] -- ;\n, x");
  });
});
