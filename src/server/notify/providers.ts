import { createHmac } from "node:crypto";
import type { Channel } from "@/db/schema";

/**
 * Notification provider adapters. NO real WhatsApp/SMS/email provider is integrated yet — one will be
 * chosen with Kun (brief §8.3, §15). Until then:
 *
 *  - "console"  (default in development): logs the message and records it as SENT with
 *               provider "console-simulated". Nothing reaches a customer. The UI labels these.
 *  - "webhook": POSTs a signed JSON payload to NOTIFY_WEBHOOK_URL so an approved gateway or
 *               integration platform can deliver it. Signature: HMAC-SHA256 of the body with
 *               NOTIFY_WEBHOOK_SECRET in header X-Kun-Signature.
 *  - "none":    no provider; notifications are recorded as SKIPPED ("No notification provider configured").
 *
 * To add a real provider, implement NotificationProvider and register it in getProvider().
 */
export interface OutboundMessage {
  id: string;
  channel: Channel;
  recipient: string;
  body: string;
  event: string;
  jobNo?: string | null;
}
export interface SendResult {
  ok: boolean;
  providerRef?: string;
  error?: string;
  simulated?: boolean;
}
export interface NotificationProvider {
  name: string;
  channels: Channel[];
  send(msg: OutboundMessage): Promise<SendResult>;
}

export const consoleProvider: NotificationProvider = {
  name: "console-simulated",
  channels: ["whatsapp", "sms", "email"],
  async send(msg) {
    if (process.env.NODE_ENV !== "test") console.info(`[notify:simulated] ${msg.channel} → ${msg.recipient}: ${msg.body}`);
    return { ok: true, providerRef: `sim-${msg.id.slice(0, 8)}`, simulated: true };
  },
};

export function webhookProvider(url: string, secret: string | undefined, channels: Channel[]): NotificationProvider {
  return {
    name: "webhook",
    channels,
    async send(msg) {
      const body = JSON.stringify({ type: "customer_notification", ...msg, sentAt: new Date().toISOString() });
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (secret) headers["x-kun-signature"] = createHmac("sha256", secret).update(body).digest("hex");
      try {
        const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return { ok: false, error: `Webhook responded ${res.status}` };
        const ref = res.headers.get("x-message-id") ?? undefined;
        return { ok: true, providerRef: ref };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}

let override: NotificationProvider | null | undefined;
/** Tests can inject a provider (or null for "none"). */
export function setProviderForTests(p: NotificationProvider | null | undefined) {
  override = p;
}

export function getProvider(): NotificationProvider | null {
  if (override !== undefined) return override;
  const kind = process.env.NOTIFY_PROVIDER ?? (process.env.NODE_ENV === "production" ? "none" : "console");
  if (kind === "console") return consoleProvider;
  if (kind === "webhook" && process.env.NOTIFY_WEBHOOK_URL) {
    const channels = (process.env.NOTIFY_WEBHOOK_CHANNELS ?? "whatsapp,sms,email").split(",").map((c) => c.trim()) as Channel[];
    return webhookProvider(process.env.NOTIFY_WEBHOOK_URL, process.env.NOTIFY_WEBHOOK_SECRET, channels);
  }
  return null;
}
