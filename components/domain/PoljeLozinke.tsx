"use client"

import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn, FOCUS_RING } from "@/lib/utils"

/**
 * Polje za lozinku sa vidljivom labelom i show/hide prekidačem.
 *
 * Podržava oba režima:
 * - **kontrolisani** — `value` + `onChange` (MojNalogForm drži stanje da polja može
 *   isprazniti nakon uspješne promjene lozinke);
 * - **nekontrolisani** — `name` (+ opcioni `defaultValue`), za forme koje šalju
 *   `FormData` kroz form action (NoviKorisnikButton).
 *
 * `opisId` se prosljeđuje kao `aria-describedby` i postavlja se SAMO kad greška
 * polja postoji — id ugovor komponente `FieldError` (S2).
 */
export function PoljeLozinke({
  label,
  name,
  value,
  onChange,
  defaultValue,
  autoComplete,
  testid,
  required = true,
  minLength,
  opisId,
  prikaziLabela,
  sakrijLabela,
}: {
  label: string
  name?: string
  value?: string
  onChange?: (v: string) => void
  defaultValue?: string
  autoComplete: string
  testid: string
  required?: boolean
  minLength?: number
  opisId?: string
  prikaziLabela: string
  sakrijLabela: string
}) {
  const [prikazi, setPrikazi] = useState(false)
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div className="relative">
        <Input
          type={prikazi ? "text" : "password"}
          name={name}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          defaultValue={defaultValue}
          aria-describedby={opisId}
          className="pr-9"
          data-testid={testid}
        />
        <button
          type="button"
          onClick={() => setPrikazi((p) => !p)}
          aria-label={prikazi ? sakrijLabela : prikaziLabela}
          aria-pressed={prikazi}
          className={cn(
            "absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground",
            FOCUS_RING,
          )}
        >
          {prikazi ? (
            <EyeOff className="h-[18px] w-[18px]" aria-hidden />
          ) : (
            <Eye className="h-[18px] w-[18px]" aria-hidden />
          )}
        </button>
      </div>
    </label>
  )
}
