"use server";
import { getDb } from "@/db/client";
import { actorForAction } from "@/server/auth";
import { run, type ActionResult } from "@/server/action-result";
import { saveUser, saveLegalEntity, saveBrand, saveDealership, saveCapacity, saveStageConfig, resetStageConfig } from "@/server/services/admin";
import type { Role, JobType, ResourceType } from "@/db/schema";

type R = ActionResult<unknown> | undefined;
const v = (f: FormData, k: string) => (String(f.get(k) ?? "").trim() || null);

export async function saveUserAction(_p: R, f: FormData) {
  const res = await run(async () => {
    await saveUser(await getDb(), await actorForAction("admin.users"), {
      id: v(f, "id") ?? undefined,
      email: v(f, "email") ?? "",
      name: v(f, "name") ?? "",
      role: v(f, "role") as Role,
      dealershipIds: f.getAll("dealershipIds").map(String),
      active: f.get("active") === "on",
      password: v(f, "password") ?? "",
    });
  }, "User saved. Changes to role or access sign the user out of existing sessions.");
  return res;
}

export async function saveEntityAction(_p: R, f: FormData) {
  const res = await run(async () => saveLegalEntity(await getDb(), await actorForAction("admin.master_data"), { code: v(f, "code") ?? "", name: v(f, "name") ?? "", registrationRef: v(f, "registrationRef") }), "Legal entity added");
  return res;
}
export async function saveBrandAction(_p: R, f: FormData) {
  const res = await run(async () => saveBrand(await getDb(), await actorForAction("admin.master_data"), { name: v(f, "name") ?? "" }), "Brand added");
  return res;
}
export async function saveDealershipAction(_p: R, f: FormData) {
  const res = await run(async () => saveDealership(await getDb(), await actorForAction("admin.master_data"), {
    id: v(f, "id") ?? undefined, code: v(f, "code") ?? "", name: v(f, "name") ?? "", brandId: v(f, "brandId") ?? "", legalEntityId: v(f, "legalEntityId") ?? "",
    locationName: v(f, "locationName") ?? "", city: v(f, "city"), hasSales: f.get("hasSales") === "on", hasService: f.get("hasService") === "on", hasBodyShop: f.get("hasBodyShop") === "on", active: f.get("active") === "on",
  }), "Dealership saved");
  return res;
}
export async function saveCapacityAction(_p: R, f: FormData) {
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => (f.get(d) === "on" ? "1" : "0")).join("");
  const res = await run(async () => saveCapacity(await getDb(), await actorForAction("admin.master_data"), {
    dealershipId: v(f, "dealershipId")!, resourceType: v(f, "resourceType") as ResourceType, physicalUnits: Number(v(f, "physicalUnits") ?? 0),
    productiveHoursPerUnitPerDay: Number(v(f, "hours") ?? 0), workingDays: days,
  }), "Capacity saved");
  return res;
}
export async function saveStagesAction(_p: R, f: FormData) {
  const dealershipId = v(f, "dealershipId");
  const jobType = v(f, "jobType") as JobType;
  const codes = f.getAll("code").map(String);
  const labels = f.getAll("label").map(String);
  const commons = f.getAll("commonStage").map(String);
  const seqs = f.getAll("sequence").map(Number);
  const stages = codes.map((c, i) => ({ code: c, label: labels[i], commonStage: commons[i], sequence: seqs[i] })).filter((s) => s.code.trim() && s.label.trim());
  const res = await run(async () => {
    if (f.get("intent") === "reset" && dealershipId) await resetStageConfig(await getDb(), await actorForAction("admin.workflow"), dealershipId, jobType);
    else await saveStageConfig(await getDb(), await actorForAction("admin.workflow"), dealershipId, jobType, stages);
  }, f.get("intent") === "reset" ? "Reset to the group default" : "Workflow saved");
  return res;
}
