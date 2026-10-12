export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse space-y-4">
      <span className="sr-only">Loading…</span>
      <div className="h-7 w-56 rounded bg-line" />
      <div className="h-9 rounded bg-line/70" />
      <div className="h-24 rounded-lg bg-line/60" />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="h-72 rounded-lg bg-line/50 xl:col-span-2" />
        <div className="h-72 rounded-lg bg-line/50" />
      </div>
      <div className="h-64 rounded-lg bg-line/40" />
    </div>
  );
}
