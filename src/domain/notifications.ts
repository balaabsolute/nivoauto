/**
 * Customer status notifications (brief §8.3) — pure rules.
 *
 *  - Triggered only by verified workflow events (not every internal change).
 *  - Channel chosen from customer preference, then consent, then provider availability.
 *  - No consent on any available channel → recorded as SKIPPED with a reason (never silently dropped).
 *  - De-duplicated by a key so the same milestone is not sent twice; a slipped delivery date is a
 *    new milestone (the key includes the new date).
 */
import type { Channel, NotificationEvent } from "@/db/schema";
import { formatDateTime, formatInr } from "./format";

export const EVENT_LABELS: Record<NotificationEvent, string> = {
  appointment_confirmed: "Appointment confirmed",
  vehicle_received: "Vehicle received / inspected",
  approval_required: "Approval required",
  repair_delayed: "Repair delayed",
  vehicle_ready: "Vehicle ready",
};

export interface CustomerContact {
  name: string;
  phone: string | null;
  email: string | null;
  preferredChannel: Channel | null;
  consentWhatsapp: boolean;
  consentSms: boolean;
  consentEmail: boolean;
}

export type ChannelChoice = { channel: Channel; recipient: string } | { channel: null; skipReason: string };

const FALLBACK_ORDER: Channel[] = ["whatsapp", "sms", "email"];

export function chooseChannel(c: CustomerContact, availableChannels: Channel[]): ChannelChoice {
  const order = c.preferredChannel ? [c.preferredChannel, ...FALLBACK_ORDER.filter((x) => x !== c.preferredChannel)] : FALLBACK_ORDER;
  const consent: Record<Channel, boolean> = { whatsapp: c.consentWhatsapp, sms: c.consentSms, email: c.consentEmail };
  const address: Record<Channel, string | null> = { whatsapp: c.phone, sms: c.phone, email: c.email };
  let sawConsent = false;
  for (const ch of order) {
    if (!consent[ch]) continue;
    sawConsent = true;
    if (!address[ch]) continue;
    if (!availableChannels.includes(ch)) continue;
    return { channel: ch, recipient: address[ch]! };
  }
  if (!sawConsent) return { channel: null, skipReason: "No recorded customer consent for any channel" };
  if (!availableChannels.length) return { channel: null, skipReason: "No notification provider configured" };
  return { channel: null, skipReason: "No consented channel with contact details and an available provider" };
}

export interface TemplateContext {
  customerName: string;
  dealershipName: string;
  jobNo?: string;
  registrationNo?: string;
  scheduledAt?: Date | null;
  requestedWork?: string | null;
  estimateAmount?: number | null;
  expectedAt?: Date | null;
  delayReason?: string | null;
  outstandingAmount?: number | null;
}

/** Plain-text bodies. Provider adapters may map these to approved templates (e.g. WhatsApp). */
export function renderTemplate(event: NotificationEvent, c: TemplateContext): string {
  const hi = `Hello ${c.customerName},`;
  const sign = `— ${c.dealershipName}`;
  switch (event) {
    case "appointment_confirmed":
      return `${hi} your appointment at ${c.dealershipName} is confirmed for ${formatDateTime(c.scheduledAt ?? null)}${c.registrationNo ? ` (vehicle ${c.registrationNo})` : ""}.${c.requestedWork ? ` Requested work: ${c.requestedWork}.` : ""} ${sign}`;
    case "vehicle_received":
      return `${hi} we have received your vehicle ${c.registrationNo ?? ""} — job reference ${c.jobNo}. We will share the inspection/estimate status shortly. ${sign}`;
    case "approval_required":
      return `${hi} the estimate for job ${c.jobNo} (${c.registrationNo ?? ""}) is ${formatInr(c.estimateAmount ?? null)}. Please reply to approve, or call us to discuss the additional work. ${sign}`;
    case "repair_delayed":
      return `${hi} work on job ${c.jobNo} is taking longer than planned. Updated expected delivery: ${formatDateTime(c.expectedAt ?? null)}.${c.delayReason ? ` Reason: ${c.delayReason}.` : ""} We apologise for the inconvenience. ${sign}`;
    case "vehicle_ready":
      return `${hi} your vehicle ${c.registrationNo ?? ""} (job ${c.jobNo}) is ready for collection.${c.outstandingAmount ? ` Outstanding amount: ${formatInr(c.outstandingAmount)}.` : ""} Please bring this message when collecting. ${sign}`;
  }
}

export function dedupeKey(event: NotificationEvent, ref: { jobId?: string | null; appointmentId?: string | null; variant?: string }): string {
  return [event, ref.jobId ?? ref.appointmentId ?? "none", ref.variant ?? ""].join(":");
}

/** Delay notification only when the customer-facing date moves LATER than what they were last told. */
export function isCustomerFacingDelay(previousCommitment: Date | null, newExpected: Date | null): boolean {
  return !!previousCommitment && !!newExpected && newExpected.getTime() > previousCommitment.getTime();
}

export const MAX_ATTEMPTS = Number(process.env.NOTIFY_MAX_ATTEMPTS ?? 3);
