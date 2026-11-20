import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Toolbar } from './Toolbar';
import { useVSCode } from '../../context/VSCodeContext';

vi.mock('../../context/VSCodeContext', () => ({ useVSCode: vi.fn() }));
vi.mock('./ExecuteButton', () => ({ ExecuteButton: () => <div /> }));
vi.mock('./ConnectionDropdown', () => ({ ConnectionDropdown: () => <div /> }));
vi.mock('./DatabaseDropdown', () => ({ DatabaseDropdown: () => <div /> }));
vi.mock('./FormatButton', () => ({ FormatButton: () => <div /> }));

const props = {
  onExecute: vi.fn(),
  onEstimatedPlan: vi.fn(),
  onFormat: vi.fn(),
  isExecuting: false,
  includeActualPlan: false,
  onToggleActualPlan: vi.fn(),
};

const ctx = (schemaStatuses: any[]) =>
  ({ isConnected: true, cancelQuery: vi.fn(), manageConnections: vi.fn(), connections: [], currentConnectionId: 'c1', schemaStatuses }) as any;

describe('Toolbar schema loading progress', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a determinate progress bar and label while a schema loads', () => {
    vi.mocked(useVSCode).mockReturnValue(
      ctx([{ key: 'k', connectionId: 'c1', database: 'AR', state: 'loading', progress: 0.5, tables: 0, views: 0, procedures: 0 }])
    );
    render(<Toolbar {...props} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect(screen.getByText('Loading AR schema...')).toBeDefined();
  });

  it('shows no progress bar when every schema is loaded', () => {
    vi.mocked(useVSCode).mockReturnValue(
      ctx([{ key: 'k', connectionId: 'c1', database: 'AR', state: 'loaded', tables: 1, views: 0, procedures: 0 }])
    );
    render(<Toolbar {...props} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('Ready')).toBeDefined();
  });
});
