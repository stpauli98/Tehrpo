"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Trash2, Users, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InfoIkona } from "@/components/ui/info-ikona"
import { KontaktSheet } from "@/components/domain/KontaktSheet"
import { useAkcijaToast } from "@/components/akcija-toast"
import { deleteKontakt, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import { useMozeUrediti } from "@/providers/korisnik-provider"
import type { Database } from "@/db/types"

type KontaktRow = Database["public"]["Tables"]["kontakt_osobe"]["Row"]
const initial: ActionResult = { ok: true }

export function KontaktiKlijentList({
  klijentId,
  kontakti,
  searchable = false,
  previewLimit,
  seeAllHref,
  info,
}: {
  klijentId: string
  kontakti: KontaktRow[]
  searchable?: boolean
  previewLimit?: number
  seeAllHref?: string
  info?: string
}) {
  const t = useTranslations("klijenti.kontaktiFirme")
  const tc = useTranslations("common")
  const router = useRouter()
  const mozeUrediti = useMozeUrediti()
  const [delState, delAction, delPending] = useActionState(deleteKontakt, initial)
  const prev = useRef(delState)
  const [q, setQ] = useState("")
  useEffect(() => {
    if (delState !== prev.current) { prev.current = delState; if (delState.ok) router.refresh() }
  }, [delState, router])
  useAkcijaToast(delState, { uspjeh: tc("obrisano"), greska: tc("greska") })

  const upit = q.trim().toLowerCase()
  const filtrirani =
    searchable && upit
      ? kontakti.filter((k) => k.ime.toLowerCase().includes(upit) || (k.funkcija ?? "").toLowerCase().includes(upit))
      : kontakti
  const vidljivi = previewLimit ? filtrirani.slice(0, previewLimit) : filtrirani
  const ostatak = filtrirani.length - vidljivi.length

  return (
    <div className="space-y-3" data-testid="kontakti-klijent-sekcija">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Users className="h-4 w-4 text-muted-foreground" aria-hidden /> {t("naslov")}
          {info && <InfoIkona tekst={info} testId="info-sekcija-kontakti-firma" />}
        </h3>
        <KontaktSheet klijentId={klijentId} />
      </div>

      {searchable && kontakti.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("pretragaPlaceholder")}
            className="pl-8"
            data-testid="kontakti-pretraga"
          />
        </div>
      )}

      {kontakti.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("prazno")}</p>
      ) : filtrirani.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("praznoPretraga", { q })}</p>
      ) : (
        <ul className="space-y-2">
          {vidljivi.map((k) => (
            <li key={k.id} data-testid="kontakt-red" className="rounded-xl border border-border p-3 text-sm transition-colors hover:border-border hover:bg-muted/60">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {k.ime}
                  {k.funkcija && <span className="font-normal text-muted-foreground"> · {k.funkcija}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <KontaktSheet klijentId={klijentId} kontakt={k} />
                  {mozeUrediti && (
                    <form action={delAction}>
                      <input type="hidden" name="id" value={k.id} />
                      <input type="hidden" name="klijent_id" value={klijentId} />
                      <Button type="submit" variant="ghost" disabled={delPending} aria-label={t("obrisiAriaLabel")} data-testid={`obrisi-kontakt-${k.id}`}>
                        <Trash2 className="w-4 h-4 text-destructive" aria-hidden />
                      </Button>
                    </form>
                  )}
                </span>
              </div>
              {(k.telefon || k.email) && (
                <div className="mt-1 text-muted-foreground">{[k.telefon, k.email].filter(Boolean).join(" · ")}</div>
              )}
            </li>
          ))}
        </ul>
      )}

      {previewLimit && seeAllHref && ostatak > 0 && (
        <Link
          href={seeAllHref}
          className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
          data-testid="kontakti-vidi-sve"
        >
          {t("vidiSve", { count: filtrirani.length })}
        </Link>
      )}

      {delState.ok === false && delState.message && (
        <p className="text-sm text-destructive" role="alert">{delState.message}</p>
      )}
    </div>
  )
}
