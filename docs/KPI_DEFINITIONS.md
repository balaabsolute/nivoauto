# KPI definitions and calculation rules

All formulas are implemented in `src/domain/` (pure functions) and covered by `tests/domain.test.ts` and
`tests/integration.test.ts`. Dashboards compute every figure from stored records at request time.

> Definitions marked **(to confirm)** are implementation defaults chosen to make the MVP work. The brief
> (§15) lists them as decisions for discovery.

## 1. Date periods (`src/domain/periods.ts`)

- **Business date:** the calendar date in `REPORTING_TZ` (default Asia/Kolkata). Transactions carry a
  business date; jobs carry timestamps that are converted to IST-midnight boundaries for filtering.
- **Inclusive ranges:** a period includes its start and end dates.
- **Financial year:** starts in `FY_START_MONTH` (default April). Quarters are FY quarters (Q1 = Apr–Jun). **(to confirm)**

| Selector | Range | Compared with |
|---|---|---|
| Today | today | yesterday |
| Month to date | 1st of month → today | same day-span of the previous month (capped at that month’s length) |
| Previous month | full previous month | the month before |
| Quarter | FY quarter start → today | same day-span of the previous quarter |
| Year to date | FY start → today | same day-span of the previous FY |
| Custom | chosen dates (≤ 2 years, not in the future) | the same number of days immediately before |

Periods longer than 62 days chart by month; otherwise by day. When a period is shorter than 7 days, the
trend chart shows month-to-date for context.

**Incomplete current day:** utilisation, and the comparison used by the *revenue below target* alert, use
**completed days only** (through yesterday), so a day in progress never reads as under-performing.
Headline revenue still includes today’s recorded lines, and the UI marks the period “today in progress”.

## 2. Revenue and gross profit (`src/domain/revenue.ts`)

**Total revenue = vehicle sales + service labour & repairs + spare parts + body shop**, ex-tax.

Double-counting safeguards:

| Rule | Treatment |
|---|---|
| R1 Tax | Stored separately (`tax_amount`) and never counted as revenue. |
| R2 Bundled service invoices | Split into lines. Labour goes to *service labour*; parts go to *spare parts* with channel `workshop`. Parts are therefore never inside service revenue. A parts channel on a non-parts line is rejected. |
| R3 Booking advances | `kind = booking_advance` is excluded from revenue and from vehicles delivered. Vehicle revenue comes from invoice lines only. |
| R4 Credit notes | Negative amounts (sign normalised on entry) that reduce revenue and units in the period issued. |
| R5 Intercompany | `kind = intercompany` is excluded from comparable revenue and reported separately. **(to confirm)** |
| R6 Duplicates | Unique `(source, source_ref)`. Re-imports skip existing lines. Manual entries are keyed by dealership + invoice ref + kind + category + channel. |
| R7 Entity retention | Every line stores legal entity, dealership, brand, source and source reference. |

**Gross profit** uses only lines whose direct cost is known.

- Cost coverage = revenue on lines with known cost ÷ total revenue.
- Coverage 100 %: GP is shown as **complete**.
- Coverage ≥ `GP_MIN_COVERAGE` (default 80 %) and < 100 %: GP is shown as **provisional**. Margin = GP ÷ *covered* revenue, so missing costs don’t inflate margin.
- Coverage below the threshold: GP is **withheld** (“cost data incomplete”).
- No revenue: “no revenue” (not 0 %).

**Gross margin %** = GP ÷ covered revenue × 100. **Revenue growth** = (current − comparison) ÷ |comparison| × 100. It is null when the comparison period has no revenue lines or nets to zero.

**Reconciliation:** each line is `unreconciled`, `reconciled` or `disputed`. *Reconciled %* = reconciled
revenue ÷ revenue. The dashboard is management information, **not statutory consolidated accounts**.

## 3. Targets (`src/domain/kpi.ts`)

- Targets are monthly per dealership (revenue ex-tax, vehicle deliveries) and count **only once approved**.
- Target for a period = Σ monthly target × (days of the period in that month ÷ days in month), i.e. pro rata.
  If any month in the period lacks an approved target, that dealership has no target for the period.
- **Target achievement %** = actual ÷ target × 100.
- **Group** achievement uses only dealerships with approved targets, and the UI states the coverage
  (e.g. “5 of 6 dealerships”).

## 4. Service KPIs

| KPI | Definition |
|---|---|
| Appointments scheduled vs attended | Appointments in period (excl. cancelled); attendance % = attended ÷ (attended + no-show) |
| Jobs opened / delivered | Jobs with `opened_at` / `delivered_at` in the period |
| Open jobs | Opened by the as-of time and not delivered or cancelled (as-of = now, or period end if earlier). Cancellation time isn’t tracked separately, so a cancelled job doesn’t count as open even for periods before its cancellation. |
| Ageing buckets | Open jobs by elapsed time since opening: up to 1 day, 1–3 days, 3–7 days, over 7 days |
| Overdue | Open and past the promised time (falls back to expected completion if no promise) |
| Average turnaround | Mean hours from opening to delivery, for jobs delivered in the period |
| On-time delivery % | Delivered by the promised time ÷ delivered jobs that had a promise |
| Average revenue per completed job | Invoice/credit-note revenue linked to jobs delivered in the period ÷ number of those jobs that have linked revenue |
| Comeback rate | Jobs opened in the period flagged as comebacks ÷ jobs opened (once consistently captured) |
| Waiting | Open jobs blocked on parts, on approval (customer/insurer or pending approval), or other |

