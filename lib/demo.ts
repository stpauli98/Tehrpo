// Demo režim: NIJEDAN mejl ne odlazi u mrežu; slanja se samo bilježe radi prikaza.
// Prekidač je po deployu (isti obrazac kao NEXT_PUBLIC_APP_NAME u lib/brand.ts) —
// pali se ISKLJUČIVO na DEMO Vercel projektu.
//
// Podrazumijevano ISKLJUČEN i namjerno strog na tačnu vrijednost "1": labava
// provjera (npr. bilo koji truthy string) znači da bi tipfeler u produkcijskom
// env-u tiho ugasio sve podsjetnike, bez ijedne poruke o grešci.
//
// NEXT_PUBLIC_ jer bedž u TopBar-u treba i klijentu; vrijednost se ugrađuje u build,
// pa se režim NE može mijenjati u toku rada.
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE?.trim() === "1"
