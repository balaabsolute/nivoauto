# Kun Automobile — Group Intelligence & Digital Operations Platform

Phase 1 MVP built from the *Kun Automobile Digital Transformation Build Brief*. One job record runs the
workshop, informs the group dashboard and triggers customer updates.

> **Demo data notice.** The bundled dataset is synthetic and illustrative. It contains **no Kun Automobile
> figures**. Every demo row is flagged `is_demo`, every screen shows a hazard-striped *Demo data* banner
> while `DATA_MODE=demo`, and `DATA_MODE=live` excludes demo rows everywhere and refuses to seed them.

## What’s in Phase 1

| Brief §17 milestone | Where |
|---|---|
| 1. Authentication & roles | `/login`, session cookies, 6 roles + dealership scope (`src/domain/permissions.ts`) |
| 2. Group executive overview | `/group`: headline figures, trend vs prior & target, revenue mix, pipeline, operational health, insights, data freshness |
| 3. Dealership comparison & drill-down | sortable table on `/group` and `/dealerships`; `/dealerships/[id]` |
| 4. Digital service job cards | `/jobs`, `/jobs/new`, `/jobs/[id]`: checklist, photos, parts, labour, approvals, QC, billing, delivery, timeline |
| 5. Body shop stage tracking | `/bodyshop` stage board; configurable stages per location (`/admin/workflow`) |
| 6. Daily reporting | `/reports/daily`: dealership submission, generated group report, print/PDF, CSV export |
| 7. Customer notification hooks | event-triggered, consent-aware, logged, retryable (`/notifications`); provider adapter |
| 8. Labelled demo dataset | `npm run db:seed-demo` |

Also included: appointments with check-in to a job card, manual revenue entry, validated CSV import with
de-duplication, approved targets, reconciliation status, management actions (owner, due date, status),
administration (users, entities, brands, dealerships, capacity, workflow stages) and an append-only audit trail.

## Quick start (local demo, no database install)

Requirements: Node.js ≥ 20.18 (22 LTS recommended).

```bash
npm install
npm run db:seed-demo     # creates ./.data/pglite (embedded Postgres) and loads the demo dataset (~15–40 s)
npm run dev              # http://localhost:3000
```

Sign in with any demo account. The password for all of them is `demo-pass-2026`. The login page lists them too.

| Role | Email |
|---|---|
| Managing Director | `md@demo.kun.local` |
| Group finance | `finance@demo.kun.local` |
| Dealership manager | `manager.bmw@demo.kun.local` (also `.hon`, `.hyu`, `.rr`, `.vw`, `.byd`) |
| Service advisor | `advisor.bmw@demo.kun.local` (same suffixes) |
| Technician | `tech1.bmw@demo.kun.local`, `tech2.…`, `tech3.…` |
| Administrator | `admin@demo.kun.local` |

> Stop the dev server before re-running `db:seed-demo` when using the embedded database. PGlite allows
> only one process to open the data directory at a time.

