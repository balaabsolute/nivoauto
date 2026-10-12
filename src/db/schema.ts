/**
 * Core data model — Kun Automobile Group Intelligence & Digital Operations Platform.
 *
 * Design rules (see docs/DATA_MODEL.md):
 *  - No dealership is hard-coded: legal entities, brands and dealerships are master data.
 *  - Every financial transaction retains legal entity, dealership, brand and source.
 *  - Every record that can be demo data carries `is_demo` so live views can exclude it.
 *  - Operational jobs (service + body shop) share one table so that one record runs the
 *    workflow, powers reporting and triggers customer updates ("capture once").
 */
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

const money = (name: string) => numeric(name, { precision: 16, scale: 2, mode: "number" });
const hours = (name: string) => numeric(name, { precision: 10, scale: 2, mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/* ───────────────────────────── Master data ───────────────────────────── */

export const legalEntities = pgTable("legal_entities", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  registrationRef: text("registration_ref"), // e.g. CIN/GSTIN — optional, validated in discovery
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

export const dealerships = pgTable("dealerships", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(), // short code used in job numbers, e.g. HON1
  name: text("name").notNull(),
  brandId: uuid("brand_id").notNull().references(() => brands.id),
  legalEntityId: uuid("legal_entity_id").notNull().references(() => legalEntities.id),
  locationName: text("location_name").notNull(),
  city: text("city"),
  hasSales: boolean("has_sales").notNull().default(true),
  hasService: boolean("has_service").notNull().default(true),
  hasBodyShop: boolean("has_body_shop").notNull().default(false),
  active: boolean("active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

/* ───────────────────────────── Users & access ───────────────────────────── */

export const ROLES = [
  "md", // Managing Director / group leadership
  "group_finance", // Group operations / finance manager
  "dealership_manager",
  "service_advisor",
  "technician", // Technician / body shop staff
  "admin",
  "sales_consultant", // Showroom sales consultant
  "kiosk", // Showroom / lounge touch-screen device account (submit-only)
] as const;
export type Role = (typeof ROLES)[number];

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<Role>().notNull(),
  active: boolean("active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Dealership scope for location-bound roles. Group roles (md, group_finance) see all. */
export const userDealerships = pgTable(
  "user_dealerships",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    dealershipId: uuid("dealership_id").notNull().references(() => dealerships.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.dealershipId] })],
);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the cookie token
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/* ───────────────────────────── Customers & vehicles ───────────────────────────── */

export const CHANNELS = ["whatsapp", "sms", "email"] as const;
export type Channel = (typeof CHANNELS)[number];

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Customer records are owned by a legal entity to respect entity boundaries.
    legalEntityId: uuid("legal_entity_id").notNull().references(() => legalEntities.id),
    dealershipId: uuid("dealership_id").notNull().references(() => dealerships.id),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    preferredChannel: text("preferred_channel").$type<Channel>(),
    consentWhatsapp: boolean("consent_whatsapp").notNull().default(false),
    consentSms: boolean("consent_sms").notNull().default(false),
    consentEmail: boolean("consent_email").notNull().default(false),
    consentRecordedAt: timestamp("consent_recorded_at", { withTimezone: true }),
    // Marketing (nurture) consent is separate from service-update consent.
    consentMarketing: boolean("consent_marketing").notNull().default(false),
    marketingOptOutAt: timestamp("marketing_opt_out_at", { withTimezone: true }),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("customers_phone_idx").on(t.phone)],
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    registrationNo: text("registration_no").notNull(),
    make: text("make"),
    model: text("model"),
    vin: text("vin"),
    year: integer("year"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("vehicles_reg_idx").on(t.registrationNo)],
);

/* ───────────────────────────── Workflow configuration ───────────────────────────── */

export const JOB_TYPES = ["service", "bodyshop"] as const;
export type JobType = (typeof JOB_TYPES)[number];

/**
 * Location-configurable workflow stages. Rows with dealership_id = NULL are the group default.
 * A dealership can rename, add or split stages, but every stage maps to a *common stage*
 * so group reporting stays comparable.
 */
export const workflowStages = pgTable(
  "workflow_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealershipId: uuid("dealership_id").references(() => dealerships.id, { onDelete: "cascade" }),
    jobType: text("job_type").$type<JobType>().notNull(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    commonStage: text("common_stage").notNull(),
    sequence: integer("sequence").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("workflow_stages_scope_code").on(t.dealershipId, t.jobType, t.code)],
);

/* ───────────────────────────── Jobs ───────────────────────────── */

export const BLOCKERS = ["none", "parts", "customer_approval", "insurer_approval", "technician", "other"] as const;
export type Blocker = (typeof BLOCKERS)[number];
export const JOB_STATUSES = ["open", "closed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const PAYMENT_STATUSES = ["unbilled", "unpaid", "partial", "paid"] as const;

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobNo: text("job_no").notNull().unique(),
    jobType: text("job_type").$type<JobType>().notNull(),
    dealershipId: uuid("dealership_id").notNull().references(() => dealerships.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
    appointmentId: uuid("appointment_id"),
    source: text("source").$type<"appointment" | "walk_in">().notNull().default("walk_in"),
    stageCode: text("stage_code").notNull(),
    commonStage: text("common_stage").notNull(),
    status: text("status").$type<JobStatus>().notNull().default("open"),
    complaint: text("complaint"),
    odometerKm: integer("odometer_km"),
    assignedToId: uuid("assigned_to_id").references(() => users.id),
    team: text("team"),
    estimatedHours: hours("estimated_hours"),
    estimateAmount: money("estimate_amount"),
    approvedAmount: money("approved_amount"),
    approvalStatus: text("approval_status").$type<"not_required" | "pending" | "approved" | "declined">().notNull().default("not_required"),
    insurerName: text("insurer_name"),
    claimRef: text("claim_ref"),
    blocker: text("blocker").$type<Blocker>().notNull().default("none"),
    delayReason: text("delay_reason"),
    nextAction: text("next_action"),
    promisedAt: timestamp("promised_at", { withTimezone: true }),
    expectedCompletionAt: timestamp("expected_completion_at", { withTimezone: true }),
    invoiceRef: text("invoice_ref"),
    paymentStatus: text("payment_status").$type<(typeof PAYMENT_STATUSES)[number]>().notNull().default("unbilled"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }), // work finished (ready)
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    isComeback: boolean("is_comeback").notNull().default(false),
    version: integer("version").notNull().default(1), // optimistic locking
    createdById: uuid("created_by_id").references(() => users.id),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("jobs_dealership_status_idx").on(t.dealershipId, t.status),
    index("jobs_vehicle_idx").on(t.vehicleId),
  ],
);

