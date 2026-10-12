# Data model

Source of truth: `src/db/schema.ts` (Drizzle, PostgreSQL). Migrations: `./drizzle`.

## Principles

- **No hard-coded dealerships.** Legal entities, brands and dealerships are master data managed in
  *Administration*. A dealership = one brand + one legal entity + one location, with flags for the
  facilities it has (sales, service, body shop).
- **Mixed legal entities.** Customers belong to a legal entity, which is the boundary for duplicate
  matching. Every revenue line stores legal entity, dealership, brand, source and source reference. A
  dealership’s legal entity cannot be changed once it has jobs, transactions or customers.
- **Capture once.** `jobs` is the single operational record for service and body shop work. It drives the
  workflow, timeline, labour (capacity), parts and customer notifications, and revenue lines can link to it.
- **Demo separation.** Records that can be demo data carry `is_demo`. Records created at a demo dealership
  inherit demo status. `DATA_MODE=live` filters demo rows out of every user-facing read and record lookup,
  and demo accounts cannot sign in.
- **Auditability.** `audit_log` is append-only and records who, what, when, before and after for sensitive
  changes. `job_events` is the per-job timeline (stage changes with reasons, field changes, notes).

## Entities

| Table | Purpose |
|---|---|
| `legal_entities`, `brands`, `dealerships` | Master data. Each dealership has an identity colour (`color`, chosen under Administration) used wherever it is named |
| `users`, `user_dealerships`, `sessions` | Accounts, dealership scope for location-bound roles, hashed session tokens |
| `customers`, `vehicles` | Customer (per legal entity) with channel consent + timestamp, separate marketing consent and marketing opt-out; vehicles by normalised registration |
| `workflow_stages` | Stage configuration: group default (`dealership_id` NULL) or per location; each stage maps to a **common stage** |
| `jobs` | Service and body shop jobs: stage, status, assignment, estimate/approval, insurer, blocker, delay reason, next action, promised/expected times, invoice/payment, comeback flag, optimistic-lock `version` |
| `job_checklist_items`, `job_parts`, `job_photos`, `labour_logs`, `job_events` | Job card detail and timeline |
| `appointments` | Bookings; check-in creates the job and links it |
| `transactions` | Revenue lines (category, kind, parts channel, revenue ex-tax, tax, direct cost, units, refs, reconciliation status, source) |
| `import_batches` | CSV import history with row-level errors |
| `targets` | Monthly revenue/delivery targets per dealership with approver and approval time |
| `capacity_profiles` | Units and productive hours per resource type, working-day pattern |
| `daily_reports` | Dealership daily pipeline figures (leads, bookings, cancellations, expected deliveries), capacity override, notes |
| `alerts` | Management actions: rule, fingerprint (rule + dealership + period), evidence, owner, due date, status |
| `notifications` | Customer messages: event, de-dupe key, channel, recipient, body, status, attempts, provider ref, errors |
| `car_models` | Catalogue per brand (body type, fuel, optional display price band); drives kiosk and enquiry choices |
| `walk_ins` | Front-desk visit: type, token, captured via kiosk/staff, status, attended by, link to enquiry or job |
| `leads` | New-car enquiry: number, source, consultant, stage (enquiry → test drive → negotiation → booked), status (open / won / bought elsewhere / not interested / opted out), timeframe, budget, exchange, next follow-up, loss details |
| `lead_interests`, `test_drives`, `lead_activities`, `follow_ups` | Models of interest, test drives (licence check, rating), timeline, follow-up tasks (incl. tasks raised by a model update) |
| `model_updates` | Nurture broadcasts about a model: type, title, message, audience counts |
| `lounge_feedback` | Lounge survey: current car, purchase year, interest, timeframe, budget, preferred models; prospect status and converted enquiry |
| `audit_log` | Append-only audit records |
| `app_settings` | Reserved key/value settings |

## Workflow model

Common stages are the reporting backbone:

- **Service:** registered → inspection → estimate_approval → in_progress → quality_check → billing → ready → delivered
- **Body shop:** intake → assessment → approval → denting → painting → finishing → quality_check → billing → ready → delivered

A location may rename stages, add stages, or split one (the demo BMW body shop splits *painting* into
*Primer & preparation* and *Paint booth*). Validation requires that the order follows the common model,
the first and last stages map correctly, and every common stage is present.

Transition rules (`src/domain/workflow.ts`):
- Forward moves go one stage at a time. Rework (backwards) requires a reason. Closed or cancelled jobs are immutable.
- Leaving an approval stage requires a recorded approval. Work stages require an assigned technician.
- A parts blocker prevents billing, ready and delivered. Delivery requires an invoice reference and payment status.
- Side effects: entering an approval stage sets approval to pending and notifies the customer. Entering
  *ready* sets the completion time and sends a *vehicle ready* message. *Delivered* closes the job.
- Technicians may only move their own assigned jobs forward from a work stage or into QC.

## Integration points (adapters, no assumed systems)

- **Imports:** `importTransactionsCsv` (validated, idempotent). The same validation applies to manual entry.
  Future API or scheduled imports should call the same service.
- **Notifications:** `src/server/notify/providers.ts`. Console (simulated), signed webhook, or none.
- **File storage:** `src/server/storage.ts`. Local disk by default; replace with object storage.
