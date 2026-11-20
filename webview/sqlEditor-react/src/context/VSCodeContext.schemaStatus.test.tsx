import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { VSCodeProvider, useVSCode } from './VSCodeContext';
import type { IncomingMessage } from '../types/messages';

describe('VSCodeContext - schema loading status', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;
  let messageHandler: ((event: MessageEvent) => void) | null = null;

  beforeEach(() => {
    postMessageMock = vi.fn();
    (global as any).acquireVsCodeApi = () => ({ postMessage: postMessageMock, getState: () => null, setState: () => {} });
    const original = window.addEventListener;
    vi.spyOn(window, 'addEventListener').mockImplementation((event, handler) => {
      if (event === 'message') messageHandler = handler as (event: MessageEvent) => void;
      return original.call(window, event, handler);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    messageHandler = null;
  });

  const send = (message: IncomingMessage) => act(() => { messageHandler!(new MessageEvent('message', { data: message })); });
  const render = () => renderHook(() => useVSCode(), { wrapper: VSCodeProvider });

  const connect = (result: ReturnType<typeof render>['result']) => {
    send({
      type: 'connectionsUpdate',
      connections: [{ id: 'c1', name: 'Server', server: 's', connectionType: 'server' } as any],
      currentConnectionId: 'c1',
      currentDatabase: 'master',
    } as IncomingMessage);
    expect(result.current.currentConnectionId).toBe('c1');
  };

  it('lists the connected database as loading, then loaded with object counts', () => {
    const { result } = render();
    connect(result);
    expect(result.current.schemaStatuses).toMatchObject([{ database: 'master', state: 'loading', isCurrent: true }]);

    send({
      type: 'schemaUpdate',
      schema: {
        tables: [{ schema: 'dbo', name: 'T', columns: [] }],
        views: [],
        foreignKeys: [],
        storedProcedures: [{ schema: 'dbo', name: 'p' }],
      },
    });
    expect(result.current.schemaStatuses).toMatchObject([
      { database: 'master', state: 'loaded', tables: 1, views: 0, procedures: 1 },
    ]);
  });

  it('tracks progress and completion of another database schema', async () => {
    const { result } = render();
    connect(result);
    send({ type: 'schemaUpdate', schema: { tables: [], views: [], foreignKeys: [] } });

    let promise!: Promise<unknown>;
    act(() => { promise = result.current.requestDatabaseSchema('AR'); });
    const request = postMessageMock.mock.calls.map((c) => c[0]).find((m) => m.type === 'requestDatabaseSchema');
    expect(request).toMatchObject({ database: 'AR' });
    expect(result.current.schemaStatuses.find((s) => s.database === 'AR')).toMatchObject({ state: 'loading', progress: 0 });

    send({ type: 'databaseSchemaProgress', requestId: request.requestId, database: 'AR', completed: 1, total: 3, detail: 'Loaded tables' });
    expect(result.current.schemaStatuses.find((s) => s.database === 'AR')).toMatchObject({ state: 'loading', detail: 'Loaded tables' });
    expect(result.current.schemaStatuses.find((s) => s.database === 'AR')?.progress).toBeCloseTo(1 / 3);

    send({
      type: 'databaseSchemaUpdate',
      requestId: request.requestId,
      database: 'AR',
      schema: { tables: [{ schema: 'dbo', name: 'A', columns: [] }, { schema: 'dbo', name: 'B', columns: [] }], views: [], foreignKeys: [] },
    });
    await promise;
    expect(result.current.schemaStatuses.find((s) => s.database === 'AR')).toMatchObject({ state: 'loaded', tables: 2, progress: 1 });
    expect(result.current.getLoadedDatabaseSchema('AR')?.tables).toHaveLength(2);
  });

  it('reloads the connected database through the extension', () => {
    const { result } = render();
    connect(result);
    send({ type: 'schemaUpdate', schema: { tables: [], views: [], foreignKeys: [] } });
    postMessageMock.mockClear();

    act(() => result.current.reloadSchema('master'));
    expect(postMessageMock).toHaveBeenCalledWith({ type: 'reloadSchema', connectionId: 'c1', database: 'master' });
    expect(result.current.schemaStatuses[0]).toMatchObject({ database: 'master', state: 'loading' });

    send({ type: 'schemaUpdate', schema: { tables: [{ schema: 'dbo', name: 'New', columns: [] }], views: [], foreignKeys: [] } });
    expect(result.current.schemaStatuses[0]).toMatchObject({ state: 'loaded', tables: 1 });
  });

  it('keeps the previous schema and reports an error when a reload fails', () => {
    const { result } = render();
    connect(result);
    send({ type: 'schemaUpdate', schema: { tables: [{ schema: 'dbo', name: 'Old', columns: [] }], views: [], foreignKeys: [] } });

    act(() => result.current.reloadSchema('master'));
    send({ type: 'schemaReloadFailed', database: 'master', error: 'Timeout' });
    expect(result.current.dbSchema.tables).toHaveLength(1);
    expect(result.current.schemaStatuses[0]).toMatchObject({ state: 'error', error: 'Reload failed, previous schema kept: Timeout' });

    // A later successful reload clears the error
    act(() => result.current.reloadSchema('master'));
    send({ type: 'schemaUpdate', schema: { tables: [], views: [], foreignKeys: [] } });
    expect(result.current.schemaStatuses[0].state).toBe('loaded');
  });

  it('forces another database to be requested again and keeps the old schema until the new one arrives', async () => {
    const { result } = render();
    connect(result);
    send({ type: 'schemaUpdate', schema: { tables: [], views: [], foreignKeys: [] } });

    let first!: Promise<unknown>;
    act(() => { first = result.current.requestDatabaseSchema('AR'); });
    const req1 = postMessageMock.mock.calls.map((c) => c[0]).find((m) => m.type === 'requestDatabaseSchema');
    send({ type: 'databaseSchemaUpdate', requestId: req1.requestId, database: 'AR', schema: { tables: [{ schema: 'dbo', name: 'A', columns: [] }], views: [], foreignKeys: [] } });
    await first;

    // A normal request is served from the cache
    postMessageMock.mockClear();
    await act(async () => { await result.current.requestDatabaseSchema('AR'); });
    expect(postMessageMock).not.toHaveBeenCalled();

    // Reload requests the schema again, keeping the old one and its counts meanwhile
    act(() => result.current.reloadSchema('AR'));
    const req2 = postMessageMock.mock.calls.map((c) => c[0]).find((m) => m.type === 'requestDatabaseSchema');
    expect(req2).toBeDefined();
    expect(result.current.getLoadedDatabaseSchema('AR')?.tables).toHaveLength(1);
    expect(result.current.schemaStatuses.find((s) => s.database === 'AR')).toMatchObject({ state: 'loading', tables: 1 });

    send({ type: 'databaseSchemaUpdate', requestId: req2.requestId, database: 'AR', schema: { tables: [], views: [], foreignKeys: [] } });
    expect(result.current.getLoadedDatabaseSchema('AR')?.tables).toHaveLength(0);
    expect(result.current.schemaStatuses.find((s) => s.database === 'AR')).toMatchObject({ state: 'loaded', tables: 0 });
  });

  it('reload all refreshes the connected database and every loaded database', async () => {
    const { result } = render();
    connect(result);
    send({ type: 'schemaUpdate', schema: { tables: [], views: [], foreignKeys: [] } });
    let first!: Promise<unknown>;
    act(() => { first = result.current.requestDatabaseSchema('AR'); });
    const req1 = postMessageMock.mock.calls.map((c) => c[0]).find((m) => m.type === 'requestDatabaseSchema');
    send({ type: 'databaseSchemaUpdate', requestId: req1.requestId, database: 'AR', schema: { tables: [], views: [], foreignKeys: [] } });
    await first;

    postMessageMock.mockClear();
    act(() => result.current.reloadSchema());
    const sent = postMessageMock.mock.calls.map((c) => c[0]);
    expect(sent.some((m) => m.type === 'reloadSchema' && m.database === 'master')).toBe(true);
    expect(sent.some((m) => m.type === 'requestDatabaseSchema' && m.database === 'AR')).toBe(true);
  });

  it('marks a failed load as an error with its message', async () => {
    const { result } = render();
    connect(result);
    let promise!: Promise<unknown>;
    act(() => { promise = result.current.requestDatabaseSchema('ZZ'); });
    const request = postMessageMock.mock.calls.map((c) => c[0]).find((m) => m.type === 'requestDatabaseSchema');
    send({ type: 'databaseSchemaUpdate', requestId: request.requestId, database: 'ZZ', error: 'Permission denied' });
    expect(await promise).toBeNull();
    expect(result.current.schemaStatuses.find((s) => s.database === 'ZZ')).toMatchObject({ state: 'error', error: 'Permission denied' });
  });
});
