# Aktivnost: keyset listanje + indeksirana pretraga

Datum: 2026-07-28
Grana: `perf/aktivnost-keyset-pretraga`
Status: dizajn odobren, implementacija nije počela

---

## 1. Cilj / Motivacija

Stranica `/aktivnost` je prestala da se učitava. RPC `get_aktivnost` traje ~9,5 s na DEMO-u, a
Supabase gasi upit `authenticated` roli na 8 s (`statement_timeout=8s` u `pg_roles`), pa stranica
padne na `GreskaUcitavanja`.

Cilj: vrijeme odgovora koje **ne zavisi od veličine `audit_log`-a**, uz punu istoriju — bez
arhiviranja, kompresije i particionisanja. Korisnik mora moći da pretražuje unazad i vidi ko je
šta i kad radio.

### 1.1 Uzrok

`get_aktivnost` je `language sql`, pa Postgres planira njeno tijelo samo po tipovima parametara,
bez stvarnih vrijednosti. Pet nagomilanih uslova oblika `(p_x is null or kolona = p_x)` sruše
procjenu na `rows=1`, planer izabere Nested Loop, i onda:

```
Nested Loop Left Join  (cost=… rows=1) (actual … rows=5440)
  ->  Seq Scan on audit_log a   (rows=5440)          Buffers: 5.759
  ->  Seq Scan on korisnici k   (loops=5440)         Buffers: 30.295
  ->  Seq Scan on klijenti kl   (loops=5440)         Buffers: 74.339
        Filter: ima_pristup_klijentu(id)
Execution Time: 9434 ms
```

`korisnici` i `klijenti` se skeniraju 5.440 puta, a RLS predikat `ima_pristup_klijentu()`
(SECURITY DEFINER) se izvrši ~70.000 puta.

Dva prateća problema koja bi ponovo srušila stranicu i s dobrim planom:

- `count(*) over ()` prolazi kroz **sve** filtrirane redove pri svakoj stranici → O(n) zauvijek.
- Pretraga je 9× `ILIKE '%tekst%'`, uključujući `staro::text`, `novo::text`, `detalji::text` —
  ne može koristiti nijedan indeks.

### 1.2 Izmjereno (DEMO, `mtwwotmwrasozmcgqwhc`, 5.444 reda, kao aktivan admin)

Sve mjereno kroz `pg` preko poolera, s `set role authenticated` + `request.jwt.claims`, dakle
identičnim putem kao aplikacija. Sve DDL izmjene su rađene u transakciji uz `rollback`.

| Upit | Sada | S ovim dizajnom |
|---|---|---|
| prva porcija, bez filtera | 9.688 ms → **timeout** | **3,2 ms** |
| sljedeća porcija (keyset) | — | **4,2 ms** |
| pretraga `Diorit` | u sklopu onih 9,5 s | **0,07 ms** |
| pretraga `obrisao` | u sklopu onih 9,5 s | **0,06 ms** |

PROD (`fqtqkehjidkzeasiegnq`, 3.333 reda) trenutno radi na **3.141 ms** — prolazi, ali je blizu
istog zida. Rast je kvadratan (3.333 → 3,1 s; 5.444 → 9,5 s), pa PROD puca oko ~5.000 redova.

---

## 2. Donesene odluke

| Odluka | Obrazloženje |
|---|---|
| **Bez kompresije, arhiviranja i particionisanja** | `audit_log` je 2,5 MB / 5.444 reda. Količina podataka nije uzrok. Arhiviranje bi dalo ~2× i pojelo baš istoriju koju treba sačuvati. |
| **Keyset paginacija, „Učitaj još"** | Konstantno vrijeme po porciji nezavisno od veličine tabele. Odabrano nad zadržavanjem brojeva stranica. |
| **Bez ukupnog broja zapisa** | `count(*) over ()` je jedini razlog zašto se prolazi kroz cijeli filtrirani skup. Nema ni približnog broja — UI ga ne prikazuje. |
| **RPC postaje SECURITY DEFINER, s `je_admin()` provjerom u prvoj liniji** | RLS sprečava korištenje trigram indeksa (§3.3). Jedna provjera umjesto 5.444. |
| **Dodaje se filter „Korisnik" u UI** | RPC već prima `p_korisnik`, samo nije izložen; direktno služi zahtjevu „ko je šta radio". |
| **Jedan PR, ne hitna zakrpa pa prepravka** | Sama popravka plana bi kupila mjesec-dva. |

---

## 3. Arhitektura

### 3.1 Generisane kolone i indeksi

`pg_trgm` je već instaliran, u šemi `public` (opclass je `public.gin_trgm_ops`, **ne**
`extensions.gin_trgm_ops` — provjereno; pogrešna šema obara migraciju).

