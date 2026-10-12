"use client";
/**
 * Touch-first kiosk primitives. Sized with viewport units so the same screens work on a showroom
 * tablet (landscape or portrait) and a large touch TV. Minimum touch target ≈ 64px.
 */
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

export const kioskText = {
  h1: "text-[clamp(28px,3.6vw,64px)] font-semibold leading-tight tracking-tight",
  h2: "text-[clamp(22px,2.4vw,44px)] font-semibold leading-tight",
  body: "text-[clamp(16px,1.5vw,28px)]",
  small: "text-[clamp(13px,1.05vw,20px)]",
};

/** Reset the kiosk after inactivity so the next customer never sees someone else's entries. */
export function useIdleReset(active: boolean, onIdle: () => void, seconds = 90) {
  const cb = useRef(onIdle);
  cb.current = onIdle;
  useEffect(() => {
    if (!active) return;
    let t = window.setTimeout(() => cb.current(), seconds * 1000);
    const bump = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => cb.current(), seconds * 1000);
    };
    const evs = ["pointerdown", "keydown", "input", "touchstart"] as const;
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => {
      window.clearTimeout(t);
      evs.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [active, seconds]);
}

export function KioskFrame({ title, subtitle, step, steps, onBack, onCancel, children, footer }: {
  title: string; subtitle?: string; step?: number; steps?: number; onBack?: () => void; onCancel?: () => void; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div className="min-h-[100dvh] flex flex-col">
      <header className="flex items-center justify-between gap-4 px-[4vw] pt-[3vh]">
        <div className="flex items-center gap-3 min-h-[64px]">
          {onBack && (
            <button type="button" onClick={onBack} className="rounded-full border-2 border-white/30 px-[1.6em] py-[0.6em] text-[clamp(16px,1.4vw,26px)] font-medium active:bg-white/10">
              ‹ Back
            </button>
          )}
        </div>
        {steps ? (
          <ol className="flex gap-2" aria-label={`Step ${step} of ${steps}`}>
            {Array.from({ length: steps }, (_, i) => (
              <li key={i} className={clsx("h-[10px] rounded-full transition-all", i + 1 === step ? "w-[48px] bg-[#f4b400]" : i + 1 < step! ? "w-[20px] bg-white/80" : "w-[20px] bg-white/25")} />
            ))}
          </ol>
        ) : <span />}
        <div className="min-h-[64px] flex items-center">
          {onCancel && (
            <button type="button" onClick={onCancel} className="rounded-full px-[1.2em] py-[0.6em] text-[clamp(16px,1.4vw,26px)] text-white/70 active:text-white">
              Start over
            </button>
          )}
        </div>
      </header>
      <main className="flex-1 px-[4vw] pt-[3vh] pb-[3vh] flex flex-col">
        <h1 className={kioskText.h1}>{title}</h1>
        {subtitle && <p className={clsx(kioskText.body, "mt-2 text-white/75 max-w-[60ch]")}>{subtitle}</p>}
        <div className="mt-[3vh] flex-1">{children}</div>
      </main>
      {footer && <footer className="sticky bottom-0 bg-gradient-to-t from-[#0b2f38] via-[#0b2f38] to-transparent px-[4vw] pt-6 pb-[3vh]">{footer}</footer>}
    </div>
  );
}

export function PrimaryButton({ children, disabled, onClick, type = "button" }: { children: React.ReactNode; disabled?: boolean; onClick?: () => void; type?: "button" | "submit" }) {
  return (
    <button type={type} disabled={disabled} onClick={onClick} className="w-full min-h-[clamp(64px,8vh,110px)] rounded-2xl bg-[#f4b400] text-[#0b2f38] font-semibold text-[clamp(20px,2vw,38px)] disabled:opacity-40 active:scale-[0.99] transition-transform">
      {children}
    </button>
  );
}

