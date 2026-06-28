import { unstable_cache, revalidateTag } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

// Org-wide referentno: vrste provjera (svi korisnici vide iste).
// Service-role jer unstable_cache ne smije čitati cookies.
export const getCachedVrste = unstable_cache(
  async () => {
    const admin = createAdminSupabaseClient()
    const { data } = await admin
      .from("vrste_provjera")
      .select("id, naziv, podrazumevani_interval_mjeseci, zakonski_osnov, aktivna, vodi_dokumentaciju")
      .order("aktivna", { ascending: false })
      .order("naziv")
    return data ?? []
  },
  ["vrste-provjera"],
  { tags: ["vrste"], revalidate: 3600 },
)

export function revalidateVrste() {
  revalidateTag("vrste", "default")
}
