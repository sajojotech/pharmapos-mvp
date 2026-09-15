import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
      <ShieldAlert className="h-12 w-12 text-amber-500" aria-hidden />
      <h1 className="text-2xl font-bold text-slate-900">Akses Ditolak</h1>
      <p className="max-w-md text-sm text-slate-600">
        Anda tidak memiliki izin untuk mengakses halaman ini. Jika menurut
        Anda ini keliru, hubungi Admin Pusat atau Owner untuk meninjau ulang
        peran (role) dan cabang yang ditugaskan ke akun Anda.
      </p>
      <Link
        href="/dashboard"
        className="mt-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
      >
        Kembali ke Dashboard
      </Link>
    </main>
  );
}
