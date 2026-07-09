"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { X, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  updateKontaktPodsjetnikPrimalac,
  dodajPodsjetnikEmail,
  ukloniPodsjetnikEmail,
} from "@/app/(dashboard)/klijenti/[id]/actions"
import {
  filtrirajKontakte,
  mozeAdHoc,
  adHocZaPrikaz,
} from "@/lib/podsjetnici/primaociPicker"

export type KontaktZaPodsjetnik = {
  id: string
  ime: string
  funkcija: string | null
  email: string | null
  podsjetnik_primalac: boolean
}

export function PrimaociCombobox({
  klijentId,
  kontakti,
  adHocEmails,
}: {
  klijentId: string
  kontakti: KontaktZaPodsjetnik[]
  adHocEmails: string[]
}) {
  const t = useTranslations("klijenti.podsjetnici")
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const [izabraniIds, setIzabraniIds] = useState<Set<string>>(
    () => new Set(kontakti.filter((k) => k.podsjetnik_primalac).map((k) => k.id)),
  )
  const [adHoc, setAdHoc] = useState<string[]>(() => [...adHocEmails])

  const contactEmails = useMemo(
    () => kontakti.map((k) => (k.email ?? "").trim()).filter((e) => e.length > 0),
    [kontakti],
  )
  const izabraniKontakti = useMemo(
    () => kontakti.filter((k) => izabraniIds.has(k.id)),
    [kontakti, izabraniIds],
  )
  const flaggedEmails = useMemo(
    () => izabraniKontakti.map((k) => (k.email ?? "").trim()).filter((e) => e.length > 0),
    [izabraniKontakti],
  )
  const adHocPrikaz = useMemo(() => adHocZaPrikaz(adHoc, flaggedEmails), [adHoc, flaggedEmails])

  const opcije = useMemo(() => filtrirajKontakte(kontakti, q, izabraniIds), [kontakti, q, izabraniIds])
  const nudiAdHoc = mozeAdHoc(q, contactEmails, adHoc)
  const brojOpcija = opcije.length + (nudiAdHoc ? 1 : 0)

  function dodajKontakt(id: string) {
    setIzabraniIds((p) => new Set(p).add(id))
    setQ(""); setOpen(false)
    startTransition(async () => {
      const res = await updateKontaktPodsjetnikPrimalac(id, klijentId, true)
      if (res.ok) { router.refresh() }
      else { setIzabraniIds((p) => { const n = new Set(p); n.delete(id); return n }); toast.error(res.message) }
    })
  }

  function ukloniKontakt(id: string) {
    setIzabraniIds((p) => { const n = new Set(p); n.delete(id); return n })
    startTransition(async () => {
      const res = await updateKontaktPodsjetnikPrimalac(id, klijentId, false)
      if (res.ok) { router.refresh() }
      else { setIzabraniIds((p) => new Set(p).add(id)); toast.error(res.message) }
    })
  }

  function dodajEmail(email: string) {
    const prethodni = adHoc
    setAdHoc((p) => [...p, email.trim().toLowerCase()])
    setQ(""); setOpen(false)
    startTransition(async () => {
      const res = await dodajPodsjetnikEmail(klijentId, email)
      if (res.ok) { router.refresh() }
      else { setAdHoc(prethodni); toast.error(res.message) }
    })
  }

  function ukloniEmail(email: string) {
    const prethodni = adHoc
    setAdHoc((p) => p.filter((e) => e.toLowerCase() !== email.toLowerCase()))
    startTransition(async () => {
      const res = await ukloniPodsjetnikEmail(klijentId, email)
      if (res.ok) { router.refresh() }
      else { setAdHoc(prethodni); toast.error(res.message) }
    })
  }

  function izaberiHighlight() {
    const opcija = opcije[hi]
    if (opcija) dodajKontakt(opcija.id)
    else if (nudiAdHoc) dodajEmail(q)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, Math.max(0, brojOpcija - 1))) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
    else if (e.key === "Enter") { e.preventDefault(); izaberiHighlight() }
    else if (e.key === "Escape") { setOpen(false) }
  }

  const nemaPrimalaca = izabraniKontakti.length === 0 && adHocPrikaz.length === 0

  return (
    <div className="max-w-xl">
      <p className="mb-1 text-sm font-medium">{t("primaociNaslov")}</p>
      <p className="mb-2 text-sm text-slate-500">{t("primaociOpis")}</p>

      {/* Izabrani primaoci (chipovi) */}
      <div className="mb-2 flex flex-wrap gap-2" data-testid="primaoci-izabrani">
        {nemaPrimalaca && <span className="text-sm text-slate-400">{t("nemaPrimalaca")}</span>}
        {izabraniKontakti.map((k) => (
          <Badge key={k.id} variant="secondary" className="gap-1" data-testid={`primalac-kontakt-${k.id}`}>
            <span className="truncate">{k.ime} · {k.email}</span>
            <button
              type="button" disabled={pending} aria-label={t("ukloniPrimaoca")}
              data-testid={`ukloni-kontakt-${k.id}`}
              className="ml-0.5 rounded hover:bg-slate-300/60 disabled:opacity-50"
              onClick={() => ukloniKontakt(k.id)}
            ><X className="h-3 w-3" /></button>
          </Badge>
        ))}
        {adHocPrikaz.map((email) => (
          <Badge key={email} variant="outline" className="gap-1" data-testid="primalac-adhoc">
            <span className="truncate">{email}</span>
            <span className="text-xs text-slate-400">⟨{t("tagJednokratno")}⟩</span>
            <button
              type="button" disabled={pending} aria-label={t("ukloniPrimaoca")}
              data-testid={`ukloni-adhoc-${email}`}
              className="ml-0.5 rounded hover:bg-slate-200 disabled:opacity-50"
              onClick={() => ukloniEmail(email)}
            ><X className="h-3 w-3" /></button>
          </Badge>
        ))}
      </div>

      {/* Combobox */}
      <div
        ref={rootRef} className="relative"
        onBlur={(e) => { if (!rootRef.current?.contains(e.relatedTarget as Node)) setOpen(false) }}
      >
        <input
          type="text" role="combobox" aria-expanded={open} aria-controls="primaoci-lista"
          data-testid="primaoci-combobox-input"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand"
          placeholder={t("comboPlaceholder")}
          value={q} disabled={pending}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {open && (opcije.length > 0 || nudiAdHoc || q.trim() !== "") && (
          <ul
            id="primaoci-lista" role="listbox" data-testid="primaoci-lista"
            className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          >
            {opcije.map((o, i) => (
              <li key={o.id} role="option" aria-selected={hi === i}>
                <button
                  type="button" data-testid={`opcija-kontakt-${o.id}`}
                  className={`flex w-full flex-col px-3 py-1.5 text-left text-sm hover:bg-slate-50 ${hi === i ? "bg-slate-50" : ""}`}
                  onMouseEnter={() => setHi(i)} onClick={() => dodajKontakt(o.id)}
                >
                  <span className="font-medium">{o.ime}{o.funkcija && <span className="font-normal text-slate-500"> · {o.funkcija}</span>}</span>
                  <span className="text-slate-500">{o.email}</span>
                </button>
              </li>
            ))}
            {nudiAdHoc && (
              <li role="option" aria-selected={hi === opcije.length}>
                <button
                  type="button" data-testid="opcija-adhoc"
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-brand hover:bg-slate-50 ${hi === opcije.length ? "bg-slate-50" : ""}`}
                  onMouseEnter={() => setHi(opcije.length)} onClick={() => dodajEmail(q)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("dodajJednokratni", { email: q.trim().toLowerCase() })}
                </button>
              </li>
            )}
            {opcije.length === 0 && !nudiAdHoc && q.trim() !== "" && (
              <li className="px-3 py-1.5 text-sm text-slate-400" data-testid="primaoci-nema-rezultata">{t("nemaRezultata")}</li>
            )}
          </ul>
        )}
      </div>

      {kontakti.length === 0 && (
        <p className="mt-2 text-sm text-slate-500">
          {t("nemaKontakata")}{" "}
          <Link href={`/klijenti/${klijentId}?tab=kontakti`} className="font-medium text-brand hover:underline">
            {t("dodajKontaktLink")}
          </Link>
        </p>
      )}
    </div>
  )
}