export const jobChecklistItems = pgTable("job_checklist_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  item: text("item").notNull(),
  result: text("result").$type<"pending" | "ok" | "attention" | "na">().notNull().default("pending"),
  note: text("note"),
  sequence: integer("sequence").notNull().default(0),
});

export const jobPhotos = pgTable("job_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  contentType: text("content_type").notNull(),
  caption: text("caption"),
  uploadedById: uuid("uploaded_by_id").references(() => users.id),
  createdAt: createdAt(),
});

export const PART_STATUSES = ["requested", "issued", "unavailable", "returned"] as const;
export const jobParts = pgTable("job_parts", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  partNo: text("part_no"),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 2, mode: "number" }).notNull().default(1),
  status: text("status").$type<(typeof PART_STATUSES)[number]>().notNull().default("requested"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
});

/** Productive time booked against a job — the numerator of utilisation. */
export const labourLogs = pgTable(
  "labour_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
    dealershipId: uuid("dealership_id").notNull().references(() => dealerships.id),
    resourceType: text("resource_type").$type<ResourceType>().notNull(),
    workDate: date("work_date", { mode: "string" }).notNull(),
    hours: hours("hours").notNull(),
    technicianId: uuid("technician_id").references(() => users.id),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("labour_logs_dealer_date_idx").on(t.dealershipId, t.workDate)],
);

