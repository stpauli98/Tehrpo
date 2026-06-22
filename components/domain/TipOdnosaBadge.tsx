import { cn } from "@/lib/utils"

export function TipOdnosaBadge({ tip }: { tip: "ugovor" | "ponuda" | null | undefined }) {
  if (!tip) return null
  const isUgovor = tip === "ugovor"
  return (
    <span
      data-testid="tip-odnosa-badge"
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        isUgovor
          ? "bg-blue-100 text-blue-700"
          : "bg-amber-100 text-amber-700"
      )}
    >
      {isUgovor ? "po ugovoru" : "po ponudi"}
    </span>
  )
}
