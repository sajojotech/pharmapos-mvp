import Link from "next/link";
import { Pill } from "lucide-react";
import { can, type SessionUser } from "@/lib/rbac";
import { NAV_ITEMS } from "./nav-items";

const appName = process.env.NEXT_PUBLIC_APP_NAME || "PharmaPOS";

export function Sidebar({ user }: { user: SessionUser }) {
  const visibleItems = NAV_ITEMS.filter(
    (item) => item.permission === null || can(user, item.permission),
  );

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white print:hidden">
      <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
        <Pill className="h-6 w-6 text-emerald-600" aria-hidden />
        <span className="text-lg font-bold text-slate-900">{appName}</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-3">
        {visibleItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-emerald-50 hover:text-emerald-700"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
