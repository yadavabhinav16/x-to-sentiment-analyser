import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import { authenticate, findUserByEmail, EMAIL_RE } from "./users";
import { rateLimit } from "@/lib/rate-limit";

const providers: Array<Provider> = [
  Credentials({
    id: "credentials",
    name: "Email & password",
    credentials: {
      email: { label: "Email", type: "text" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials, req) {
      const email = (credentials?.email as string) || "";
      const password = (credentials?.password as string) || "";
      if (!EMAIL_RE.test(email) || !password) return null;

      // Brute-force guard: 10 sign-in attempts / 5 min per email.
      const rl = rateLimit(`signin:${email.toLowerCase()}`, 10, 5 * 60 * 1000);
      if (!rl.allowed) return null;

      return authenticate(email, password) ?? null;
    },
  }),
];

// Legacy/dev provider retained for local development only.
if (process.env.NODE_ENV === "development") {
  providers.push(
    Credentials({
      id: "dev",
      name: "Dev login",
      credentials: { email: { label: "Email", type: "text" } },
      async authorize(credentials) {
        const email = (credentials?.email as string) || "dev@example.com";
        if (!EMAIL_RE.test(email)) return null;
        // Ensure a backing user row exists for dev sign-in.
        let user = findUserByEmail(email);
        if (!user) {
          const { createUser } = await import("./users");
          user = createUser(email, "dev-password-placeholder");
        }
        return { id: user.id, name: user.name, email: user.email ?? email };
      },
    }) as Provider
  );
}

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }));
}
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  providers.push(GitHub({ clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET }));
}

declare module "next-auth" {
  interface Session {
    user: { id: string; name?: string | null; email?: string | null };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  trustHost: true,
  secret: process.env.AUTH_SECRET || "dev-secret-change-me",
  callbacks: {
    jwt({ token, user }) {
      if (user) token.uid = user.id as string;
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.id = (token.uid as string) ?? token.sub ?? "";
      return session;
    },
  },
});