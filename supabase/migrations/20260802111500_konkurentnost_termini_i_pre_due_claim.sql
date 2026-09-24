-- B4 (02.08.2026.): konkurentnost — izgubljeno ažuriranje termina i dupli pre-due krug.
--
-- Dvije nezavisne trke, jedna migracija jer obje traže mrežu ISPOD aplikacije:
--
-- (1) MREŽA ISPOD updateTermin/markIzvrseno/otkaziTermin.
--     Sve tri akcije su read-modify-write bez transakcije i bez ijednog uslova na
--     status u samom UPDATE-u. Dokazano sa dvije psql sesije: „Označi izvršeno" i
--     „Spremi izmjene" u istoj sekundi ostave red u stanju koje po modelu NE POSTOJI
--     — status='planirano'/'zakazano' SA popunjenim datum_izvrsenja, uz već napravljen
--     sljedeći ciklus (tg_termini_auto_cycle je okinuo na prvi upis). Isto vrijedi za
--     otkazivanje izvršenog termina iz zastarjelog ekrana.
--     Guard u kodu (verzija preko updated_at + .neq/.is na status) je prva linija;
--     ovaj CHECK je posljednja — nijedan put upisa (akcija, skripta, ručni SQL, budući
--     trigger) ne može ostaviti datum izvršenja na terminu koji nije izvršen.
--     Smjer je namjerno JEDNOSTRAN (datum ⇒ izvršeno, ne i obrnuto): 'izvrseno' bez
--     datuma je legitimno prelazno stanje koje ne želimo zabraniti.
--     Provjereno na živim bazama PRIJE pisanja — nijedan red ne krši pravilo:
--       PROD: planirano 11/0 · zakazano 5/0 · izvrseno 13/13 · otkazano 1/0  (n / sa datumom)
--       DEMO: planirano 26/0 · zakazano 12/0 · izvrseno 20/20 · otkazano 2/0
--
-- (2) ATOMSKI CLAIM DNEVNOG PRE-DUE KRUGA.
--     Ruta /api/cron/reminders je marker `postavke.zadnje_slanje_datum` čitala na
--     POČETKU, a upisivala ga tek POSLIJE cijelog kruga (~50 s pri punom cap-u).
--     Svako preklapanje dva poziva u tom prozoru (Vercel retry, dva regiona, ručno
--     „Pokreni sada" preko cron-a) pokreće isti krug ponovo — a runReminders šalje
--     mejl PRIJE upisa u `podsjetnici`, pa unique tamo hvata duplikat tek nakon što
--     je drugi mejl već otišao klijentu.
--     Isti obrazac kao claim_post_due i claim_digest: „insert ... on conflict do update
--     ... where ... returning" PostgREST ne može izraziti, pa claim mora biti funkcija.
--     Prazan rezultat = krug već drži neko drugi → pozivalac preskače pre-due.
--     `insert` grana pokriva i bazu bez postavke reda (dosadašnja tolerancija rute na
--     nedostajući red: id ima default 1, sve ostale kolone imaju default).
--
-- Idempotentno i sigurno za ponovno pokretanje.

-- ── (1) Mreža ispod svega: datum izvršenja postoji samo na izvršenom terminu ──
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.termini'::regclass
      and conname  = 'chk_termini_datum_samo_izvrseno'
  ) then
    alter table public.termini
      add constraint chk_termini_datum_samo_izvrseno
      check (status = 'izvrseno' or datum_izvrsenja is null);
  end if;
end $$;

comment on constraint chk_termini_datum_samo_izvrseno on public.termini is
  'B4: datum_izvrsenja smije biti popunjen SAMO uz status=izvrseno. Hvata izgubljeno ažuriranje (paralelno „Spremi izmjene" + „Označi izvršeno") i otkazivanje već izvršenog termina.';

-- ── (2) Atomski claim dnevnog pre-due kruga ──────────────────────────────────
create or replace function claim_pre_due(p_datum date)
returns date
language sql
volatile
security invoker
set search_path = public
as $$
  insert into postavke (id, zadnje_slanje_datum)
  values (1, p_datum)
  on conflict (id) do update
    set zadnje_slanje_datum = excluded.zadnje_slanje_datum
    where postavke.zadnje_slanje_datum is distinct from excluded.zadnje_slanje_datum
  returning zadnje_slanje_datum;
$$;

comment on function claim_pre_due(date) is
  'Atomski zauzima dnevni pre-due krug za dati lokalni datum. Vraća datum kad je claim uspio, NULL kad je krug za taj dan već zauzet (isti obrazac kao claim_post_due/claim_digest).';

-- Claim smije samo cron/server put (service_role). Prijavljeni korisnik ne smije moći
-- ni zauzeti ni pomjeriti dnevni marker — time bi ugasio podsjetnike za taj dan.
revoke execute on function claim_pre_due(date) from public, anon, authenticated;
grant  execute on function claim_pre_due(date) to service_role;
