-- supabase/migrations/20260801093000_za_brisanje_iz_storagea.sql
-- Nalaz N07: kaskadno brisanje odnosi red iz `dokumenti`, ali NIKAD fajl iz bucketa.
--
-- ŠTA JE RUPA
-- `removeDokument()` se zove sa TAČNO jednog mjesta (app/(dashboard)/dokumenti/actions.ts:213 —
-- brisanje pojedinačnog dokumenta) i iz rollback grana upload-a. Svi ostali putevi brišu redove
-- `dokumenti` KASKADNO, iz baze, bez ijedne linije aplikacijskog koda:
--   dokumenti.termin_id  -> termini(id)  on delete cascade
--   dokumenti.klijent_id -> klijenti(id) on delete cascade
-- Kaskada je posao Postgresa; TypeScript o njoj ne sazna ništa i fajl ostaje u bucketu zauvijek,
-- nedostupan iz aplikacije (jedini put do fajla je `dokumenti.storage_path`, kojeg više nema).
-- Izmjereno na DEMO 01.08.2026: 28 od 58 objekata (48%) u `tehpro-dokumenti` je bez reda.
--
-- ZAŠTO POPRAVKA IDE U BAZU, A NE U KOD
-- Popravka u kodu bi morala pogoditi svaki put brisanja posebno (brisanje klijenta, brisanje
-- termina, dedup skripte, ručni SQL, budući ekrani) i tiho bi zaostajala za svakim novim putem.
-- Kaskadu vidi samo onaj ko je izvršava — Postgres. Zato triger na `dokumenti` hvata SVE puteve
-- odjednom, uključujući direktan `delete from termini` iz psql-a.
--
-- MEHANIZAM
-- `after delete` triger upisuje `storage_path` u red čekanja `za_brisanje_iz_storagea`. Red
-- OSTAJE dok ga potrošač (noćno metenje, app/api/cron/ciscenje-storagea) ne obriše iz bucketa i
-- ne zatvori. Upis je u ISTOJ transakciji kao i brisanje reda: ako se brisanje povuče
-- (rollback), povlači se i zapis — nikad se ne zabilježi fajl čiji red i dalje postoji.
--
-- Migracija je idempotentna (create ... if not exists / create or replace / drop ... if exists).

-- ───────────────────────── 1) Red čekanja ─────────────────────────
-- `storage_path` JE primarni ključ, ne surogat uuid: red čekanja je SKUP putanja koje treba
-- obrisati iz bucketa, a ista putanja se ne briše dvaput. Ponovno bilježenje iste putanje
-- (fajl ponovo upload-ovan pa opet obrisan) je `on conflict do update`, ne novi red.
--
-- NEMA FK ni na `dokumenti` ni na `klijenti`: cijela svrha reda je da PREŽIVI brisanje tih
-- redova. `dokument_id` / `klijent_id` su forenzika (šta je bilo, čije je bilo), ne reference.
create table if not exists za_brisanje_iz_storagea (
  storage_path text        primary key,
  dokument_id  uuid        not null,
  klijent_id   uuid,
  izvor        text        not null default 'brisanje_dokumenta',
  trazio_id    uuid,
  trazeno_at   timestamptz not null default now(),
  constraint chk_zbs_izvor check (izvor in ('brisanje_dokumenta','zatecen')),
  constraint chk_zbs_putanja check (length(btrim(storage_path)) > 0)
);

comment on table za_brisanje_iz_storagea is
  'N07: red čekanja fajlova iz bucketa tehpro-dokumenti čiji je red u `dokumenti` obrisan '
  '(najčešće kaskadom). Puni ga triger `zabiljezi_brisanje_fajla`; prazni ga metenje '
  '(app/api/cron/ciscenje-storagea) TEK nakon što storage potvrdi uklanjanje.';
comment on column za_brisanje_iz_storagea.izvor is
  '`brisanje_dokumenta` = zabilježio triger u trenutku DELETE-a (dokaz, ne pretpostavka). '
  '`zatecen` = ručno unesen zaostatak nastao PRIJE ovog trigera (v. N07-plan.md) — takav red '
  'traži ljudski pregled prije nego što se metenje pusti na njega.';
comment on column za_brisanje_iz_storagea.trazio_id is
  'auth.uid() u trenutku brisanja; NULL kad je brisanje došlo iz service-role posla ili psql-a.';

-- ───────────────────────── 2) RLS ─────────────────────────
-- KRITIČNO: cloud event trigger uključuje RLS na svakoj novoj public tabeli, pa tabela bez
-- polise tiho vraća 0 redova. Uključujemo ga EKSPLICITNO (lokal == cloud) i odmah dodajemo
-- polisu, u istoj migraciji.
alter table za_brisanje_iz_storagea enable row level security;

