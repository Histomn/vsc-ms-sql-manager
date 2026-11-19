import { useEffect, useRef, type MutableRefObject } from 'react';
import type { editor } from 'monaco-editor';
import { findCrossDatabaseReferences, type CrossDatabaseContext } from '../../../services';

/**
 * Loads the schema of every other database referenced in the editor text
 * (e.g. `OtherDb.dbo.Table`) so columns, "Expand *", hover and validation work
 * for those tables. Runs once on mount and after content changes (debounced).
 */
export function useCrossDatabasePrefetch(
  editorRef: MutableRefObject<editor.IStandaloneCodeEditor | null>,
  editorReady: boolean,
  crossDb: CrossDatabaseContext | undefined
): void {
  const crossDbRef = useRef(crossDb);
  crossDbRef.current = crossDb;
  const failedRef = useRef(new Set<string>());

  const databasesKey = crossDb?.databases.join('|') ?? '';
  const currentDatabase = crossDb?.currentDatabase ?? null;

  useEffect(() => {
    const ed = editorRef.current;
    if (!editorReady || !ed) return;

    failedRef.current.clear();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scan = () => {
      const cross = crossDbRef.current;
      const model = ed.getModel();
      if (!cross || !model || cross.databases.length === 0) return;

      const current = cross.currentDatabase?.toLowerCase();
      const wanted = new Set(
        findCrossDatabaseReferences(model.getValue(), cross.databases)
          .map((r) => r.database)
          .filter((d) => d.toLowerCase() !== current)
      );
      wanted.forEach((database) => {
        if (cross.getLoadedSchema(database) || failedRef.current.has(database)) return;
        void cross.requestSchema(database).then((schema) => {
          if (!schema) failedRef.current.add(database); // do not retry on every keystroke
        });
      });
    };

    scan();
    const disposable = ed.onDidChangeModelContent(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(scan, 600);
    });

    return () => {
      if (timer) clearTimeout(timer);
      disposable.dispose();
    };
  }, [editorRef, editorReady, databasesKey, currentDatabase]);
}