Na `audit_log` se dodaju dvije `GENERATED ALWAYS … STORED` kolone. Obje su provjereno izvodive
(`jsonb::text` i `tekst_u_uuid()` jesu `IMMUTABLE`):

- **`pretraga_tekst text`** — `entitet`, `entitet_id`, `akcija`, `staro::text`, `novo::text`,
  `detalji::text` spojeni razmakom. Nosi GIN trigram indeks.
- **`klijent_ref uuid`** — klijent izvučen iz JSONB-a istom logikom koju danas ima
  `aktivnost_view`: za `entitet='klijenti'` iz `novo->>'id'` / `staro->>'id'` / `entitet_id`,
  inače iz `novo->>'klijent_id'` / `staro->>'klijent_id'`.

Indeksi:

| Indeks | Svrha |
|---|---|
| `gin (pretraga_tekst public.gin_trgm_ops)` | `ILIKE '%q%'` postaje indeksiran |
| `btree (klijent_ref)` | filtriranje po firmi kad pretraga pogodi naziv firme |
| `btree (vrijeme desc, id desc)` | keyset listanje |

Cijena: `audit_log` 2,5 MB → ~9 MB ukupno (indeksi 3,9 MB). GIN indeks se gradi za 664 ms na
5.444 reda.

Postojeći `idx_audit_vrijeme (vrijeme desc)` ostaje — koristi ga i `Plan aktivnosti`; novi
kompozitni ga ne zamjenjuje, nego pokriva keyset tie-break po `id`.

### 3.2 Nova RPC `get_aktivnost_strana`

Zamjenjuje `get_aktivnost` (jedini pozivalac je `lib/queries/aktivnost.ts`). Stara funkcija se
briše u istoj migraciji.

```
get_aktivnost_strana(
  p_od            timestamptz default null,
  p_do            timestamptz default null,
  p_korisnik      uuid        default null,
  p_akcija        text        default null,
  p_entitet       text        default null,
  p_pretraga      text        default null,
  p_prije_vrijeme timestamptz default null,   -- kursor
  p_prije_id      bigint      default null,   -- kursor, tie-break
  p_limit         int         default 50
) returns table (… iste kolone kao danas, bez `ukupno` …)
```

Ključne osobine:

1. **`language plpgsql` + `RETURN QUERY EXECUTE format(…)` s literalima (`%L`).** Planer vidi
   stvarne vrijednosti umjesto placeholder-a, pa procjene više ne padaju na `rows=1`. Ovo je
   jedini razlog za dinamički SQL — `%L` radi ispravno kvotovanje, nema injekcije.
2. **Keyset umjesto offset-a:** `where (vrijeme, id) < (p_prije_vrijeme, p_prije_id)` kad je
   kursor prisutan. Prva porcija ide bez tog uslova.
3. **Nema `count(*) over ()`.** RPC vraća tačno `p_limit` redova; sloj upita (`lib/queries`)
   traži `50 + 1` i po 51. redu zna da ima još, pa prikaže prvih 50.
4. **Join na `korisnici`/`klijenti` tek nad dohvaćenom porcijom**, ne nad cijelim logom.
   `klijent_ref` ovdje zamjenjuje `tekst_u_uuid(case …)` iz `aktivnost_view`.
5. **Pretraga** — pojam se prvo traži u malim tabelama, pa se log filtrira po id-evima:
   ```
   pretraga_tekst ilike '%q%'
   or korisnik_id = any (select id from korisnici where ime ilike '%q%' or email ilike '%q%')
   or klijent_ref = any (select id from klijenti where naziv ilike '%q%')
   ```
   `korisnici` (8 redova) i `klijenti` (13) su trivijalni za sken; prva grana ide kroz GIN indeks.
   Time pretraga i dalje pokriva ime korisnika i naziv firme, kao danas, ali indeksirano.

`aktivnost_view` se **briše**. Provjereno: nema nijednog pozivaoca u `lib/`, `app/`, `components/`,
`tests/` ni `scripts/`, a jedina druga migracija koja ga pominje
(`20260726122000_get_aktivni_korisnici_rpc.sql`) pominje ga samo u komentaru. Nova RPC ne treba
view jer join radi tek nad porcijom, a `klijent_ref` zamjenjuje `tekst_u_uuid(case …)` izraz.
`tekst_u_uuid()` ostaje — koristi ga generisana kolona.

### 3.3 Zašto SECURITY DEFINER

Pod RLS-om Postgres mora izvršiti sigurnosni predikat (`je_admin()`) prije korisničkih uslova,
a `ILIKE` (`~~*`) nije leakproof — pa ga ne smije spustiti u indeksni uslov. Posljedica: GIN
trigram indeks se **uopšte ne koristi**.