drop policy if exists zbs_sel on za_brisanje_iz_storagea;
-- Čitanje: samo admin. Red čekanja otkriva putanje tuđih dokumenata (a putanja je, po nalazu
-- N01, sama po sebi ključ do fajla), pa ovdje NEMA operatera ni `pregled` uloge.
create policy zbs_sel on za_brisanje_iz_storagea for select using ( je_admin() );
-- Namjerno BEZ insert/update/delete polise: kroz PostgREST se u ovaj red ne smije pisati.
-- Puni ga isključivo triger (security definer, vlasnik tabele → zaobilazi RLS), a prazni ga
-- metenje preko service-role ključa (koji takođe zaobilazi RLS). Da polisa za pisanje postoji,
-- operater bi mogao ubaciti proizvoljnu putanju i time naručiti brisanje tuđeg fajla.

-- ───────────────────────── 3) Triger ─────────────────────────
-- `after delete`, ne `before`: red je tada već otišao, pa provjera „ima li još neko ovaj fajl"
-- ispod ne mora ručno da isključuje sam OLD red. Efekat je isti — obje varijante su u istoj
-- transakciji kao i DELETE, pa se pri rollback-u povlači i zapis.
create or replace function tg_zabiljezi_brisanje_fajla()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- `storage_path` je `not null`, ali prazan string bi u redu čekanja značio „obriši prefiks",
  -- što je najgori mogući oblik greške u bucketu. Odbacuje se tiho.
  if OLD.storage_path is null or btrim(OLD.storage_path) = '' then
    return null;
  end if;

  -- Ista putanja može biti na više redova (`dokumenti.storage_path` nema unique constraint —
  -- 20260620201156_supporting_tables.sql:12). Dok je ŽIV bar jedan red s tom putanjom, fajl je
  -- u upotrebi i ne smije se naći u redu za brisanje. Kod kaskade koja briše sve takve redove
  -- ovaj uslov je tačan za sve osim za posljednji, pa se putanja zabilježi tačno jednom.
  if exists (select 1 from dokumenti d where d.storage_path = OLD.storage_path) then
    return null;
  end if;

  insert into za_brisanje_iz_storagea (storage_path, dokument_id, klijent_id, izvor, trazio_id)
  values (OLD.storage_path, OLD.id, OLD.klijent_id, 'brisanje_dokumenta', auth.uid())
  on conflict (storage_path) do update
    set dokument_id = excluded.dokument_id,
        klijent_id  = excluded.klijent_id,
        izvor       = excluded.izvor,
        trazio_id   = excluded.trazio_id,
        trazeno_at  = now();

  return null; -- povratna vrijednost `after` trigera se ignoriše
end $$;

comment on function tg_zabiljezi_brisanje_fajla() is
  'N07: bilježi storage_path obrisanog dokumenta u red čekanja za brisanje iz bucketa. '
  'Hvata SVE puteve brisanja, uključujući kaskadu iz `termini`/`klijenti` koju aplikacija ne vidi.';

drop trigger if exists zabiljezi_brisanje_fajla on dokumenti;
create trigger zabiljezi_brisanje_fajla
after delete on dokumenti
for each row execute function tg_zabiljezi_brisanje_fajla();

-- ───────────────────────── 4) Indeks na storage_path ─────────────────────────
-- Triger radi `exists (... where storage_path = ...)` po SVAKOM obrisanom redu; bez indeksa je
-- to seq scan po `dokumenti` puta broj redova u kaskadi. Isti indeks pokriva i `order by
-- storage_path` u keyset paginaciji `svePutanjeUBazi` (lib/dokumenti/popis.ts), gdje je
-- nedostatak indeksa već bio zabilježen kao poznat trošak.
-- NIJE unique — duplikati putanje su danas mogući i ova migracija ih ne zabranjuje (to bi bila
-- zasebna odluka s migracijom podataka).
create index if not exists idx_dokumenti_storage_path on dokumenti (storage_path);

-- ───────────────────────── 5) Zaostatak PRIJE trigera ─────────────────────────
-- Triger hvata samo brisanja OD SADA. Fajlovi osirotjeli ranije (DEMO 28, PROD 1 na dan
-- 01.08.2026) nemaju zapis i metenje ih vidi samo kao izvedene kandidate.
-- Backfill se NAMJERNO ne izvršava automatski: bucket drži zakonski obavezne zapisnike ZNR,
-- a „nema reda u bazi" može značiti i da je red izgubljen greškom — tada je fajl JEDINI
-- preostali primjerak i upis u red za brisanje bi ga osudio. Zaostatak se unosi ručno, nakon
-- pregleda liste; upit je opisan u opisu PR-a.
