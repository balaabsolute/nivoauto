"use client";
import { useCallback, useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import { submitLounge } from "@/app/kiosk/actions";
import { KioskFrame, PrimaryButton, Choice, Field, Toggle, ErrorNote, ThankYou, useIdleReset, kioskText } from "./ui";
import { bodyLabel } from "@/domain/crm";

interface Model { id: string; name: string; brand: string; bodyType: string | null }

const TIMEFRAMES: [string, string][] = [["within_1m", "Within a month"], ["1_3m", "1–3 months"], ["3_6m", "3–6 months"], ["6_12m", "6–12 months"], ["12m_plus", "More than a year"]];
const BUDGETS: [string, string][] = [["under_10l", "Under ₹10 L"], ["10_15l", "₹10–15 L"], ["15_25l", "₹15–25 L"], ["25_50l", "₹25–50 L"], ["50l_1cr", "₹50 L – ₹1 Cr"], ["above_1cr", "Above ₹1 Cr"]];
const BODIES: [string, string][] = [["hatchback", "Hatchback"], ["sedan", "Sedan"], ["suv", "SUV"], ["mpv", "MPV / 7-seater"], ["luxury", "Luxury"], ["ev", "Electric"]];
const FUELS: [string, string][] = [["petrol", "Petrol"], ["diesel", "Diesel"], ["hybrid", "Hybrid"], ["ev", "Electric"], ["cng", "CNG"]];

interface State {
  started: boolean;
  step: number;
  currentMake: string | null;
  currentModel: string;
  purchaseYear: number | null;
  rating: number | null;
  interest: "yes" | "maybe" | "no" | null;
  timeframe: string | null;
  budgetBand: string | null;
  body: string | null;
  fuel: string | null;
  modelIds: string[];
  other: string;
  name: string;
  phone: string;
  marketing: boolean;
}
const EMPTY: State = { started: false, step: 1, currentMake: null, currentModel: "", purchaseYear: null, rating: null, interest: null, timeframe: null, budgetBand: null, body: null, fuel: null, modelIds: [], other: "", name: "", phone: "", marketing: true };

export function LoungeKiosk({ dealershipName, models, brands }: { dealershipName: string; models: Model[]; brands: string[] }) {
  const [s, setS] = useState<State>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const reset = useCallback(() => {
    setS(EMPTY);
    setError(null);
    setDone(false);
  }, []);
  useIdleReset(s.started && !done, reset, 120);
  const set = (p: Partial<State>) => {
    setError(null);
    setS((x) => ({ ...x, ...p }));
  };
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => Array.from({ length: 16 }, (_, i) => thisYear - i), [thisYear]);
  const thinking = s.interest === "yes" || s.interest === "maybe";
  const steps = thinking ? 4 : 3;

  if (done) return <ThankYou headline={`Thank you${s.name ? `, ${s.name.split(" ")[0]}` : ""}`} message="We appreciate your time. Enjoy your coffee — we’ll let you know as soon as your car is ready." onDone={reset} seconds={15} />;

  if (!s.started) {
    return (
      <button type="button" onClick={() => set({ started: true })} className="min-h-[100dvh] w-full flex flex-col items-start justify-center px-[6vw] text-left">
        <p className={clsx(kioskText.body, "text-white/70")}>{dealershipName} · Customer lounge</p>
        <h1 className={clsx(kioskText.h1, "mt-3 max-w-[18ch]")}>While you wait — tell us about your car and what you’d drive next.</h1>
        <p className={clsx(kioskText.body, "mt-4 text-white/80 max-w-[48ch]")}>Two minutes. It helps us look after your car and let you know about cars that suit you.</p>
        <span className="mt-[6vh] inline-flex items-center rounded-2xl bg-[#f4b400] px-[2em] py-[0.8em] text-[clamp(20px,2vw,38px)] font-semibold text-[#0b2f38]">Tap to start</span>
      </button>
    );
  }

  const back = () => (s.step <= 1 ? reset() : set({ step: s.step - 1 }));

  if (s.step === 1) {
    return (
      <KioskFrame title="Your current car" step={1} steps={steps} onBack={back} onCancel={reset} footer={<PrimaryButton disabled={!s.purchaseYear} onClick={() => set({ step: 2 })}>Continue</PrimaryButton>}>
        <div className="grid gap-[3vh] max-w-[1200px]">
          <section>
            <h2 className={kioskText.h2}>Brand</h2>
            <div className="mt-3 flex flex-wrap gap-3">{[...brands, "Other"].map((b) => <Choice key={b} selected={s.currentMake === b} onClick={() => set({ currentMake: b })}>{b}</Choice>)}</div>
          </section>
          <Field label="Model (optional)" value={s.currentModel} onChange={(e) => set({ currentModel: e.target.value })} />
          <section>
            <h2 className={kioskText.h2}>Year you bought it</h2>
            <div className="mt-3 flex flex-wrap gap-3">
              {years.map((y) => <Choice key={y} selected={s.purchaseYear === y} onClick={() => set({ purchaseYear: y })}>{y}</Choice>)}
              <Choice selected={s.purchaseYear === thisYear - 16} onClick={() => set({ purchaseYear: thisYear - 16 })}>Earlier</Choice>
            </div>
          </section>
          <section>
            <h2 className={kioskText.h2}>How was today’s service experience? <span className="text-white/60 font-normal">(optional)</span></h2>
            <div className="mt-3 flex gap-3" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={s.rating === n} aria-label={`${n} of 5`} onClick={() => set({ rating: n })}
                  className={clsx("h-[clamp(56px,7vh,96px)] w-[clamp(56px,7vh,96px)] rounded-2xl text-[clamp(28px,3vw,52px)]", s.rating != null && n <= s.rating ? "bg-[#f4b400] text-[#0b2f38]" : "bg-white/10")}>
                  ★
                </button>
              ))}
            </div>
          </section>
        </div>
      </KioskFrame>
    );
  }

  if (s.step === 2) {
    return (
      <KioskFrame title="Are you thinking about your next car?" step={2} steps={steps} onBack={back} onCancel={reset} footer={<PrimaryButton disabled={!s.interest} onClick={() => set({ step: 3 })}>Continue</PrimaryButton>}>
        <div className="grid gap-4 max-w-[900px]">
          <Choice wide selected={s.interest === "yes"} onClick={() => set({ interest: "yes" })}>Yes, I’m looking</Choice>
          <Choice wide selected={s.interest === "maybe"} onClick={() => set({ interest: "maybe" })}>Maybe, in the future</Choice>
          <Choice wide selected={s.interest === "no"} onClick={() => set({ interest: "no", timeframe: null, budgetBand: null, body: null, fuel: null, modelIds: [] })}>Not at the moment</Choice>
        </div>
      </KioskFrame>
    );
  }

  if (thinking && s.step === 3) {
    const byBrand = brands.map((b) => ({ brand: b, ms: models.filter((m) => m.brand === b && (!s.body || m.bodyType === s.body || s.body === "luxury")) })).filter((g) => g.ms.length);
    return (
      <KioskFrame title="What would suit you next?" subtitle="Choose whatever applies — all optional." step={3} steps={steps} onBack={back} onCancel={reset} footer={<PrimaryButton onClick={() => set({ step: 4 })}>Continue</PrimaryButton>}>
        <div className="grid gap-[3.5vh] max-w-[1400px]">
          <section><h2 className={kioskText.h2}>When might you change?</h2><div className="mt-3 flex flex-wrap gap-3">{TIMEFRAMES.map(([k, l]) => <Choice key={k} selected={s.timeframe === k} onClick={() => set({ timeframe: s.timeframe === k ? null : k })}>{l}</Choice>)}</div></section>
          <section><h2 className={kioskText.h2}>Budget</h2><div className="mt-3 flex flex-wrap gap-3">{BUDGETS.map(([k, l]) => <Choice key={k} selected={s.budgetBand === k} onClick={() => set({ budgetBand: s.budgetBand === k ? null : k })}>{l}</Choice>)}</div></section>
          <section><h2 className={kioskText.h2}>Type of car</h2><div className="mt-3 flex flex-wrap gap-3">{BODIES.map(([k, l]) => <Choice key={k} selected={s.body === k} onClick={() => set({ body: s.body === k ? null : k })}>{l}</Choice>)}</div></section>
          <section><h2 className={kioskText.h2}>Fuel</h2><div className="mt-3 flex flex-wrap gap-3">{FUELS.map(([k, l]) => <Choice key={k} selected={s.fuel === k} onClick={() => set({ fuel: s.fuel === k ? null : k })}>{l}</Choice>)}</div></section>
          <section>
            <h2 className={kioskText.h2}>Models you like <span className="text-white/60 font-normal">(up to 6)</span></h2>
            <div className="mt-3 grid gap-5">
              {byBrand.map((g) => (
                <div key={g.brand}>
                  <p className={clsx(kioskText.small, "text-white/60 mb-2")}>{g.brand}</p>
                  <div className="flex flex-wrap gap-3">
                    {g.ms.map((m) => {
                      const on = s.modelIds.includes(m.id);
                      return <Choice key={m.id} selected={on} onClick={() => set({ modelIds: on ? s.modelIds.filter((x) => x !== m.id) : [...s.modelIds, m.id].slice(0, 6) })}>{m.name}{m.bodyType ? <span className="opacity-60 font-normal"> · {bodyLabel(m.bodyType)}</span> : null}</Choice>;
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <Field label="Anything else? (features, colour, seating…)" value={s.other} onChange={(e) => set({ other: e.target.value })} />
        </div>
      </KioskFrame>
    );
  }

  // Contact
  const submit = () => {
    const digits = s.phone.replace(/\D/g, "");
    if (s.name.trim().length < 2) return setError("Please enter your name");
    if (!/^(91)?[6-9]\d{9}$/.test(digits)) return setError("Please enter a valid 10-digit mobile number");
    start(async () => {
      const res = await submitLounge({
        name: s.name.trim(),
        phone: digits.slice(-10),
        // Only marketing is asked here; service-update consents are left as they are unless granted.
        consentWhatsapp: s.marketing ? true : undefined,
        consentSms: s.marketing ? true : undefined,
        consentMarketing: s.marketing,
        currentMake: s.currentMake,
        currentModel: s.currentModel.trim() || null,
        purchaseYear: s.purchaseYear,
        serviceRating: s.rating,
        interest: s.interest!,
        timeframe: (s.interest === "no" ? "not_planning" : s.timeframe) as never,
        budgetBand: s.budgetBand as never,
        preferredBodyType: s.body,
        preferredFuel: s.fuel,
        preferredModelIds: s.modelIds,
        otherPreferences: s.other.trim() || null,
      });
      if (res.ok) setDone(true);
      else setError(res.error);
    });
  };
  return (
    <KioskFrame title="Last step — your details" subtitle="So we can match this with your service record." step={steps} steps={steps} onBack={back} onCancel={reset}
      footer={<><ErrorNote>{error}</ErrorNote><div className="mt-3"><PrimaryButton onClick={submit} disabled={pending}>{pending ? "Sending…" : "Submit"}</PrimaryButton></div></>}>
      <div className="grid gap-[2.5vh] max-w-[900px]">
        <Field label="Your name" autoComplete="off" value={s.name} onChange={(e) => set({ name: e.target.value })} />
        <Field label="Mobile number" inputMode="numeric" autoComplete="off" maxLength={14} value={s.phone} onChange={(e) => set({ phone: e.target.value.replace(/[^\d+\s]/g, "") })} />
        <div className="rounded-2xl bg-white/5 px-5 py-3">
          <Toggle checked={s.marketing} onChange={(v) => set({ marketing: v })} label="Send me news and offers about cars that match my preferences (stop anytime)" />
        </div>
      </div>
    </KioskFrame>
  );
}
