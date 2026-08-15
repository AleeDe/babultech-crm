import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { supabaseAdmin } from "./supabase";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
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
