"use client"

import { useTranslations } from "next-intl"

export function SuggestedPills({ onPick }: { onPick: (q: string) => void }) {
  const t = useTranslations("asistent.suggestedPills")
  const pitanja = [t("pitanje1"), t("pitanje2"), t("pitanje3")]
  return (
    <div className="flex flex-wrap gap-2" data-testid="suggested-pills">
      {pitanja.map((p) => (
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
