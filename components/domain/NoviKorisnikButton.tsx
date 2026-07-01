"use client"
import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { kreirajKorisnika, type ActionResult } from "@/app/(dashboard)/postavke/actions"
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const initial: ActionResult = { ok: true }

export function NoviKorisnikButton() {
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
      <DialogTrigger render={<Button size="sm"><Plus className="w-4 h-4" aria-hidden /> Novi korisnik</Button>} />
      <DialogContent>
        <DialogHeader><DialogTitle>Novi korisnik</DialogTitle></DialogHeader>
        <form
          action={(fd) => {
            submitted.current = true
            action(fd)
          }}
          className="space-y-3"
        >
          <div>
            <Input name="ime" placeholder="Ime i prezime" required />
            {state.ok === false && state.errors?.ime && (
              <p className="text-sm text-status-kasni mt-1" role="alert">{state.errors.ime[0]}</p>
            )}
          </div>
          <div>
            <Input name="email" type="email" placeholder="Email" required />
            {state.ok === false && state.errors?.email && (
              <p className="text-sm text-status-kasni mt-1" role="alert">{state.errors.email[0]}</p>
            )}
          </div>
          <div>
            <Input name="lozinka" type="password" placeholder="Početna lozinka (min 8)" required minLength={8} />
            {state.ok === false && state.errors?.lozinka && (
              <p className="text-sm text-status-kasni mt-1" role="alert">{state.errors.lozinka[0]}</p>
            )}
          </div>
          <select name="uloga" defaultValue="operater" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
            <option value="operater">Operater</option>
            <option value="pregled">Pregled</option>
            <option value="admin">Administrator</option>
          </select>
          {state.ok === false && state.message && (
            <p className="text-sm text-status-kasni" role="alert">{state.message}</p>
          )}
          <Button type="submit" disabled={pending} className="w-full">{pending ? "Kreiranje…" : "Kreiraj"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
