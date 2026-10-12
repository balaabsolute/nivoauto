"use client";
import { useCallback, useState, useTransition } from "react";
import clsx from "clsx";
import { bodyLabel } from "@/domain/crm";
import { submitKioskVisit } from "@/app/kiosk/actions";
import { KioskFrame, PrimaryButton, Tile, Choice, Field, Toggle, ErrorNote, ThankYou, useIdleReset, kioskText, KIcon } from "./ui";

type Visit = "new_car" | "service" | "spare_parts" | "body_shop";
interface Model { id: string; name: string; bodyType: string | null; priceBand: string | null; fuelTypes: string | null }

const TIMEFRAMES: [string, string][] = [["immediate", "Right away"], ["within_1m", "Within a month"], ["1_3m", "1–3 months"], ["3_6m", "3–6 months"], ["6_12m", "Later this year"]];
const BUDGETS: [string, string][] = [["under_10l", "Under ₹10 L"], ["10_15l", "₹10–15 L"], ["15_25l", "₹15–25 L"], ["25_50l", "₹25–50 L"], ["50l_1cr", "₹50 L – ₹1 Cr"], ["above_1cr", "Above ₹1 Cr"]];
const SERVICE_NEEDS = ["Periodic service", "Repair / a problem", "Inspection / check-up", "Tyres / wheel alignment", "Accessories"];

interface State {
  visit: Visit | null;
  step: number;
  modelIds: string[];
  testDrive: boolean | null;
  timeframe: string | null;
  budgetBand: string | null;
  exchange: string;
  registrationNo: string;
  vehicleModel: string;
  need: string | null;
  request: string;
  insuranceClaim: boolean | null;
  name: string;
  phone: string;
  email: string;
  updates: boolean;
  marketing: boolean;
}
const EMPTY: State = {
  visit: null, step: 0, modelIds: [], testDrive: null, timeframe: null, budgetBand: null, exchange: "", registrationNo: "", vehicleModel: "",
  need: null, request: "", insuranceClaim: null, name: "", phone: "", email: "", updates: true, marketing: false,
};

