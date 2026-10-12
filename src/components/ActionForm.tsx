"use client";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import clsx from "clsx";
import type { ActionResult } from "@/server/action-result";

type Action = (prev: ActionResult<unknown> | undefined, form: FormData) => Promise<ActionResult<unknown>>;

/** Form bound to a server action; shows pending state and the result inline. */
export function ActionForm({ action, children, className, resetOnSuccess, successMessage, id }: { action: Action; children: React.ReactNode; className?: string; resetOnSuccess?: boolean; successMessage?: string; id?: string }) {
  const [state, formAction] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} id={id}>
      {children}
      {state && !state.ok && <p role="alert" className="mt-2 text-sm text-crit">{state.error}</p>}
      {state?.ok && (state.message || successMessage) && <p role="status" className="mt-2 text-sm text-good">{state.message ?? successMessage}</p>}
    </form>
  );
}

export function Submit({ children, className = "btn-primary", pendingText, name, value, formNoValidate }: { children: React.ReactNode; className?: string; pendingText?: string; name?: string; value?: string; formNoValidate?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className={clsx(className)} disabled={pending} name={name} value={value} formNoValidate={formNoValidate}>
      {pending ? pendingText ?? "Saving…" : children}
    </button>
  );
}
