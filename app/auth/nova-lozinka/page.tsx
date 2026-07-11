"use client"
import { useActionState } from "react"
import { useTranslations } from "next-intl"
import { postaviLozinku, type ActionResult } from "./actions"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const initial: ActionResult = { ok: true }

export default function NovaLozinkaPage() {
  const t = useTranslations("auth.novaLozinka")
  const [state, action, pending] = useActionState(postaviLozinku, initial)
  return (
    <div className="min-h-screen grid place-items-center bg-muted">
      <form action={action} className="w-80 rounded-xl border border-border bg-card p-6 space-y-4">
        <h1 className="text-lg font-medium">{t("naslov")}</h1>
        <Input name="lozinka" type="password" placeholder={t("lozinkaPlaceholder")} autoComplete="new-password" required />
        {state.ok === false && <p className="text-sm text-destructive" role="alert">{state.message}</p>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t("dugmeUToku") : t("dugme")}
        </Button>
      </form>
    </div>
  )
}
