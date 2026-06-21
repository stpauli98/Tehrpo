import { Bot } from "lucide-react"
import { ComingSoon } from "@/components/shell/ComingSoon"

export default function AsistentPage() {
  return (
    <ComingSoon
      naslov="Asistent"
      faza="Faza 8"
      opis="AI asistent sa Claude API-jem za upite o terminima i automatsko generisanje zapisnika."
      icon={Bot}
    />
  )
}
