"use client"
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  bezbjedniSessionStorage,
  trebaPrikazatiDisklejmer,
  potvrdiDisklejmer,
} from "@/lib/demo-disklejmer"

// Prikazuje se jednom po prijavi (ključ briše /prijava na mount). Zatvaranje
// ISKLJUČIVO dugmetom: bez X-a (showCloseButton={false}), a Escape i klik van
// modala se ignorišu tako što onOpenChange ne prihvata zahtjev za zatvaranje.
// Gate na DEMO_MODE je na pozivaocu ({DEMO_MODE && ...}), kao kod DemoTraka.
export function DemoDisklejmer() {
  const t = useTranslations("shell.demoDisklejmer")
  const [otvoren, setOtvoren] = useState(false)

  // U efektu, ne u render fazi: sessionStorage postoji samo u browseru,
  // a i izbjegava se hydration razlika server/klijent.
  useEffect(() => {
    if (trebaPrikazatiDisklejmer(bezbjedniSessionStorage())) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- jednokratna inicijalizacija iz sessionStorage nakon mounta (isti obrazac kao Sidebar širina)
      setOtvoren(true)
    }
  }, [])

  const potvrdi = () => {
    potvrdiDisklejmer(bezbjedniSessionStorage())
    setOtvoren(false)
  }

  return (
    <Dialog
      open={otvoren}
      onOpenChange={(sljedece) => {
        if (sljedece) setOtvoren(true)
      }}
    >
      <DialogContent
        showCloseButton={false}
        data-testid="demo-disklejmer"
        className="max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{t("naslov")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>{t("pasus1")}</p>
          <p>{t("pasus2")}</p>
          <p>{t("pasus3")}</p>
        </div>
        <DialogFooter>
          <Button onClick={potvrdi} data-testid="demo-disklejmer-potvrdi">
            {t("dugme")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
