"use client"
import { Suspense } from "react"
import { useActionState } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { posaljiReset, type ActionResult } from "./actions"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { href } from "@/i18n/routes"

const initial: ActionResult = { ok: false }

function ZaboravljenaLozinkaForm() {
  const t = useTranslations("auth.zaboravljenaLozinka")
  const [state, action, pending] = useActionState(posaljiReset, initial)
  const istekao = useSearchParams().get("greska") === "istekao"
  return (
    <div className="min-h-screen grid place-items-center bg-muted">
      <form action={action} className="w-80 rounded-xl border border-border bg-card p-6 space-y-4">
        <h1 className="text-lg font-medium">{t("naslov")}</h1>
        {istekao && (
          <p className="text-sm text-amber-700" role="alert">
            {t("linkIstekao")}
          </p>
        )}
        <Input name="email" type="email" placeholder={t("emailPlaceholder")} required />
        {state.message && <p className="text-sm text-muted-foreground" role="status">{state.message}</p>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t("dugmeUToku") : t("dugme")}
        </Button>
        <Link href={href("/prijava")} className="block text-center text-xs text-muted-foreground hover:underline">{t("nazadNaPrijavu")}</Link>
      </form>
    </div>
  )
}

export default function ZaboravljenaLozinkaPage() {
  return (
    <Suspense fallback={null}>
      <ZaboravljenaLozinkaForm />
    </Suspense>
  )
}
