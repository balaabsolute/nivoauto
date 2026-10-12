"use client";
import { useMemo, useState } from "react";
import { formatInt, formatPct } from "@/domain/format";
import { DealerName, EmptyState, Panel } from "@/components/ui";

export interface DealerOpt { id: string; name: string; color: string }
interface ConsultantRow { id: string; name: string; dealershipId: string | null; enquiries: number; testDrives: number; won: number; closeRatePct: number | null; followUpsDue: number; followUpsDonePct: number | null; contacts: number; openNow: number; overdueNow: number }
interface ModelRow { model: string; dealershipId: string | null; enquiries: number; drives: number; won: number }

function DealerFilter({ dealers, value, onChange, label }: { dealers: DealerOpt[]; value: string; onChange: (v: string) => void; label: string }) {
  if (dealers.length < 2) return null;
  return (
    <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
      <span className="sr-only sm:not-sr-only">Dealership</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="field h-8 w-auto text-[13px]">
        <option value="">All dealerships</option>
        {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </label>
  );
}

function Dealer({ id, dealers }: { id: string | null; dealers: DealerOpt[] }) {
  const d = dealers.find((x) => x.id === id);
  return d ? <DealerName name={d.name} color={d.color} /> : <span className="text-ink-3">—</span>;
}

export function ConsultantTable({ rows, dealers }: { rows: ConsultantRow[]; dealers: DealerOpt[] }) {
  const [f, setF] = useState("");
  const shown = useMemo(() => rows.filter((r) => !f || r.dealershipId === f), [rows, f]);
  return (
    <Panel title="Sales consultants" subtitle="Activity and results in the period" actions={<DealerFilter dealers={dealers} value={f} onChange={setF} label="Filter consultants by dealership" />} bodyClassName="px-0 pb-0">
      {!shown.length ? <EmptyState title="No consultant activity for this selection" icon="users" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-line"><tr>
              <th className="th">Consultant</th><th className="th">Dealership</th><th className="th text-right">Enquiries</th><th className="th text-right">Test drives</th><th className="th text-right">Sold</th><th className="th text-right">Close rate</th>
              <th className="th text-right">Follow-ups done</th><th className="th text-right">Contacts</th><th className="th text-right">Open / overdue now</th>
            </tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className="td font-medium whitespace-nowrap">{c.name}</td>
                  <td className="td whitespace-nowrap"><Dealer id={c.dealershipId} dealers={dealers} /></td>
                  <td className="td text-right num">{formatInt(c.enquiries)}</td>
                  <td className="td text-right num">{formatInt(c.testDrives)}</td>
                  <td className="td text-right num font-medium">{formatInt(c.won)}</td>
                  <td className="td text-right num">{formatPct(c.closeRatePct)}</td>
                  <td className="td text-right num">{formatPct(c.followUpsDonePct)} <span className="text-xs text-ink-3">of {c.followUpsDue}</span></td>
                  <td className="td text-right num">{formatInt(c.contacts)}</td>
                  <td className="td text-right num">{formatInt(c.openNow)} / <span className={c.overdueNow ? "text-crit font-medium" : ""}>{formatInt(c.overdueNow)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function ModelTable({ rows, dealers }: { rows: ModelRow[]; dealers: DealerOpt[] }) {
  const [f, setF] = useState("");
  const shown = useMemo(() => rows.filter((r) => !f || r.dealershipId === f).slice(0, 20), [rows, f]);
  return (
    <Panel title="Models" subtitle="Interest, test drives and sales by model" actions={<DealerFilter dealers={dealers} value={f} onChange={setF} label="Filter models by dealership" />} bodyClassName="px-0 pb-0">
      {!shown.length ? <EmptyState title="No model activity for this selection" icon="car" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line"><tr><th className="th">Model</th><th className="th">Dealership</th><th className="th text-right">Enquiries</th><th className="th text-right">Test drives</th><th className="th text-right">Test-drive share</th><th className="th text-right">Sold</th></tr></thead>
            <tbody>
              {shown.map((m) => (
                <tr key={`${m.model}|${m.dealershipId}`} className="border-b border-line last:border-0">
                  <td className="td font-medium">{m.model}</td>
                  <td className="td whitespace-nowrap"><Dealer id={m.dealershipId} dealers={dealers} /></td>
                  <td className="td text-right num">{formatInt(m.enquiries)}</td>
                  <td className="td text-right num">{formatInt(m.drives)}</td>
                  <td className="td text-right num">{m.enquiries ? formatPct((m.drives / m.enquiries) * 100) : "—"}</td>
                  <td className="td text-right num font-medium">{formatInt(m.won)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
