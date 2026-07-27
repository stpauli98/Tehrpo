import { Skeleton } from "@/components/ui/skeleton"

/**
 * Skeleton prati STVARNI raspored stranice (S16): naslov + opis, pa filter red
 * (label `text-sm` = h-5 iznad kontrole `h-8`, dva checkbox reda i dva dugmeta),
 * pa blok tabele.
 */
export default function PoslatiMejloviLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-10" />
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-14" />
          <Skeleton className="h-8 w-44" />
        </div>
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-8" />
          <Skeleton className="h-8 w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-8" />
          <Skeleton className="h-8 w-40" />
        </div>
        <div className="flex h-8 items-center gap-2">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex h-8 items-center gap-2">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-28" />
        </div>
        <Skeleton className="h-8 w-20" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
