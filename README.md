This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## `pnpm seed` — uvoz iz Excela BRIŠE podatke

`pnpm seed` nije čista dopuna. Prije uvoza briše `termini`, `klijent_provjere` i
`lokacije` (kaskadno i `podsjetnici`, `dokumenti`, `termin_zakazano_obavijest`,
`post_due_obavijesti`; fajlovi u Storage-u ostaju osirotjeli). Zato okruženje
mora biti navedeno **eksplicitno**, isto kao kod `pnpm db:apply-cloud`:

```bash
pnpm seed --lokalno                                  # lokalni `supabase start`
pnpm seed --demo                                     # DEMO baza
POTVRDI_PROD=da SEED_BRISI=da pnpm seed --prod       # PRODUKCIJA — dvije potvrde
```

Bez `--lokalno` / `--demo` / `--prod` skripta odbija rad. Guard radi **prije
ijednog upita** (i prije čitanja Excela): URL na koji bi se spojila mora stvarno
voditi na traženo okruženje (`zahtijevajCilj` iz `lib/supabase/refs.ts`), pa se
pogrešan cilj vidi prije nego što išta nestane. Prije prvog `DELETE`-a skripta
ispiše **koliko redova nestaje**, po tabeli.

Dodatne zastavice:

| Zastavica | Značenje |
| --- | --- |
| `--suho` | ništa ne mijenja — ispiše cilj i koliko bi redova nestalo, pa izađe |
| `--samo-brisanje` | uradi samo wipe, bez uvoza Excela |
| `--bez-brisanja` | preskoči wipe, uradi samo uvoz (nema gubitka podataka) |

Ako env fajl gađa drugu bazu od tražene, cilj se postavlja bez diranja `.env.local`:
`SUPABASE_URL_LOKALNO` / `SUPABASE_URL_DEMO` / `SUPABASE_URL_PROD` (i odgovarajući
`SUPABASE_SERVICE_ROLE_KEY_*`) imaju prednost nad `NEXT_PUBLIC_SUPABASE_URL`.

Poslije seed-a pokreni `pnpm gc:dokumenti` — brisanje termina ne briše fajlove iz
Storage-a.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
