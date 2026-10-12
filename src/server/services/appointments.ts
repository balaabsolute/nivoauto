import { and, asc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { appointments, customers, dealerships, vehicles, jobs } from "@/db/schema";
import { assertCan, assertDealership, dealershipScope } from "@/domain/permissions";
import type { Actor } from "../principal";
import { audit } from "../audit";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { notify } from "../notify/dispatcher";
import { customerVehicleInput, findOrCreateCustomerVehicle, createJob } from "./jobs";
import { demoFilter } from "../data-mode";

export const createAppointmentInput = customerVehicleInput.extend({
  dealershipId: z.string().uuid(),
  jobType: z.enum(["service", "bodyshop"]).default("service"),
  scheduledAt: z.coerce.date(),
  requestedWork: z.string().trim().min(3, "Describe the requested work"),
});

export async function createAppointment(db: DB, actor: Actor, raw: z.input<typeof createAppointmentInput>, opts: { isDemo?: boolean; allowPast?: boolean } = {}) {
  assertCan(actor, "appointments.manage");
  const parsed = createAppointmentInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message));
  const input = parsed.data;
  assertDealership(actor, input.dealershipId);
  if (!opts.allowPast && input.scheduledAt.getTime() < Date.now() - 15 * 60_000) throw new ValidationError(["Appointment time is in the past"]);
  const [dealer] = await db.select().from(dealerships).where(eq(dealerships.id, input.dealershipId));
  if (!dealer) throw new ValidationError(["Dealership not found"]);
  opts = { ...opts, isDemo: opts.isDemo ?? dealer.isDemo };

  const appt = await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as DB;
    const { customer, vehicle } = await findOrCreateCustomerVehicle(tx, actor, dealer, input, opts.isDemo);
    // Prevent accidental double-booking of the same vehicle on the same day.
    const [dup] = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(
        eq(appointments.vehicleId, vehicle.id),
        eq(appointments.status, "scheduled"),
        sql`date(${appointments.scheduledAt} at time zone 'Asia/Kolkata') = date(${input.scheduledAt.toISOString()}::timestamptz at time zone 'Asia/Kolkata')`,
      ))
      .limit(1);
    if (dup) throw new ConflictError(`Vehicle ${vehicle.registrationNo} already has an appointment that day`);
    const [a] = await tx
      .insert(appointments)
      .values({ dealershipId: dealer.id, customerId: customer.id, vehicleId: vehicle.id, jobType: input.jobType, scheduledAt: input.scheduledAt, requestedWork: input.requestedWork, createdById: actor.id, isDemo: opts.isDemo ?? false })
      .returning();
    await audit(tx, { userId: actor.id, action: "appointment.create", entityType: "appointment", entityId: a.id, dealershipId: dealer.id, after: { scheduledAt: a.scheduledAt, vehicle: vehicle.registrationNo } });
    return { a, vehicle };
  });

  try {
    await notify(db, {
      event: "appointment_confirmed", dealershipId: dealer.id, customerId: appt.a.customerId, appointmentId: appt.a.id,
      context: { scheduledAt: appt.a.scheduledAt, registrationNo: appt.vehicle.registrationNo, requestedWork: appt.a.requestedWork }, isDemo: opts.isDemo,
    });
  } catch (e) {
    console.error("[notify] appointment", e);
  }
  return appt.a;
}

/** Mark arrived → opens a job card from the appointment (capture once). */
export async function checkInAppointment(db: DB, actor: Actor, appointmentId: string, extra: { odometerKm?: number | null; promisedAt?: Date | null } = {}) {
  assertCan(actor, "appointments.manage");
  const [row] = await db
    .select({ a: appointments, c: customers, v: vehicles })
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(vehicles, eq(vehicles.id, appointments.vehicleId))
    .where(eq(appointments.id, appointmentId));
  if (!row) throw new NotFoundError("Appointment not found");
  assertDealership(actor, row.a.dealershipId);
  if (row.a.status !== "scheduled") throw new ValidationError([`Appointment is ${row.a.status.replace("_", " ")}`]);
  const job = await createJob(db, actor, {
    dealershipId: row.a.dealershipId, jobType: row.a.jobType, source: "appointment", appointmentId: row.a.id,
    customerName: row.c.name, phone: row.c.phone, email: row.c.email, registrationNo: row.v.registrationNo,
    consentWhatsapp: row.c.consentWhatsapp, consentSms: row.c.consentSms, consentEmail: row.c.consentEmail,
    complaint: row.a.requestedWork ?? "As per appointment", odometerKm: extra.odometerKm ?? null, promisedAt: extra.promisedAt ?? null,
  }, { isDemo: row.a.isDemo });
  await db.update(appointments).set({ status: "attended", jobId: job.id }).where(eq(appointments.id, appointmentId));
  await audit(db, { userId: actor.id, action: "appointment.check_in", entityType: "appointment", entityId: appointmentId, dealershipId: row.a.dealershipId, after: { jobId: job.id } });
  return job;
}

export async function setAppointmentStatus(db: DB, actor: Actor, appointmentId: string, status: "no_show" | "cancelled") {
  assertCan(actor, "appointments.manage");
  const [a] = await db.select().from(appointments).where(eq(appointments.id, appointmentId));
  if (!a) throw new NotFoundError();
  assertDealership(actor, a.dealershipId);
  if (a.status !== "scheduled") throw new ValidationError([`Appointment is already ${a.status}`]);
  await db.update(appointments).set({ status }).where(eq(appointments.id, appointmentId));
  await audit(db, { userId: actor.id, action: `appointment.${status}`, entityType: "appointment", entityId: appointmentId, dealershipId: a.dealershipId, before: { status: a.status }, after: { status } });
}

export async function listAppointments(db: DB, actor: Actor, range: { from: Date; to: Date }, dealershipId?: string) {
  assertCan(actor, "appointments.manage");
  const conds: (SQL | undefined)[] = [gte(appointments.scheduledAt, range.from), lt(appointments.scheduledAt, range.to), demoFilter(appointments.isDemo)];
  const scope = dealershipScope(actor);
  if (scope !== "all") conds.push(scope.length ? inArray(appointments.dealershipId, scope) : sql`false`);
  if (dealershipId) conds.push(eq(appointments.dealershipId, dealershipId));
  return db
    .select({ a: appointments, customerName: customers.name, reg: vehicles.registrationNo, model: vehicles.model, dealershipName: dealerships.name, jobNo: jobs.jobNo })
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(vehicles, eq(vehicles.id, appointments.vehicleId))
    .innerJoin(dealerships, eq(dealerships.id, appointments.dealershipId))
    .leftJoin(jobs, eq(jobs.id, appointments.jobId))
    .where(and(...conds))
    .orderBy(asc(appointments.scheduledAt));
}