export function ShowroomKiosk({ dealershipName, facilities, models }: { dealershipName: string; facilities: { sales: boolean; service: boolean; bodyShop: boolean }; models: Model[] }) {
  const [s, setS] = useState<State>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ token: string; visit: Visit } | null>(null);
  const [pending, start] = useTransition();
  const reset = useCallback(() => {
    setS(EMPTY);
    setError(null);
    setDone(null);
  }, []);
  useIdleReset(s.visit !== null && !done, reset, 90);
  const set = (p: Partial<State>) => {
    setError(null);
    setS((x) => ({ ...x, ...p }));
  };

  if (done) {
    const msg = {
      new_car: "Please have a seat. A sales consultant will be with you shortly.",
      service: "Please have a seat. A service advisor will call your token shortly.",
      spare_parts: "Please show this token at the parts counter.",
      body_shop: "Please have a seat. Our body shop advisor will be with you shortly.",
    }[done.visit];
    return <ThankYou headline={`Thank you, ${s.name.split(" ")[0] || "welcome"}`} token={done.token} message={msg} onDone={reset} />;
  }

  /* ───── Welcome ───── */
  if (!s.visit) {
    return (
      <div className="min-h-[100dvh] flex flex-col px-[4vw] py-[5vh]">
        <p className={clsx(kioskText.body, "text-white/70")}>{dealershipName}</p>
        <h1 className={clsx(kioskText.h1, "mt-2")}>Welcome. How can we help you today?</h1>
        <div className="mt-[5vh] grid flex-1 content-start gap-[2vw] grid-cols-1 sm:grid-cols-2">
          {facilities.sales && <Tile title="New car enquiry" hint="Explore models, prices and a test drive" icon={KIcon.car} onClick={() => set({ visit: "new_car", step: 1 })} />}
          {facilities.service && <Tile title="Car service" hint="Service, repairs and check-ups" icon={KIcon.service} onClick={() => set({ visit: "service", step: 1 })} />}
          <Tile title="Spare parts" hint="Genuine parts and accessories" icon={KIcon.parts} onClick={() => set({ visit: "spare_parts", step: 1 })} />
          {facilities.bodyShop && <Tile title="Body shop repairs" hint="Dents, scratches, paint and insurance claims" icon={KIcon.body} onClick={() => set({ visit: "body_shop", step: 1 })} />}
        </div>
        <p className={clsx(kioskText.small, "mt-[4vh] text-white/55 max-w-[70ch]")}>
          We use your details only to help with today’s visit and, if you choose, to keep you updated. Your information is not shown on this screen once submitted.
        </p>
      </div>
    );
  }

  const isNew = s.visit === "new_car";
  const totalSteps = isNew ? 3 : 2;
  const back = () => (s.step <= 1 ? reset() : set({ step: s.step - 1 }));
  const submit = () => {
    const digits = s.phone.replace(/\D/g, "");
    if (s.name.trim().length < 2) return setError("Please enter your name");
    if (!/^(91)?[6-9]\d{9}$/.test(digits)) return setError("Please enter a valid 10-digit mobile number");
    start(async () => {
      const res = await submitKioskVisit({
        visitType: s.visit!,
        name: s.name.trim(),
        phone: digits.slice(-10),
        email: s.email.trim() || null,
        consentWhatsapp: s.updates,
        consentSms: s.updates,
        consentEmail: s.updates && !!s.email.trim(),
        consentMarketing: s.marketing,
        modelIds: s.modelIds,
        testDrive: !!s.testDrive,
        timeframe: (s.timeframe as never) ?? null,
        budgetBand: (s.budgetBand as never) ?? null,
        exchangeVehicle: s.exchange.trim() || null,
        registrationNo: s.registrationNo.trim() || null,
        vehicleModel: s.vehicleModel.trim() || null,
        request: [s.need, s.request.trim()].filter(Boolean).join(": ") || null,
        insuranceClaim: s.insuranceClaim,
      });
      if (res.ok && res.data) setDone({ token: res.data.token, visit: s.visit! });
      else setError(res.ok ? "Something went wrong" : res.error);
    });
  };

  /* ───── Contact step (last step for every visit) ───── */
  if (s.step === totalSteps) {
    return (
      <KioskFrame title="Your details" subtitle="So we can call your token and help you faster." step={s.step} steps={totalSteps} onBack={back} onCancel={reset}
        footer={<><ErrorNote>{error}</ErrorNote><div className="mt-3"><PrimaryButton onClick={submit} disabled={pending}>{pending ? "Sending…" : "Get my token"}</PrimaryButton></div></>}>
        <div className="grid gap-[2.5vh] max-w-[900px]">
          <Field label="Your name" autoComplete="off" value={s.name} onChange={(e) => set({ name: e.target.value })} />
          <Field label="Mobile number" inputMode="numeric" autoComplete="off" maxLength={14} value={s.phone} onChange={(e) => set({ phone: e.target.value.replace(/[^\d+\s]/g, "") })} placeholder="10-digit mobile" />
          <Field label="Email (optional)" type="email" inputMode="email" autoComplete="off" value={s.email} onChange={(e) => set({ email: e.target.value })} />
          <div className="rounded-2xl bg-white/5 px-5 py-3">
            <Toggle checked={s.updates} onChange={(v) => set({ updates: v })} label="Send me updates about today’s visit on WhatsApp / SMS" />
            {isNew && <Toggle checked={s.marketing} onChange={(v) => set({ marketing: v })} label="Also send me offers and news about the cars I chose (stop anytime)" />}
          </div>
        </div>
      </KioskFrame>
    );
  }

  /* ───── New car ───── */
  if (isNew && s.step === 1) {
    return (
      <KioskFrame title="Which cars are you interested in?" subtitle="Choose one or more." step={1} steps={totalSteps} onBack={back} onCancel={reset}
        footer={<PrimaryButton disabled={!s.modelIds.length} onClick={() => set({ step: 2 })}>Continue</PrimaryButton>}>
        <div className="grid gap-[1.6vw] grid-cols-2 lg:grid-cols-3">
          {models.map((m) => {
            const on = s.modelIds.includes(m.id);
            return (
              <button key={m.id} type="button" aria-pressed={on} onClick={() => set({ modelIds: on ? s.modelIds.filter((x) => x !== m.id) : [...s.modelIds, m.id].slice(0, 5) })}
                className={clsx("rounded-3xl p-[clamp(16px,2vw,36px)] text-left min-h-[clamp(110px,16vh,220px)] border-4 transition-colors", on ? "bg-white text-[#0b2f38] border-[#f4b400]" : "bg-white/10 border-transparent active:bg-white/20")}>
                <span className="block text-[clamp(22px,2.4vw,44px)] font-semibold">{on && "✓ "}{m.name}</span>
                <span className={clsx("block mt-1 text-[clamp(14px,1.2vw,22px)]", on ? "text-[#4a5a68]" : "text-white/70")}>
                  {[bodyLabel(m.bodyType), m.priceBand].filter(Boolean).join(" · ")}
                </span>
              </button>
            );
          })}
          {!models.length && <p className={kioskText.body}>Our team will show you the range. Tap Continue.</p>}
        </div>
      </KioskFrame>
    );
  }
  if (isNew && s.step === 2) {
    return (
      <KioskFrame title="A few quick questions" step={2} steps={totalSteps} onBack={back} onCancel={reset}
        footer={<PrimaryButton disabled={s.testDrive === null} onClick={() => set({ step: 3 })}>Continue</PrimaryButton>}>
        <div className="grid gap-[3.5vh] max-w-[1200px]">
          <section>
            <h2 className={kioskText.h2}>Would you like a test drive today?</h2>
            <div className="mt-3 flex flex-wrap gap-3">
              <Choice selected={s.testDrive === true} onClick={() => set({ testDrive: true })}>Yes, please</Choice>
              <Choice selected={s.testDrive === false} onClick={() => set({ testDrive: false })}>Not today</Choice>
            </div>
          </section>
          <section>
            <h2 className={kioskText.h2}>When are you planning to buy?</h2>
            <div className="mt-3 flex flex-wrap gap-3">{TIMEFRAMES.map(([k, l]) => <Choice key={k} selected={s.timeframe === k} onClick={() => set({ timeframe: s.timeframe === k ? null : k })}>{l}</Choice>)}</div>
          </section>
          <section>
            <h2 className={kioskText.h2}>Budget <span className="text-white/60 font-normal">(optional)</span></h2>
            <div className="mt-3 flex flex-wrap gap-3">{BUDGETS.map(([k, l]) => <Choice key={k} selected={s.budgetBand === k} onClick={() => set({ budgetBand: s.budgetBand === k ? null : k })}>{l}</Choice>)}</div>
          </section>
          <Field label="Exchanging your current car? (optional)" placeholder="e.g. 2017 hatchback" value={s.exchange} onChange={(e) => set({ exchange: e.target.value })} />
        </div>
      </KioskFrame>
    );
  }

  /* ───── Service / parts / body shop ───── */
  const titles = { service: "About your car", spare_parts: "Which part do you need?", body_shop: "About the damage" } as const;
  const v = s.visit as Exclude<Visit, "new_car">;
  const canContinue = v === "spare_parts" ? s.request.trim().length >= 2 : s.registrationNo.trim().length >= 4 && (v === "body_shop" ? s.request.trim().length >= 2 : !!s.need);
  return (
    <KioskFrame title={titles[v]} step={1} steps={totalSteps} onBack={back} onCancel={reset}
      footer={<PrimaryButton disabled={!canContinue} onClick={() => set({ step: 2 })}>Continue</PrimaryButton>}>
      <div className="grid gap-[3vh] max-w-[1100px]">
        {v !== "spare_parts" && <Field label="Registration number" autoCapitalize="characters" placeholder="e.g. TN 01 AB 1234" value={s.registrationNo} onChange={(e) => set({ registrationNo: e.target.value.toUpperCase() })} />}
        <Field label={v === "spare_parts" ? "Your car model (optional)" : "Car model (optional)"} value={s.vehicleModel} onChange={(e) => set({ vehicleModel: e.target.value })} />
        {v === "service" && (
          <section>
            <h2 className={kioskText.h2}>What do you need today?</h2>
            <div className="mt-3 flex flex-wrap gap-3">{SERVICE_NEEDS.map((n) => <Choice key={n} selected={s.need === n} onClick={() => set({ need: n })}>{n}</Choice>)}</div>
          </section>
        )}
        <Field
          label={v === "spare_parts" ? "Part or accessory" : v === "body_shop" ? "Describe the damage" : "Anything else we should know? (optional)"}
          placeholder={v === "spare_parts" ? "e.g. wiper blades, floor mats" : v === "body_shop" ? "e.g. dent on the rear door" : ""}
          value={s.request}
          onChange={(e) => set({ request: e.target.value })}
        />
        {v === "body_shop" && (
          <section>
            <h2 className={kioskText.h2}>Is this an insurance claim?</h2>
            <div className="mt-3 flex gap-3">
              <Choice selected={s.insuranceClaim === true} onClick={() => set({ insuranceClaim: true })}>Yes</Choice>
              <Choice selected={s.insuranceClaim === false} onClick={() => set({ insuranceClaim: false })}>No</Choice>
              <Choice selected={s.insuranceClaim === null} onClick={() => set({ insuranceClaim: null })}>Not sure</Choice>
            </div>
          </section>
        )}
      </div>
    </KioskFrame>
  );
}
