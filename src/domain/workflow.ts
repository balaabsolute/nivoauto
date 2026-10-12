/**
 * Job workflow state machine (service + body shop).
 *
 * Locations can configure their own stage list (labels, extra/split stages), but every stage maps
 * to a COMMON stage so group reporting stays comparable. Transition rules are expressed on the
 * configured sequence plus guards on common stages.
 */
import type { JobType, Blocker } from "@/db/schema";

export const SERVICE_COMMON_STAGES = [
  "registered",
  "inspection",
  "estimate_approval",
  "in_progress",
  "quality_check",
  "billing",
  "ready",
  "delivered",
] as const;

export const BODYSHOP_COMMON_STAGES = [
  "intake",
  "assessment",
  "approval",
  "denting",
  "painting",
  "finishing",
  "quality_check",
  "billing",
  "ready",
  "delivered",
] as const;

export type CommonStage = (typeof SERVICE_COMMON_STAGES)[number] | (typeof BODYSHOP_COMMON_STAGES)[number];

export const COMMON_STAGE_LABELS: Record<CommonStage, string> = {
  registered: "Registered",
  inspection: "Inspection & job card",
  estimate_approval: "Awaiting approval",
  in_progress: "Work in progress",
  quality_check: "Quality check",
  billing: "Billing",
  ready: "Ready for delivery",
  delivered: "Delivered",
  intake: "Intake",
  assessment: "Assessment & estimate",
  approval: "Insurer / customer approval",
  denting: "Denting & panel",
  painting: "Painting",
  finishing: "Reassembly & finishing",
};

export function commonStagesFor(jobType: JobType): readonly CommonStage[] {
  return jobType === "service" ? SERVICE_COMMON_STAGES : BODYSHOP_COMMON_STAGES;
}

/** Stages that represent hands-on work (technician-operable). */
export const WORK_STAGES: CommonStage[] = ["in_progress", "denting", "painting", "finishing"];
/** Stages where the job waits for an approval decision. */
export const APPROVAL_STAGES: CommonStage[] = ["estimate_approval", "approval"];
/** Stage entered on job creation-equivalent "vehicle received/inspected" milestone. */
export const INSPECTION_STAGES: CommonStage[] = ["inspection", "assessment"];

export interface StageDef {
  code: string;
  label: string;
  commonStage: CommonStage;
  sequence: number;
  active?: boolean;
}

/** Group default stage configuration. Seeded into workflow_stages with dealership_id = NULL. */
export function defaultStages(jobType: JobType): StageDef[] {
  return commonStagesFor(jobType).map((c, i) => ({ code: c, label: COMMON_STAGE_LABELS[c], commonStage: c, sequence: (i + 1) * 10 }));
}

/**
 * Validate a location stage configuration: must start with the first common stage, end with
 * delivered, keep common stages in canonical order, and include every common stage at least once
 * (so reporting is comparable). Extra/split stages may repeat a common stage.
 */
export function validateStageConfig(jobType: JobType, stages: StageDef[]): string[] {
  const errs: string[] = [];
  const active = sortStages(stages.filter((s) => s.active !== false));
  const canon = commonStagesFor(jobType);
  if (!active.length) return ["At least one stage is required"];
  const codes = new Set<string>();
  for (const s of active) {
    if (codes.has(s.code)) errs.push(`Duplicate stage code "${s.code}"`);
    codes.add(s.code);
    if (!canon.includes(s.commonStage)) errs.push(`Stage "${s.label}" maps to unknown common stage "${s.commonStage}"`);
  }
  if (active[0].commonStage !== canon[0]) errs.push(`First stage must map to "${COMMON_STAGE_LABELS[canon[0]]}"`);
  if (active[active.length - 1].commonStage !== "delivered") errs.push(`Last stage must map to "Delivered"`);
  let lastIdx = -1;
  for (const s of active) {
    const idx = canon.indexOf(s.commonStage);
    if (idx < lastIdx) {
      errs.push(`Stage "${s.label}" is out of order relative to the common reporting model`);
      break;
    }
    lastIdx = idx;
  }
  for (const c of canon) if (!active.some((s) => s.commonStage === c)) errs.push(`Missing a stage for "${COMMON_STAGE_LABELS[c]}"`);
  return errs;
}

export function sortStages<T extends { sequence: number }>(stages: T[]): T[] {
  return [...stages].sort((a, b) => a.sequence - b.sequence);
}

/**
 * Pick the effective stages for a dealership: its own configuration if any rows exist for the
 * job type, otherwise the group default.
 */
export function resolveStages<T extends StageDef & { dealershipId: string | null }>(rows: T[], dealershipId: string): T[] {
  const own = rows.filter((r) => r.dealershipId === dealershipId && r.active !== false);
  const chosen = own.length ? own : rows.filter((r) => r.dealershipId === null && r.active !== false);
  return sortStages(chosen);
}

