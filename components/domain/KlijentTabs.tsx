"use client"

import { useRouter } from "next/navigation"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { InfoIkona } from "@/components/ui/info-ikona"

const TABS = [
  {
    value: "id-karta",
    label: "ID karta",
    info: "Lična karta klijenta na jednom mjestu: osnovni podaci firme, ugovori, ključni kontakti i pregled ugovorenih usluga sa sljedećim rokovima.",
  },
  {
    value: "termini",
    label: "Termini",
    info: "Svi konkretni rokovi za ovog klijenta — prošli i budući. Svaki red je jedan termin sa datumom roka, statusom (planirano, zakazano, kasni, izvršeno) i zaduženom osobom. Termini se generišu iz provjera definisanih u Profilu.",
  },
  {
    value: "lokacije",
    label: "Lokacije",
    info: "Objekti i poslovne jedinice klijenta na kojima se vrše provjere i obilasci. Svaka lokacija može imati svoju adresu i kontakt osobu, a termini se mogu vezati za konkretnu lokaciju.",
  },
  {
    value: "kontakti",
    label: "Kontakti",
    info: "Sve kontakt osobe klijenta: kontakti firme (direktor, odgovorna lica…) i kontakti pojedinačnih lokacija. Kontakti lokacija se uređuju u tabu Lokacije.",
  },
  {
    value: "dokumenti",
    label: "Dokumenti",
    info: "Svi dokumenti vezani za klijenta — ručno dodati fajlovi i AI-generisani zapisnici. Kolona Izvor pokazuje da li je dokument nastao uploadom ili ga je generisao AI.",
  },
  {
    value: "profil",
    label: "Profil",
    info: "Definicija ponavljajućih provjera za klijenta: koja vrsta provjere se radi, na kojoj lokaciji i kojim intervalom. Iz ovih stavki se automatski generišu termini. „Zadnji put” je posljednje stvarno izvršenje, „Sljedeći rok” je rok aktivnog termina.",
  },
] as const

export function KlijentTabs({ activeTab, klijentId }: { activeTab: string; klijentId: string }) {
  const router = useRouter()
  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => router.push(`/klijenti/${klijentId}?tab=${v ?? "termini"}`)}
    >
      <TabsList variant="line">
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value} data-testid={`tab-${t.value}`}>
            {t.label}
            <InfoIkona tekst={t.info} testId={`info-tab-${t.value}`} />
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
