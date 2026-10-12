import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { listModelUpdates, groupCatalogue, salesDealerships } from "@/server/services/crm";
import { can } from "@/domain/permissions";
import { formatDateTime, formatDate } from "@/domain/format";
import { PageHeader, Panel, Chip, EmptyState, Notice } from "@/components/ui";
import { LeadTabs } from "../LeadTabs";
import { UpdateForm } from "./UpdateForm";

export const metadata = { title: "Model updates" };

const TYPE_LABEL: Record<string, string> = { offer: "Offer", price_change: "Price change", new_variant: "New variant", stock_arrival: "Stock arrived", launch: "Launch", event: "Event" };

export default async function UpdatesPage() {
  const actor = await requireCap("leads.view");
  const db = await getDb();
  const canPublish = can(actor, "model_updates.manage");
  const [rows, dealers, catalogue] = await Promise.all([listModelUpdates(db, actor), salesDealerships(db, actor), canPublish ? groupCatalogue(db) : Promise.resolve([])]);
  const brandIds = new Set(dealers.map((d) => d.brandId));
  const models = catalogue.filter((x) => brandIds.has(x.m.brandId)).map((x) => ({ id: x.m.id, name: x.m.name, brand: x.brand, brandId: x.m.brandId }));

  return (
    <>
      <PageHeader title="Car enquiries" subtitle="Nurture: tell open enquiries about news on the cars they asked about" />
      <LeadTabs current="updates" canPublish={canPublish} />
      <div className="grid gap-4 xl:grid-cols-5">
        {canPublish && (
          <Panel title="New model update" className="xl:col-span-2">
            {models.length ? <UpdateForm models={models} dealers={dealers} /> : <EmptyState title="No models in the catalogue" icon="car">Add models under Administration → Car models.</EmptyState>}
            <div className="mt-4"><Notice>Only customers with an open enquiry for the model, who agreed to offers and haven’t opted out, receive it. Enquiries that are sold, bought elsewhere, not interested or opted out are never messaged.</Notice></div>
          </Panel>
        )}
        <Panel title="Sent updates" className={canPublish ? "xl:col-span-3" : "xl:col-span-5"} bodyClassName="px-0 pb-0">
          {!rows.length ? <EmptyState title="No updates sent yet" icon="spark" /> : (
            <ul className="divide-y divide-line">
              {rows.map(({ u, model, brand, by, dealershipName }) => (
                <li key={u.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone="petrol">{TYPE_LABEL[u.type] ?? u.type}</Chip>
                    <span className="font-medium">{u.title}</span>
                    <span className="text-sm text-ink-3">{brand} {model} · {dealershipName ?? "all dealerships"}</span>
                  </div>
                  <p className="text-sm text-ink-2 mt-1">{u.message}</p>
                  <p className="text-xs text-ink-3 mt-1">
                    {formatDateTime(u.publishedAt ?? u.createdAt)}{by ? ` · ${by}` : ""} · {u.recipients} messaged · {u.tasksCreated} call tasks
                    {u.includeProspects ? " · incl. lounge prospects" : ""}{u.validUntil ? ` · valid until ${formatDate(u.validUntil)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
