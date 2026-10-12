import clsx from "clsx";
import { COMMON_STAGE_LABELS, type CommonStage } from "@/domain/workflow";
import { Chip } from "./ui";

export const BLOCKER_LABELS: Record<string, string> = {
  none: "None",
  parts: "Waiting on parts",
  customer_approval: "Waiting on customer approval",
  insurer_approval: "Waiting on insurer approval",
  technician: "Waiting on technician",
  other: "Other",
};

export function StageChip({ common, label }: { common: string; label?: string }) {
  const tone = common === "delivered" ? "good" : common === "ready" ? "good" : ["estimate_approval", "approval"].includes(common) ? "warn" : "petrol";
  return <Chip tone={tone}>{label ?? COMMON_STAGE_LABELS[common as CommonStage] ?? common}</Chip>;
}

export function DueText({ due, status, now = new Date() }: { due: Date | null; status: string; now?: Date }) {
  if (!due) return <span className="text-ink-3 text-xs">No promise set</span>;
  const overdue = status === "open" && due < now;
  const hrs = Math.round((due.getTime() - now.getTime()) / 3_600_000);
  const rel = Math.abs(hrs) >= 48 ? `${Math.round(Math.abs(hrs) / 24)} d` : `${Math.abs(hrs)} h`;
  const txt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(due);
  return (
    <span className={clsx("text-sm", overdue ? "text-crit font-medium" : "text-ink")}>
      {txt}
      {status === "open" && <span className={clsx("block text-xs", overdue ? "text-crit" : "text-ink-3")}>{overdue ? `Overdue by ${rel}` : `in ${rel}`}</span>}
    </span>
  );
}