Izmjereno na istoj tabeli, isti upit, isti indeks:

| | pretraga `Diorit` | pretraga `obrisao` |
|---|---|---|
| pod RLS (`security invoker`) | 113 ms, Seq Scan | 111 ms, Seq Scan |
| bez RLS (vlasnik tabele) | **0,07 ms**, Bitmap Index Scan | **0,06 ms**, Bitmap Index Scan |

113 ms danas znači ~750 ms za godinu dana rada i ~2 s za tri — degradacija koja vraća isti
problem.

Zato je `get_aktivnost_strana` `SECURITY DEFINER` sa **eksplicitnim guard-om u prvoj liniji**:

```sql
if not je_admin() then
  raise exception 'nije dozvoljeno' using errcode = '42501';
end if;
```

Šta se **ne** mijenja:

- RLS na `audit_log` ostaje uključen; policy `audit_sel = je_admin()` ostaje. Direktan
  `select` iz PostgREST-a i dalje ne prolazi za ne-admina.
- Stranica `/aktivnost` i dalje radi `notFound()` za ne-admina (`page.tsx`).

Definer higijena, po presedanu `get_aktivni_korisnici` (`20260726122000`) — obavezna:

- `set search_path = public` u definiciji funkcije. Bez toga pozivalac može podmetnuti svoju
  šemu u `search_path` i preusmjeriti `audit_log`/`korisnici` na svoje tabele. Kod dinamičkog
  SQL-a ovo je utoliko važnije.
- `revoke execute on function get_aktivnost_strana(…) from public;` pa
  `grant execute … to authenticated;` — definer funkcija koja probija RLS nikad ne smije ostati
  dostupna `anon` roli. (Stara `get_aktivnost` je bila invoker i imala samo `grant`; nova mora
  imati i `revoke`.)

Garancija se dakle ne uklanja nego premješta: iz predikata koji se izvrši 5.444 puta u jednu
provjeru na ulazu. Rizik je da guard bude pogrešan ili kasnije uklonjen — pokriva ga E2E test
(§6) koji tvrdi da `operater` i `pregled` ne dobiju nijedan red.

### 3.4 Tok podataka

```
/aktivnost (server komponenta)
  → getTrenutniKorisnik() → notFound() ako nije admin
  → dohvatiAktivnostStranu({filteri, kursor: null})   ← prva porcija, SSR
       → rpc get_aktivnost_strana(…, p_limit = 50)
  → <AktivnostLista pocetna={…} filteri={…} />        ← client komponenta

„Učitaj još" (klijent)
  → GET /api/aktivnost?…filteri…&prijeVrijeme=…&prijeId=…
       → dohvatiAktivnostStranu({filteri, kursor})
  → dodaje porciju na kraj liste
```

Kursor je `(vrijeme, id)` posljednjeg prikazanog reda. Filteri i pretraga ostaju u URL-u; svaka
njihova promjena resetuje listu na prvu porciju (kursor `null`).

---

## 4. Šema baze

Dvije migracije, obje backward-compatible u smislu da ne diraju upis u `audit_log`:

### 4.1 `20260728120000_audit_pretraga_kolone.sql`

- `create extension if not exists pg_trgm;` (već postoji na DEMO i PROD — idempotentno)
- `alter table audit_log add column pretraga_tekst text generated always as (…) stored;`
- `alter table audit_log add column klijent_ref uuid generated always as (…) stored;`
- tri indeksa iz §3.1
- `analyze audit_log;`

Dodavanje `STORED` generisane kolone prepisuje tabelu i uzima `ACCESS EXCLUSIVE` lock. Na 5.444
reda / 2,5 MB to je ispod sekunde, pa je prihvatljivo bez posebnog prozora — ali **provjeriti
trajanje na DEMO-u prije PROD apply-a**.

### 4.2 `20260728121000_get_aktivnost_strana.sql`

- `create function get_aktivnost_strana(…)` po §3.2, sa `security definer set search_path = public`
- `revoke execute on function get_aktivnost_strana(…) from public;`
- `grant execute on function get_aktivnost_strana(…) to authenticated;`
- `drop function if exists get_aktivnost(timestamptz,timestamptz,uuid,text,text,text,int,int);`
- `drop view if exists aktivnost_view;` (poslije drop-a funkcije — funkcija zavisi od view-a)

Redoslijed puštanja: DEMO → provjera → PROD (lockstep, po `demo-prod-lockstep` pravilu).
Migracija 4.2 mora ići **poslije** 4.1 jer funkcija čita nove kolone. Aplikacija se deploy-uje
tek nakon što obje prođu na obje baze — u suprotnom stara aplikacija zove obrisanu funkciju.

