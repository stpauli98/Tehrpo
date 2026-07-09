"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  updateKlijentSaljiPodsjetnik,
  updateKontaktPodsjetnikPrimalac,
} from "@/app/(dashboard)/klijenti/[id]/actions"

type KontaktZaPodsjetnik = {
  id: string
  ime: string
  funkcija: string | null
  email: string | null
  podsjetnik_primalac: boolean
}

export function KlijentPodsjetniciForm({
  klijentId, salji, kontakti,
}: { klijentId: string; salji: boolean; kontakti: KontaktZaPodsjetnik[] }) {
  const t = useTranslations("klijenti.podsjetnici")
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [saljiState, setSalji] = useState(salji)
  const [izabrani, setIzabrani] = useState<Set<string>>(
    () => new Set(kontakti.filter((k) => k.podsjetnik_primalac).map((k) => k.id)),
  )

  function toggleSalji(next: boolean) {
    setSalji(next)
    startTransition(async () => {
      const res = await updateKlijentSaljiPodsjetnik(klijentId, next)
      if (res.ok) { toast.success(t("spaseno")); router.refresh() }
      else { setSalji(!next); toast.error(res.message) }
    })
  }

  function toggleKontakt(kontaktId: string, next: boolean) {
    setIzabrani((prev) => {
      const kopija = new Set(prev)
      if (next) kopija.add(kontaktId); else kopija.delete(kontaktId)
      return kopija
    })
    startTransition(async () => {
      const res = await updateKontaktPodsjetnikPrimalac(kontaktId, klijentId, next)
      if (res.ok) { toast.success(t("spaseno")); router.refresh() }
      else {
        setIzabrani((prev) => {
          const kopija = new Set(prev)
          if (next) kopija.delete(kontaktId); else kopija.add(kontaktId)
          return kopija
        })
        toast.error(res.message)
      }
    })
  }

  return (
    <div className="max-w-xl space-y-4" data-testid="klijent-podsjetnici-form">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={saljiState}
          disabled={pending}
          data-testid="klijent-salji-toggle"
          className="mt-0.5 h-4 w-4 cursor-pointer accent-brand disabled:opacity-50"
          onChange={(e) => toggleSalji(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-medium">{t("saljiNaslov")}</span>
          <span className="block text-sm text-slate-500">{t("saljiOpis")}</span>
        </span>
      </label>

      <div>
        <p className="mb-2 text-sm font-medium">{t("primaociNaslov")}</p>
        {kontakti.length === 0 ? (
          <p className="text-sm text-slate-500" data-testid="klijent-primaoci-prazno">
            {t("nemaKontakata")}{" "}
            <Link href={`/klijenti/${klijentId}?tab=kontakti`} className="font-medium text-brand hover:underline">
              {t("dodajKontaktLink")}
            </Link>
          </p>
        ) : (
          <ul className="space-y-2">
            {kontakti.map((k) => {
              const imaEmail = !!(k.email && k.email.trim())
              return (
                <li
                  key={k.id}
                  data-testid={`klijent-primalac-red-${k.id}`}
                  className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={izabrani.has(k.id)}
                    disabled={pending || !imaEmail}
                    data-testid={`klijent-primalac-${k.id}`}
                    className="mt-0.5 h-4 w-4 cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-40"
                    onChange={(e) => toggleKontakt(k.id, e.target.checked)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {k.ime}
                      {k.funkcija && <span className="font-normal text-slate-500"> · {k.funkcija}</span>}
                    </span>
                    {imaEmail ? (
                      <span className="block truncate text-sm text-slate-500">{k.email}</span>
                    ) : (
                      <span
                        className="block text-sm text-amber-600"
                        data-testid={`klijent-primalac-nema-email-${k.id}`}
                      >
                        {t("nemaEmail")}{" "}
                        <Link href={`/klijenti/${klijentId}?tab=kontakti`} className="underline">
                          {t("dodajEmailLink")}
                        </Link>
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
