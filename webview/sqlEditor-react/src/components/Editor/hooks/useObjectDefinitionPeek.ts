import { useEffect, useRef, type MutableRefObject } from 'react';
import type { editor } from 'monaco-editor';
import type { DatabaseSchema } from '../../../types/schema';
import {
  provideDefinitionLocation,
  resolveObjectAtOffset,
  type CrossDatabaseContext,
} from '../../../services';

type MonacoType = typeof import('monaco-editor');

const DEFINITION_SCHEME = 'mssql-definition';
const CACHE_MS = 30_000;

export interface ObjectDefinitionDeps {
  dbSchema: DatabaseSchema | undefined;
  crossDb: CrossDatabaseContext | undefined;
  currentDatabase: string | null;
  requestDefinition: (target: { database?: string; schema: string; name: string }) => Promise<string | null>;
}

/**
 * "Peek definition" for database objects:
 *  - Ctrl+F12 / F12 on a table, view or stored procedure (also `OtherDb.dbo.Name`)
 *    opens an inline peek with its script: CREATE TABLE (columns, keys, indexes)
 *    or the CREATE VIEW / PROCEDURE text.
 *  - The script is loaded from the server and shown in a read-only in-memory model,
 *    so the query being edited is never replaced.
 */
export function useObjectDefinitionPeek(
  monacoRef: MutableRefObject<MonacoType | null>,
  editorRef: MutableRefObject<editor.IStandaloneCodeEditor | null>,
  editorReady: boolean,
  deps: ObjectDefinitionDeps
): void {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    const monaco = monacoRef.current;
    const ed = editorRef.current;
    if (!monaco || !ed || !editorReady) return;

    const disposables: { dispose: () => void }[] = [];
    const models = new Map<string, editor.ITextModel>();
    const cache = new Map<string, { text: string; at: number }>();

    // Definition provider for tables, views and stored procedures
    disposables.push(
      monaco.languages.registerDefinitionProvider('sql', {
        provideDefinition: async (model, position) => {
          const sql = model.getValue();
          // Table aliases and CTE names are handled by the schema providers
          if (provideDefinitionLocation(sql, position.lineNumber, position.column)) return null;

          const { dbSchema, crossDb, currentDatabase, requestDefinition } = depsRef.current;
          if (!dbSchema) return null;
          const obj = resolveObjectAtOffset(sql, model.getOffsetAt(position), dbSchema, crossDb);
          if (!obj) return null;

          const database = obj.database ?? currentDatabase ?? undefined;
          const key = `${database ?? ''}|${obj.schema}|${obj.name}`.toLowerCase();
          let text: string | null = null;
          const cached = cache.get(key);
          if (cached && Date.now() - cached.at < CACHE_MS) {
            text = cached.text;
          } else {
            text = await requestDefinition({ database, schema: obj.schema, name: obj.name });
            if (text !== null) cache.set(key, { text, at: Date.now() });
          }
          if (text === null) return null;

          const uri = monaco.Uri.from({
            scheme: DEFINITION_SCHEME,
            path: `/${database ?? 'default'}/${obj.schema}.${obj.name}.sql`,
          });
          let target = monaco.editor.getModel(uri);
          if (target) {
            if (target.getValue() !== text) target.setValue(text);
          } else {
            target = monaco.editor.createModel(text, 'sql', uri);
          }
          models.set(uri.toString(), target);
          return { uri, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } };
        },
      })
    );

    // Ctrl+F12 and F12 open the definition inline (peek) instead of navigating away
    disposables.push(
      ed.addAction({
        id: 'mssql.peekObjectDefinition',
        label: 'Peek Object Definition',
        keybindings: [monaco.KeyCode.F12, monaco.KeyMod.CtrlCmd | monaco.KeyCode.F12],
        run: (e) => {
          void e.getAction('editor.action.peekDefinition')?.run();
        },
      })
    );

    // "Go to Definition" from the context menu would swap the editor's model for the
    // definition model. Show it as a peek instead.
    const service = (ed as unknown as { _codeEditorService?: {
      openCodeEditor?: (input: { resource?: { scheme?: string } }, source: unknown, sideBySide?: boolean) => Promise<unknown>;
    } })._codeEditorService;
    const originalOpen = service?.openCodeEditor;
    if (service && originalOpen) {
      service.openCodeEditor = (input, source, sideBySide) => {
        if (input?.resource?.scheme === DEFINITION_SCHEME) {
          if (source === ed) void ed.getAction('editor.action.peekDefinition')?.run();
          return Promise.resolve(null);
        }
        return originalOpen.call(service, input, source, sideBySide);
      };
      disposables.push({ dispose: () => { service.openCodeEditor = originalOpen; } });
    }

    return () => {
      disposables.forEach((d) => d.dispose());
      models.forEach((m) => { if (!m.isDisposed()) m.dispose(); });
      models.clear();
    };
  }, [monacoRef, editorRef, editorReady]);
}