"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { DodjelaKlijenata } from "./DodjelaKlijenata"
import { PrimaPodsjetnikeToggle } from "./PrimaPodsjetnikeToggle"
import { UlogaSelect } from "./UlogaSelect"
import { KorisnikAkcije } from "./KorisnikAkcije"

type Uloga = "admin" | "operater" | "pregled"

type Korisnik = {
  id: string
  ime: string
  email: string
  uloga: Uloga
  aktivan: boolean
  prima_podsjetnike: boolean
  izabrani: string[]
}

function inicijali(ime: string): string {
  const d = ime.trim().split(/\s+/)
  return ((d[0]?.[0] ?? "") + (d[1]?.[0] ?? "")).toUpperCase() || "?"
}

export function KorisniciTabela({
  korisnici,
  klijenti,
  jaId,
}: {
  korisnici: Korisnik[]
  klijenti: { id: string; naziv: string }[]
  jaId?: string
}) {
  const t = useTranslations("postavke.korisniciTabela")
  const [q, setQ] = useState("")
  const upit = q.trim().toLowerCase()
  const vidljivi =
    upit === ""
      ? korisnici
      : korisnici.filter((k) => k.ime.toLowerCase().includes(upit) || k.email.toLowerCase().includes(upit))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-[18px] w-[18px] shrink-0 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("pretragaPlaceholder")}
            // pl-9 (a ne pl-8): ikona je narasla na 18px, uži padding bi je preklopio tekstom.
            className="pl-9"
            data-testid="korisnici-pretraga"
          />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {upit === "" ? t("brojUkupno", { count: korisnici.length }) : t("brojFiltrirano", { prikazano: vidljivi.length, ukupno: korisnici.length })}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">{t("kolone.korisnik")}</th>
              <th scope="col" className="px-4 py-2 font-medium">{t("kolone.uloga")}</th>
              <th scope="col" className="px-4 py-2 text-center font-medium">{t("kolone.podsjetnici")}</th>
              <th scope="col" className="px-4 py-2 font-medium">{t("kolone.firme")}</th>
              <th scope="col" className="w-12 px-4 py-2" aria-label={t("kolone.akcije")} />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {vidljivi.map((k) => {
              const jeJa = k.id === jaId
              const brFirmi = k.izabrani.length
              return (
                <tr key={k.id} className={cn(!k.aktivan && "bg-muted/60")}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold",
                          k.aktivan ? "bg-brand/10 text-brand" : "bg-muted text-muted-foreground",
                        )}
                        aria-hidden
                      >
                        {inicijali(k.ime)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn("truncate font-medium", !k.aktivan && "text-muted-foreground")}>{k.ime}</span>
                          {jeJa && <span className="text-xs text-muted-foreground">{t("ti")}</span>}
                          {!k.aktivan && (
                            <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                              {t("deaktiviran")}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{k.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <UlogaSelect korisnikId={k.id} uloga={k.uloga} jeJa={jeJa} />
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <PrimaPodsjetnikeToggle korisnikId={k.id} prima={k.prima_podsjetnike} />
                  </td>
                  <td className="px-4 py-2.5">
                    {k.uloga === "admin" ? (
                      <span className="text-xs text-muted-foreground" title={t("sveFirmeTitle")}>
                        {t("sveFirme")}
                      </span>
                    ) : (
                      <DodjelaKlijenata korisnikId={k.id} klijenti={klijenti} izabrani={k.izabrani} />
                    )}
                    {k.uloga !== "admin" && brFirmi === 0 && (
                      <span className="ml-2 text-xs text-warning">{t("nemaDodijeljenih")}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <KorisnikAkcije korisnikId={k.id} email={k.email} aktivan={k.aktivan} jeJa={jeJa} />
                  </td>
                </tr>
              )
            })}
            {vidljivi.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  {t("prazno", { upit: q })}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
