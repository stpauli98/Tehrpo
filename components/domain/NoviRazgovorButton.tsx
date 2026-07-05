"use client"

import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"

export function NoviRazgovorButton() {
  const t = useTranslations("asistent.noviRazgovor")
  const router = useRouter()
  return (
    <Button
      variant="outline"
      data-testid="novi-razgovor"
      onClick={() => router.push(`/asistent?k=${crypto.randomUUID()}`)}
    >
      <Plus className="w-4 h-4" aria-hidden /> {t("dugme")}
    </Button>
  )
}
