import type { LucideIcon } from "lucide-react"

export function ComingSoon({
  naslov,
  faza,
  opis,
  icon: Icon,
}: {
  naslov: string
  faza: string
  opis: string
  icon: LucideIcon
}) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{naslov}</h1>
      <div
        data-testid="coming-soon"
        className="flex flex-col items-center rounded-xl border border-slate-200 p-10 text-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-light text-brand">
          <Icon className="h-6 w-6" aria-hidden />
        </div>
        <p className="mt-4 text-base font-medium text-slate-900">{naslov} — uskoro</p>
        <p className="mt-1 max-w-md text-sm text-slate-500">{opis}</p>
        <span className="mt-4 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
          {faza}
        </span>
      </div>
    </div>
  )
}
