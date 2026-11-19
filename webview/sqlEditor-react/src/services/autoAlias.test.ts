import { describe, it, expect } from 'vitest';
import { createUniqueAlias, isDeleteFromContext, isTableReferencePosition, hasTextAfterCursor } from './autoAlias';

describe('createUniqueAlias', () => {
  it('builds an alias from the table name initials', () => {
    expect(createUniqueAlias('AGRMNT_ACC_MNT', new Set())).toBe('aam');
    expect(createUniqueAlias('Users', new Set())).toBe('u');
    expect(createUniqueAlias('OrderItems', new Set())).toBe('oi');
  });

  it('avoids aliases already used in the query (case-insensitive)', () => {
    expect(createUniqueAlias('AGRMNT_ACC_MNT', new Set(['aam']))).toBe('aam2');
    expect(createUniqueAlias('AGRMNT_ACC_MNT', new Set(['aam', 'aam2']))).toBe('aam3');
    expect(createUniqueAlias('Users', new Set(['u']))).toBe('u2');
  });

  it('never returns a reserved keyword', () => {
    expect(createUniqueAlias('Orders_Names', new Set())).toBe('on2');
    expect(createUniqueAlias('Inventory_Stock', new Set())).not.toBe('is');
  });
});

describe('isDeleteFromContext', () => {
  it('detects DELETE FROM only', () => {
    expect(isDeleteFromContext('DELETE FROM ')).toBe(true);
    expect(isDeleteFromContext('SELECT 1; delete top (5) from dbo.Us')).toBe(true);
    expect(isDeleteFromContext('SELECT * FROM ')).toBe(false);
    expect(isDeleteFromContext('DELETE a FROM ')).toBe(false); // alias form: alias allowed
    expect(isDeleteFromContext('DELETE FROM t; SELECT * FROM ')).toBe(false);
  });
});

describe('isTableReferencePosition', () => {
  it('is true right after FROM / JOIN, also while typing a qualified name', () => {
    expect(isTableReferencePosition('SELECT * FROM ')).toBe(true);
    expect(isTableReferencePosition('SELECT * FROM a JOIN AR.dbo.')).toBe(true);
    expect(isTableReferencePosition('SELECT * FROM a WHERE ')).toBe(false);
    expect(isTableReferencePosition('EXEC AR.dbo.')).toBe(false);
  });
});

describe('hasTextAfterCursor', () => {
  it('detects an existing alias or table text after the cursor', () => {
    expect(hasTextAfterCursor('')).toBe(false);
    expect(hasTextAfterCursor('   ')).toBe(false);
    expect(hasTextAfterCursor(' WHERE x = 1')).toBe(false);
    expect(hasTextAfterCursor(' a ON a.id = b.id')).toBe(true);
    expect(hasTextAfterCursor(');')).toBe(false);
    expect(hasTextAfterCursor(', b')).toBe(false);
  });
});
