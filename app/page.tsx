import { redirect } from "next/navigation"
import { href } from "@/i18n/routes"

export default function RootPage() {
  redirect(href("/pregled"))
}
