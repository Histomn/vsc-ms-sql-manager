import type { SchemaLoadStatus } from '../types/schema';

export interface SchemaLoadSummary {
  active: boolean;
  /** True when at least one running load has no measurable progress. */
  indeterminate: boolean;
  /** Average progress (0..1) of the running loads. */
  progress: number;
  /** Text such as `Loading AR schema...` */
  label: string;
}

/** Combines the running schema loads into one progress value and label. */
export function summarizeSchemaLoads(statuses: SchemaLoadStatus[]): SchemaLoadSummary {
  const running = statuses.filter((s) => s.state === 'loading');
  if (running.length === 0) return { active: false, indeterminate: false, progress: 0, label: '' };

  const known = running.filter((s) => typeof s.progress === 'number');
  const indeterminate = known.length !== running.length;
  const progress = known.length > 0 ? known.reduce((sum, s) => sum + (s.progress as number), 0) / known.length : 0;
  const names = running.map((s) => s.database);
  const shown = names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  return { active: true, indeterminate, progress, label: `Loading ${shown} schema...` };
}

/** `12 tables, 3 views, 20 procedures` */
export function describeSchemaCounts(status: Pick<SchemaLoadStatus, 'tables' | 'views' | 'procedures'>): string {
  const part = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [part(status.tables, 'table', 'tables'), part(status.views, 'view', 'views'), part(status.procedures, 'procedure', 'procedures')].join(', ');
}
