import { describe, it, expect } from 'vitest';
import {
  parseQualifiedPrefix,
  isExecContext,
  findDatabaseName,
  getSchemaNames,
  quoteIfNeeded,
  formatProcedureParameters,
} from './crossDatabaseCompletion';

describe('parseQualifiedPrefix', () => {
  it('parses db. as a two-part prefix', () => {
    expect(parseQualifiedPrefix('SELECT * FROM AR.')).toEqual({ kind: 'two', first: 'AR', partial: '' });
    expect(parseQualifiedPrefix('SELECT * FROM AR.dbo')).toEqual({ kind: 'two', first: 'AR', partial: 'dbo' });
  });

  it('parses db.schema. as a three-part prefix', () => {
    expect(parseQualifiedPrefix('FROM AR.dbo.')).toEqual({ kind: 'three', db: 'AR', schema: 'dbo', partial: '' });
    expect(parseQualifiedPrefix('FROM AR.dbo.cust')).toEqual({ kind: 'three', db: 'AR', schema: 'dbo', partial: 'cust' });
  });

  it('parses db..partial (default schema)', () => {
    expect(parseQualifiedPrefix('FROM AR..cu')).toEqual({ kind: 'defaultSchema', db: 'AR', partial: 'cu' });
  });

  it('handles bracketed identifiers', () => {
    expect(parseQualifiedPrefix('FROM [My DB].[dbo].')).toEqual({ kind: 'three', db: 'My DB', schema: 'dbo', partial: '' });
    expect(parseQualifiedPrefix('FROM [My DB].')).toEqual({ kind: 'two', first: 'My DB', partial: '' });
  });

  it('works mid-line after commas and parentheses', () => {
    expect(parseQualifiedPrefix('JOIN a ON x=1, (SELECT 1 FROM AP.')).toEqual({ kind: 'two', first: 'AP', partial: '' });
  });

  it('returns null without a dot or with four-part names', () => {
    expect(parseQualifiedPrefix('SELECT * FROM ')).toBeNull();
    expect(parseQualifiedPrefix('SELECT * FROM abc')).toBeNull();
    expect(parseQualifiedPrefix('FROM srv.AR.dbo.t')).toBeNull();
  });
});

describe('isExecContext', () => {
  it('detects EXEC and EXECUTE', () => {
    expect(isExecContext('EXEC ')).toBe(true);
    expect(isExecContext('exec usp_get')).toBe(true);
    expect(isExecContext('  EXECUTE dbo.usp')).toBe(true);
    expect(isExecContext('EXEC @rc = usp')).toBe(true);
    expect(isExecContext('INSERT INTO t EXEC ')).toBe(true);
  });

  it('does not trigger on other text', () => {
    expect(isExecContext('SELECT * FROM executions ')).toBe(false);
    expect(isExecContext('EXEC usp_a @p1 = ')).toBe(false);
    expect(isExecContext('SELECT 1')).toBe(false);
  });
});

describe('findDatabaseName', () => {
  it('matches case-insensitively and returns the canonical name', () => {
    expect(findDatabaseName('ar', ['AP', 'AR'])).toBe('AR');
    expect(findDatabaseName('zz', ['AP', 'AR'])).toBeNull();
  });
});

describe('getSchemaNames', () => {
  it('returns distinct schemas across tables, views and procedures', () => {
    const schema = {
      tables: [{ schema: 'dbo', name: 'a', columns: [] }, { schema: 'hr', name: 'b', columns: [] }],
      views: [{ schema: 'DBO', name: 'v', columns: [] }],
      foreignKeys: [],
      storedProcedures: [{ schema: 'rpt', name: 'p' }],
    };
    expect(getSchemaNames(schema)).toEqual(['dbo', 'hr', 'rpt']);
  });
});

describe('quoteIfNeeded', () => {
  it('quotes names that are not plain identifiers', () => {
    expect(quoteIfNeeded('Orders')).toBe('Orders');
    expect(quoteIfNeeded('My Table')).toBe('[My Table]');
    expect(quoteIfNeeded('a]b')).toBe('[a]]b]');
  });
});

describe('formatProcedureParameters', () => {
  it('formats parameter lists', () => {
    expect(
      formatProcedureParameters({
        schema: 'dbo',
        name: 'p',
        parameters: [
          { name: '@id', type: 'int', mode: 'IN' },
          { name: '@out', type: 'varchar', mode: 'INOUT' },
        ],
      })
    ).toBe('@id int, @out varchar OUT');
    expect(formatProcedureParameters({ schema: 'dbo', name: 'p' })).toBe('');
  });
});
