import { redirect } from "next/navigation"
import { href } from "@/i18n/routes"

export default function DashboardIndex() {
  redirect(href("/pregled"))
}
