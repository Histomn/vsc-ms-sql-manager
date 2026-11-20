import React, { createContext, useContext, useEffect, useReducer, useCallback, useMemo, useRef, useState } from 'react';
import type {
  IncomingMessage,
  OutgoingMessage,
  Connection,
  QueryMessage,
  ResultSetMetadata,
  Snippet,
  EditorConfig,
  ResultsMessage,
  RelationResultsMessage,
} from '../types/messages';
import { DatabaseSchema, SchemaLoadStatus, emptySchema } from '../types/schema';
import { defaultEditorConfig } from '../types/messages';

// ============================================
// VS Code API Type
// ============================================

interface VSCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeApi;

// ============================================
// State Types
// ============================================

interface VSCodeState {
  // Connection state
  connections: Connection[];
  currentConnectionId: string | null;
  currentDatabase: string | null;
  databases: string[];
  
  // Schema
  dbSchema: DatabaseSchema;
  /** Loading state of the connected database's schema ('idle' until the first request). */
  schemaState: 'idle' | 'loading' | 'loaded';
  /** Message of the last failed reload of the connected database's schema. */
  schemaError: string | null;
  
  // Editor content
  editorContent: string;
  
  // Snippets
  snippets: Snippet[];
  
  // Config
  config: EditorConfig;
  
  // Query execution state
  isExecuting: boolean;
  lastResults: any[][] | null;
  lastColumnNames: string[][] | null;
  lastMetadata: ResultSetMetadata[] | null;
  lastMessages: QueryMessage[];
  lastError: string | null;
  lastErrorId: number;
  lastPlanXml: string | null;
  executionTime: number | null;
  rowsAffected: number | null;
  originalQuery: string | null;
  
  // FK Expansion
  pendingExpansions: Map<string, RelationResultsMessage>;
  
  // Auto-execute flag
  shouldAutoExecute: boolean;
  
  // Paste content
  pasteContent: string | null;

  // History info (when opened from query history)
  historyInfo: {
    executedAt: string;
    connectionName: string;
    server: string;
    database: string;
    resultSetCount: number;
    rowCountsStr: string;
    duration?: number;
  } | null;
}

type VSCodeAction =
  | { type: 'SET_CONFIG'; config: Partial<EditorConfig> }
  | { type: 'SET_CONTENT'; content: string }
  | { type: 'SET_CONNECTIONS'; connections: Connection[]; currentConnectionId?: string; currentDatabase?: string }
  | { type: 'SET_DATABASES'; databases: string[]; currentDatabase?: string }
  | { type: 'SET_SCHEMA'; schema: DatabaseSchema }
  | { type: 'SET_SCHEMA_STATE'; schemaState: 'idle' | 'loading' | 'loaded' }
  | { type: 'SET_SCHEMA_ERROR'; error: string }
  | { type: 'SET_SNIPPETS'; snippets: Snippet[] }
  | { type: 'SET_EXECUTING'; isExecuting: boolean }
  | { type: 'SET_RESULTS'; payload: ResultsMessage }
  | { type: 'SET_ERROR'; error: string; messages?: QueryMessage[] }
  | { type: 'SET_QUERY_PLAN'; planXml: string; executionTime?: number; messages?: QueryMessage[]; resultSets?: any[][] }
  | { type: 'QUERY_CANCELLED' }
  | { type: 'SET_EXPANSION_RESULT'; payload: RelationResultsMessage }
  | { type: 'CLEAR_RESULTS' }
  | { type: 'SET_AUTO_EXECUTE'; shouldAutoExecute: boolean }
  | { type: 'SET_PASTE_CONTENT'; content: string | null }
  | { type: 'SET_HISTORY_INFO'; info: VSCodeState['historyInfo'] };

const initialState: VSCodeState = {
  connections: [],
  currentConnectionId: null,
  currentDatabase: null,
  databases: [],
  dbSchema: emptySchema,
  schemaState: 'idle',
  schemaError: null,
  editorContent: '',
  snippets: [],
  config: defaultEditorConfig,
  isExecuting: false,
  lastResults: null,
  lastColumnNames: null,
  lastMetadata: null,
  lastMessages: [],
  lastError: null,
  lastErrorId: 0,
  lastPlanXml: null,
  executionTime: null,
  rowsAffected: null,
  originalQuery: null,
  pendingExpansions: new Map(),
  shouldAutoExecute: false,
  pasteContent: null,
  historyInfo: null,
};

