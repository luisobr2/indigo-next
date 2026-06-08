import { type LucideIcon } from "lucide-react";

export function PagePlaceholder({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="mx-auto max-w-2xl py-16 text-center">
      {Icon && (
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700">
          <Icon size={28} />
        </div>
      )}
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-slate-900">
        {title}
      </h1>
      <p className="text-sm text-slate-500">{description}</p>
      <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-sm text-slate-400">
        Coming soon — this screen is on the implementation roadmap.
      </div>
    </div>
  );
}
