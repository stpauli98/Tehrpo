import { STATUS_LABEL, type DerivedStatus } from "@/lib/termini"

const BOJE: Record<DerivedStatus, string> = {
  izvrseno: "bg-green-100",
  planirano: "bg-blue-50",
  zakazano: "bg-cyan-50",
  kasni: "bg-red-100",
  otkazano: "bg-slate-100",
}
const REDOSLIJED: DerivedStatus[] = ["izvrseno", "planirano", "zakazano", "kasni", "otkazano"]

export function MatrixLegenda() {
  return (
    <div
      data-testid="matrix-legenda"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500"
    >
      <span className="font-medium text-slate-600">Legenda:</span>
      <span>✓ izvršeno</span>
      <span>! kasni</span>
      <span>(+N) još termina</span>
      <span>· nema termina</span>
      <span className="mx-1 inline-block h-3 w-px bg-slate-200" />
      {REDOSLIJED.map((s) => (
        <span key={s} className="inline-flex items-center gap-1">
          <span className={`inline-block h-3 w-3 rounded ${BOJE[s]} ring-1 ring-inset ring-black/5`} />
          {STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  )
}
