import Link from "next/link";
export const metadata = { title: "No access" };
export default function Forbidden() {
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="panel max-w-md p-6 text-center">
        <h1 className="h1">You don’t have access to this page</h1>
        <p className="text-sm text-ink-2 mt-2">Your role doesn’t include this area. If you need it for your work, ask your administrator to update your access.</p>
        <Link href="/" className="btn-primary mt-5">Go to your home page</Link>
      </div>
    </main>
  );
}
