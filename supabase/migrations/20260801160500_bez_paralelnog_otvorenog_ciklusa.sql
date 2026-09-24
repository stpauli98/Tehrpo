-- N06 — auto-ciklus ne smije praviti PARALELAN otvoren ciklus iste obaveze.
--
-- Problem:
--   tg_termini_auto_cycle bezuslovno radi `insert into termini` čim termin pređe u
--   'izvrseno' (UPDATE) ili se odmah unese kao 'izvrseno' (INSERT, migracija
--   20260730170000). Ne provjerava postoji li VEĆ otvoren termin iste trojke
--   (klijent_id, lokacija_id, vrsta_provjere_id). Posljedica:
--     * istorijski unos ("odmah izvrseno") pored postojećeg otvorenog termina →
--       dva otvorena termina za istu obavezu;
--     * dupli klik / re-import istog nalaza → dva djeteta sa IDENTIČNIM rokom →
--       dva odvojena podsjetnika istog dana (get_due_podsjetnici vraća red po terminu,
--       a uq_podsjetnici_termin_dana_kanal deduplicira po termin_id, ne po obavezi).
--   PROD trag: CARMEUSE/Obilazak ×3 i TRANSFERA/Obilazak/RS ×2 otvorena termina.
--
-- Popravka ima dva sloja:
--   (1) KAPIJA PRIJE INSERTA — BEFORE INSERT trigger `bez_paralelnog_ciklusa` koji
--       ugasi SAMO ugniježđeni (trigerom generisan) insert ako za istu trojku već
--       postoji otvoren termin. `lokacija_id` se poredi sa `is not distinct from`
--       jer je nullable.
--   (2) BACKSTOP U BAZI — parcijalni UNIQUE indeks nad otvorenim ciklusnim terminima.
--
-- Zašto kapija NIJE ugrađena u tijelo tg_termini_auto_cycle():
--   N06 i N03 diraju isti nalaz. N03 mijenja tijelo tg_termini_auto_cycle()
--   (`create or replace function`) da jednokratni termin ne bi ciklovao. Da je kapija
--   upisana u to isto tijelo, redoslijed primjene bi odlučivao ko koga prepisuje.
--   Ovako se kapija kači na SAM INSERT u tabelu termini, pa radi identično bez obzira
--   da li je N03 primijenjen prije ili poslije ove migracije (i da li je uopšte
--   primijenjen). Razlikovanje "trigerom generisan insert" vs "korisnički insert" ide
--   preko pg_trigger_depth(): korisnički INSERT vidi depth = 1, insert izdat iz
--   tijela drugog trigera vidi depth >= 2. Korisničke unose kapija NE dira.
--
-- Re-run safe (idempotentno).

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) Kapija prije inserta
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function tg_termini_bez_paralelnog_ciklusa() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Samo ugniježđeni insert (izdat iz tijela drugog trigera, tj. auto-ciklus).
  -- Direktan korisnički unos ima pg_trigger_depth() = 1 i prolazi netaknut.
  if pg_trigger_depth() < 2 then
    return NEW;
  end if;

  if NEW.status not in ('planirano', 'zakazano') then
    return NEW;
  end if;

  if exists (
    select 1
    from termini t
    where t.klijent_id = NEW.klijent_id
      and t.vrsta_provjere_id = NEW.vrsta_provjere_id
      and t.lokacija_id is not distinct from NEW.lokacija_id
      and t.id is distinct from NEW.id
      and t.status in ('planirano', 'zakazano')
  ) then
    raise notice 'auto-ciklus preskocen: vec postoji otvoren termin (klijent=%, vrsta=%, lokacija=%)',
      NEW.klijent_id, NEW.vrsta_provjere_id, coalesce(NEW.lokacija_id::text, '(bez lokacije)');
    return null;  -- tiho odustajanje od inserta; roditeljski UPDATE/INSERT ostaje
  end if;

  return NEW;
end;
$$;

comment on function tg_termini_bez_paralelnog_ciklusa() is
  'N06: gasi trigerom generisan (pg_trigger_depth>=2) insert novog otvorenog termina '
  'ako za istu trojku (klijent, lokacija, vrsta) vec postoji otvoren termin. '
  'Direktne korisnicke unose ne dira.';

