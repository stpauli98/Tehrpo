import { STATUS_LABEL, STATUS_DOT_CLASS, STATUS_ORDER } from "@/lib/termini"

export function PlanLegenda() {
  return (
    <div
      data-testid="plan-legenda"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500"
    >
      <span className="font-medium text-slate-600">Legenda:</span>
      {STATUS_ORDER.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT_CLASS[s]}`} />
          {STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  )
}
