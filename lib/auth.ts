import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import {
  getAssignedBranchIds,
  recordLoginAttempt,
  verifyCredentials,
} from "@/services/auth-service";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // MVP ini di-hosting sendiri (Docker/Vercel di belakang domain yang kita
  // kontrol), bukan multi-tenant host arbitrer — trustHost aman dipakai di
  // sini untuk development maupun deployment tunggal semacam ini.
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const result = await verifyCredentials(
          parsed.data.email,
          parsed.data.password,
        );

        if (!result.ok) {
          if (result.reason !== "NOT_FOUND") {
            await recordLoginAttempt({
              companyId: result.companyId,
              userId: result.userId,
              success: false,
              reason:
                result.reason === "INACTIVE"
                  ? "Akun nonaktif"
                  : "Password salah",
            });
          }
          return null;
        }

        await recordLoginAttempt({
          companyId: result.user.companyId,
          userId: result.user.id,
          success: true,
        });

        return result.user;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.companyId = user.companyId;
        token.role = user.role;
        token.assignedBranchIds = await getAssignedBranchIds(user.id);
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.userId;
      session.user.companyId = token.companyId;
      session.user.role = token.role;
      session.user.assignedBranchIds = token.assignedBranchIds;
      return session;
    },
  },
});
