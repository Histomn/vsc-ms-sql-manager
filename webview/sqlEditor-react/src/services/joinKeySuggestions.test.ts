import { describe, it, expect } from 'vitest';
import { getJoinKeySuggestions } from './joinKeySuggestions';
import { extractTablesFromQuery } from './sqlCompletionService';
import type { DatabaseSchema } from '../types/schema';

const col = (name: string, type = 'bigint') => ({ name, type, nullable: false });

const schema: DatabaseSchema = {
  tables: [
    {
      schema: 'dbo',
      name: 'AGRMNT_ACC_MNT',
      columns: [col('AGRMNT_ACC_MNT_ID'), col('AGRMNT_ID'), col('AGRMNT_DT', 'date'), col('DTM_CRT', 'datetime'), col('STATUS', 'varchar')],
    },
    {
      schema: 'dbo',
      name: 'AGRMNT',
      columns: [col('AGRMNT_ID'), col('AGRMNT_DT', 'datetime'), col('DTM_CRT', 'datetime'), col('STATUS', 'int'), col('APP_NO', 'varchar')],
    },
    { schema: 'dbo', name: 'CUSTOMER', columns: [col('CUSTOMER_ID'), col('AGRMNT_ID')] },
  ],
  views: [],
  foreignKeys: [],
};

const suggest = (sql: string, s: DatabaseSchema = schema) =>
  getJoinKeySuggestions(sql, extractTablesFromQuery(sql, s), s);

describe('getJoinKeySuggestions', () => {
  it('recommends same-named columns of the joined table and the existing table', () => {
    const sql = 'SELECT * FROM dbo.AGRMNT_ACC_MNT aam\njoin dbo.AGRMNT a on ';
    const result = suggest(sql);
    expect(result.map((r) => r.text)).toEqual(['aam.AGRMNT_ID = a.AGRMNT_ID']);
  });

  it('skips audit columns and columns with different types', () => {
    const sql = 'SELECT * FROM dbo.AGRMNT_ACC_MNT aam join dbo.AGRMNT a on ';
    const texts = suggest(sql).map((r) => r.text);
    expect(texts).not.toContain('aam.DTM_CRT = a.DTM_CRT');
    expect(texts).not.toContain('aam.AGRMNT_DT = a.AGRMNT_DT'); // date vs datetime
    expect(texts).not.toContain('aam.STATUS = a.STATUS'); // varchar vs int
  });

  it('compares against every table already in the query', () => {
    const sql = 'SELECT * FROM dbo.AGRMNT_ACC_MNT aam join dbo.AGRMNT a on a.AGRMNT_ID = aam.AGRMNT_ID join dbo.CUSTOMER c on ';
    expect(suggest(sql).map((r) => r.text)).toEqual(['aam.AGRMNT_ID = c.AGRMNT_ID', 'a.AGRMNT_ID = c.AGRMNT_ID']);
  });

  it('ranks foreign keys first', () => {
    const withFk: DatabaseSchema = {
      ...schema,
      foreignKeys: [
        { fromSchema: 'dbo', fromTable: 'AGRMNT_ACC_MNT', fromColumn: 'AGRMNT_ID', toSchema: 'dbo', toTable: 'AGRMNT', toColumn: 'AGRMNT_ID' },
      ],
    };
    const sql = 'SELECT * FROM dbo.AGRMNT_ACC_MNT aam join dbo.AGRMNT a on ';
    const result = suggest(sql, withFk);
    expect(result[0]).toMatchObject({ text: 'aam.AGRMNT_ID = a.AGRMNT_ID', priority: 0 });
    expect(result).toHaveLength(1);
  });

  it('works without aliases and returns nothing outside a JOIN ... ON', () => {
    expect(suggest('SELECT * FROM AGRMNT_ACC_MNT join AGRMNT on ').map((r) => r.text)).toEqual([
      'AGRMNT_ACC_MNT.AGRMNT_ID = AGRMNT.AGRMNT_ID',
    ]);
    expect(suggest('SELECT * FROM AGRMNT_ACC_MNT aam WHERE ')).toEqual([]);
  });
});
