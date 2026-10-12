import Link from "next/link";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { listNotifications } from "@/server/services/admin";
import { getProvider } from "@/server/notify/providers";
import { can } from "@/domain/permissions";
import { EVENT_LABELS } from "@/domain/notifications";
import { formatDateTime } from "@/domain/format";
import { first, type SP } from "@/server/period-params";
import { PageHeader, Panel, Chip, EmptyState, Notice } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { retryNotificationAction } from "./actions";

export const metadata = { title: "Customer updates" };
const TONE = { sent: "good", failed: "crit", skipped: "neutral", queued: "info" } as const;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireCap("notifications.view");
  const status = first((await searchParams).status);
  const rows = await listNotifications(await getDb(), actor, { status });
  const provider = getProvider();
  const counts = rows.reduce<Record<string, number>>((a, r) => ((a[r.n.status] = (a[r.n.status] ?? 0) + 1), a), {});
  return (
    <>
      <PageHeader title="Customer updates" subtitle="Status messages triggered by appointments and job milestones" />
      <div className="mb-4">
        {!provider ? (
          <Notice tone="warn" title="No message provider connected">Updates are recorded but not delivered. A WhatsApp/SMS/email provider will be connected once Kun selects one; see the deployment guide.</Notice>
        ) : provider.name === "console-simulated" ? (
          <Notice tone="info" title="Simulated delivery">No provider is connected yet, so “sent” means the message was generated and logged. Nothing reaches customers.</Notice>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 mb-3 text-[13px]">
        {[undefined, "sent", "failed", "skipped"].map((s) => (
          <Link key={s ?? "all"} href={s ? `/notifications?status=${s}` : "/notifications"} className={`chip ${status === s ? "bg-ink text-white" : "bg-panel border border-line text-ink-2"}`}>
            {s ? `${s[0].toUpperCase()}${s.slice(1)}` : "All"}{!status && s && counts[s] ? ` (${counts[s]})` : ""}
          </Link>
        ))}
      </div>
      <Panel bodyClassName="px-0 pb-0">
        {!rows.length ? <EmptyState title="No customer updates" icon="bell">Updates appear here when appointments are confirmed or jobs reach a customer milestone.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead className="border-b border-line"><tr><th className="th">When</th><th className="th">Milestone</th><th className="th">Customer</th><th className="th">Job</th><th className="th">Channel</th><th className="th">Status</th><th className="th">Message</th></tr></thead>
              <tbody>
                {rows.map(({ n, customerName, dealershipName, jobNo }) => (
                  <tr key={n.id} className="border-b border-line last:border-0 align-top">
                    <td className="td text-sm whitespace-nowrap">{formatDateTime(n.createdAt)}</td>
                    <td className="td text-sm">{EVENT_LABELS[n.event]}<div className="text-xs text-ink-3">{dealershipName}</div></td>
                    <td className="td text-sm">{customerName}</td>
                    <td className="td text-sm">{n.jobId ? <Link className="text-petrol hover:underline" href={`/jobs/${n.jobId}`}>{jobNo}</Link> : "Appointment"}</td>
                    <td className="td text-sm">{n.channel ?? "—"}</td>
                    <td className="td">
                      <Chip tone={TONE[n.status]}>{n.status}</Chip>
                      <div className="text-xs text-ink-3 mt-0.5">{n.attempts} attempt{n.attempts === 1 ? "" : "s"}</div>
                      {n.status === "failed" && can(actor, "notifications.retry") && (
                        <ActionForm action={retryNotificationAction}><input type="hidden" name="id" value={n.id} /><Submit className="btn-ghost btn-sm" pendingText="Retrying…">Retry</Submit></ActionForm>
                      )}
                    </td>
                    <td className="td text-xs text-ink-2 max-w-[360px]">
                      {n.body}
                      {n.skipReason && <p className="text-ink-3 mt-1">Not sent: {n.skipReason}</p>}
                      {n.lastError && <p className="text-crit mt-1">{n.lastError}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
