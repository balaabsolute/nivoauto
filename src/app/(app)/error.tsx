"use client";
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <div className="panel p-6 max-w-lg">
      <h1 className="h2">This page couldn’t load</h1>
      <p className="text-sm text-ink-2 mt-1">
        The data service didn’t respond as expected. Your saved work is not affected. Try again; if it keeps happening, share reference <code>{error.digest ?? "n/a"}</code> with your administrator.
      </p>
      <button onClick={reset} className="btn-primary mt-4">Try again</button>
    </div>
  );
}
