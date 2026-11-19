import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCompletionProvider, type CrossDatabaseContext } from '../hooks/useCompletionProvider';
import type { DatabaseSchema } from '../../../types/schema';

const currentSchema: DatabaseSchema = {
  tables: [{ schema: 'dbo', name: 'Users', columns: [{ name: 'Id', type: 'int', nullable: false }] }],
  views: [{ schema: 'dbo', name: 'vUsers', columns: [] }],
  foreignKeys: [],
  storedProcedures: [
    { schema: 'dbo', name: 'usp_get_users', parameters: [{ name: '@id', type: 'int', mode: 'IN' }] },
    { schema: 'rpt', name: 'usp_report' },
  ],
};

const otherSchema: DatabaseSchema = {
  tables: [{ schema: 'dbo', name: 'Customers', columns: [] }, { schema: 'hr', name: 'Staff', columns: [] }],
  views: [],
  foreignKeys: [],
  storedProcedures: [{ schema: 'dbo', name: 'usp_other' }],
};

function setup(crossDb: CrossDatabaseContext) {
  const registerCompletionItemProvider = vi.fn(() => ({ dispose: vi.fn() }));
  const kinds = new Proxy({}, { get: (_t, p) => String(p) });
  const monaco = {
    languages: {
      registerCompletionItemProvider,
      CompletionItemKind: kinds,
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    },
  };
  renderHook(() => useCompletionProvider({ current: monaco } as any, currentSchema, true, crossDb));
  const provider = (registerCompletionItemProvider.mock.calls as any[])[0][1];

  return async (sql: string) => {
    const model = {
      getWordUntilPosition: () => ({ word: '', startColumn: sql.length + 1, endColumn: sql.length + 1 }),
      getValueInRange: ({ startColumn, endColumn, startLineNumber, endLineNumber }: any) =>
        startLineNumber === 1 && endLineNumber === 1 ? sql.slice(startColumn - 1, endColumn - 1) : sql,
      getValue: () => sql,
    };
    const result = await provider.provideCompletionItems(model, { lineNumber: 1, column: sql.length + 1 });
    return (result.suggestions as any[]).map((s) => ({ label: s.label as string, kind: s.kind as string, insertText: s.insertText as string, detail: s.detail as string }));
  };
}

const makeCross = () => {
  const requestSchema = vi.fn(async (db: string) => (db === 'AR' ? otherSchema : null));
  const crossDb: CrossDatabaseContext = {
    databases: ['AP', 'AR'],
    currentDatabase: 'AP',
    requestSchema,
    getLoadedSchema: () => undefined,
    version: 0,
  };
  return { crossDb, requestSchema };
};

describe('useCompletionProvider cross-database completion', () => {
  it('suggests database names after FROM', async () => {
    const { crossDb } = makeCross();
    const run = setup(crossDb);
    const items = await run('SELECT * FROM ');
    const dbItems = items.filter((i) => i.detail === 'Database');
    expect(dbItems.map((i) => i.label)).toEqual(['AP', 'AR']);
    expect(dbItems[0].insertText).toBe('AP.');
    expect(items.map((i) => i.label)).toContain('Users');
  });

  it('lists schemas of another database after `db.` and loads it lazily', async () => {
    const { crossDb, requestSchema } = makeCross();
    const run = setup(crossDb);
    const items = await run('SELECT * FROM AR.');
    expect(requestSchema).toHaveBeenCalledWith('AR');
    expect(items.map((i) => i.label)).toEqual(['dbo', 'hr']);
    expect(items[0].insertText).toBe('dbo.');
  });

  it('lists tables after `db.schema.`', async () => {
    const { crossDb } = makeCross();
    const run = setup(crossDb);
    const items = await run('SELECT * FROM AR.dbo.');
    expect(items.map((i) => i.label)).toEqual(['Customers']);
    const hr = await run('SELECT * FROM AR.hr.');
    expect(hr.map((i) => i.label)).toEqual(['Staff']);
  });

  it('uses the default (dbo) schema for `db..`', async () => {
    const { crossDb } = makeCross();
    const run = setup(crossDb);
    const items = await run('SELECT * FROM AR..');
    expect(items.map((i) => i.label)).toEqual(['Customers']);
  });

  it('does not request the schema of the current database', async () => {
    const { crossDb, requestSchema } = makeCross();
    const run = setup(crossDb);
    const items = await run('SELECT * FROM AP.dbo.');
    expect(requestSchema).not.toHaveBeenCalled();
    expect(items.map((i) => i.label)).toEqual(['Users', 'vUsers']);
  });

  it('suggests stored procedures and databases after EXEC', async () => {
    const { crossDb } = makeCross();
    const run = setup(crossDb);
    const items = await run('EXEC ');
    const labels = items.map((i) => i.label);
    expect(labels).toContain('usp_get_users');
    expect(labels).toContain('[rpt].[usp_report]');
    expect(labels).toContain('AR');
    expect(labels).not.toContain('Users');
    const proc = items.find((i) => i.label === 'usp_get_users');
    expect(proc?.detail).toBe('Stored Procedure (@id int)');
  });

  it('lists procedures of another database after `EXEC db.dbo.`', async () => {
    const { crossDb } = makeCross();
    const run = setup(crossDb);
    const items = await run('EXEC AR.dbo.');
    expect(items.map((i) => i.label)).toEqual(['usp_other']);
  });

  it('lists objects of a schema in the current database after `schema.`', async () => {
    const { crossDb } = makeCross();
    const run = setup(crossDb);
    const items = await run('EXEC rpt.');
    expect(items.map((i) => i.label)).toEqual(['usp_report']);
  });

  it('suggests columns of a table from another database in WHERE', async () => {
    const withColumns: DatabaseSchema = {
      tables: [{
        schema: 'dbo',
        name: 'AMRTZ_INST_SCHDL',
        columns: [{ name: 'DUE_DT', type: 'date', nullable: true }, { name: 'ROW_VERSION', type: 'timestamp', nullable: false }],
      }],
      views: [],
      foreignKeys: [],
    };
    const crossDb: CrossDatabaseContext = {
      databases: ['AP', 'AR'],
      currentDatabase: 'AP',
      requestSchema: vi.fn(async () => withColumns),
      getLoadedSchema: (db: string) => (db === 'AR' ? withColumns : undefined),
      version: 1,
    };
    const run = setup(crossDb);
    const items = await run('SELECT * FROM AR.dbo.AMRTZ_INST_SCHDL WHERE ');
    expect(items.map((i) => i.label)).toEqual(['DUE_DT', 'ROW_VERSION']);
  });

  it('asks for the schema of a referenced database that is not loaded yet', async () => {
    const { crossDb, requestSchema } = makeCross();
    const run = setup(crossDb);
    await run('SELECT * FROM AR.dbo.Customers WHERE ');
    expect(requestSchema).toHaveBeenCalledWith('AR');
  });

  it('returns no suggestions when the other schema cannot be loaded', async () => {
    const requestSchema = vi.fn(async () => null);
    const run = setup({ databases: ['AP', 'ZZ'], currentDatabase: 'AP', requestSchema, getLoadedSchema: () => undefined, version: 0 });
    expect(await run('SELECT * FROM ZZ.dbo.')).toEqual([]);
  });
});