Poslije migracija: `pnpm db:types`. Taj skript čita **lokalni** stack, ne cloud — dakle traži
`supabase start` + `pnpm db:reset` da bi nove migracije bile primijenjene lokalno prije
regenerisanja `db/types.ts`.

---

## 5. Moduli

| Fajl | Izmjena |
|---|---|
| `supabase/migrations/20260728120000_audit_pretraga_kolone.sql` | nov |
| `supabase/migrations/20260728121000_get_aktivnost_strana.sql` | nov |
| `lib/queries/aktivnost.ts` | `dohvatiAktivnost` → `dohvatiAktivnostStranu`; `AktivnostFilter` gubi `offset`, dobija `kursor`; `AktivnostRed` gubi `ukupno`; rezultat dobija `imaJos: boolean` |
| `app/api/aktivnost/route.ts` | nov — GET za „Učitaj još", isti filteri iz query stringa |
| `app/(dashboard)/aktivnost/page.tsx` | SSR prve porcije, bez `Pagination` i bez `ukupno`; prosljeđuje početnu porciju listi |
| `components/domain/AktivnostLista.tsx` | nova client komponenta — akumulira porcije, dugme „Učitaj još", `aria-live` za najavu novih redova |
| `components/domain/AktivnostTabela.tsx` | ostaje prikaz redova; lista je iznad njega |
| `components/domain/AktivnostFilteri.tsx` | dodaje se „Korisnik" select |
| `messages/{sr,en,de}.json` | `aktivnost.filteri.korisnik`, `aktivnost.ucitajJos`; **briše se** `aktivnost.ukupno`; paritet ključeva obavezan, bez ICU `one` za `sr` |
| `db/types.ts` | regenerisan |

`Pagination` komponenta se **ne** dira — koriste je drugi ekrani.

Lista korisnika za novi filter dolazi iz iste server komponente (`korisnici` je 8 redova, jedan
dodatni `select` u postojećem `Promise.all`).

---

## 6. Testiranje

**Unit (vitest)** — nema nove čiste domenske logike osim gradnje kursora; ako
`lib/aktivnost/kursor.ts` nastane, ide mu `*.test.ts`.

**E2E (playwright, `--workers=1`, DEMO)** — `tests/e2e/` :

1. Stranica se učita i prikaže prvu porciju od 50 redova.
2. „Učitaj još" dodaje sljedećih 50; nema duplikata (provjera po `id`).
3. Dugme nestaje kad porcija vrati manje od `p_limit` redova.
4. Pretraga po nazivu firme vraća redove te firme.
5. Pretraga po imenu korisnika vraća redove tog korisnika.
6. Pretraga po sadržaju izmjene (tekst iz `novo`) vraća očekivani red.
7. Filter „Korisnik" sužava listu.
8. Promjena filtera resetuje listu na prvu porciju.
9. **Sigurnost:** `operater` i `pregled` na `/aktivnost` dobiju `notFound()`; direktan poziv
   RPC-a kao `operater` vrati grešku `42501`, ne redove. Ovo je test guard-a iz §3.3 i ne smije
   se preskočiti.

**Ručna provjera performansi** prije merge-a: prva porcija i pretraga na DEMO-u ispod 50 ms.

---

## 7. Greške i rubni slučajevi

| Slučaj | Ponašanje |
|---|---|
| Nevažeći kursor u URL-u / query-ju | Ignoriše se, vraća se prva porcija (isti obrazac kao `isoDatum` sanitacija u `page.tsx`) |
| Novi zapis stigne između dvije porcije | Ne pojavljuje se — keyset gleda unazad od kursora. Ispravno: nema duplikata ni preskočenih redova, za razliku od offset paginacije |
| `p_pretraga` prazan string | Tretira se kao `null` (nema filtera) |
| RPC padne | `dohvatiAktivnostStranu` vraća `{ok:false}`, stranica prikazuje `GreskaUcitavanja` — postojeći S1 obrazac ostaje |
| Greška pri „Učitaj još" | Lista ostaje, dugme se vraća u aktivno stanje uz poruku; već učitano se ne gubi |
| Zapis bez `korisnik_id` (service-role akcije) | `korisnik_ime` ostaje `null`, red se prikazuje — nepromijenjeno |

---

## 8. Šta ovaj dizajn NE rješava

- **Audit gubi aktera za service-role akcije** — poznat gap iz `rls-audit-2026-07-11`; nije
  predmet ovog rada.
- **Retencija.** Log raste neograničeno. Pri ovom dizajnu to ne utiče na brzinu, ali će jednog
  dana biti pitanje prostora — ne sada.
- **Izvoz aktivnosti.** Nije traženo.
