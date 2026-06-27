import { redirect } from "next/navigation"
import { buildRedirectHref } from "@/lib/plan-view"

export default async function PrikazRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(buildRedirectHref("matrica", await searchParams))
}
