"use client"

import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { InfoIkona } from "@/components/ui/info-ikona"
import { href } from "@/i18n/routes"

const TABS = [
  { value: "id-karta", labelKey: "idKarta" },
  { value: "termini", labelKey: "termini" },
  { value: "lokacije", labelKey: "lokacije" },
  { value: "kontakti", labelKey: "kontakti" },
  { value: "dokumenti", labelKey: "dokumenti" },
  { value: "podsjetnici", labelKey: "podsjetnici" },
  { value: "profil", labelKey: "profil" },
] as const

export function KlijentTabs({ activeTab, klijentId }: { activeTab: string; klijentId: string }) {
  const t = useTranslations("klijenti.tabs")
  const router = useRouter()
  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => router.push(href(`/klijenti/${klijentId}?tab=${v ?? "termini"}`))}
    >
      <TabsList variant="line">
        {TABS.map((tab, i) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            data-testid={`tab-${tab.value}`}
            aria-describedby={`info-tab-desc-${tab.value}`}
          >
            {t(`${tab.labelKey}.label`)}
            {/* AT dobija objašnjenje preko aria-describedby → sr-only span (NE native `title`,
                koji bi se duplirao sa CSS tooltip-om ⓘ ikone). Zadnji tab: desno poravnanje
                (na 1024px bi bubble prešao desnu ivicu). dekorativno: ikona ostaje aria-hidden
                da ne pravi zaseban tab-stop niti zagadi accessible name TabsTrigger-a. */}
            <span id={`info-tab-desc-${tab.value}`} className="sr-only">{t(`${tab.labelKey}.info`)}</span>
            <InfoIkona
              tekst={t(`${tab.labelKey}.info`)}
              testId={`info-tab-${tab.value}`}
              strana={i === TABS.length - 1 ? "desno" : undefined}
              dekorativno
            />
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
