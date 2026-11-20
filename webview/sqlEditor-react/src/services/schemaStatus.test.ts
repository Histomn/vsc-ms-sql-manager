import { describe, it, expect } from 'vitest';
import { summarizeSchemaLoads, describeSchemaCounts } from './schemaStatus';
import type { SchemaLoadStatus } from '../types/schema';

const status = (database: string, patch: Partial<SchemaLoadStatus> = {}): SchemaLoadStatus => ({
  key: database,
  connectionId: 'c1',
  database,
  state: 'loaded',
  tables: 0,
  views: 0,
  procedures: 0,
  ...patch,
});

describe('summarizeSchemaLoads', () => {
  it('is inactive when nothing is loading', () => {
    expect(summarizeSchemaLoads([])).toMatchObject({ active: false, label: '' });
    expect(summarizeSchemaLoads([status('AR'), status('AP', { state: 'error' })]).active).toBe(false);
  });

  it('reports a determinate average progress with a label', () => {
    const result = summarizeSchemaLoads([
      status('AR', { state: 'loading', progress: 1 / 3 }),
      status('AP', { state: 'loading', progress: 1 }),
      status('X'),
    ]);
    expect(result.active).toBe(true);
    expect(result.indeterminate).toBe(false);
    expect(result.progress).toBeCloseTo(2 / 3);
    expect(result.label).toBe('Loading AR, AP schema...');
  });

  it('is indeterminate when a running load has no progress and shortens long name lists', () => {
    const result = summarizeSchemaLoads([
      status('A', { state: 'loading' }),
      status('B', { state: 'loading', progress: 0.5 }),
      status('C', { state: 'loading', progress: 0.5 }),
    ]);
    expect(result.indeterminate).toBe(true);
    expect(result.label).toBe('Loading A, B +1 schema...');
  });
});

describe('describeSchemaCounts', () => {
  it('pluralizes', () => {
    expect(describeSchemaCounts({ tables: 1, views: 0, procedures: 20 })).toBe('1 table, 0 views, 20 procedures');
  });
});
