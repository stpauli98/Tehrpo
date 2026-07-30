import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { smijePreuzeti } from "@/lib/auth/roles"

/**
 * Server-only guard: smije li tekući korisnik iznositi podatke (preuzimanje, izvoz)?
 * `pregled` smije SAMO čitati na ekranu — potvrđeno sa naručiocem 30.07.2026.
 * Vraća true/false umjesto da baca, jer svaka ruta ima svoj i18n tekst i status.
 */
export async function smijeTrenutniPreuzeti(): Promise<boolean> {
  const ja = await getTrenutniKorisnik()
  return !!ja && smijePreuzeti(ja.uloga)
}
