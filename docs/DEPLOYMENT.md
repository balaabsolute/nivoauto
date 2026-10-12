# Deployment & operations

## Target topology (pilot)

```
Users (desktop / phone) ──HTTPS──> Reverse proxy (TLS, compression) ──> Next.js app (Node 22) ──> PostgreSQL 15+
                                                                              │
                                                                              ├─> Photo storage (disk volume or object store)
                                                                              └─> Notification webhook (approved provider / gateway)
```

Any host that runs Node 22 works: a VM, a container platform, or Kubernetes. Run a single app instance
for the pilot. For multiple instances, see the notes on photos and login throttling below.

## 1. Database

1. Provision PostgreSQL 15 or later (tested on 17.5). Create a database and a least-privilege user that owns it.
2. Set `DATABASE_URL=postgres://user:password@host:5432/dbname`, and `DATABASE_SSL=require` if the
   server needs TLS.
3. Apply migrations:
   ```bash
   npm ci
   npm run db:migrate        # applies ./drizzle/*.sql and inserts the group-default workflow stages
   ```
4. Schema changes: edit `src/db/schema.ts`, run `npm run db:generate` to create a new SQL migration,
   review it, commit it, and run `db:migrate` on deploy.

Backups: enable automated daily backups with point-in-time recovery on the Postgres service. Job photos
need their own backup if they're stored on disk.

## 2. Build & run

```bash
npm ci
npm run build
NODE_ENV=production DATABASE_URL=… DATA_MODE=live npm start      # listens on :3000 (PORT to change)
```

Health check: `GET /api/health` returns `{ ok, dataMode, db }`, or 503 if the database is unreachable.

A `Dockerfile` is included:

```bash
docker build -t kun-platform .
docker run -p 3000:3000 -e DATABASE_URL=… -e DATA_MODE=live -v kun-uploads:/app/uploads kun-platform
docker run --rm -e DATABASE_URL=… kun-platform npm run db:migrate   # one-off migration job
```

## 3. First users

There is no self-registration. Create the first administrator from the command line:

```bash
KUN_NEW_USER_PASSWORD='…at least 10 chars…' npm run user:create -- --email admin@kun.example --name "Admin Name" --role admin
```

The administrator then adds legal entities, brands, dealerships, capacity profiles and users (with
dealership scope) under **Administration**. The group finance user sets and approves monthly targets
under **Finance & targets → Targets**.

### Showroom and lounge kiosks

1. An administrator adds the brand's models under **Administration → Car models**.
2. Create a user with role **Kiosk device** and exactly one dealership (Administration → Users).
3. On the showroom tablet or touch TV, open the site and sign in once as that user. Kiosk sessions last
   30 days; the device lands on `/kiosk` (walk-ins). Kiosk accounts can only submit visits and feedback —
   they can't read customer records.
4. Put the browser in full-screen / kiosk mode: Android *Screen pinning* or *Add to Home screen* (the app
   ships a web manifest), or Chrome with `--kiosk https://<host>/kiosk`.
5. To switch a device to the lounge feedback screen, tap the top-right corner five times to open the staff
   device menu, then choose *Lounge screen*. The same menu signs the device out.
6. Screens reset automatically after inactivity so the next customer never sees earlier entries.

Sales consultants (role **Sales consultant**) work enquiries and follow-ups; dealership managers also
assign enquiries and publish model updates.

## 4. Demo vs live data

| | Demo environment | Live / pilot environment |
|---|---|---|
| `DATA_MODE` | `demo` (default) | `live` |
| Demo seeding | `npm run db:seed-demo` (set `ALLOW_DEMO_SEED=1` under `NODE_ENV=production`) | Refused |
| Demo rows | Visible, with a *Demo data* banner on every screen | Excluded from every query |

Use a **separate database** for demos. Before go-live in an environment that ever held demo data, run
`npm run db:seed-demo -- --remove` (removal is always allowed), then set `DATA_MODE=live`. In live mode,
demo accounts can't sign in and demo rows are excluded even if some remain.

## 5. Customer notifications

No messaging provider is integrated. Kun needs to choose one (brief §8.3 and §15), and consent capture is
built in. Options:

- `NOTIFY_PROVIDER=console`: simulated. Messages are generated and logged as *sent* with provider
  `console-simulated`, and the UI says nothing reaches customers. This is the default in development.
