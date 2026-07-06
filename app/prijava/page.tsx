"use client"
import { useActionState } from "react"
import { useTranslations } from "next-intl"
import { prijaviSe, type ActionResult } from "./actions"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { APP_NAME, APP_INITIAL } from "@/lib/brand"
import { href } from "@/i18n/routes"

const initial: ActionResult = { ok: true }

export default function PrijavaPage() {
  const t = useTranslations("auth.prijava")
  const [state, action, pending] = useActionState(prijaviSe, initial)
  return (
    <div className="min-h-screen grid place-items-center bg-slate-50">
      <form action={action} className="w-80 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-brand text-white text-xs font-bold grid place-items-center">{APP_INITIAL}</div>
          <span className="font-semibold">{APP_NAME}</span>
        </div>
        <h1 className="text-lg font-medium">{t("naslov")}</h1>
        <Input name="email" type="email" placeholder={t("emailPlaceholder")} autoComplete="username" required />
        <Input name="lozinka" type="password" placeholder={t("lozinkaPlaceholder")} autoComplete="current-password" required />
        {state.ok === false && state.message && (
          <p className="text-sm text-status-kasni" role="alert">{state.message}</p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t("dugmeUToku") : t("dugme")}
        </Button>
        <a href={href("/zaboravljena-lozinka")} className="block text-center text-xs text-slate-500 hover:underline">
          {t("zaboravljenaLozinka")}
        </a>
      </form>
    </div>
  )
}
