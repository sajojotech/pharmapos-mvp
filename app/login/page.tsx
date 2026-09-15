import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/rbac";
import { LoginForm } from "./login-form";

const appName = process.env.NEXT_PUBLIC_APP_NAME || "PharmaPOS";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">{appName}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Masuk untuk melanjutkan ke sistem kasir apotek.
        </p>

        <div className="mt-6">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
