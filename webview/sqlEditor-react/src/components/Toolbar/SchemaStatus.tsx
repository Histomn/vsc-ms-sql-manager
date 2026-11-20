import { useEffect, useRef, useState } from 'react';
import { useVSCode } from '../../context/VSCodeContext';
import { describeSchemaCounts } from '../../services/schemaStatus';
import type { SchemaLoadStatus } from '../../types/schema';
import './SchemaStatus.css';

function StateIcon({ state }: { state: SchemaLoadStatus['state'] }) {
  if (state === 'loading') return <span className="schema-spinner" aria-label="Loading" />;
  if (state === 'error') return <span className="schema-state-icon schema-state-error" aria-label="Failed">!</span>;
  return <span className="schema-state-icon schema-state-ok" aria-label="Loaded">&#10003;</span>;
}

/**
 * Toolbar button that lists the databases whose schema (autocomplete data) is loaded,
 * is loading, or failed to load.
 */
export function SchemaStatus() {
  const { schemaStatuses } = useVSCode();
  const statuses: SchemaLoadStatus[] = schemaStatuses ?? [];
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (statuses.length === 0) return null;

  const loadedCount = statuses.filter((s) => s.state === 'loaded').length;
  const loading = statuses.some((s) => s.state === 'loading');
  const failed = statuses.some((s) => s.state === 'error');

  return (
    <div className="schema-status" ref={rootRef}>
      <button
        type="button"
        className={`toolbar-button secondary schema-status-button${failed ? ' has-error' : ''}`}
        title="Databases whose schema is loaded for autocomplete"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {loading ? (
          <span className="schema-spinner" aria-hidden="true" />
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <ellipse cx="12" cy="6" rx="8" ry="3" />
            <path d="M4 6v6a8 3 0 0 0 16 0v-6" />
            <path d="M4 12v6a8 3 0 0 0 16 0v-6" />
          </svg>
        )}
        <span>{loadedCount}/{statuses.length}</span>
      </button>

      {open && (
        <div className="schema-status-popover" role="dialog" aria-label="Loaded schemas">
          <div className="schema-status-title">Schemas for autocomplete</div>
          <ul>
            {statuses.map((s) => (
              <li key={s.key} className={`schema-status-item schema-${s.state}`}>
                <StateIcon state={s.state} />
                <div className="schema-status-text">
                  <div className="schema-status-name">
                    {s.database}
                    {s.isCurrent && <span className="schema-status-tag">selected</span>}
                  </div>
                  <div className="schema-status-detail">
                    {s.state === 'loaded' && describeSchemaCounts(s)}
                    {s.state === 'loading' && (s.detail ?? 'Loading...')}
                    {s.state === 'error' && (s.error ?? 'Failed to load')}
                  </div>
                  {s.state === 'loading' && (
                    <div className="schema-status-bar" aria-hidden="true">
                      <div
                        className={`schema-status-bar-fill${typeof s.progress === 'number' ? '' : ' indeterminate'}`}
                        style={typeof s.progress === 'number' ? { width: `${Math.round(s.progress * 100)}%` } : undefined}
                      />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}