function vsCodeReducer(state: VSCodeState, action: VSCodeAction): VSCodeState {
  switch (action.type) {
    case 'SET_CONFIG':
      return {
        ...state,
        config: { ...state.config, ...action.config },
      };
    
    case 'SET_AUTO_EXECUTE':
      return {
        ...state,
        shouldAutoExecute: action.shouldAutoExecute,
      };
      
    case 'SET_PASTE_CONTENT':
      return {
        ...state,
        pasteContent: action.content,
      };
      
    case 'SET_CONTENT':
      return {
        ...state,
        editorContent: action.content,
      };
      
    case 'SET_CONNECTIONS': {
      let currentId = action.currentConnectionId ?? state.currentConnectionId;
      const currentDb = action.currentDatabase ?? state.currentDatabase;
      
      // If no current connection is specified but there are connections available,
      // use the first connection as the current one
      if (!currentId && action.connections.length > 0) {
        currentId = action.connections[0].id;
      }
      
      return {
        ...state,
        connections: action.connections,
        currentConnectionId: currentId,
        currentDatabase: currentDb,
        // The extension sends the schema right after the connection is known
        schemaState: state.schemaState === 'idle' && currentId && currentDb ? 'loading' : state.schemaState,
      };
    }
    
    case 'SET_DATABASES':
      return {
        ...state,
        databases: action.databases,
        currentDatabase: action.currentDatabase ?? state.currentDatabase,
      };
      
    case 'SET_SCHEMA':
      return {
        ...state,
        dbSchema: action.schema,
        schemaState: 'loaded',
        schemaError: null,
      };

    case 'SET_SCHEMA_STATE':
      return {
        ...state,
        schemaState: action.schemaState,
        schemaError: action.schemaState === 'loading' ? null : state.schemaError,
      };

    case 'SET_SCHEMA_ERROR':
      return { ...state, schemaState: 'loaded', schemaError: action.error };
      
    case 'SET_SNIPPETS':
      return {
        ...state,
        snippets: action.snippets,
      };
      
    case 'SET_EXECUTING':
      return {
        ...state,
        isExecuting: action.isExecuting,
        lastError: action.isExecuting ? null : state.lastError,
      };
      
    case 'SET_RESULTS':
      return {
        ...state,
        isExecuting: false,
        lastResults: action.payload.resultSets,
        lastColumnNames: action.payload.columnNames ?? null,
        lastMetadata: action.payload.metadata ?? null,
        lastMessages: action.payload.messages ?? [],
        lastPlanXml: action.payload.planXml ?? null,
        executionTime: action.payload.executionTime ?? null,
        rowsAffected: action.payload.rowsAffected ?? null,
        lastError: null,
        originalQuery: action.payload.originalQuery ?? null,
      };
      
    case 'SET_ERROR':
      return {
        ...state,
        isExecuting: false,
        lastError: action.error,
        lastErrorId: state.lastErrorId + 1,
        lastMessages: action.messages ?? [{ type: 'error', text: action.error }],
      };
      
    case 'SET_QUERY_PLAN':
      return {
        ...state,
        isExecuting: false,
        lastPlanXml: action.planXml,
        executionTime: action.executionTime ?? null,
        lastMessages: action.messages ?? [],
        lastResults: action.resultSets ?? state.lastResults,
      };
      
    case 'QUERY_CANCELLED':
      return {
        ...state,
        isExecuting: false,
        lastMessages: [{ type: 'info', text: 'Query execution cancelled.' }],
      };
      
    case 'SET_EXPANSION_RESULT': {
      const newExpansions = new Map(state.pendingExpansions);
      newExpansions.set(action.payload.expansionId, action.payload);
      return {
        ...state,
        pendingExpansions: newExpansions,
      };
    }
    
    case 'CLEAR_RESULTS':
      return {
        ...state,
        lastResults: null,
        lastColumnNames: null,
        lastMetadata: null,
        lastMessages: [],
        lastError: null,
        lastPlanXml: null,
        executionTime: null,
        rowsAffected: null,
      };
      
    default:
      return state;
  }
}

// Extend reducer for historyInfo (outside switch to avoid TS exhaustiveness issue)
function vsCodeReducerWithHistory(state: VSCodeState, action: VSCodeAction): VSCodeState {
  if (action.type === 'SET_HISTORY_INFO') {
    return { ...state, historyInfo: action.info };
  }
  return vsCodeReducer(state, action);
}

