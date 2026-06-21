import { FileText } from "lucide-react"
import { ComingSoon } from "@/components/shell/ComingSoon"

export default function PregledPage() {
  return (
    <ComingSoon
      naslov="Pregled"
      faza="Faza 7"
      opis="Pregled i upravljanje AI-generisanim zapisnicima — download, re-generisanje i brisanje."
      icon={FileText}
    />
  )
}
