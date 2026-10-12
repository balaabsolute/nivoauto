"use client";
import { useActionState, useRef } from "react";
import { loginAction } from "./actions";

export function LoginForm({ next, demoAccounts, demoPassword }: { next?: string; demoAccounts?: { email: string; label: string }[]; demoPassword?: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-6">
      <form action={action} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next ?? ""} />
        <div>
          <label className="label" htmlFor="email">Work email</label>
          <input ref={emailRef} id="email" name="email" type="email" autoComplete="username" required className="field" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input ref={pwRef} id="password" name="password" type="password" autoComplete="current-password" required className="field" />
        </div>
        {state?.error && <p role="alert" className="text-sm text-crit">{state.error}</p>}
        <button className="btn-primary w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      </form>
      {demoAccounts && (
        <div className="rounded-lg border border-line bg-page p-4">
          <div className="hazard-tape h-1.5 rounded-full mb-3" aria-hidden />
          <p className="text-sm font-medium">Demo accounts</p>
          <p className="text-xs text-ink-2 mt-0.5">Password <code className="font-semibold">{demoPassword}</code>. Choose a role to fill the form.</p>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {demoAccounts.map((d) => (
              <button
                key={d.email}
                type="button"
                className="text-left rounded border border-line bg-panel px-2.5 py-1.5 text-[13px] hover:border-petrol"
                onClick={() => {
                  if (emailRef.current) emailRef.current.value = d.email;
                  if (pwRef.current) pwRef.current.value = demoPassword ?? "";
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
