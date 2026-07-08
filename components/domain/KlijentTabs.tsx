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
          <TabsTrigger key={tab.value} value={tab.value} data-testid={`tab-${tab.value}`}>
            {t(`${tab.labelKey}.label`)}
            {/* Zadnji (najdesniji) tab: desno poravnanje — na 1024px bi mu bubble prešao desnu ivicu main-a */}
            <InfoIkona
              tekst={t(`${tab.labelKey}.info`)}
              testId={`info-tab-${tab.value}`}
              strana={i === TABS.length - 1 ? "desno" : undefined}
            />
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
