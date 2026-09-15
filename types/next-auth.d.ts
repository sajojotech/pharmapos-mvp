import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

/**
 * Augmentasi tipe Auth.js agar session/JWT membawa field yang dipakai di
 * seluruh RBAC & branch context (lihat lib/rbac.ts).
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      companyId: string;
      role: Role;
      assignedBranchIds: string[];
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    companyId: string;
    role: Role;
    assignedBranchIds?: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    companyId: string;
    role: Role;
    assignedBranchIds: string[];
  }
}

// NextAuth v5's callback signatures (`jwt`/`session`) resolve the `JWT` type
// from `@auth/core/jwt` internally, not from the `next-auth/jwt` re-export —
// augmenting only the latter leaves `token.xxx` typed as `unknown` inside
// `lib/auth.ts` callbacks. Augment both so the type is correct wherever it's
// imported from.
declare module "@auth/core/jwt" {
  interface JWT {
    userId: string;
    companyId: string;
    role: Role;
    assignedBranchIds: string[];
  }
}
