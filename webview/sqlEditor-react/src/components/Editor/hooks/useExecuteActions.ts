import { useEffect, useRef, type MutableRefObject } from 'react';
import type { editor, IDisposable } from 'monaco-editor';
import { parseKeybindings, type MonacoKeyApi } from '../../../services/keybindingParser';
import { getStatementAtOffset } from '../../../services/sqlStatement';

type MonacoType = typeof import('monaco-editor');

/**
 * Registers the "Execute Query" and "Execute Current Statement" actions with
 * user-configurable keybindings. The actions are re-registered whenever the
 * keybinding strings change.
 *
 * - Execute Query: runs the selection, or the whole file if nothing is selected.
 * - Execute Current Statement: runs the selection, or the statement under the cursor.
 */
export function useExecuteActions(
  editorRef: MutableRefObject<editor.IStandaloneCodeEditor | null>,
  monacoRef: MutableRefObject<MonacoType | null>,
  editorReady: boolean,
  onExecute: (sql: string) => void,
  executeQueryKeys: string,
  executeCurrentStatementKeys: string
) {
  // Always call the latest onExecute without re-registering the actions
  const onExecuteRef = useRef(onExecute);
  useEffect(() => { onExecuteRef.current = onExecute; }, [onExecute]);

  useEffect(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!editorReady || !ed || !monaco) return;

    const api = monaco as unknown as MonacoKeyApi;
    const disposables: IDisposable[] = [];

    disposables.push(
      ed.addAction({
        id: 'execute-query',
        label: 'Execute Query',
        keybindings: parseKeybindings(executeQueryKeys, api),
        run: () => {
          const model = ed.getModel();
          if (!model) return;
          const selection = ed.getSelection();
          const sql = selection && !selection.isEmpty()
            ? model.getValueInRange(selection)
            : model.getValue();
          if (sql.trim()) onExecuteRef.current(sql);
        },
      })
    );

    disposables.push(
      ed.addAction({
        id: 'execute-current-statement',
        label: 'Execute Current Statement',
        keybindings: parseKeybindings(executeCurrentStatementKeys, api),
        run: () => {
          const model = ed.getModel();
          if (!model) return;
          const selection = ed.getSelection();
          let sql: string;
          if (selection && !selection.isEmpty()) {
            sql = model.getValueInRange(selection);
          } else {
            const position = ed.getPosition();
            if (!position) return;
            const statement = getStatementAtOffset(model.getValue(), model.getOffsetAt(position));
            sql = statement?.text ?? '';
          }
          if (sql.trim()) onExecuteRef.current(sql);
        },
      })
    );

    return () => {
      disposables.forEach((d) => d.dispose());
    };
  }, [editorRef, monacoRef, editorReady, executeQueryKeys, executeCurrentStatementKeys]);
}
