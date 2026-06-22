"use client"

const PITANJA = [
  "Koji termini kasne?",
  "Koje firme imamo i koliko kasne?",
  "Grupiši aktivne termine po klijentu",
] as const

export function SuggestedPills({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="suggested-pills">
      {PITANJA.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPick(p)}
          data-testid="suggested-pill"
          className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
        >
          {p}
        </button>
      ))}
    </div>
  )
}