/** Immutable job timeline: stage changes, field changes, notes. */
export const jobEvents = pgTable(
  "job_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
    type: text("type").$type<"created" | "stage_change" | "field_change" | "note" | "notification">().notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    field: text("field"),
    reason: text("reason"),
    userId: uuid("user_id").references(() => users.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("job_events_job_idx").on(t.jobId, t.at)],
);

/* ───────────────────────────── Appointments ───────────────────────────── */

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealershipId: uuid("dealership_id").notNull().references(() => dealerships.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
    jobType: text("job_type").$type<JobType>().notNull().default("service"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    requestedWork: text("requested_work"),
    status: text("status").$type<"scheduled" | "attended" | "no_show" | "cancelled">().notNull().default("scheduled"),
    jobId: uuid("job_id"),
    createdById: uuid("created_by_id").references(() => users.id),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("appointments_dealer_time_idx").on(t.dealershipId, t.scheduledAt)],
);

/* ───────────────────────────── Finance ───────────────────────────── */

export const REVENUE_CATEGORIES = ["vehicle_sales", "service_labour", "parts", "body_shop"] as const;
export type RevenueCategory = (typeof REVENUE_CATEGORIES)[number];
export const TXN_KINDS = ["invoice", "credit_note", "booking_advance", "intercompany"] as const;
export type TxnKind = (typeof TXN_KINDS)[number];
export const RECON_STATUSES = ["unreconciled", "reconciled", "disputed"] as const;
export type ReconStatus = (typeof RECON_STATUSES)[number];
export const SOURCES = ["platform", "manual", "import"] as const;
export type DataSource = (typeof SOURCES)[number];

/**
 * Revenue lines. Amounts are stored EXCLUDING tax (tax kept separately, never counted as revenue).
 * A bundled service invoice must be split into lines: labour → service_labour, parts → parts
 * (channel = workshop). See src/domain/revenue.ts for the counting rules.
 */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    dealershipId: uuid("dealership_id").notNull().references(() => dealerships.id),
    legalEntityId: uuid("legal_entity_id").notNull().references(() => legalEntities.id),
    brandId: uuid("brand_id").notNull().references(() => brands.id),
    category: text("category").$type<RevenueCategory>().notNull(),
    partsChannel: text("parts_channel").$type<"retail" | "workshop">(),
    kind: text("kind").$type<TxnKind>().notNull().default("invoice"),
    revenueAmount: money("revenue_amount").notNull(), // ex-tax; negative for credit notes
    taxAmount: money("tax_amount"),
    directCostAmount: money("direct_cost_amount"), // NULL = cost not known → GP provisional
    units: integer("units"), // vehicles delivered on a vehicle_sales invoice line
    invoiceRef: text("invoice_ref"),
    jobId: uuid("job_id").references(() => jobs.id),
    source: text("source").$type<DataSource>().notNull(),
    sourceRef: text("source_ref").notNull(), // de-duplication key within a source
    importBatchId: uuid("import_batch_id"),
    reconciliationStatus: text("reconciliation_status").$type<ReconStatus>().notNull().default("unreconciled"),
    notes: text("notes"),
    createdById: uuid("created_by_id").references(() => users.id),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("transactions_source_ref_uq").on(t.source, t.sourceRef),
    index("transactions_dealer_date_idx").on(t.dealershipId, t.businessDate),
  ],
);

export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(), // "transactions"
  fileName: text("file_name").notNull(),
  rowsTotal: integer("rows_total").notNull(),
  rowsAccepted: integer("rows_accepted").notNull(),
  rowsRejected: integer("rows_rejected").notNull(),
  rowsDuplicate: integer("rows_duplicate").notNull(),
  errors: jsonb("errors").$type<{ row: number; message: string }[]>().notNull().default([]),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: createdAt(),
});

