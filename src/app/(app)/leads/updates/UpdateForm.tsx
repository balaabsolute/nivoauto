"use client";
import { useEffect, useState } from "react";
import { ActionForm, Submit } from "@/components/ActionForm";
import { previewUpdateAction, publishUpdateAction } from "../actions";

interface Model { id: string; name: string; brand: string; brandId: string }
interface Dealer { id: string; name: string; brandId: string }
type Preview = { eligible: number; skipped: Record<string, number>; prospects: number; prospectsSkipped: number };

const TYPES: [string, string][] = [["offer", "Offer / discount"], ["price_change", "Price change"], ["new_variant", "New variant"], ["stock_arrival", "Stock arrived"], ["launch", "Launch"], ["event", "Showroom event"]];
const SKIP: Record<string, string> = { no_marketing_consent: "no consent for offers", opted_out: "opted out", no_channel: "no consented channel" };

export function UpdateForm({ models, dealers }: { models: Model[]; dealers: Dealer[] }) {
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const [dealerId, setDealerId] = useState("");
  const [prospects, setProspects] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const brandId = models.find((m) => m.id === modelId)?.brandId;
  const dealerChoices = dealers.filter((d) => d.brandId === brandId);

  useEffect(() => {
    if (!modelId) return;
    let live = true;
    setPreview(null);
    setErr(null);
    previewUpdateAction({ modelId, dealershipId: dealerId || null, includeProspects: prospects }).then((r) => {
      if (!live) return;
      if (r.ok) setPreview(r.data as Preview);
      else setErr(r.error);
    });
    return () => {
      live = false;
    };
  }, [modelId, dealerId, prospects]);

  const brands = [...new Set(models.map((m) => m.brand))];
  const skippedTotal = preview ? Object.values(preview.skipped).reduce((a, b) => a + b, 0) - (preview.skipped.closed ?? 0) : 0;

  return (
    <ActionForm action={publishUpdateAction} resetOnSuccess className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className="label">Model</span>
          <select name="modelId" value={modelId} onChange={(e) => { setModelId(e.target.value); setDealerId(""); }} className="field">
            {brands.map((b) => <optgroup key={b} label={b}>{models.filter((m) => m.brand === b).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>)}
          </select>
        </label>
        <label><span className="label">Dealership</span>
          <select name="dealershipId" value={dealerId} onChange={(e) => setDealerId(e.target.value)} className="field">
            <option value="">All {dealerChoices.length > 1 ? `${dealerChoices.length} dealerships` : "dealerships"} selling it</option>
            {dealerChoices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label><span className="label">Type</span><select name="type" className="field">{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label><span className="label">Valid until (optional)</span><input type="date" name="validUntil" className="field" /></label>
      </div>
      <label className="block"><span className="label">Title</span><input name="title" required maxLength={80} placeholder="e.g. Festive benefits on the model" className="field" /></label>
      <label className="block"><span className="label">Message to customers</span><textarea name="message" required rows={3} maxLength={500} className="field" placeholder="What changed, and what the customer should do next. Only use real, approved offers." /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="includeProspects" checked={prospects} onChange={(e) => setProspects(e.target.checked)} /> Also send to lounge prospects who chose this model</label>

      <div className="rounded-lg bg-page border border-line p-3 text-sm" aria-live="polite">
        {err ? <p className="text-crit">{err}</p> : !preview ? <p className="text-ink-3">Counting audience…</p> : (
          <>
            <p><span className="font-semibold num">{preview.eligible}</span> open enquir{preview.eligible === 1 ? "y" : "ies"} will get the message and a call task for their consultant.
              {prospects && <> Plus <span className="font-semibold num">{preview.prospects}</span> lounge prospect{preview.prospects === 1 ? "" : "s"}.</>}</p>
            {(skippedTotal > 0 || preview.prospectsSkipped > 0) && (
              <p className="text-ink-3 mt-1">
                Not messaged: {Object.entries(preview.skipped).filter(([k, n]) => k !== "closed" && n > 0).map(([k, n]) => `${n} ${SKIP[k] ?? k}`).join(", ")}
                {preview.prospectsSkipped > 0 && `${skippedTotal > 0 ? ", " : ""}${preview.prospectsSkipped} prospects without consent`}.
              </p>
            )}
          </>
        )}
      </div>
      <Submit pendingText="Publishing…">Publish update</Submit>
    </ActionForm>
  );
}