export interface JobState {
  jobType: JobType;
  status: "open" | "closed" | "cancelled";
  stageCode: string;
  assignedToId: string | null;
  approvalStatus: "not_required" | "pending" | "approved" | "declined";
  invoiceRef: string | null;
  paymentStatus: "unbilled" | "unpaid" | "partial" | "paid";
  blocker: Blocker;
}

export type TransitionDirection = "forward" | "rework";

export interface TransitionResult {
  ok: boolean;
  reason?: string;
  direction?: TransitionDirection;
  to?: StageDef;
  from?: StageDef;
}

/**
 * Rules:
 *  - Closed/cancelled jobs cannot move.
 *  - Forward moves go to the NEXT active stage only (no skipping), so every stage is timestamped.
 *  - Rework moves go back to any earlier stage (not from Delivered) and require a reason.
 *  - Guards: leaving an approval stage needs approval = approved; entering a work stage needs an
 *    assigned technician; entering Billing+ is blocked while waiting on parts; entering Delivered
 *    needs an invoice reference and a billed payment status.
 */
export function checkTransition(stages: StageDef[], job: JobState, toCode: string, reason?: string): TransitionResult {
  const ordered = sortStages(stages.filter((s) => s.active !== false));
  const fromIdx = ordered.findIndex((s) => s.code === job.stageCode);
  const toIdx = ordered.findIndex((s) => s.code === toCode);
  if (job.status !== "open") return { ok: false, reason: `Job is ${job.status}` };
  if (fromIdx < 0) return { ok: false, reason: `Current stage "${job.stageCode}" is not in this location's workflow` };
  if (toIdx < 0) return { ok: false, reason: `Stage "${toCode}" is not in this location's workflow` };
  const from = ordered[fromIdx];
  const to = ordered[toIdx];
  if (toIdx === fromIdx) return { ok: false, reason: "Job is already in this stage" };

  if (toIdx < fromIdx) {
    if (!reason?.trim()) return { ok: false, reason: "A reason is required to send a job back (rework)" };
    return { ok: true, direction: "rework", from, to };
  }
  if (toIdx !== fromIdx + 1) return { ok: false, reason: `Next stage is "${ordered[fromIdx + 1].label}" — stages cannot be skipped` };

  if (APPROVAL_STAGES.includes(from.commonStage) && to.commonStage !== from.commonStage && job.approvalStatus !== "approved") {
    return { ok: false, reason: job.approvalStatus === "declined" ? "Estimate was declined — revise the estimate or cancel the job" : "Record the customer/insurer approval before continuing" };
  }
  if (WORK_STAGES.includes(to.commonStage) && !job.assignedToId) {
    return { ok: false, reason: "Assign a technician before starting work" };
  }
  if (["billing", "ready", "delivered"].includes(to.commonStage) && job.blocker === "parts") {
    return { ok: false, reason: "Job is waiting on parts — clear the parts blocker first" };
  }
  if (to.commonStage === "delivered") {
    if (!job.invoiceRef?.trim()) return { ok: false, reason: "Add the invoice reference before delivery" };
    if (job.paymentStatus === "unbilled") return { ok: false, reason: "Record the payment status before delivery" };
  }
  return { ok: true, direction: "forward", from, to };
}

export function nextStage(stages: StageDef[], currentCode: string): StageDef | null {
  const ordered = sortStages(stages.filter((s) => s.active !== false));
  const i = ordered.findIndex((s) => s.code === currentCode);
  return i >= 0 && i < ordered.length - 1 ? ordered[i + 1] : null;
}

export type NotificationTrigger = "vehicle_received" | "approval_required" | "vehicle_ready";

export interface StageEffects {
  approvalStatus?: JobState["approvalStatus"];
  setCompletedAt?: boolean;
  setDeliveredAndClose?: boolean;
  clearCompletedAt?: boolean;
  notify?: NotificationTrigger;
}

/** Side effects of entering a stage (applied by the service layer). */
export function effectsOfEntering(from: StageDef, to: StageDef, direction: TransitionDirection): StageEffects {
  const fx: StageEffects = {};
  if (APPROVAL_STAGES.includes(to.commonStage) && !APPROVAL_STAGES.includes(from.commonStage)) {
    fx.approvalStatus = "pending";
    fx.notify = "approval_required";
  }
  if (to.commonStage === "ready" && direction === "forward") {
    fx.setCompletedAt = true;
    fx.notify = "vehicle_ready";
  }
  if (to.commonStage === "delivered") fx.setDeliveredAndClose = true;
  if (direction === "rework" && ["ready", "billing", "quality_check"].includes(from.commonStage)) fx.clearCompletedAt = true;
  return fx;
}

/** Common stages considered "waiting" for bottleneck reporting. */
export function waitingReason(job: { commonStage: string; blocker: Blocker; approvalStatus: JobState["approvalStatus"] }): string | null {
  if (job.blocker !== "none") return job.blocker;
  if (APPROVAL_STAGES.includes(job.commonStage as CommonStage) && job.approvalStatus === "pending") return "approval";
  return null;
}
