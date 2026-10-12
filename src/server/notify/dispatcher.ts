import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { notifications, customers, dealerships, type NotificationEvent } from "@/db/schema";
import { chooseChannel, dedupeKey, renderTemplate, MAX_ATTEMPTS, type TemplateContext } from "@/domain/notifications";
import { getProvider } from "./providers";

export interface NotifyRequest {
  event: NotificationEvent;
  dealershipId: string;
  customerId: string;
  jobId?: string | null;
  appointmentId?: string | null;
  variant?: string; // e.g. new expected date for repair_delayed
  context: Omit<TemplateContext, "customerName" | "dealershipName">;
  isDemo?: boolean;
}

/**
 * Record a notification for a verified workflow event, then attempt delivery.
 * Idempotent: a second request with the same dedupe key returns the existing record.
 */
export async function notify(db: DB, req: NotifyRequest): Promise<typeof notifications.$inferSelect> {
  const key = dedupeKey(req.event, { jobId: req.jobId, appointmentId: req.appointmentId, variant: req.variant });
  const [existing] = await db.select().from(notifications).where(eq(notifications.dedupeKey, key)).limit(1);
  if (existing) return existing;

  const [cust] = await db.select().from(customers).where(eq(customers.id, req.customerId)).limit(1);
  const [dealer] = await db.select().from(dealerships).where(eq(dealerships.id, req.dealershipId)).limit(1);
  if (!cust || !dealer) throw new Error("Customer or dealership not found for notification");

  const provider = getProvider();
  const choice = chooseChannel(
    { name: cust.name, phone: cust.phone, email: cust.email, preferredChannel: cust.preferredChannel ?? null, consentWhatsapp: cust.consentWhatsapp, consentSms: cust.consentSms, consentEmail: cust.consentEmail },
    provider?.channels ?? [],
  );
  const body = renderTemplate(req.event, { ...req.context, customerName: cust.name, dealershipName: dealer.name });

  const inserted = await db
    .insert(notifications)
    .values({
      event: req.event,
      dedupeKey: key,
      dealershipId: req.dealershipId,
      customerId: req.customerId,
      jobId: req.jobId ?? null,
      appointmentId: req.appointmentId ?? null,
      channel: choice.channel,
      recipient: choice.channel ? choice.recipient : null,
      body,
      status: choice.channel ? "queued" : "skipped",
      skipReason: choice.channel ? null : choice.skipReason,
      isDemo: req.isDemo ?? false,
    })
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning();
  const row = inserted[0] ?? (await db.select().from(notifications).where(eq(notifications.dedupeKey, key)))[0];
  if (row.status === "queued") return attempt(db, row.id);
  return row;
}

/** Attempt (or retry) delivery of a queued/failed notification. */
export async function attempt(db: DB, id: string): Promise<typeof notifications.$inferSelect> {
  const [n] = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
  if (!n) throw new Error("Notification not found");
  if (n.status === "sent" || n.status === "skipped") return n;
  if (n.attempts >= MAX_ATTEMPTS) return n;
  const provider = getProvider();
  if (!provider || !n.channel || !n.recipient || !provider.channels.includes(n.channel)) {
    const [u] = await db
      .update(notifications)
      .set({ status: "failed", attempts: n.attempts + 1, lastAttemptAt: new Date(), lastError: "No provider available for this channel" })
      .where(eq(notifications.id, id))
      .returning();
    return u;
  }
  const res = await provider.send({ id: n.id, channel: n.channel, recipient: n.recipient, body: n.body, event: n.event });
  const [u] = await db
    .update(notifications)
    .set({
      status: res.ok ? "sent" : "failed",
      provider: provider.name,
      providerRef: res.providerRef ?? null,
      attempts: n.attempts + 1,
      lastAttemptAt: new Date(),
      lastError: res.ok ? null : res.error ?? "Unknown error",
      sentAt: res.ok ? new Date() : null,
    })
    .where(eq(notifications.id, id))
    .returning();
  return u;
}
