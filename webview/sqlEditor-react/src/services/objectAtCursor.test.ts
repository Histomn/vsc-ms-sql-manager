import { describe, it, expect } from 'vitest';
import { resolveObjectAtOffset } from './objectAtCursor';
import type { DatabaseSchema } from '../types/schema';

const local: DatabaseSchema = {
  tables: [{ schema: 'dbo', name: 'Users', columns: [] }, { schema: 'sales', name: 'Orders', columns: [] }],
  views: [{ schema: 'dbo', name: 'vActive', columns: [] }],
  foreignKeys: [],
  storedProcedures: [{ schema: 'dbo', name: 'usp_get_users' }, { schema: 'rpt', name: 'usp_report' }],
};
const ar: DatabaseSchema = {
  tables: [{ schema: 'dbo', name: 'AGRMNT_ACC_MNT', columns: [] }],
  views: [],
  foreignKeys: [],
  storedProcedures: [{ schema: 'dbo', name: 'usp_ar' }],
};
const cross = (loaded: Record<string, DatabaseSchema> = { AR: ar }) => ({
  databases: ['ACCRUAL', 'AR'],
  currentDatabase: 'ACCRUAL',
  requestSchema: async () => null,
  getLoadedSchema: (db: string) => loaded[db],
  version: 1,
});

/** Offset of the first character of `word` (or its Nth char) in sql */
const at = (sql: string, word: string, plus = 1) => sql.indexOf(word) + plus;

describe('resolveObjectAtOffset', () => {
  it('resolves a plain table name', () => {
    const sql = 'SELECT * FROM Users WHERE 1=1';
    expect(resolveObjectAtOffset(sql, at(sql, 'Users'), local, cross())).toEqual({ kind: 'table', database: undefined, schema: 'dbo', name: 'Users' });
  });

  it('resolves schema-qualified tables, views and procedures', () => {
    const sql = 'SELECT * FROM sales.Orders; SELECT * FROM vActive; EXEC rpt.usp_report';
    expect(resolveObjectAtOffset(sql, at(sql, 'Orders'), local)).toMatchObject({ kind: 'table', schema: 'sales', name: 'Orders' });
    expect(resolveObjectAtOffset(sql, at(sql, 'vActive'), local)).toMatchObject({ kind: 'view', name: 'vActive' });
    expect(resolveObjectAtOffset(sql, at(sql, 'usp_report'), local)).toMatchObject({ kind: 'procedure', schema: 'rpt' });
  });

  it('resolves an unqualified stored procedure after EXEC', () => {
    const sql = 'EXEC usp_get_users @id = 1';
    expect(resolveObjectAtOffset(sql, at(sql, 'usp_get_users', 3), local)).toMatchObject({ kind: 'procedure', schema: 'dbo', name: 'usp_get_users' });
  });

  it('resolves objects in another database and reports the database', () => {
    const sql = 'SELECT * FROM AR.dbo.AGRMNT_ACC_MNT; EXEC AR.dbo.usp_ar';
    expect(resolveObjectAtOffset(sql, at(sql, 'AGRMNT_ACC_MNT'), local, cross())).toEqual({ kind: 'table', database: 'AR', schema: 'dbo', name: 'AGRMNT_ACC_MNT' });
    expect(resolveObjectAtOffset(sql, at(sql, 'usp_ar'), local, cross())).toMatchObject({ kind: 'procedure', database: 'AR' });
  });

  it('supports db..name and bracketed names', () => {
    const sql = 'SELECT * FROM AR..AGRMNT_ACC_MNT; SELECT * FROM [AR].[dbo].[AGRMNT_ACC_MNT]';
    expect(resolveObjectAtOffset(sql, at(sql, 'AGRMNT_ACC_MNT'), local, cross())).toMatchObject({ database: 'AR', schema: 'dbo' });
    expect(resolveObjectAtOffset(sql, sql.lastIndexOf('AGRMNT_ACC_MNT') + 2, local, cross())).toMatchObject({ database: 'AR' });
  });

  it('omits the database for the connected database', () => {
    const sql = 'SELECT * FROM ACCRUAL.dbo.Users';
    expect(resolveObjectAtOffset(sql, at(sql, 'Users'), local, cross())).toMatchObject({ name: 'Users', database: undefined });
  });

  it('returns null for unknown names, schema parts, unloaded databases, comments and strings', () => {
    const sql = "SELECT * FROM Nope; SELECT * FROM sales.Orders; SELECT * FROM AR.dbo.AGRMNT_ACC_MNT -- Users\nSELECT 'Users'";
    expect(resolveObjectAtOffset(sql, at(sql, 'Nope'), local, cross())).toBeNull();
    expect(resolveObjectAtOffset(sql, at(sql, 'sales'), local, cross())).toBeNull();
    expect(resolveObjectAtOffset(sql, at(sql, 'AGRMNT_ACC_MNT'), local, cross({}))).toBeNull();
    expect(resolveObjectAtOffset(sql, sql.indexOf('-- Users') + 4, local, cross())).toBeNull();
    expect(resolveObjectAtOffset(sql, sql.lastIndexOf('Users') + 1, local, cross())).toBeNull();
  });
});
