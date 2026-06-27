"use client"

import { useRouter } from "next/navigation"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const TABS = [
  { value: "id-karta", label: "ID karta" },
  { value: "termini", label: "Termini" },
  { value: "lokacije", label: "Lokacije" },
  { value: "kontakti", label: "Kontakti" },
  { value: "dokumenti", label: "Dokumenti" },
  { value: "profil", label: "Profil" },
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
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
