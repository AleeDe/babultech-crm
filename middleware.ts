import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap gate only. It checks for the presence of a session cookie and bounces
 * anonymous traffic to /login — it deliberately does NOT import lib/auth,
 * because the Credentials provider pulls in bcrypt, which cannot run on the
 * Edge runtime that middleware executes in.
 *
 * The real check is server-side: every page under (app) goes through
 * requireUser(), and every server action calls requirePermission(). Those hit
 * the database and enforce row-level scope. Do not rely on this file for
 * authorization.
 */
const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

export function middleware(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));

  if (!hasSession) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)"],
};
