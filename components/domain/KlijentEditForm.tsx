"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Pencil } from "lucide-react"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { updateKlijent, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"

const initial: ActionResult = { ok: true }

// Minimalni prop type — edit forma treba samo id/naziv/napomena/podsjetnik_emails (ne created_at/updated_at),
// pa nema rekonstrukcije iz nullable klijenti_view sa `!` asercijama.
export function KlijentEditForm({
  klijent,
}: {
  klijent: { id: string; naziv: string; napomena: string | null; podsjetnik_emails: string[]; tip_odnosa?: string | null }
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(updateKlijent, initial)
  const submitted = useRef(false)

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      setOpen(false)
      router.refresh()
    }
  }, [state, pending, router])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm" data-testid="uredi-klijent-btn">
            <Pencil className="w-3.5 h-3.5" aria-hidden /> Uredi
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="w-full lg:max-w-md flex flex-col"
        data-testid="klijent-edit-sheet"
      >
        <SheetHeader>
          <SheetTitle>Uredi klijenta</SheetTitle>
        </SheetHeader>

        <form
          key={klijent.id}
          action={(fd) => {
            submitted.current = true
            action(fd)
          }}
          className="flex-1 overflow-auto px-4 space-y-3"
          data-testid="klijent-edit-form"
        >
          <input type="hidden" name="id" value={klijent.id} />

          <label className="block text-sm">
            <span className="text-slate-600">Naziv *</span>
            <Input
              name="naziv"
              required
              defaultValue={klijent.naziv}
              data-testid="edit-klijent-naziv"
            />
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Napomena</span>
            <Input
              name="napomena"
              defaultValue={klijent.napomena ?? ""}
              data-testid="edit-klijent-napomena"
            />
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Primaoci podsjetnika (email, odvojeni zarezom)</span>
            <Input
              name="podsjetnik_emails"
              defaultValue={klijent.podsjetnik_emails.join(", ")}
              placeholder="npr. sef@firma.com, tehnicar@firma.com"
              data-testid="edit-klijent-primaoci"
            />
          </label>

          <div className="space-y-1">
            <span className="block text-sm text-slate-600">Tip odnosa</span>
            <Select
              name="tip_odnosa"
              defaultValue={klijent.tip_odnosa ?? "none"}
            >
              <SelectTrigger data-testid="klijent-tip-odnosa" className="w-full">
                <SelectValue placeholder="— (nije postavljeno)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— (nije postavljeno)</SelectItem>
                <SelectItem value="ugovor">Po ugovoru</SelectItem>
                <SelectItem value="ponuda">Po ponudi</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {state.ok === false && state.message && (
            <p className="text-sm text-red-600" role="alert">
              {state.message}
            </p>
          )}

          <Button type="submit" disabled={pending} data-testid="edit-klijent-submit">
            {pending ? "Spremam…" : "Spremi izmjene"}
          </Button>
        </form>

        <SheetFooter>
          <SheetClose render={<Button variant="outline">Otkaži</Button>} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
