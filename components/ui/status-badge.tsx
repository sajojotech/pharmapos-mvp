export function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={
        isActive
          ? "inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700"
          : "inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500"
      }
    >
      {isActive ? "Aktif" : "Nonaktif"}
    </span>
  );
}
