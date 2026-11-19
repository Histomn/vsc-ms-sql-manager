import { describe, it, expect } from 'vitest';
import { findTableAtCursorPosition } from '../hooks/useEditorActions';
import type { DatabaseSchema } from '../../../types/schema';

const testSchema: DatabaseSchema = {
  tables: [
    { schema: 'dbo', name: 'Users', columns: [{ name: 'Id', type: 'int', nullable: false, isPrimaryKey: true }] },
    { schema: 'dbo', name: 'Orders', columns: [{ name: 'Id', type: 'int', nullable: false }] },
    { schema: 'sales', name: 'Products', columns: [{ name: 'Id', type: 'int', nullable: false }] },
  ],
  views: [
    { schema: 'dbo', name: 'ActiveUsers', columns: [{ name: 'Id', type: 'int', nullable: false }] },
  ],
  foreignKeys: [],
};

function makeEditor(wordAtPosition: { word: string; startColumn: number; endColumn: number } | null) {
  return {
    getModel: () => ({
      getWordAtPosition: () => wordAtPosition,
    }),
    getPosition: () => ({ lineNumber: 1, column: 1 }),
  };
}

describe('findTableAtCursorPosition', () => {
  it('returns null when position is null', () => {
    const ed = makeEditor({ word: 'Users', startColumn: 1, endColumn: 6 });
    expect(findTableAtCursorPosition(ed as any, null, testSchema)).toBeNull();
  });

  it('returns null when model is null', () => {
    const ed = { getModel: () => null, getPosition: () => ({ lineNumber: 1, column: 1 }) };
    expect(findTableAtCursorPosition(ed as any, { lineNumber: 1, column: 1 }, testSchema)).toBeNull();
  });

  it('returns null when no word at position', () => {
    const ed = makeEditor(null);
    expect(findTableAtCursorPosition(ed as any, { lineNumber: 1, column: 1 }, testSchema)).toBeNull();
  });

  it('returns null when word is empty', () => {
    const ed = makeEditor({ word: '', startColumn: 1, endColumn: 1 });
    expect(findTableAtCursorPosition(ed as any, { lineNumber: 1, column: 1 }, testSchema)).toBeNull();
  });

  it('finds a table by exact name', () => {
    const ed = makeEditor({ word: 'Users', startColumn: 1, endColumn: 6 });
    const result = findTableAtCursorPosition(ed as any, { lineNumber: 1, column: 3 }, testSchema);
    expect(result).toEqual({ schema: 'dbo', table: 'Users' });
  });

  it('finds a table case-insensitively', () => {
    const ed = makeEditor({ word: 'users', startColumn: 1, endColumn: 6 });
    const result = findTableAtCursorPosition(ed as any, { lineNumber: 1, column: 3 }, testSchema);
    expect(result).toEqual({ schema: 'dbo', table: 'Users' });
  });

  it('finds a view by name', () => {
    const ed = makeEditor({ word: 'ActiveUsers', startColumn: 1, endColumn: 12 });
    const result = findTableAtCursorPosition(ed as any, { lineNumber: 1, column: 3 }, testSchema);
    expect(result).toEqual({ schema: 'dbo', table: 'ActiveUsers' });
  });

  it('returns null for unknown table name', () => {
    const ed = makeEditor({ word: 'NonExistent', startColumn: 1, endColumn: 12 });
    const result = findTableAtCursorPosition(ed as any, { lineNumber: 1, column: 3 }, testSchema);
    expect(result).toBeNull();
  });

  it('returns null when no schema provided', () => {
    const ed = makeEditor({ word: 'Users', startColumn: 1, endColumn: 6 });
    expect(findTableAtCursorPosition(ed as any, { lineNumber: 1, column: 3 })).toBeNull();
  });

  it('finds table in non-dbo schema', () => {
    const ed = makeEditor({ word: 'Products', startColumn: 1, endColumn: 9 });
    const result = findTableAtCursorPosition(ed as any, { lineNumber: 1, column: 3 }, testSchema);
    expect(result).toEqual({ schema: 'sales', table: 'Products' });
  });
});
describe('findTableAtCursorPosition (cross-database)', () => {
  const otherSchema: DatabaseSchema = {
    tables: [{ schema: 'dbo', name: 'AMRTZ_INST_SCHDL', columns: [{ name: 'DUE_DT', type: 'date', nullable: true }] }],
    views: [],
    foreignKeys: [],
  };
  const sql = 'SELECT * FROM AR.dbo.AMRTZ_INST_SCHDL';
  const nameCol = sql.indexOf('AMRTZ_INST_SCHDL') + 1;
  const editorFor = (text: string, word: string, startColumn: number) => ({
    getModel: () => ({
      getWordAtPosition: () => ({ word, startColumn, endColumn: startColumn + word.length }),
      getValue: () => text,
      getOffsetAt: (p: { lineNumber: number; column: number }) => p.column - 1,
    }),
    getPosition: () => ({ lineNumber: 1, column: startColumn }),
  });
  const cross = (loaded: Record<string, DatabaseSchema>, currentDatabase = 'ACCRUAL') => ({
    databases: ['ACCRUAL', 'AR'],
    currentDatabase,
    requestSchema: async () => null,
    getLoadedSchema: (db: string) => loaded[db],
    version: 1,
  });

  it('returns the table with its database for OtherDb.schema.Table', () => {
    const ed = editorFor(sql, 'AMRTZ_INST_SCHDL', nameCol);
    const result = findTableAtCursorPosition(ed as any, { lineNumber: 1, column: nameCol }, testSchema, cross({ AR: otherSchema }));
    expect(result).toEqual({ schema: 'dbo', table: 'AMRTZ_INST_SCHDL', database: 'AR' });
  });

  it('returns null until the other database schema is loaded', () => {
    const ed = editorFor(sql, 'AMRTZ_INST_SCHDL', nameCol);
    expect(findTableAtCursorPosition(ed as any, { lineNumber: 1, column: nameCol }, testSchema, cross({}))).toBeNull();
  });

  it('omits the database when it is the connected one', () => {
    const text = 'SELECT * FROM ACCRUAL.dbo.Users';
    const col = text.indexOf('Users') + 1;
    const ed = editorFor(text, 'Users', col);
    const result = findTableAtCursorPosition(ed as any, { lineNumber: 1, column: col }, testSchema, cross({}));
    expect(result).toEqual({ schema: 'dbo', table: 'Users', database: undefined });
  });
});