// ============================================
// Context Type
// ============================================

interface VSCodeContextValue extends VSCodeState {
  // Derived state
  isConnected: boolean;
  
  // Actions
  postMessage: (message: OutgoingMessage) => void;
  setEditorContent: (content: string) => void;
  
  // Query execution
  executeQuery: (query: string, options?: { includeActualPlan?: boolean }) => void;
  executeEstimatedPlan: (query: string) => void;
  cancelQuery: () => void;
  
  // Connection management
  selectConnection: (connectionId: string) => void;
  selectDatabase: (databaseName: string) => void;
  manageConnections: () => void;
  
  // FK Expansion
  expandRelation: (
    expansionId: string, 
    keyValue: any,
    schema: string,
    table: string,
    column: string
  ) => void;
  getExpansionResult: (expansionId: string) => RelationResultsMessage | undefined;
  
  // Cross-database autocomplete: lazily loads (and caches) another database's schema
  requestDatabaseSchema: (database: string, options?: { force?: boolean }) => Promise<DatabaseSchema | null>;
  /** Fetches the script (CREATE ...) of a table, view or stored procedure. Resolves null on timeout. */
  requestObjectDefinition: (target: { database?: string; schema: string; name: string }) => Promise<string | null>;
  /** Reloads the schema of one database (or of every loaded database when omitted) from the server. */
  reloadSchema: (database?: string) => void;
  /** Returns the already loaded schema of another database, if any. */
  getLoadedDatabaseSchema: (database: string) => DatabaseSchema | undefined;
  /** Increments each time another database's schema finishes loading. */
  externalSchemaVersion: number;
  /** Schema loading state per database (connected database first), for the toolbar indicator. */
  schemaStatuses: SchemaLoadStatus[];

  // Clipboard
  requestPaste: () => void;
  clearPasteContent: () => void;
  
  // Auto-execute
  clearAutoExecute: () => void;
  
  // History info
  dismissHistoryInfo: () => void;
}

const VSCodeContext = createContext<VSCodeContextValue | null>(null);

// ============================================
// Provider Component
// ============================================