- `NOTIFY_PROVIDER=webhook`: POSTs JSON to `NOTIFY_WEBHOOK_URL` for an approved gateway or integration
  platform to deliver.
  - Body: `{ type: "customer_notification", id, channel, recipient, body, event, sentAt }`
  - Header `X-Kun-Signature`: HMAC-SHA256 (hex) of the raw body with `NOTIFY_WEBHOOK_SECRET`
  - A 2xx response means delivered or accepted. Return an `X-Message-Id` header to store a provider reference.
  - Any other status or a timeout marks the message *failed*. Staff can retry it up to `NOTIFY_MAX_ATTEMPTS`.
  - `NOTIFY_WEBHOOK_CHANNELS` lists the channels the gateway supports (default `whatsapp,sms,email`).
- `NOTIFY_PROVIDER=none` (production default): messages are recorded as *skipped* with a reason.

Messages are sent only for verified milestones: appointment confirmed, vehicle received, approval
required, a customer-facing delay (expected delivery moved later, with a reason), and vehicle ready. They
are de-duplicated per job and milestone, and only go to channels the customer consented to.
WhatsApp Business normally requires pre-approved templates. Map the five events to templates in the
provider adapter.

## 6. Security checklist

- Serve over HTTPS only. Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- Passwords are hashed with scrypt; sessions are random 256-bit tokens stored hashed. Role, scope,
  password or deactivation changes revoke the user's sessions.
- Login throttling is in memory per instance (5 failures → 5-minute lockout). Behind several instances,
  move it to a shared store or rely on the proxy/WAF.
- Every server action and page re-checks permissions and dealership scope on the server. Technicians
  can't see customer contact details.
- Security headers come from middleware (`X-Frame-Options: DENY`, `X-Content-Type-Options`,
  `Referrer-Policy`). Add a Content-Security-Policy at the proxy once embed requirements are known.
- Photos are served only to users allowed to view the job. Upload types are restricted to JPEG, PNG,
  WebP and HEIC, up to `MAX_UPLOAD_MB`.
- Keep Next.js on a patched 15.5.x release (≥ 15.5.7 includes the 2025 React Server Components security
  fixes). The project pins 15.5.27.

## 7. Operations

- **Logs:** stdout/stderr. Unexpected server-action errors are logged with details and shown to users as
  a generic message. Actions slower than 1 s are logged as `[action] slow server action`.
- **Performance:** dashboards compute from raw records on each request. With the demo volume
  (~26k revenue lines, ~5k jobs, 6 dealerships), a year-to-date group dashboard takes about 1.5 s on
  embedded PGlite. When volumes grow, add pre-aggregated daily tables or materialised views behind the
  same `src/server/analytics.ts` interface.
- **Time zone:** business dates use `REPORTING_TZ`. Server clocks should use NTP.

## Known limitations

1. **No external integrations.** This is deliberate (brief §16): accounting, DMS and inventory systems
   connect later through the import/adapter layer. CSV import is the current route for historical and
   system data.
2. **No live messaging provider.** Notifications are simulated, webhooked or skipped (see §5).
3. **Financial figures are management information**, not statutory consolidated accounts. Revenue
   definitions, GP rules, intercompany treatment and FY/quarter conventions need confirming in discovery.
4. **Alert thresholds and success-measure targets are placeholders.** The brief says not to invent
   performance targets. Set them after measuring the pilot baseline.
5. **Photos are stored on local disk** (`UPLOAD_DIR`). For serverless or multi-instance hosting, replace
   `src/server/storage.ts` with object storage.
6. **The daily-report sales pipeline is still manual.** The showroom CRM now captures walk-ins, enquiries,
   test drives and outcomes transactionally; bookings and deliveries are not yet linked to invoices.
   Vehicle deliveries come from vehicle-sales invoice lines.
7. **Inventory, stock-outs and ageing parts** aren't included until reliable inventory data exists.
8. **No offline mode for workshop phones.** A network connection is needed to save updates.
9. **Embedded PGlite** is for local development, tests and single-machine demos only. One process at a
   time can open its data directory.
10. **No route-level `loading.tsx` boundaries.** With Next 15.5 they intermittently stalled client
    navigations and post-action refreshes in testing, so loading feedback is inline (pending buttons,
    *Updating figures…*). Revisit after the next Next.js major upgrade. A regression end-to-end test covers it.
11. **No complaint capture yet.** Customer complaints are not a separate entity; the drill-down notes this.
12. **Cross-source duplicates are not detected automatically.** De-duplication is per source (`manual` vs
    `import`). If the same invoice is both entered manually and imported, it counts twice until marked
    *disputed* and corrected. Agree one source per dealership and category, and use reconciliation to catch exceptions.
13. **Showroom CRM:** model updates are free text written by managers — only real, approved offers should
    be sent. Replies such as *STOP* need the messaging provider's inbound webhook (not built yet); until then
    staff record the opt-out on the enquiry. There's no kiosk offline mode.
