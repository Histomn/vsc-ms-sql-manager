import { describe, it, expect } from 'vitest';
import {
  maskStringsAndComments,
  findCrossDatabaseReferences,
  prepareCrossDatabaseQuery,
} from './crossDatabaseResolver';
import { extractTablesFromQuery, getColumnsForTable } from './sqlCompletionService';
import { resolveWildcard } from './sqlWildcardService';
import { validateSql } from './sqlValidator';
import type { DatabaseSchema } from '../types/schema';

const local: DatabaseSchema = {
  tables: [{ schema: 'dbo', name: 'Users', columns: [{ name: 'Id', type: 'int', nullable: false }] }],
  views: [],
  foreignKeys: [],
};

const ar: DatabaseSchema = {
  tables: [
    {
      schema: 'dbo',
      name: 'AMRTZ_INST_SCHDL',
      columns: [
        { name: 'AMRTZ_INST_SCHDL_ID', type: 'bigint', nullable: false },
        { name: 'DUE_DT', type: 'date', nullable: true },
      ],
    },
    { schema: 'dbo', name: 'Users', columns: [{ name: 'ArUserId', type: 'int', nullable: false }] },
  ],
  views: [{ schema: 'rpt', name: 'vSummary', columns: [{ name: 'Total', type: 'int', nullable: true }] }],
  foreignKeys: [],
};

const ctx = (loaded: Record<string, DatabaseSchema> = { AR: ar }, currentDatabase: string | null = 'ACCRUAL') => ({
  databases: ['ACCRUAL', 'AR'],
  currentDatabase,
  getLoadedSchema: (db: string) => loaded[db],
});

describe('maskStringsAndComments', () => {
  it('keeps length and masks literals and comments', () => {
    const sql = "SELECT 'a.b.c' /* AR.dbo.T */ -- AR..T\nFROM x";
    const masked = maskStringsAndComments(sql);
    expect(masked.length).toBe(sql.length);
    expect(masked).not.toContain('AR');
    expect(masked).toContain('FROM x');
  });
});

describe('findCrossDatabaseReferences', () => {
  it('finds db.schema.table and db..table', () => {
    const refs = findCrossDatabaseReferences('SELECT * FROM AR.dbo.T1 a JOIN [AR]..T2 b ON 1=1', ['AR']);
    expect(refs.map((r) => [r.database, r.schema, r.name])).toEqual([
      ['AR', 'dbo', 'T1'],
      ['AR', null, 'T2'],
    ]);
  });

  it('ignores unknown first parts, comments and strings', () => {
    expect(findCrossDatabaseReferences('SELECT * FROM dbo.Users.Id', ['AR'])).toEqual([]);
    expect(findCrossDatabaseReferences("SELECT 'AR.dbo.T' -- AR.dbo.T", ['AR'])).toEqual([]);
  });
});

describe('prepareCrossDatabaseQuery', () => {
  it('returns inputs unchanged without cross-database references', () => {
    const sql = 'SELECT * FROM Users';
    const result = prepareCrossDatabaseQuery(sql, local, ctx());
    expect(result.sql).toBe(sql);
    expect(result.schema).toBe(local);
    expect(result.missing).toEqual([]);
  });

  it('blanks the database prefix without changing the text length', () => {
    const sql = 'SELECT * FROM AR.dbo.AMRTZ_INST_SCHDL WHERE ';
    const result = prepareCrossDatabaseQuery(sql, local, ctx());
    expect(result.sql.length).toBe(sql.length);
    expect(result.sql).toBe('SELECT * FROM    dbo.AMRTZ_INST_SCHDL WHERE ');
  });

  it('blanks db.. completely', () => {
    const result = prepareCrossDatabaseQuery('FROM AR..AMRTZ_INST_SCHDL', local, ctx());
    expect(result.sql).toBe('FROM     AMRTZ_INST_SCHDL');
  });

  it('adds the referenced table to the schema so columns resolve', () => {
    const sql = 'SELECT * FROM AR.dbo.AMRTZ_INST_SCHDL x WHERE ';
    const result = prepareCrossDatabaseQuery(sql, local, ctx());
    const tables = extractTablesFromQuery(result.sql, result.schema);
    expect(tables.map((t) => t.table)).toEqual(['AMRTZ_INST_SCHDL']);
    expect(tables[0].alias).toBe('x');
    expect(getColumnsForTable('dbo', 'AMRTZ_INST_SCHDL', result.schema).map((c) => c.name)).toEqual([
      'AMRTZ_INST_SCHDL_ID',
      'DUE_DT',
    ]);
  });

  it('resolves views and uses the other database for same-named tables', () => {
    const result = prepareCrossDatabaseQuery('FROM AR.rpt.vSummary v JOIN AR.dbo.Users u ON 1=1', local, ctx());
    expect(getColumnsForTable('rpt', 'vSummary', result.schema).map((c) => c.name)).toEqual(['Total']);
    expect(getColumnsForTable('dbo', 'Users', result.schema).map((c) => c.name)).toEqual(['ArUserId']);
    expect(local.tables[0].columns[0].name).toBe('Id'); // base schema is not mutated
  });

  it('expands * for a table of another database', () => {
    const sql = 'SELECT * FROM AR.dbo.AMRTZ_INST_SCHDL';
    const prepared = prepareCrossDatabaseQuery(sql, local, ctx());
    const resolution = resolveWildcard(
      prepared.sql,
      { alias: null, wildcardRange: { startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 9 } },
      prepared.schema
    );
    expect(resolution?.totalColumns).toBe(2);
  });

  it('does not report the other database table as unknown once its schema is loaded', () => {
    const sql = 'SELECT * FROM AR.dbo.AMRTZ_INST_SCHDL';
    const before = validateSql(prepareCrossDatabaseQuery(sql, local, ctx({})).sql, local);
    expect(before.length).toBeGreaterThan(0);
    const prepared = prepareCrossDatabaseQuery(sql, local, ctx());
    expect(validateSql(prepared.sql, prepared.schema)).toEqual([]);
  });

  it('reports databases that are not loaded yet and leaves the text untouched', () => {
    const sql = 'FROM AR.dbo.T';
    const result = prepareCrossDatabaseQuery(sql, local, ctx({}));
    expect(result.missing).toEqual(['AR']);
    expect(result.sql).toBe(sql);
    expect(result.schema).toBe(local);
  });

  it('treats the current database prefix as a plain qualifier', () => {
    const result = prepareCrossDatabaseQuery('FROM ACCRUAL.dbo.Users', local, ctx({}, 'ACCRUAL'));
    expect(result.sql).toBe('FROM         dbo.Users');
    expect(result.missing).toEqual([]);
    expect(result.schema).toBe(local);
  });
});
