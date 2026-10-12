import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { listImportBatches, IMPORT_COLUMNS } from "@/server/services/finance";
import { formatDateTime } from "@/domain/format";
import { PageHeader, Panel } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { ImportForm } from "./ImportForm";

export const metadata = { title: "Import revenue lines" };

export default async function ImportPage() {
  const actor = await requireCap("imports.run");
  const batches = await listImportBatches(await getDb(), actor);
  return (
    <>
      <PageHeader back={{ href: "/finance", label: "Finance" }} title="Import revenue lines" subtitle="From spreadsheets, registers or dealer-system exports. Validated before anything is saved." />
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Upload">
          <ImportForm />
        </Panel>
        <Panel title="File format" actions={<a href="/finance/import/template" className="btn-ghost btn-sm"><Icon name="download" /> Template</a>}>
          <p className="text-sm text-ink-2">CSV with a header row. Columns:</p>
          <ul className="text-xs mt-2 space-y-0.5 font-medium">{IMPORT_COLUMNS.map((c) => <li key={c}>{c}</li>)}</ul>
          <ul className="text-xs text-ink-2 mt-3 space-y-1 list-disc pl-4">
            <li>Amounts are ex-tax; tax goes in tax_amount.</li>
            <li>category: vehicle_sales, service_labour, parts, body_shop. Parts lines need parts_channel retail or workshop.</li>
            <li>kind: invoice, credit_note, booking_advance (not revenue), intercompany (excluded from group totals).</li>
            <li>source_ref must be unique per line (for example the system’s invoice line ID). Re-importing a file skips lines already imported.</li>
            <li>Leave direct_cost_amount blank when unknown; gross profit is then shown as provisional or withheld.</li>
          </ul>
        </Panel>
      </div>
      <Panel className="mt-4" title="Import history" bodyClassName="px-0 pb-0">
        {!batches.length ? <p className="px-4 pb-4 text-sm text-ink-3">No imports yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[640px]">
            <thead className="border-b border-line"><tr><th className="th">When</th><th className="th">File</th><th className="th">By</th><th className="th text-right">Imported</th><th className="th text-right">Rejected</th><th className="th text-right">Duplicates</th></tr></thead>
            <tbody>{batches.map(({ b, userName }) => <tr key={b.id} className="border-b border-line last:border-0"><td className="td">{formatDateTime(b.createdAt)}</td><td className="td">{b.fileName}</td><td className="td">{userName}</td><td className="td text-right num">{b.rowsAccepted}</td><td className="td text-right num">{b.rowsRejected}</td><td className="td text-right num">{b.rowsDuplicate}</td></tr>)}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
