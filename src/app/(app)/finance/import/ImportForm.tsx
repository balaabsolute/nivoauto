"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { importAction, type ImportState } from "../actions";

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importAction, undefined);
  const data = state?.ok ? state.data : undefined;
  const router = useRouter();
  useEffect(() => {
    if (data && !data.dryRun) router.refresh();
  }, [data, router]);
  return (
    <div className="space-y-4">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[240px]"><span className="label">CSV file</span><input type="file" name="file" accept=".csv,text/csv" className="field py-1.5 h-auto" required /></label>
        <button name="intent" value="validate" className="btn-primary" disabled={pending}>{pending ? "Checking…" : "Validate file"}</button>
      </form>
      {state && !state.ok && <p role="alert" className="text-sm text-crit">{state.error}</p>}
      {data && (
        <div className="rounded border border-line p-4 space-y-3" role="status">
          <p className="font-medium">{data.dryRun ? "Validation result" : "Import complete"} for {data.fileName}</p>
          <ul className="flex flex-wrap gap-4 text-sm">
            <li>{data.rowsTotal} rows</li>
            <li className="text-good">{data.rowsAccepted} {data.dryRun ? "ready to import" : "imported"}</li>
            <li className={data.rowsRejected ? "text-crit" : ""}>{data.rowsRejected} rejected</li>
            <li className={data.rowsDuplicate ? "text-warn" : ""}>{data.rowsDuplicate} already imported (skipped)</li>
          </ul>
          {data.results.length > 0 && (
            <div className="max-h-72 overflow-y-auto border-t border-line pt-2">
              <table className="w-full text-sm"><thead><tr><th className="th">Row</th><th className="th">Status</th><th className="th">Problem</th></tr></thead>
                <tbody>{data.results.map((r) => <tr key={r.row} className="border-t border-line"><td className="td num">{r.row}</td><td className="td">{r.status}</td><td className="td text-ink-2">{r.message}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {data.dryRun && data.rowsAccepted > 0 && (
            <form action={action}>
              <input type="hidden" name="csv" value={data.csv} />
              <input type="hidden" name="fileName" value={data.fileName} />
              <button name="intent" value="import" className="btn-primary" disabled={pending}>{pending ? "Importing…" : `Import ${data.rowsAccepted} valid rows`}</button>
              {data.rowsRejected > 0 && <span className="text-xs text-ink-3 ml-2">Rejected rows are not imported; fix them and re-import — duplicates are skipped safely.</span>}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
