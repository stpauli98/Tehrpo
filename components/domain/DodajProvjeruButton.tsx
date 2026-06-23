"use client"
import { Button } from "@/components/ui/button"

export function DodajProvjeruButton({
  klijentId, vrste, lokacije,
}: {
  klijentId: string
  vrste: { id: string; naziv: string; interval: number | null }[]
  lokacije: { id: string; naziv: string }[]
}) {
  void klijentId; void vrste; void lokacije
  return <Button data-testid="dodaj-provjeru-btn">Dodaj provjeru</Button>
}