export function VSCodeProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(vsCodeReducerWithHistory, initialState);
  
  // Use ref to always access latest state in callbacks
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  
  // Get VS Code API (memoized)
  const vscode = useMemo(() => {
    try {
      return acquireVsCodeApi();
    } catch {
      // Running outside VS Code (dev mode)
      console.warn('VS Code API not available - running in dev mode');
      return {
        postMessage: (msg: unknown) => console.log('[DEV] postMessage:', msg),
        getState: () => null,
        setState: () => {},
      };
    }
  }, []);
  
  // Post message helper
  const postMessage = useCallback((message: OutgoingMessage) => {
    console.log('[VSCode] Sending message:', message.type);
    vscode.postMessage(message);
  }, [vscode]);

  // Cross-database schema cache and in-flight requests (refs: read by the message handler)
  const externalSchemasRef = useRef(new Map<string, DatabaseSchema>());
  const externalInflightRef = useRef(new Map<string, Promise<DatabaseSchema | null>>());
  const externalPendingRef = useRef(new Map<string, { key: string; database: string; reloading: boolean; resolve: (s: DatabaseSchema | null) => void; timer: ReturnType<typeof setTimeout> }>());
  const externalNamesRef = useRef(new Map<string, string>()); // cache key -> database name as listed by the server
  const [externalStatus, setExternalStatus] = useState<Record<string, SchemaLoadStatus>>({});
  const patchExternalStatus = useCallback((key: string, patch: Partial<SchemaLoadStatus>) => {
    setExternalStatus((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], ...patch } } : prev));
  }, []);
  const externalRequestCounterRef = useRef(0);
  const [externalSchemaVersion, setExternalSchemaVersion] = useState(0);

  // Pending "peek definition" requests
  const definitionPendingRef = useRef(new Map<string, { resolve: (text: string | null) => void; timer: ReturnType<typeof setTimeout> }>());
  const definitionCounterRef = useRef(0);

  const requestObjectDefinition = useCallback((target: { database?: string; schema: string; name: string }): Promise<string | null> => {
    const connectionId = stateRef.current.currentConnectionId;
    if (!connectionId) return Promise.resolve(null);
    const requestId = `objdef-${++definitionCounterRef.current}`;
    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        definitionPendingRef.current.delete(requestId);
        resolve(null);
      }, 20000);
      definitionPendingRef.current.set(requestId, { resolve, timer });
      postMessage({
        type: 'requestObjectDefinition',
        requestId,
        connectionId,
        database: target.database ?? stateRef.current.currentDatabase ?? undefined,
        schema: target.schema,
        name: target.name,
      });
    });
  }, [postMessage]);

  const getLoadedDatabaseSchema = useCallback((database: string): DatabaseSchema | undefined => {
    const connectionId = stateRef.current.currentConnectionId;
    if (!connectionId || !database) return undefined;
    return externalSchemasRef.current.get(`${connectionId}::${database.toLowerCase()}`);
  }, []);

  const requestDatabaseSchema = useCallback((database: string, options?: { force?: boolean }): Promise<DatabaseSchema | null> => {
    const connectionId = stateRef.current.currentConnectionId;
    if (!connectionId || !database) return Promise.resolve(null);

    const key = `${connectionId}::${database.toLowerCase()}`;
    const cached = externalSchemasRef.current.get(key);
    if (cached && !options?.force) return Promise.resolve(cached);
    const inflight = externalInflightRef.current.get(key);
    if (inflight) return inflight;

    const reloading = !!cached;
    externalNamesRef.current.set(key, database);
    const requestId = `dbschema-${++externalRequestCounterRef.current}`;
    setExternalStatus((prev) => ({
      ...prev,
      [key]: {
        // keep the previous counts while reloading
        tables: prev[key]?.tables ?? 0,
        views: prev[key]?.views ?? 0,
        procedures: prev[key]?.procedures ?? 0,
        key, connectionId, database, state: 'loading', progress: 0,
        detail: reloading ? 'Reloading' : 'Starting', error: undefined,
      },
    }));
    const promise = new Promise<DatabaseSchema | null>((resolve) => {
      const timer = setTimeout(() => {
        externalPendingRef.current.delete(requestId);
        externalInflightRef.current.delete(key);
        patchExternalStatus(key, { state: 'error', progress: undefined, error: reloading ? 'Reload timed out (previous schema kept)' : 'Timed out while loading the schema' });
        resolve(null);
      }, 30000);
      externalPendingRef.current.set(requestId, { key, database, reloading, resolve, timer });
      postMessage({ type: 'requestDatabaseSchema', requestId, connectionId, database });
    });
    externalInflightRef.current.set(key, promise);
    return promise;
  }, [postMessage, patchExternalStatus]);
  
  // Message handler
  useEffect(() => {
    const handleMessage = (event: MessageEvent<IncomingMessage>) => {
      const message = event.data;
      
      // Ignore internal VS Code webview messages
      if (message && 'vscodeScheduleAsyncWork' in message) {
        return;
      }
      
      console.log('[VSCode] Received message:', message?.type || 'undefined', message);
      
      if (!message || !message.type) {
        console.warn('[VSCode] Received message without type:', message);
        return;
      }
      
      switch (message.type) {
        case 'config':
          dispatch({ type: 'SET_CONFIG', config: message.config });
          break;
          
        case 'update':
          console.log('[VSCode] Received update message:', {
            contentLength: message.content?.length || 0,
            contentPreview: message.content?.substring(0, 100) + '...' || 'undefined'
          });
          dispatch({ type: 'SET_CONTENT', content: message.content });
          break;
          
        case 'connectionsUpdate':
          dispatch({
            type: 'SET_CONNECTIONS',
            connections: message.connections,
            currentConnectionId: message.currentConnectionId,
            currentDatabase: message.currentDatabase,
          });
          break;
          
        case 'databasesUpdate':
          dispatch({
            type: 'SET_DATABASES',
            databases: message.databases,
            currentDatabase: message.currentDatabase,
          });
          break;
          
        case 'schemaUpdate':
          dispatch({ type: 'SET_SCHEMA', schema: message.schema });
          break;

        case 'objectDefinition': {
          const pending = definitionPendingRef.current.get(message.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            definitionPendingRef.current.delete(message.requestId);
            pending.resolve(message.definition ?? `-- ${message.error ?? 'Definition not available'}`);
          }
          break;
        }

        case 'databaseSchemaUpdate': {
          const pending = externalPendingRef.current.get(message.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            externalPendingRef.current.delete(message.requestId);
            externalInflightRef.current.delete(pending.key);
            if (message.schema) {
              const schema: DatabaseSchema = { ...emptySchema, ...message.schema };
              externalSchemasRef.current.set(pending.key, schema);
              patchExternalStatus(pending.key, {
                state: 'loaded',
                progress: 1,
                detail: undefined,
                error: undefined,
                tables: schema.tables?.length ?? 0,
                views: schema.views?.length ?? 0,
                procedures: schema.storedProcedures?.length ?? 0,
              });
              setExternalSchemaVersion((v) => v + 1);
              pending.resolve(schema);
            } else {
              console.warn('[VSCode] Failed to load schema for database', message.database, message.error);
              const reason = message.error ?? 'Failed to load the schema';
              patchExternalStatus(pending.key, {
                state: 'error',
                progress: undefined,
                error: pending.reloading ? `Reload failed, previous schema kept: ${reason}` : reason,
              });
              pending.resolve(externalSchemasRef.current.get(pending.key) ?? null);
            }
          }
          break;
        }

        case 'schemaReloadFailed':
          dispatch({ type: 'SET_SCHEMA_ERROR', error: `Reload failed, previous schema kept: ${message.error}` });
          break;

        case 'databaseSchemaProgress': {
          const pending = externalPendingRef.current.get(message.requestId);
          if (pending) {
            patchExternalStatus(pending.key, {
              progress: message.total > 0 ? message.completed / message.total : undefined,
              detail: message.detail,
            });
          }
          break;
        }
          
        case 'executing':
          dispatch({ type: 'SET_EXECUTING', isExecuting: true });
          break;
          
        case 'results':
          dispatch({ type: 'SET_RESULTS', payload: message });
          break;
          
        case 'relationResults':
          dispatch({ type: 'SET_EXPANSION_RESULT', payload: message });
          break;
          
        case 'queryPlan':
          dispatch({
            type: 'SET_QUERY_PLAN',
            planXml: message.planXml,
            executionTime: message.executionTime,
            messages: message.messages,
            resultSets: message.resultSets,
          });
          break;
          
        case 'error':
          dispatch({ type: 'SET_ERROR', error: message.error, messages: message.messages });
          break;
          
        case 'queryCancelled':
          dispatch({ type: 'QUERY_CANCELLED' });
          break;
          
        case 'snippetsUpdate':
          dispatch({ type: 'SET_SNIPPETS', snippets: message.snippets });
          break;
          
        case 'autoExecuteQuery':
          // Signal that auto-execute should happen
          dispatch({ type: 'SET_AUTO_EXECUTE', shouldAutoExecute: true });
          break;
          
        case 'pasteContent':
          // Handle paste content from extension
          if (message.content !== undefined) {
            dispatch({ type: 'SET_PASTE_CONTENT', content: message.content });
            console.log('[VSCode] Received paste content:', message.content);
          }
          break;
          
        case 'commitSuccess':
          console.log('[VSCode] Commit success:', message.message);
          // Dispatch event so pending changes hook can clear state
          window.dispatchEvent(new CustomEvent('commitSuccess', { detail: message }));
          break;

        case 'historyInfo':
          dispatch({
            type: 'SET_HISTORY_INFO',
            info: {
              executedAt: message.executedAt,
              connectionName: message.connectionName,
              server: message.server,
              database: message.database,
              resultSetCount: message.resultSetCount,
              rowCountsStr: message.rowCountsStr,
              duration: message.duration,
            },
          });
          break;

        case 'inlineCompletionResult':
        case 'hostCompletionsResult':
          // Handled by the editor completion hooks
          break;
          
        default:
          console.log('[VSCode] Unhandled message type:', (message as any).type);
      }
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);
  
  // Send ready message when component mounts
  useEffect(() => {
    console.log('[VSCode] Sending ready message to extension');
    postMessage({ type: 'ready' });
  }, [postMessage]);
  
  // Action helpers
  const setEditorContent = useCallback((content: string) => {
    dispatch({ type: 'SET_CONTENT', content });
    postMessage({ type: 'contentChanged', content });
  }, [postMessage]);
  
  const executeQuery = useCallback((query: string, options?: { includeActualPlan?: boolean }) => {
    // Access current state from ref - this ensures we always have the latest state
    const currentState = stateRef.current;
    const currentConnectionId = currentState.currentConnectionId;
    const currentDatabase = currentState.currentDatabase;
    const connections = currentState.connections;
    
    console.log('[VSCodeContext] executeQuery called:', {
      queryLength: query.length,
      queryPreview: query.substring(0, 100) + '...',
      includeActualPlan: options?.includeActualPlan,
      currentConnectionId,
      currentDatabase,
      stateConnections: connections.length,
      stateConnectionsIds: connections.map(c => c.id).join(', ')
    });
    
    if (!currentConnectionId) {
      console.log('[VSCodeContext] No connection selected');
      console.log('[VSCodeContext] Available connections:', connections);
      postMessage({ type: 'showMessage', level: 'error', message: 'Please select a connection first' });
      return;
    }

    // Clear previous results immediately in the UI.
    // Do NOT set isExecuting here — the extension sends 'executing' only after
    // all DML protection confirmations are done, so the timer starts then.
    dispatch({ type: 'CLEAR_RESULTS' });

    console.log('[VSCodeContext] Sending executeQuery message to extension');
    postMessage({
      type: 'executeQuery',
      query,
      connectionId: currentConnectionId,
      databaseName: currentDatabase ?? undefined,
      includeActualPlan: options?.includeActualPlan,
    });
  }, [postMessage]);
  
  const executeEstimatedPlan = useCallback((query: string) => {
    const currentState = stateRef.current;
    if (!currentState.currentConnectionId) {
      postMessage({ type: 'showMessage', level: 'error', message: 'Please select a connection first' });
      return;
    }

    // Clear previous results immediately and set executing state
    dispatch({ type: 'CLEAR_RESULTS' });
    dispatch({ type: 'SET_EXECUTING', isExecuting: true });

    postMessage({
      type: 'executeEstimatedPlan',
      query,
      connectionId: currentState.currentConnectionId,
      databaseName: currentState.currentDatabase ?? undefined,
    });
  }, [postMessage]);
  
  const cancelQuery = useCallback(() => {
    postMessage({ type: 'cancelQuery' });
  }, [postMessage]);
  
  const selectConnection = useCallback((connectionId: string) => {
    postMessage({ type: 'switchConnection', connectionId });
  }, [postMessage]);
  
  const selectDatabase = useCallback((databaseName: string) => {
    if (!state.currentConnectionId) {
      console.warn('[VSCode] Cannot select database without active connection');
      return;
    }
    // Optimistic update: update local state immediately so the dropdown reflects
    // the selection without waiting for the extension round-trip
    dispatch({ type: 'SET_DATABASES', databases: state.databases, currentDatabase: databaseName });
    dispatch({ type: 'SET_SCHEMA_STATE', schemaState: 'loading' });
    postMessage({ 
      type: 'switchDatabase', 
      connectionId: state.currentConnectionId,
      databaseName 
    });
  }, [state.currentConnectionId, state.databases, postMessage]);
  
  const reloadSchema = useCallback((database?: string) => {
    const current = stateRef.current;
    const connectionId = current.currentConnectionId;
    if (!connectionId) return;

    const reloadCurrent = () => {
      if (!current.currentDatabase || current.schemaState === 'loading') return;
      dispatch({ type: 'SET_SCHEMA_STATE', schemaState: 'loading' });
      postMessage({ type: 'reloadSchema', connectionId, database: current.currentDatabase });
    };
    const isCurrent = (name: string) => name.toLowerCase() === (current.currentDatabase ?? '').toLowerCase();

    if (database) {
      if (isCurrent(database)) reloadCurrent();
      else void requestDatabaseSchema(database, { force: true });
      return;
    }

    // Everything that is loaded for this connection
    reloadCurrent();
    for (const key of externalSchemasRef.current.keys()) {
      if (!key.startsWith(`${connectionId}::`)) continue;
      const name = externalNamesRef.current.get(key) ?? key.slice(connectionId.length + 2);
      if (!isCurrent(name)) void requestDatabaseSchema(name, { force: true });
    }
  }, [postMessage, requestDatabaseSchema]);

  const manageConnections = useCallback(() => {
    postMessage({ type: 'manageConnections' });
  }, [postMessage]);
  
  const expandRelation = useCallback((
    expansionId: string, 
    keyValue: any,
    schema: string,
    table: string,
    column: string
  ) => {
    if (!state.currentConnectionId) return;
    
    postMessage({
      type: 'expandRelation',
      expansionId,
      keyValue,
      schema,
      table,
      column,
      connectionId: state.currentConnectionId,
    });
  }, [state.currentConnectionId, postMessage]);
  
  const getExpansionResult = useCallback((expansionId: string) => {
    return state.pendingExpansions.get(expansionId);
  }, [state.pendingExpansions]);
  
  const clearAutoExecute = useCallback(() => {
    dispatch({ type: 'SET_AUTO_EXECUTE', shouldAutoExecute: false });
  }, []);
  
  const requestPaste = useCallback(() => {
    postMessage({ type: 'requestPaste' });
  }, [postMessage]);
  
  const clearPasteContent = useCallback(() => {
    dispatch({ type: 'SET_PASTE_CONTENT', content: null });
  }, []);

  const dismissHistoryInfo = useCallback(() => {
    dispatch({ type: 'SET_HISTORY_INFO', info: null });
  }, []);
  
  // A schema request that never gets an answer must not leave the indicator spinning
  useEffect(() => {
    if (state.schemaState !== 'loading') return;
    const timer = setTimeout(() => dispatch({ type: 'SET_SCHEMA_STATE', schemaState: 'idle' }), 60000);
    return () => clearTimeout(timer);
  }, [state.schemaState]);

  const schemaStatuses = useMemo<SchemaLoadStatus[]>(() => {
    const list: SchemaLoadStatus[] = [];
    const connectionId = state.currentConnectionId;
    const currentDb = state.currentDatabase;
    if (connectionId && currentDb && state.schemaState !== 'idle') {
      list.push({
        key: `${connectionId}::current`,
        connectionId,
        database: currentDb,
        state: state.schemaState === 'loading' ? 'loading' : state.schemaError ? 'error' : 'loaded',
        detail: state.schemaState === 'loading' ? 'Reading schema' : undefined,
        error: state.schemaState === 'loading' ? undefined : state.schemaError ?? undefined,
        tables: state.dbSchema.tables?.length ?? 0,
        views: state.dbSchema.views?.length ?? 0,
        procedures: state.dbSchema.storedProcedures?.length ?? 0,
        isCurrent: true,
      });
    }
    Object.values(externalStatus)
      .filter((s) => s.connectionId === connectionId && s.database.toLowerCase() !== currentDb?.toLowerCase())
      .sort((a, b) => a.database.localeCompare(b.database))
      .forEach((s) => list.push(s));
    return list;
  }, [state.currentConnectionId, state.currentDatabase, state.schemaState, state.schemaError, state.dbSchema, externalStatus]);

  // Derived state
  const isConnected = state.currentConnectionId !== null;
  
  // Context value
  const contextValue: VSCodeContextValue = useMemo(() => ({
    ...state,
    isConnected,
    postMessage,
    setEditorContent,
    executeQuery,
    executeEstimatedPlan,
    cancelQuery,
    selectConnection,
    selectDatabase,
    manageConnections,
    expandRelation,
    getExpansionResult,
    clearAutoExecute,
    requestDatabaseSchema,
    requestObjectDefinition,
    getLoadedDatabaseSchema,
    externalSchemaVersion,
    schemaStatuses,
    reloadSchema,
    requestPaste,
    clearPasteContent,
    dismissHistoryInfo,
  }), [
    state,
    isConnected,
    postMessage,
    setEditorContent,
    executeQuery,
    executeEstimatedPlan,
    cancelQuery,
    selectConnection,
    selectDatabase,
    manageConnections,
    expandRelation,
    getExpansionResult,
    clearAutoExecute,
    requestDatabaseSchema,
    requestObjectDefinition,
    getLoadedDatabaseSchema,
    externalSchemaVersion,
    schemaStatuses,
    reloadSchema,
    requestPaste,
    clearPasteContent,
    dismissHistoryInfo,
  ]);
  
  return (
    <VSCodeContext.Provider value={contextValue}>
      {children}
    </VSCodeContext.Provider>
  );
}

// ============================================
// Hook
// ============================================

export function useVSCode(): VSCodeContextValue {
  const context = useContext(VSCodeContext);
  if (!context) {
    throw new Error('useVSCode must be used within a VSCodeProvider');
  }
  return context;
}