export function Tile({ title, hint, icon, onClick, disabled }: { title: string; hint?: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group text-left rounded-3xl bg-white text-[#0b2f38] p-[clamp(18px,2.2vw,44px)] min-h-[clamp(150px,26vh,360px)] flex flex-col justify-between shadow-[0_8px_0_rgba(0,0,0,0.18)] active:translate-y-[4px] active:shadow-[0_4px_0_rgba(0,0,0,0.18)] transition disabled:opacity-40"
    >
      <span className="h-[clamp(40px,5vw,84px)] w-[clamp(40px,5vw,84px)] text-[#0e5e6f]">{icon}</span>
      <span>
        <span className="block text-[clamp(22px,2.4vw,46px)] font-semibold leading-tight">{title}</span>
        {hint && <span className="block mt-1 text-[clamp(14px,1.2vw,24px)] text-[#4a5a68]">{hint}</span>}
      </span>
    </button>
  );
}

export function Choice({ selected, onClick, children, wide }: { selected: boolean; onClick: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={clsx(
        "min-h-[clamp(56px,7vh,96px)] rounded-2xl border-2 px-[1.2em] text-[clamp(16px,1.6vw,30px)] font-medium transition-colors",
        wide && "w-full text-left",
        selected ? "bg-white text-[#0b2f38] border-white" : "border-white/30 text-white active:bg-white/10",
      )}
    >
      {selected && <span aria-hidden className="mr-2">✓</span>}
      {children}
    </button>
  );
}

export function Field({ label, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-[clamp(15px,1.3vw,24px)] text-white/80 mb-2">{label}</span>
      <input
        {...props}
        className="w-full min-h-[clamp(60px,7.5vh,104px)] rounded-2xl bg-white text-[#0b2f38] px-[0.8em] text-[clamp(20px,2vw,38px)] placeholder:text-[#8a959e] focus:outline-none focus:ring-4 focus:ring-[#f4b400]"
      />
      {hint && <span className="block mt-1 text-[clamp(13px,1vw,20px)] text-white/60">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center gap-4 text-left min-h-[64px] py-2">
      <span className={clsx("relative inline-flex h-[40px] w-[72px] shrink-0 rounded-full transition-colors", checked ? "bg-[#f4b400]" : "bg-white/25")}>
        <span className={clsx("absolute top-[4px] h-[32px] w-[32px] rounded-full bg-white transition-all", checked ? "left-[36px]" : "left-[4px]")} />
      </span>
      <span className="text-[clamp(16px,1.5vw,28px)]">{label}</span>
    </button>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="mt-4 rounded-2xl bg-[#c23934] px-5 py-4 text-[clamp(16px,1.5vw,28px)] font-medium">{children}</p>;
}

/** Thank-you screen; returns to the start automatically. */
export function ThankYou({ headline, token, message, onDone, seconds = 20 }: { headline: string; token?: string; message: string; onDone: () => void; seconds?: number }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const t = window.setInterval(() => setLeft((s) => s - 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (left <= 0) onDone();
  }, [left, onDone]);
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center text-center px-[6vw]" role="status" aria-live="polite">
      <p className={kioskText.h1}>{headline}</p>
      {token && (
        <div className="mt-[4vh] rounded-3xl bg-white text-[#0b2f38] px-[5vw] py-[3vh]">
          <p className={clsx(kioskText.small, "text-[#4a5a68]")}>Your token</p>
          <p className="text-[clamp(64px,10vw,200px)] font-bold leading-none tracking-tight num">{token}</p>
        </div>
      )}
      <p className={clsx(kioskText.body, "mt-[4vh] max-w-[40ch] text-white/85")}>{message}</p>
      <button type="button" onClick={onDone} className="mt-[5vh] rounded-full border-2 border-white/30 px-8 py-4 text-[clamp(16px,1.4vw,26px)] active:bg-white/10">
        Done ({Math.max(left, 0)})
      </button>
    </div>
  );
}

export const KIcon = {
  car: <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-full w-full"><path d="M6 30l4-12a4 4 0 0 1 4-3h20a4 4 0 0 1 4 3l4 12M6 30h36v8H6zM12 38v3M36 38v3M12 34h4M32 34h4" /></svg>,
  service: <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-full w-full"><path d="M29 9a9 9 0 0 0 10 12l3 3-16 16-4-4 12-12a9 9 0 0 1-12-10L10 26l-4-4L22 6z" /></svg>,
  parts: <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-full w-full"><circle cx="24" cy="24" r="7" /><path d="M24 5v6M24 37v6M5 24h6M37 24h6M10.6 10.6l4.2 4.2M33.2 33.2l4.2 4.2M10.6 37.4l4.2-4.2M33.2 14.8l4.2-4.2" /></svg>,
  body: <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-full w-full"><path d="M8 40l14-14M20 20l8 8M26 8l14 14-8 8-14-14zM34 6l8 8" /></svg>,
};