-- Ime počinje slovom 'b' → u BEFORE INSERT lancu ide prije postavi_kreirao /
-- tg_termini_compute_rok_biud / zatvaranje_trazi_nalaz (PG okida po abecedi),
-- pa se suvišan posao ne radi uopšte.
drop trigger if exists bez_paralelnog_ciklusa on termini;
create trigger bez_paralelnog_ciklusa
  before insert on termini
  for each row execute function tg_termini_bez_paralelnog_ciklusa();

-- ─────────────────────────────────────────────────────────────────────────────
-- (2) Backstop: parcijalni UNIQUE indeks
-- ─────────────────────────────────────────────────────────────────────────────
-- Opseg je NAMJERNO uži od kapije: `datum_zadnjeg is not null`.
--   * Ciklusni termin (dijete auto-ciklusa) UVIJEK ima datum_zadnjeg (= datum_izvrsenja
--     roditelja) — to je red koji ovaj indeks čuva jedinstvenim.
--   * Ad-hoc / jednokratni termin unesen kroz UI (NoviTerminDialog → actions.ts) šalje
--     samo rok_dospijeca i ostavlja datum_zadnjeg NULL. Takvi redovi ostaju IZVAN
--     indeksa, pa dvije zakazane "Obilazak" posjete istoj firmi i dalje rade.
--     Da je indeks postavljen na SVE otvorene termine, odmah bi pao na PROD-u:
--     CARMEUSE/Obilazak ima 3 otvorena, TRANSFERA/Obilazak/RS ima 2 — a to su ad-hoc
--     redovi bez intervala, ne paralelni ciklusi.
--   * `nulls not distinct` (PG15+) rješava nullable lokacija_id: dva reda sa
--     lokacija_id IS NULL se tretiraju kao ISTA vrijednost, u skladu sa
--     `is not distinct from` u kapiji.
--
-- Indeks se kreira SAMO ako je baza čista. Ako duplikata ima, migracija NE PADA nego
-- ispiše upozorenje — prvo ide sanacija, pa ponovno pokretanje ove migracije.
-- Stanje u trenutku pisanja: PROD 0 kršenja, DEMO 0 kršenja (u ovom, užem opsegu).
--
-- SANACIJA (ako upozorenje ispod ikad izađe) — pregled pa zatvaranje viška:
--   select klijent_id, vrsta_provjere_id, lokacija_id, array_agg(id order by created_at)
--   from termini
--   where status in ('planirano','zakazano') and datum_zadnjeg is not null
--   group by 1,2,3 having count(*) > 1;
--   -- zadržati NAJNOVIJI (najveći datum_zadnjeg), ostale prebaciti u 'otkazano':
--   -- update termini set status = 'otkazano' where id in (...);
do $$
declare
  v_krsenja int;
begin
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relname = 'uq_termini_otvoren_ciklus' and n.nspname = 'public'
  ) then
    raise notice 'uq_termini_otvoren_ciklus vec postoji — preskacem';
    return;
  end if;

  select count(*) into v_krsenja
  from (
    select 1
    from termini
    where status in ('planirano', 'zakazano')
      and datum_zadnjeg is not null
    group by klijent_id, vrsta_provjere_id, lokacija_id
    having count(*) > 1
  ) s;

  if v_krsenja > 0 then
    raise warning
      'N06: uq_termini_otvoren_ciklus NIJE kreiran — % grupa vec ima paralelne otvorene cikluse. '
      'Uradi sanaciju (vidi komentar iznad) pa ponovo pokreni ovu migraciju.', v_krsenja;
    return;
  end if;

  execute $ddl$
    create unique index uq_termini_otvoren_ciklus
      on termini (klijent_id, vrsta_provjere_id, lokacija_id)
      nulls not distinct
      where status in ('planirano', 'zakazano') and datum_zadnjeg is not null
  $ddl$;
  raise notice 'N06: uq_termini_otvoren_ciklus kreiran';
end;
$$;
