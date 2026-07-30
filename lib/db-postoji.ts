/**
 * Pre-fetch pred brisanjem: postoji li red koji brišemo?
 *
 * Provjera je RLS-scoped: red na firmi koja korisniku nije dodijeljena čita se kao
 * „ne postoji", što mu je i tačno reći — ne odajemo postojanje zapisa na tuđim firmama.
 * Bez ovoga svako brisanje bez pogotka (dupli submit, ustajala stranica, neko drugi već
 * obrisao) tvrdi da je problem u dozvolama.
 *
 * Greška upita se VRAĆA, ne guta: pad lookup-a NIJE „nema reda". Isto pravilo koje
 * `app/(dashboard)/termini/actions.ts` (S1) već primjenjuje na svoj pre-fetch — ako se
 * provjera nije mogla obaviti, korisniku se ne smije reći da zapis ne postoji, jer nije
 * ni pokušano ništa. Pozivalac razlikuje tri ishoda: greška → poruka o grešci; `!postoji`
 * bez greške → „zapis ne postoji"; `postoji` → nastavi na DELETE.
 */
export type PostojanjeIshod = { postoji: boolean; greska: { code?: string | null; message?: string | null } | null }

export async function postojiRed(
  upit: PromiseLike<{
    data: { id: string } | null
    error: { code?: string | null; message?: string | null } | null
  }>,
): Promise<PostojanjeIshod> {
  const { data, error } = await upit
  if (error) return { postoji: false, greska: error }
  return { postoji: data !== null, greska: null }
}
