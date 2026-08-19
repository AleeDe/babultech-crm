import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Bounces anonymous traffic to /login and keeps the Supabase session fresh.
 *
 * Calling getUser() here does double duty: it verifies the token with Supabase
 * rather than trusting the cookie, and it writes back a refreshed token when the
 * old one is close to expiring. Server Components cannot set cookies, so
 * without this pass a long-lived tab would eventually fall off its session.
 *
 * This is not the authorization boundary. Every page under (app) still goes
 * through requireUser() and every server action through requirePermission(),
 * both of which hit the database and enforce row-level scope.
 */
export async function middleware(request: NextRequest) {
  // Cookies set below have to travel on the response that is actually returned,
  // so the response object is created up front and mutated in place.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
