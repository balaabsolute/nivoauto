"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";

const HOLD_MS = 1500;

/**
 * Staff access to the device menu (switch showroom/lounge, sign out): a small, faint lock icon in the
 * bottom-left corner. Press and hold for 1.5 s. A quick tap only shows a hint, so customers don't
 * open it by accident. Five quick taps also work (for screens where long-press is awkward).
 */
export function DeviceCorner() {
  const router = useRouter();
  const [progress, setProgress] = useState(0);
  const [hint, setHint] = useState(false);
  const start = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const taps = useRef<number[]>([]);

  const open = () => {
    stop();
    router.push("/kiosk/device");
  };
  const stop = () => {
    start.current = null;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    setProgress(0);
  };
  const tick = () => {
    if (start.current == null) return;
    const p = Math.min(1, (performance.now() - start.current) / HOLD_MS);
    setProgress(p);
    if (p >= 1) open();
    else raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => stop(), []);
  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(() => setHint(false), 2500);
    return () => window.clearTimeout(t);
  }, [hint]);

  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <div className="fixed left-0 bottom-0 z-50 flex items-center">
      <button
        type="button"
        aria-label="Staff: press and hold for device menu (sign out, switch screen)"
        title="Staff: press and hold"
        className="relative h-11 w-11 flex items-center justify-center text-white/25 active:text-white/70 touch-none"
        onPointerDown={(e) => {
          e.preventDefault();
          start.current = performance.now();
          raf.current = requestAnimationFrame(tick);
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          const now = Date.now();
          taps.current = [...taps.current.filter((t) => now - t < 2500), now];
          if (taps.current.length >= 5) open();
          else setHint(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") open();
        }}
      >
        <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
          <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} className={clsx(progress === 0 && "opacity-0")} />
        </svg>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      </button>
      {hint && <span className="ml-1 rounded-md bg-black/60 px-2 py-1 text-xs text-white/80">Staff: press and hold</span>}
    </div>
  );
}
