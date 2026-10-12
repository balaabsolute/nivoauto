import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { listAudit } from "@/server/services/admin";
import { can } from "@/domain/permissions";
import { formatDateTime } from "@/domain/format";
import { first, type SP } from "@/server/period-params";
import { PageHeader, Panel } from "@/components/ui";
import { AdminTabs } from "../AdminTabs";

export const metadata = { title: "Audit trail" };

function short(v: unknown): string {
  if (v == null) return "";
  const s = JSON.stringify(v);
  return s.length > 240 ? s.slice(0, 240) + "…" : s;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireCap("audit.view");
  const sp = await searchParams;
  const rows = await listAudit(await getDb(), actor, { entityType: first(sp.entity), entityId: first(sp.id), limit: 300 });
  return (
    <>
      <PageHeader title={can(actor, "admin.users") ? "Administration" : "Audit trail"} subtitle="Append-only record of sensitive changes: who, what, when, before and after." />
      {can(actor, "admin.users") && <AdminTabs current="/admin/audit" />}
      <form action="/admin/audit" className="flex flex-wrap gap-2 mb-3">
        <select name="entity" defaultValue={first(sp.entity) ?? ""} className="field w-auto" aria-label="Record type">
          <option value="">All record types</option>
          {["job", "transaction", "user", "dealership", "daily_report", "alert", "target", "import_batch", "workflow_stages", "capacity_profile", "appointment", "customer", "notification"].map((e) => <option key={e} value={e}>{e.replace("_", " ")}</option>)}
        </select>
        <button className="btn-secondary">Filter</button>
      </form>
      <Panel bodyClassName="px-0 pb-0">
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[860px]">
          <thead className="border-b border-line"><tr><th className="th">When</th><th className="th">Who</th><th className="th">Action</th><th className="th">Before</th><th className="th">After</th></tr></thead>
          <tbody>{rows.map(({ a, userName }) => (
            <tr key={a.id} className="border-b border-line last:border-0 align-top">
              <td className="td whitespace-nowrap text-xs">{formatDateTime(a.at)}</td>
              <td className="td text-xs">{userName ?? "System"}</td>
              <td className="td text-xs font-medium">{a.action}<div className="text-ink-3 font-normal font-mono">{a.entityId?.slice(0, 8)}</div></td>
              <td className="td text-xs text-ink-2 font-mono break-all max-w-[280px]">{short(a.before)}</td>
              <td className="td text-xs text-ink-2 font-mono break-all max-w-[320px]">{short(a.after)}</td>
            </tr>))}
            {!rows.length && <tr><td colSpan={5} className="td text-center text-ink-3 py-8">No audit entries match.</td></tr>}
          </tbody>
        </table></div>
      </Panel>
    </>
  );
}