Production build against the embedded demo database: `npm run build && npm run start:demo`.
For real deployments use PostgreSQL. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm run start` | Production build / server (requires `DATABASE_URL`) |
| `npm run start:demo` | Production server on the embedded PGlite database (demo only) |
| `npm run db:generate` | Generate a new SQL migration from `src/db/schema.ts` (drizzle-kit) |
| `npm run db:migrate` | Apply migrations in `./drizzle` and ensure default workflow stages |
| `npm run db:seed-demo` | Replace demo rows with a fresh demo dataset (refused when `DATA_MODE=live`) |
| `npm run db:seed-demo -- --remove` | Remove all demo rows and everything attached to demo dealerships |
| `npm run user:create -- --email … --name "…" --role admin` | Create a real user (password from `KUN_NEW_USER_PASSWORD`) |
| `npm test` | Unit + integration tests (Vitest, in-memory Postgres) |
| `npm run test:e2e` | Playwright smoke tests against a running, demo-seeded app |
| `npm run typecheck` | TypeScript check |

## Configuration

Copy `.env.example` to `.env.local` (dev) or set variables in your host. All variables are optional in dev.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string. If unset, embedded PGlite is used (dev/demo only). |
| `DATABASE_SSL` | — | `require` to use TLS to Postgres. |
| `DATABASE_POOL_MAX` | `10` | Connection-pool size. |
| `PGLITE_DIR` | `./.data/pglite` | Embedded database directory. |
| `ALLOW_PGLITE` | — | `1` allows the embedded DB under `NODE_ENV=production` (single-machine demo only). |
| `DATA_MODE` | `demo` | `live` excludes all `is_demo` rows and refuses demo seeding. |
| `ALLOW_DEMO_SEED` | — | `1` permits seeding under `NODE_ENV=production` (dedicated demo environment). |
| `REPORTING_TZ` | `Asia/Kolkata` | Business-date time zone. |
| `FY_START_MONTH` | `4` | Financial-year start month (April). Use `1` for calendar years. |
| `GP_MIN_COVERAGE` | `0.8` | Minimum share of revenue with known cost before gross profit is shown. |
| `STALE_AFTER_HOURS` | `36` | No new records for this long ⇒ dealership flagged as stale. |
| `SESSION_TTL_HOURS` | `12` | Session lifetime. |
| `COOKIE_SECURE` | auto | Set `false` only if production is served over plain HTTP (not recommended). |
| `UPLOAD_DIR` / `MAX_UPLOAD_MB` | `./uploads` / `8` | Job photo storage and size limit. |
| `NOTIFY_PROVIDER` | `console` (dev), `none` (prod) | `console` = simulated, `webhook`, or `none`. |
| `NOTIFY_WEBHOOK_URL` / `_SECRET` / `_CHANNELS` | — | Webhook adapter settings (see deployment guide). |
| `NOTIFY_MAX_ATTEMPTS` | `3` | Delivery attempts per notification. |
| `ALERT_*` | see docs | Alert thresholds (placeholders to agree with Kun). |
| `KUN_NEW_USER_PASSWORD` | — | Read by `user:create`. |

## Architecture

```
src/
  domain/      Pure, tested business rules: periods, revenue & GP rules, KPIs, workflow state machine,
               permissions, alert rules, notification rules, formatting
  db/          Drizzle schema (Postgres), client (pg or embedded PGlite), demo seed
  server/      Services (jobs, appointments, finance, reporting, admin), analytics, auth/session,
               audit, storage adapter, notification dispatcher + provider adapters
  app/         Next.js App Router pages and server actions
  components/  UI primitives, dashboard sections & charts
drizzle/       SQL migrations
tests/         Vitest unit/integration tests; tests/e2e Playwright smoke tests
docs/          Plan, KPI definitions, data model, deployment
```

- **Stack:** Next.js 15 (App Router, server actions), React 19, TypeScript, Tailwind CSS, Recharts,
  Drizzle ORM on PostgreSQL. Embedded PGlite (Postgres compiled to WASM) for local development and tests.
- **Capture once:** a job card drives the workshop workflow, labour/parts data, KPIs and customer updates.
  Revenue lines can be linked to jobs.
- **Calculations** live in `src/domain` and are covered by tests. Dashboards compute from stored records on
  each request, so nothing is pre-aggregated or hard-coded.

Further reading: [Implementation plan & status](docs/IMPLEMENTATION_PLAN.md) ·
[KPI definitions](docs/KPI_DEFINITIONS.md) · [Data model](docs/DATA_MODEL.md) ·
[Deployment & operations](docs/DEPLOYMENT.md)

## Testing

```bash
npm test                                   # 66 unit + integration tests
npm run db:seed-demo && npm run build
npm run start:demo &                       # or npm start with DATABASE_URL
npm run test:e2e                           # 8 Playwright smoke tests
```

The integration tests run the real services against an in-memory Postgres. They cover KPI formulas,
date-period semantics, double-counting safeguards, permissions and entity boundaries, workflow
transitions with audit history, notifications (consent, de-duplication, retry), CSV import and live-mode
demo separation. The end-to-end suite was also run against PostgreSQL 17.

## Known limitations (Phase 1)

See [docs/DEPLOYMENT.md#known-limitations](docs/DEPLOYMENT.md#known-limitations). In short: no external
system integrations yet (by design, adapters only), no real message provider connected, local-disk photo
storage, figures are management information and not statutory consolidated accounts, and alert thresholds
are placeholders pending discovery.
