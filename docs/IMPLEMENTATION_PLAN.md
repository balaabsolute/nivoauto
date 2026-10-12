# Implementation plan & Phase 1 status

## Repository inspection (brief §16, first step)

No existing Kun Automobile codebase was found among the connected GitHub repositories or the project
folders on the product owner's machine, and the product owner chose to start a new repository. There
was therefore no existing stack, entry point, data model or component library to reuse. This repository
is the new baseline.

## Stack decision

| Concern | Choice | Why |
|---|---|---|
| Web app | Next.js 15 App Router, React 19, TypeScript | One deployable for leadership dashboards and phone-first workshop screens. Server actions keep permission checks on the server. |
| Database | PostgreSQL via Drizzle ORM | Relational model for entities, jobs and transactions; SQL migrations. Embedded PGlite for zero-install dev and fast integration tests on the same schema. |
| Styling / charts | Tailwind CSS tokens; Recharts | Restrained corporate design system; accessible, labelled charts. |
| Tests | Vitest (unit + integration on in-memory Postgres), Playwright (E2E) | Brief §16 requires tests for KPIs, permissions, transitions, date filters and double counting. |

## Increments delivered

1. **Foundations:** schema and migrations, database client (Postgres/PGlite), audit log, data-mode separation.
2. **Domain layer:** periods, revenue/GP rules, KPIs, workflow state machine, permissions, alert and
   notification rules, plus 42 unit tests.
3. **Services:** job cards, appointments, finance (manual entry, CSV import, targets, reconciliation),
   daily reports, management actions, administration, analytics, plus 22 integration tests.
4. **Labelled demo dataset:** synthetic, deterministic and flagged. It includes realistic exception states
   for design review.
5. **UI:**
   - Leadership: MD group dashboard and dealership drill-down
   - Operations: jobs, job card, body shop board, appointments
   - Reporting and finance: daily report, finance and import
   - Governance: management actions, customer updates, administration, audit
6. **Hardening:** root-caused intermittent stalled submissions (route loading boundaries in Next 15.5),
   fixed job numbering after gaps, made demo status inherit from the dealership, refused PGlite in
   production, added live-mode tests and an E2E regression loop, and verified on PostgreSQL 17.
7. **Documentation:** README, KPI definitions, data model, deployment and known limitations.

## MVP acceptance criteria (brief §14)

| Criterion | Status | Evidence |
|---|---|---|
| Users see only data permitted by role and entity scope | Met | `src/domain/permissions.ts`; integration tests "permissions & entity boundaries"; E2E "advisor cannot open the group dashboard" |
| MD views group summary and drills down | Met | `/group` → `/dealerships/[id]`; E2E MD journey |
| Totals calculated from stored records and respond to periods | Met | `src/server/analytics.ts`; integration test "dashboard totals come from stored records…" |
| Revenue categories documented; double counting avoided | Met | `docs/KPI_DEFINITIONS.md` §2; unit + integration tests |
| Service jobs created, assigned, staged, closed with audit history | Met | job service + timeline; integration test "moves through every stage…" |
| Body shop jobs tracked through configured stages incl. delays and expected dates | Met | `/bodyshop`, configurable stages, blocker/delay/expected completion; integration test "configurable workflow" |
| Notifications triggered by workflow events; delivery status recorded | Met (provider pending) | dispatcher and `/notifications`; tests for consent, de-dupe, retry |
| Managers see open jobs, ageing, overdue, capacity | Met | drill-down and operational health panels |
| Data freshness and missing/reconciliation status visible | Met | data-status strip on every dashboard |
| Production UI does not present fictional values as real Kun data | Met | `DATA_MODE=live` exclusion and live-mode tests; demo banner in demo mode |
| Required-field validation, duplicate prevention, change attribution | Met | zod validation; duplicate open job, appointment, invoice-line and import checks; `audit_log` and `job_events` |

## Next increments (suggested)

**Phase 1 pilot readiness** (with Kun, after discovery):
1. Confirm the pilot dealership, paper forms to retire, stage lists, revenue/GP definitions, FY
   convention and alert thresholds. Then update configuration rather than code.
2. Load real master data (entities, dealerships, capacity) and users. Import historical revenue via CSV
   after validation.
3. Select a notification provider and implement its adapter (WhatsApp Business templates for the five
   events). Record consent at intake.
4. Move photo storage to object storage. Set up backups and monitoring. Add a CSP at the proxy.
5. Measure the baseline for the success measures (brief §13) before setting any targets.

**Phase 2 (Expand):** vehicle-sales pipeline module (leads, bookings, deliveries captured transactionally),
parts entries and consumption, more dealerships.
**Phase 3 (Integrate):** accounting/DMS integrations through the import layer, automated reconciliation and
pre-aggregated reporting tables.
**Phase 4 (Optimise):** forecasting, anomaly detection and AI-assisted summaries, grounded in verified
data and separating facts from hypotheses.

## Decisions still open (brief §15)

Pilot dealership and location · forms to digitise first · revenue/GP/target definitions per category ·
common vs variant stages · how bays, booths, hours and technician capacity are recorded today · first
customer channel and consent recording · owners for master data, data quality, targets and
reconciliation · who may view cross-entity financial and customer data.
