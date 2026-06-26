"use client"
import { useActionState, useState } from "react"
import { kreirajKorisnika, type ActionResult } from "@/app/(dashboard)/postavke/actions"
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const initial: ActionResult = { ok: true }

export function NoviKorisnikButton() {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(kreirajKorisnika, initial)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">+ Novi korisnik</Button>} />
      <DialogContent>
        <DialogHeader><DialogTitle>Novi korisnik</DialogTitle></DialogHeader>
        <form action={action} className="space-y-3">
          <Input name="ime" placeholder="Ime i prezime" required />
          <Input name="email" type="email" placeholder="Email" required />
          <Input name="lozinka" type="password" placeholder="Početna lozinka (min 8)" required />
          <select name="uloga" defaultValue="operater" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
            <option value="operater">Operater</option>
            <option value="pregled">Pregled</option>
            <option value="admin">Administrator</option>
          </select>
          {state.ok === false && state.message && <p className="text-sm text-status-kasni" role="alert">{state.message}</p>}
          <Button type="submit" disabled={pending} className="w-full">{pending ? "Kreiranje…" : "Kreiraj"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
