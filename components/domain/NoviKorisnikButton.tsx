"use client"
import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Plus } from "lucide-react"
import { kreirajKorisnika, type ActionResult } from "@/app/(dashboard)/postavke/actions"
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"

const initial: ActionResult = { ok: true }

export function NoviKorisnikButton() {
  const t = useTranslations("postavke.noviKorisnik")
  const tu = useTranslations("postavke.uloge")
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(kreirajKorisnika, initial)
  const submitted = useRef(false)

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      setOpen(false)
      router.refresh()
    }
  }, [state, pending, router])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm"><Plus className="w-4 h-4" aria-hidden /> {t("dugme")}</Button>} />
      <DialogContent>
        <DialogHeader><DialogTitle>{t("naslov")}</DialogTitle></DialogHeader>
        <form
          action={(fd) => {
            submitted.current = true
            action(fd)
          }}
          className="space-y-3"
        >
          <div>
            <Input name="ime" placeholder={t("placeholderIme")} required />
            {state.ok === false && state.errors?.ime && (
              <p className="text-sm text-status-kasni mt-1" role="alert">{state.errors.ime[0]}</p>
            )}
          </div>
          <div>
            <Input name="email" type="email" placeholder={t("placeholderEmail")} required />
            {state.ok === false && state.errors?.email && (
              <p className="text-sm text-status-kasni mt-1" role="alert">{state.errors.email[0]}</p>
            )}
          </div>
          <div>
            <Input name="lozinka" type="password" placeholder={t("placeholderLozinka")} required minLength={8} />
            {state.ok === false && state.errors?.lozinka && (
              <p className="text-sm text-status-kasni mt-1" role="alert">{state.errors.lozinka[0]}</p>
            )}
          </div>
          <Select
            name="uloga"
            defaultValue="operater"
            items={{ operater: tu("operater"), pregled: tu("pregled"), admin: tu("admin") }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="operater">{tu("operater")}</SelectItem>
              <SelectItem value="pregled">{tu("pregled")}</SelectItem>
              <SelectItem value="admin">{tu("admin")}</SelectItem>
            </SelectContent>
          </Select>
          {state.ok === false && state.message && (
            <p className="text-sm text-status-kasni" role="alert">{state.message}</p>
          )}
          <Button type="submit" disabled={pending} className="w-full">{pending ? t("submitPending") : t("submit")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