/** Approved targets per dealership per month. Target achievement is only shown against these. */
export const targets = pgTable(
  "targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealershipId: uuid("dealership_id").notNull().references(() => dealerships.id),
    month: text("month").notNull(), // YYYY-MM
    revenueTarget: money("revenue_target"),
    deliveriesTarget: integer("deliveries_target"),
    approvedById: uuid("approved_by_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("targets_dealer_month_uq").on(t.dealershipId, t.month)],
);

/* ───────────────────────────── Capacity ───────────────────────────── */

export const RESOURCE_TYPES = ["service_bay", "paint_booth", "body_bay"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/**
 * Capacity profile — physical units and the *productive* hours each unit is realistically
 * available per working day (after operating hours, maintenance and staffing).
 */
export const capacityProfiles = pgTable(
  "capacity_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealershipId: uuid("dealership_id").notNull().references(() => dealerships.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").$type<ResourceType>().notNull(),
    physicalUnits: integer("physical_units").notNull(),
    productiveHoursPerUnitPerDay: hours("productive_hours_per_unit_per_day").notNull(),
    workingDays: text("working_days").notNull().default("1111110"), // Mon..Sun
    isDemo: boolean("is_demo").notNull().default(false),
  },
  (t) => [uniqueIndex("capacity_dealer_type_uq").on(t.dealershipId, t.resourceType)],
);

/* ───────────────────────────── Daily reporting ───────────────────────────── */

export const dailyReports = pgTable(
  "daily_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealershipId: uuid("dealership_id").notNull().references(() => dealerships.id),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    status: text("status").$type<"draft" | "submitted">().notNull().default("draft"),
    leads: integer("leads"),
    bookings: integer("bookings"),
    bookingCancellations: integer("booking_cancellations"),
    expectedDeliveries7d: integer("expected_deliveries_7d"),
    availableBayHoursOverride: hours("available_bay_hours_override"),
    notes: text("notes"),
    submittedById: uuid("submitted_by_id").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    isDemo: boolean("is_demo").notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("daily_reports_dealer_date_uq").on(t.dealershipId, t.businessDate)],
);

/* ───────────────────────────── Alerts / management actions ───────────────────────────── */

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fingerprint: text("fingerprint").notNull().unique(), // rule + dealership + period
    ruleCode: text("rule_code").notNull(),
    dealershipId: uuid("dealership_id").references(() => dealerships.id),
    severity: text("severity").$type<"info" | "warning" | "critical">().notNull(),
    title: text("title").notNull(),
    observedFact: text("observed_fact").notNull(),
    periodLabel: text("period_label").notNull(),
    evidence: jsonb("evidence").$type<Record<string, string | number | null>>().notNull(),
    suggestedInvestigation: text("suggested_investigation").notNull(),
    source: text("source").notNull(),
    ownerId: uuid("owner_id").references(() => users.id),
    dueDate: date("due_date", { mode: "string" }),
    status: text("status").$type<"open" | "acknowledged" | "in_progress" | "resolved" | "dismissed">().notNull().default("open"),
    resolutionNote: text("resolution_note"),
    active: boolean("active").notNull().default(true), // false once the rule no longer fires
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

/* ───────────────────────────── Notifications ───────────────────────────── */

export const NOTIFICATION_EVENTS = [
  "enquiry_received",
  "model_update",
  "appointment_confirmed",
  "vehicle_received",
  "approval_required",
  "repair_delayed",
  "vehicle_ready",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event: text("event").$type<NotificationEvent>().notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    dealershipId: uuid("dealership_id").notNull().references(() => dealerships.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    jobId: uuid("job_id").references(() => jobs.id),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    leadId: uuid("lead_id").references(() => leads.id),
    channel: text("channel").$type<Channel>(),
    recipient: text("recipient"),
    body: text("body").notNull(),
    status: text("status").$type<"queued" | "sent" | "failed" | "skipped">().notNull().default("queued"),
    skipReason: text("skip_reason"),
    provider: text("provider"),
    providerRef: text("provider_ref"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_job_idx").on(t.jobId)],
);

/* ───────────────────────────── Audit ───────────────────────────── */

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(), // e.g. job.stage_change, transaction.create, user.role_change
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    dealershipId: uuid("dealership_id"),
    before: jsonb("before"),
    after: jsonb("after"),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_at_idx").on(t.at)],
);

/** Single-row-per-key settings, e.g. data mode. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

/* ═════════════════════════════ Showroom & sales (CRM) ═════════════════════════════ */

/** Vehicle catalogue per brand — drives enquiry capture on kiosks and nurture targeting. */
export const carModels = pgTable(
  "car_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id),
    name: text("name").notNull(),
    bodyType: text("body_type"), // hatchback, sedan, suv, mpv, luxury, ev …
    fuelTypes: text("fuel_types"), // comma-separated: petrol,diesel,hybrid,ev,cng
    priceBand: text("price_band"), // display text, e.g. "₹11–20 L" (indicative, set by Kun)
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("car_models_brand_name_uq").on(t.brandId, t.name)],
);

