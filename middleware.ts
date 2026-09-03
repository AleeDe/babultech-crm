import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Bounces anonymous traffic to /login and keeps the Supabase session fresh.
 *
 * getClaims() verifies the JWT's signature locally against the project's
 * published JWKS (ES256), so the common case costs no network round trip — the
 * key set is fetched once and cached for the life of the process. It still
 * refreshes an expiring token, because the client is built with the cookie
 * adapter below and writes the new one back through setAll(). Server Components
 * cannot set cookies, so without this pass a long-lived tab would eventually
 * fall off its session.
 *
 * This deliberately does NOT call getUser(). That is a round trip to Supabase
 * Auth on every request, and requireUser() in lib/authz.ts already makes one on
 * the way to loading the profile — two sequential calls to the same service
 * before a page fetched a single row. A forged token cannot pass the signature
 * check here, and anything getClaims() lets through still has to survive
 * requireUser().
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

  const { data: claims } = await supabase.auth.getClaims();

  if (!claims) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
