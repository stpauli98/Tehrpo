"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { X, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { cn, FOCUS_RING } from "@/lib/utils"
import { toastRezultat } from "@/components/akcija-toast"
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
import { useMozeUrediti } from "@/providers/korisnik-provider"
import { href } from "@/i18n/routes"

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
  const tc = useTranslations("common")
  const router = useRouter()
  const mozeUrediti = useMozeUrediti()
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
    setQ(""); setOpen(false); setHi(0)
    startTransition(async () => {
      const res = toastRezultat(await updateKontaktPodsjetnikPrimalac(id, klijentId, true), {
        uspjeh: tc("sacuvano"),
        greska: tc("greska"),
      })
      if (res.ok) { router.refresh() }
      else { setIzabraniIds((p) => { const n = new Set(p); n.delete(id); return n }) }
    })
  }

  function ukloniKontakt(id: string) {
    setIzabraniIds((p) => { const n = new Set(p); n.delete(id); return n })
    startTransition(async () => {
      const res = toastRezultat(await updateKontaktPodsjetnikPrimalac(id, klijentId, false), {
        uspjeh: tc("obrisano"),
        greska: tc("greska"),
      })
      if (res.ok) { router.refresh() }
      else { setIzabraniIds((p) => new Set(p).add(id)) }
    })
  }

  function dodajEmail(email: string) {
    const norm = email.trim().toLowerCase()
    setAdHoc((p) => [...p, norm])
    setQ(""); setOpen(false); setHi(0)
    startTransition(async () => {
      const res = toastRezultat(await dodajPodsjetnikEmail(klijentId, email), {
        uspjeh: tc("sacuvano"),
        greska: tc("greska"),
      })
      if (res.ok) { router.refresh() }
      else { setAdHoc((p) => p.filter((e) => e.toLowerCase() !== norm)) }
    })
  }

  function ukloniEmail(email: string) {
    setAdHoc((p) => p.filter((e) => e.toLowerCase() !== email.toLowerCase()))
    startTransition(async () => {
      const res = toastRezultat(await ukloniPodsjetnikEmail(klijentId, email), {
        uspjeh: tc("obrisano"),
        greska: tc("greska"),
      })
      if (res.ok) { router.refresh() }
      else { setAdHoc((p) => (p.some((e) => e.toLowerCase() === email.toLowerCase()) ? p : [...p, email])) }
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
    else if (e.key === "Enter") { if (!open) return; e.preventDefault(); izaberiHighlight() }
    else if (e.key === "Escape") { setOpen(false) }
  }

  const nemaPrimalaca = izabraniKontakti.length === 0 && adHocPrikaz.length === 0

  return (
    <div className="max-w-xl">
      <p className="mb-1 text-sm font-medium">{t("primaociNaslov")}</p>
      <p className="mb-2 text-sm text-muted-foreground">{t("primaociOpis")}</p>

      {/* Izabrani primaoci (chipovi) */}
      <div className="mb-2 flex flex-wrap gap-2" data-testid="primaoci-izabrani">
        {nemaPrimalaca && <span className="text-sm text-muted-foreground">{t("nemaPrimalaca")}</span>}
        {izabraniKontakti.map((k) => (
          <Badge key={k.id} variant="secondary" className="gap-1" data-testid={`primalac-kontakt-${k.id}`}>
            <span className="truncate">{k.ime} · {k.email}</span>
            {mozeUrediti && (
              <button
                type="button" disabled={pending} aria-label={t("ukloniPrimaoca")}
                data-testid={`ukloni-kontakt-${k.id}`}
                className={cn("ml-0.5 rounded hover:bg-foreground/10 disabled:opacity-50", FOCUS_RING)}
                onClick={() => ukloniKontakt(k.id)}
              ><X className="h-3 w-3" aria-hidden /></button>
            )}
          </Badge>
        ))}
        {adHocPrikaz.map((email) => (
          <Badge key={email} variant="outline" className="gap-1" data-testid="primalac-adhoc">
            <span className="truncate">{email}</span>
            <span className="text-xs text-muted-foreground">{t("tagJednokratno")}</span>
            {mozeUrediti && (
              <button
                type="button" disabled={pending} aria-label={t("ukloniPrimaoca")}
                data-testid={`ukloni-adhoc-${email}`}
                className={cn("ml-0.5 rounded hover:bg-foreground/10 disabled:opacity-50", FOCUS_RING)}
                onClick={() => ukloniEmail(email)}
              ><X className="h-3 w-3" aria-hidden /></button>
            )}
          </Badge>
        ))}
      </div>

      {/* Combobox — dodavanje primalaca; skriveno za pregled (read-only) */}
      {mozeUrediti && (
      <div
        ref={rootRef} className="relative"
        onBlur={(e) => { if (!rootRef.current?.contains(e.relatedTarget as Node)) setOpen(false) }}
      >
        {/* S4: ui/Input primitiv donosi h-8, rounded-lg, border-input i fokus prsten. */}
        <Input
          type="text" role="combobox" aria-expanded={open} aria-controls="primaoci-lista"
          data-testid="primaoci-combobox-input"
          placeholder={t("comboPlaceholder")}
          // S12: placeholder nije pristupačno ime — combobox mora imati aria-label.
          aria-label={t("comboPlaceholder")}
          value={q} disabled={pending}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0) }}
          onFocus={() => { setOpen(true); setHi(0) }}
          onKeyDown={onKeyDown}
        />
        {open && (opcije.length > 0 || nudiAdHoc || q.trim() !== "") && (
          <ul
            id="primaoci-lista" role="listbox" data-testid="primaoci-lista"
            className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-card py-1 shadow-lg"
          >
            {opcije.map((o, i) => (
              <li key={o.id} role="option" aria-selected={hi === i}>
                <button
                  type="button" data-testid={`opcija-kontakt-${o.id}`}
                  className={cn(
                    "flex w-full flex-col px-3 py-1.5 text-left text-sm hover:bg-muted",
                    hi === i && "bg-muted",
                    FOCUS_RING,
                  )}
                  onMouseEnter={() => setHi(i)} onClick={() => dodajKontakt(o.id)}
                >
                  <span className="font-medium">{o.ime}{o.funkcija && <span className="font-normal text-muted-foreground"> · {o.funkcija}</span>}</span>
                  <span className="text-muted-foreground">{o.email}</span>
                </button>
              </li>
            ))}
            {nudiAdHoc && (
              <li role="option" aria-selected={hi === opcije.length}>
                <button
                  type="button" data-testid="opcija-adhoc"
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-brand hover:bg-muted",
                    hi === opcije.length && "bg-muted",
                    FOCUS_RING,
                  )}
                  onMouseEnter={() => setHi(opcije.length)} onClick={() => dodajEmail(q)}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {t("dodajJednokratni", { email: q.trim().toLowerCase() })}
                </button>
              </li>
            )}
            {opcije.length === 0 && !nudiAdHoc && q.trim() !== "" && (
              <li className="px-3 py-1.5 text-sm text-muted-foreground" data-testid="primaoci-nema-rezultata">{t("nemaRezultata")}</li>
            )}
          </ul>
        )}
      </div>
      )}

      {kontakti.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("nemaKontakata")}{" "}
          <Link
            href={href(`/klijenti/${klijentId}?tab=kontakti`)}
            className={cn("rounded-sm font-medium text-brand hover:underline", FOCUS_RING)}
          >
            {t("dodajKontaktLink")}
          </Link>
        </p>
      )}
    </div>
  )
}
