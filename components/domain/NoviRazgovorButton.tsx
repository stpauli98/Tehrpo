"use client"

import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"

export function NoviRazgovorButton() {
  const router = useRouter()
  return (
    <Button
      variant="outline"
      data-testid="novi-razgovor"
      onClick={() => router.push(`/asistent?k=${crypto.randomUUID()}`)}
    >
      <Plus className="w-4 h-4" aria-hidden /> Novi razgovor
    </Button>
  )
}
