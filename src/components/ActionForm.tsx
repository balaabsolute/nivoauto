"use client";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import type { ActionResult } from "@/server/action-result";

type Action = (prev: ActionResult<unknown> | undefined, form: FormData) => Promise<ActionResult<unknown>>;

/**
 * Form bound to a server action; shows pending state and the result inline.
 * Actions return plain results (no revalidatePath/redirect inside the action). On success the form
 * refreshes the current route, or navigates when the action returns { redirectTo }. Keeping action
 * responses free of re-rendered page trees avoided intermittent stalled submissions in testing.
 */
export function ActionForm({ action, children, className, resetOnSuccess, successMessage, id }: { action: Action; children: React.ReactNode; className?: string; resetOnSuccess?: boolean; successMessage?: string; id?: string }) {
  const [state, formAction] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  // Handle each action result exactly once. Re-running the effect (e.g. when the router context
  // changes mid-navigation) would start a second navigation that aborts the first.
  const handled = useRef<unknown>(undefined);
  useEffect(() => {
    if (!state?.ok || handled.current === state) return;
    handled.current = state;
    if (resetOnSuccess) ref.current?.reset();
    const to = (state.data as { redirectTo?: string } | undefined)?.redirectTo;
    if (to) router.push(to);
    else router.refresh();
  }, [state, resetOnSuccess, router]);
  const navigating = state?.ok && (state.data as { redirectTo?: string } | undefined)?.redirectTo;
  return (
    <form ref={ref} action={formAction} className={className} id={id}>
      {children}
      {state && !state.ok && <p role="alert" className="mt-2 text-sm text-crit">{state.error}</p>}
      {state?.ok && !navigating && (state.message || successMessage) && <p role="status" className="mt-2 text-sm text-good">{state.message ?? successMessage}</p>}
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
