"use client"

import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { href } from "@/i18n/routes"

export function NoviRazgovorButton() {
  const t = useTranslations("asistent.noviRazgovor")
  const router = useRouter()
  return (
    <Button
      variant="outline"
      data-testid="novi-razgovor"
      onClick={() => router.push(href(`/asistent?k=${crypto.randomUUID()}`))}
    >
      <Plus className="h-[18px] w-[18px] shrink-0" aria-hidden /> {t("dugme")}
    </Button>
  )
}
