"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export function NoviRazgovorButton() {
  const router = useRouter()
  return (
    <Button
      variant="outline"
      data-testid="novi-razgovor"
      onClick={() => router.push(`/asistent?k=${crypto.randomUUID()}`)}
    >
      + Novi razgovor
    </Button>
  )
}