## 5. Body shop KPIs

Work in progress by common stage (intake, assessment, approval, denting, painting, finishing, QC, billing,
ready); vehicles awaiting assessment (intake + assessment); jobs waiting for approval or parts; average
repair cycle (opening → delivery); overdue promised deliveries; paint booth and body bay utilisation;
revenue per delivered job where linked revenue exists.

## 6. Capacity (`src/domain/kpi.ts`)

- **Available productive hours** = units × productive hours per unit per working day × working days, from
  the capacity profile (service bays, body bays, paint booths). A dealership’s daily report can override
  available service bay-hours for a day (e.g. a bay down for maintenance).
- **Used productive hours** = labour hours logged on job cards (`labour_logs`). Labour can’t be dated before the job opened or more than 7 days back, so closed periods stay stable.
- **Utilisation %** = used ÷ available × 100, over completed days. Brief example: 60 of 80 h = 75 % (tested).
- Capacity must reflect real operating hours and staffing, not the count of bays. The admin screen states this.

## 7. Spare parts KPIs

Retail vs workshop parts revenue; parts gross margin (same GP rules); part lines issued to jobs in the
period; jobs currently delayed by parts. Stock-outs and ageing inventory are **not** shown until reliable
inventory data exists (brief §6.4).

## 8. Sales pipeline

Leads, bookings, booking cancellations and expected deliveries (next 7 days) come from the **dealership
daily report** until a sales system is integrated (Phase 2). Expected deliveries is a snapshot: the latest
reported figure per dealership, never summed across days. *Booking conversion* = bookings ÷ leads.
Daily-report coverage = submitted ÷ expected reports for completed days.

### 8a. Showroom funnel (`funnel()` in `src/domain/crm.ts`)

Captured transactionally by the kiosk, front desk and enquiry records (separate from the daily-report
figures above, which remain until the dealership switches over). For a period [from, to):

| Measure | Rule |
|---|---|
| Walk-ins | Front-desk visits created in the period, by type (new car, service, spare parts, body shop) |
| New-car enquiries | Enquiries **created** in the period (walk-in, phone, web, referral, lounge conversion) |
| Test drives done | Test drives **completed** in the period (licence check required to complete) |
| Test-drive rate | Enquiries created in the period that have a completed test drive ÷ enquiries created in the period |
| Sold (won) | Enquiries **closed as won** in the period |
| Close rate | Won ÷ all enquiries **closed** in the period (won + bought elsewhere + not interested + opted out) |
| Open at period end | Enquiries created before the period end that were open at that moment |

Nurture eligibility: an enquiry receives model updates only while **open**, and only if the customer gave
marketing consent, has not opted out, and has a consented channel. Any closing outcome stops nurture and
cancels open follow-ups. A *STOP* / opt-out sets the customer's marketing opt-out, which also excludes them
from lounge-prospect updates. Service-update consent is separate and unaffected.

Lounge prospects: the *upgrade due* tag means purchase year ≤ current year − 5 (`UPGRADE_AGE_YEARS`,
default 5). Prospect ranking score combines interest, timeframe and car age (`prospectScore`).

## 9. Management alerts (`src/domain/alerts.ts`)

Transparent rules, evaluated when a dashboard is viewed and stored with owner, due date, status and history.
**Thresholds are placeholders** (env-configurable) to agree with Kun:

| Rule | Fires when | Default |
|---|---|---|
| Revenue below target | completed-day revenue < X % of pro-rata approved target | warn < 90 %, critical < 75 % |
| Jobs past promised delivery | ≥ 1 overdue open job | critical at ≥ 5 |
| Capacity imbalance | service bay utilisation outside band | > 95 % or < 50 % |
| Revenue up, margin down | revenue ↑ vs comparison and margin ↓ by ≥ N pp (only with adequate cost data) | 2 pp |
| Approval wait | jobs that have been in an approval-pending state for longer than N days (time in the current stage) | 3 days |
| Daily report missing | a submitted report is missing for one or more of the last 3 completed days | info |

Each alert records the observed fact, period, source, evidence values, a suggested investigation, owner,
due date and status. Causes are never asserted. Resolving or dismissing requires a note.

## 10. Data freshness & completeness

Shown above every dashboard:
- **Last update:** latest transaction import or job activity.
- **Reporting coverage:** dealerships with any data in the period.
- **Daily reports:** submitted of expected.
- **Lines missing cost.**
- **Unreconciled revenue:** amount and line count.
- **Reconciled %.**

A dealership with no new records for `STALE_AFTER_HOURS` is flagged *Stale data*.
