import { redirect } from "next/navigation"
import { buildRedirectHref } from "@/lib/plan-view"

export default async function PlanRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(buildRedirectHref("kalendar", await searchParams))
}