export const VISIT_TYPES = ["new_car", "service", "spare_parts", "body_shop"] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

/** A front-desk visit captured on a kiosk or by staff. */
export const walkIns = pgTable(
  "walk_ins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealershipId: uuid("dealership_id").notNull().references(() => dealerships.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    visitType: text("visit_type").$type<VisitType>().notNull(),
    token: text("token").notNull(), // e.g. N-007, shown to the customer
    businessDate: date("business_date", { mode: "string" }).notNull(),
    capturedVia: text("captured_via").$type<"kiosk" | "staff">().notNull(),
    kioskUserId: uuid("kiosk_user_id").references(() => users.id),
    registrationNo: text("registration_no"),
    vehicleModel: text("vehicle_model"),
    request: text("request"), // service need / part needed / damage description
    insuranceClaim: boolean("insurance_claim"),
    status: text("status").$type<"waiting" | "attending" | "done" | "left">().notNull().default("waiting"),
    attendedById: uuid("attended_by_id").references(() => users.id),
    attendedAt: timestamp("attended_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    outcomeNote: text("outcome_note"),
    leadId: uuid("lead_id"),
    jobId: uuid("job_id"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("walk_ins_dealer_date_idx").on(t.dealershipId, t.businessDate)],
);

export const LEAD_STAGES = ["enquiry", "test_drive", "negotiation", "booked"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const LEAD_STATUSES = ["open", "won", "lost_other_dealer", "not_interested", "opted_out"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_SOURCES = ["walk_in", "phone", "web", "lounge_feedback", "referral", "other"] as const;
export const TIMEFRAMES = ["immediate", "within_1m", "1_3m", "3_6m", "6_12m", "12m_plus", "not_planning"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** New-car enquiry. Nurtured while status = open; any closing outcome stops nurture. */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadNo: text("lead_no").notNull().unique(),
    dealershipId: uuid("dealership_id").notNull().references(() => dealerships.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    source: text("source").$type<(typeof LEAD_SOURCES)[number]>().notNull(),
    walkInId: uuid("walk_in_id"),
    consultantId: uuid("consultant_id").references(() => users.id),
    stage: text("stage").$type<LeadStage>().notNull().default("enquiry"),
    status: text("status").$type<LeadStatus>().notNull().default("open"),
    timeframe: text("timeframe").$type<Timeframe>(),
    budgetMin: money("budget_min"),
    budgetMax: money("budget_max"),
    fuelPreference: text("fuel_preference"),
    financeNeeded: boolean("finance_needed"),
    exchangeVehicle: text("exchange_vehicle"), // free text: make/model/year
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
    lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    lostToBrand: text("lost_to_brand"),
    lostToModel: text("lost_to_model"),
    lostToDealer: text("lost_to_dealer"),
    closeReason: text("close_reason"),
    wonInvoiceRef: text("won_invoice_ref"),
    version: integer("version").notNull().default(1),
    createdById: uuid("created_by_id").references(() => users.id),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("leads_dealer_status_idx").on(t.dealershipId, t.status), index("leads_customer_idx").on(t.customerId)],
);

export const leadInterests = pgTable(
  "lead_interests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    modelId: uuid("model_id").notNull().references(() => carModels.id),
    variant: text("variant"),
    colour: text("colour"),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [uniqueIndex("lead_interests_uq").on(t.leadId, t.modelId)],
);

export const testDrives = pgTable("test_drives", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  modelId: uuid("model_id").notNull().references(() => carModels.id),
  status: text("status").$type<"requested" | "scheduled" | "completed" | "cancelled">().notNull().default("requested"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  licenceChecked: boolean("licence_checked").notNull().default(false),
  rating: integer("rating"), // customer impression 1–5
  notes: text("notes"),
  consultantId: uuid("consultant_id").references(() => users.id),
  createdAt: createdAt(),
});

export const leadActivities = pgTable(
  "lead_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    type: text("type").$type<"created" | "note" | "call" | "visit" | "message" | "test_drive" | "stage_change" | "nurture" | "follow_up" | "outcome" | "assignment">().notNull(),
    text: text("text"),
    userId: uuid("user_id").references(() => users.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lead_activities_lead_idx").on(t.leadId, t.at)],
);

export const followUps = pgTable(
  "follow_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    assignedToId: uuid("assigned_to_id").references(() => users.id),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    kind: text("kind").$type<"call" | "message" | "visit">().notNull().default("call"),
    reason: text("reason").notNull(),
    modelUpdateId: uuid("model_update_id"),
    status: text("status").$type<"open" | "done" | "skipped">().notNull().default("open"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedById: uuid("completed_by_id").references(() => users.id),
    outcomeNote: text("outcome_note"),
    createdAt: createdAt(),
  },
  (t) => [index("follow_ups_assignee_idx").on(t.assignedToId, t.status, t.dueAt)],
);

export const MODEL_UPDATE_TYPES = ["offer", "price_change", "new_variant", "stock_arrival", "launch", "event"] as const;

/** A nurture broadcast about a model, sent to eligible open enquiries (and optionally prospects). */
export const modelUpdates = pgTable("model_updates", {
  id: uuid("id").primaryKey().defaultRandom(),
  modelId: uuid("model_id").notNull().references(() => carModels.id),
  dealershipId: uuid("dealership_id").references(() => dealerships.id), // NULL = all dealerships of the brand in scope
  type: text("type").$type<(typeof MODEL_UPDATE_TYPES)[number]>().notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  validUntil: date("valid_until", { mode: "string" }),
  includeProspects: boolean("include_prospects").notNull().default(false),
  status: text("status").$type<"draft" | "published">().notNull().default("draft"),
  recipients: integer("recipients").notNull().default(0),
  tasksCreated: integer("tasks_created").notNull().default(0),
  createdById: uuid("created_by_id").references(() => users.id),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

export const BUDGET_BANDS = ["under_10l", "10_15l", "15_25l", "25_50l", "50l_1cr", "above_1cr"] as const;

/** Lounge survey: upgrade intent of existing customers → future-prospect pool. */
export const loungeFeedback = pgTable(
  "lounge_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealershipId: uuid("dealership_id").notNull().references(() => dealerships.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    kioskUserId: uuid("kiosk_user_id").references(() => users.id),
    currentMake: text("current_make"),
    currentModel: text("current_model"),
    registrationNo: text("registration_no"),
    purchaseYear: integer("purchase_year"),
    serviceRating: integer("service_rating"), // 1–5, today's experience
    interest: text("interest").$type<"yes" | "maybe" | "no">().notNull(),
    timeframe: text("timeframe").$type<Timeframe>(),
    budgetBand: text("budget_band").$type<(typeof BUDGET_BANDS)[number]>(),
    preferredBodyType: text("preferred_body_type"),
    preferredFuel: text("preferred_fuel"),
    preferredModelIds: jsonb("preferred_model_ids").$type<string[]>().notNull().default([]),
    otherPreferences: text("other_preferences"),
    comments: text("comments"),
    status: text("status").$type<"new" | "contacted" | "converted" | "not_now">().notNull().default("new"),
    convertedLeadId: uuid("converted_lead_id"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("lounge_feedback_dealer_idx").on(t.dealershipId, t.createdAt)],
);
