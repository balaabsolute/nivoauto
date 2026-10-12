import { NextResponse, type NextRequest } from "next/server";

/** Cheap gate: no session cookie → login. Real verification happens server-side on every request. */
export function middleware(req: NextRequest) {
  const has = req.cookies.has("kun_session");
  const { pathname } = req.nextUrl;
  if (!has && !pathname.startsWith("/login") && !pathname.startsWith("/api/health") && pathname !== "/manifest.webmanifest" && pathname !== "/icon.svg") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next();
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "same-origin");
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.svg).*)"] };
