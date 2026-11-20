import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SchemaStatus } from './SchemaStatus';
import { useVSCode } from '../../context/VSCodeContext';
import type { SchemaLoadStatus } from '../../types/schema';

vi.mock('../../context/VSCodeContext', () => ({
  useVSCode: vi.fn(),
}));

const base = { connectionId: 'c1', tables: 0, views: 0, procedures: 0 };
const statuses: SchemaLoadStatus[] = [
  { ...base, key: 'c1::current', database: 'master', state: 'loaded', tables: 12, views: 3, procedures: 20, isCurrent: true },
  { ...base, key: 'c1::ar', database: 'AR', state: 'loading', progress: 1 / 3, detail: 'Loaded tables' },
  { ...base, key: 'c1::zz', database: 'ZZ', state: 'error', error: 'Permission denied' },
];

describe('SchemaStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing without schemas', () => {
    vi.mocked(useVSCode).mockReturnValue({ schemaStatuses: [] } as any);
    const { container } = render(<SchemaStatus />);
    expect(container.firstChild).toBeNull();
  });

  it('shows loaded/total in the button and lists databases in the popover', () => {
    vi.mocked(useVSCode).mockReturnValue({ schemaStatuses: statuses } as any);
    render(<SchemaStatus />);
    const button = screen.getByRole('button');
    expect(button.textContent).toContain('1/3');

    fireEvent.click(button);
    expect(screen.getByText('master')).toBeDefined();
    expect(screen.getByText('selected')).toBeDefined();
    expect(screen.getByText('12 tables, 3 views, 20 procedures')).toBeDefined();
    expect(screen.getByText('AR')).toBeDefined();
    expect(screen.getByText('Loaded tables')).toBeDefined();
    expect(screen.getByText('Permission denied')).toBeDefined();
  });

  it('closes the popover on Escape', () => {
    vi.mocked(useVSCode).mockReturnValue({ schemaStatuses: statuses } as any);
    render(<SchemaStatus />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
