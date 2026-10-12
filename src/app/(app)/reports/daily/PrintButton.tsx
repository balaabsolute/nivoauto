"use client";
import { Icon } from "@/components/Icon";
export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="btn-secondary btn-sm"><Icon name="report" /> Print / PDF</button>;
}
