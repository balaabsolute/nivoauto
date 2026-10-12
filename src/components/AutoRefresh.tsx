"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refresh server data periodically (e.g. the front-desk queue), pausing while the tab is hidden or a field is focused. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = window.setInterval(() => {
      const el = document.activeElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
      if (document.visibilityState === "visible" && !typing) router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(t);
  }, [router, seconds]);
  return null;
}
