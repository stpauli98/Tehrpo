"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Trash2, Users, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InfoIkona } from "@/components/ui/info-ikona"
import { KontaktSheet } from "@/components/domain/KontaktSheet"
import { PotvrdiBrisanjeDialog } from "@/components/domain/PotvrdiBrisanjeDialog"
import { toastRezultat } from "@/components/akcija-toast"
import { deleteKontakt } from "@/app/(dashboard)/klijenti/actions"
import { useDozvole } from "@/providers/korisnik-provider"
import type { Database } from "@/db/types"

type KontaktRow = Database["public"]["Tables"]["kontakt_osobe"]["Row"]

export function KontaktiKlijentList({
  klijentId,
  kontakti,
  searchable = false,
  previewLimit,
  seeAllHref,
  info,
  lokacije = [],
}: {
  klijentId: string
  kontakti: KontaktRow[]
  /** Lokacije firme — prosljeđuju se formi kontakta radi vezivanja (prazno = polje skriveno). */
  lokacije?: { id: string; naziv: string }[]
  searchable?: boolean
  previewLimit?: number
  seeAllHref?: string
  info?: string
}) {
  const t = useTranslations("klijenti.kontaktiFirme")
  const tc = useTranslations("common")
  const router = useRouter()
  // kontakt_del prati prekidač za klijente; KontaktSheet (dodaj/izmijeni) se sam gate-uje.
  const { smije_brisati_klijente: mozeBrisati } = useDozvole()
  const [q, setQ] = useState("")

  // Per-red brisanje (S3/O3) — pending i greška žive u dijalogu tog kontakta,
  // ostali redovi ostaju upotrebljivi.
  async function obrisi(kontaktId: string) {
    const fd = new FormData()
    fd.set("id", kontaktId)
    fd.set("klijent_id", klijentId)
    return toastRezultat(await deleteKontakt({ ok: true }, fd), {
      uspjeh: tc("obrisano"),
      greska: tc("greska"),
    })
  }

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
          <Users className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden /> {t("naslov")}
          {info && <InfoIkona tekst={info} testId="info-sekcija-kontakti-firma" />}
        </h3>
        <KontaktSheet klijentId={klijentId} lokacije={lokacije} />
      </div>

      {searchable && kontakti.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-[18px] w-[18px] shrink-0 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("pretragaPlaceholder")}
            aria-label={t("pretragaPlaceholder")}
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
            <li key={k.id} data-testid="kontakt-red" className="rounded-xl border border-border p-3 text-sm transition-colors motion-reduce:transition-none hover:border-border hover:bg-muted/60">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {k.ime}
                  {k.funkcija && <span className="font-normal text-muted-foreground"> · {k.funkcija}</span>}
                  {/* Za koju lokaciju prima podsjetnike — bez ovoga se veza vidi tek
                      otvaranjem forme, pa je lako pomisliti da svi primaju sve. */}
                  <span
                    className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground"
                    data-testid={`kontakt-lokacija-bedz-${k.id}`}
                  >
                    {lokacije.find((l) => l.id === k.lokacija_id)?.naziv ?? t("lokacijaSve")}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <KontaktSheet klijentId={klijentId} kontakt={k} lokacije={lokacije} />
                  {mozeBrisati && (
                    <PotvrdiBrisanjeDialog
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label={t("obrisiAriaLabel")} data-testid={`obrisi-kontakt-${k.id}`}>
                          <Trash2 className="h-[18px] w-[18px] shrink-0 text-destructive" aria-hidden />
                        </Button>
                      }
                      naslov={t("obrisiDialogNaslov")}
                      opis={t("obrisiDialogOpis")}
                      onPotvrdi={() => obrisi(k.id)}
                      onUspjeh={() => router.refresh()}
                      testId="obrisi-kontakt-dialog"
                    />
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
    </div>
  )
}
