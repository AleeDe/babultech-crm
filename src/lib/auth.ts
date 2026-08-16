import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { supabaseAdmin, supabaseServer } from "./supabase";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Behind Vercel's proxy the request host is forwarded, not original, so v5
  // refuses to infer the site URL and every CSRF check fails with MissingCSRF.
  // AUTH_URL pins it when set; trusting the host covers preview deployments,
  // whose URL changes per commit and so cannot be pinned in advance.
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        // Sign-in runs before any session exists, so RLS would block the anon
        // client from reading app_user — including the row being authenticated.
        // The service-role client is used for this lookup only, keyed by an
        // email that is verified against a bcrypt hash immediately below.
        const db = supabaseAdmin();

        const { data: user } = await db
          .from("app_user")
          .select("*, role:security_role!inner ( name )")
          .eq("email", parsed.data.email.toLowerCase())
          .maybeSingle();

        if (!user?.passwordHash || user.status !== "ACTIVE" || user.deletedAt) {
          return null;
        }

        const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;

        // Sign in to Supabase Auth as well, so the request carries a Supabase
        // JWT and not only the NextAuth cookie.
        //
        // Without this the two halves disagree: requireUser() resolves identity
        // from the NextAuth session, but every data query runs through
        // supabaseServer(), which is anonymous to the database. RLS then denies
        // everything — reads come back empty and inserts fail with "new row
        // violates row-level security policy".
        //
        // auth.users.id === app_user.id (scripts/migrate-auth-users.mjs), so
        // both sessions describe the same person.
        const sessionDb = await supabaseServer();
        const { error: supabaseSignInError } = await sessionDb.auth.signInWithPassword({
          email: parsed.data.email.toLowerCase(),
          password: parsed.data.password,
        });

        if (supabaseSignInError) {
          // The bcrypt hash in app_user and the password in auth.users are
          // stored separately, so they can drift apart. Failing loudly here
          // beats signing the user in to a session that can read nothing.
          console.error(
            `Supabase Auth rejected ${parsed.data.email}: ${supabaseSignInError.message}. ` +
              `Run scripts/migrate-auth-users.mjs to resync passwords.`,
          );
          return null;
        }

        await db
          .from("app_user")
          .update({ lastLoginAt: new Date().toISOString() })
          .eq("id", user.id);

        // PostgREST types an embedded to-one relation as an array.
        const role = (Array.isArray(user.role) ? user.role[0] : user.role) as {
          name: string;
        };

        return {
          id: user.id,
          name: user.fullName,
          email: user.email,
          image: user.avatarUrl,
          role: role?.name,
        };
      },
    }),
  ],
  events: {
    // Sign-in creates two sessions, so sign-out has to end both. Leaving the
    // Supabase cookie behind would keep a usable database session alive after
    // the user believes they have signed out.
    async signOut() {
      try {
        const sessionDb = await supabaseServer();
        await sessionDb.auth.signOut();
      } catch {
        // Best effort: the NextAuth sign-out must complete regardless.
      }
    },
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
});

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: string;
    };
  }
  interface User {
    role?: string;
  }
}
