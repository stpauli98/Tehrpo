-- Dozvole brisanja po korisniku (potvrđeno sa naručiocem 30.07.2026.).
-- admin: sve, uvijek (prekidači se ne konsultuju).  pregled: ništa, uvijek.
-- operater: po prekidačima, i UVIJEK ograničen na dodijeljene firme (ima_pristup_klijentu).
-- Defaults su namjerno restriktivni osim `svoje` — operater smije ispraviti vlastitu grešku
-- bez posebnog odobrenja; sve ostalo admin pali svjesno.
-- Re-run safe.

alter table korisnici
  add column if not exists smije_brisati_svoje        boolean not null default true,
  add column if not exists smije_brisati_tudje        boolean not null default false,
  add column if not exists smije_brisati_klijente     boolean not null default false,
  add column if not exists smije_zatvoriti_bez_nalaza boolean not null default false;

comment on column korisnici.smije_brisati_svoje is 'Operater briše redove koje je sam unio (kreirao_id = auth.uid()).';
comment on column korisnici.smije_brisati_tudje is 'Operater briše tuđe redove na dodijeljenim firmama.';
comment on column korisnici.smije_brisati_klijente is 'Operater briše klijenta, ugovor i lokaciju.';
comment on column korisnici.smije_zatvoriti_bez_nalaza is 'Operater zatvara aktivnost kao izvršenu bez priloženog nalaza.';

-- ── Helperi ──────────────────────────────────────────────────────────────────
-- security definer: čitaju korisnici, koji ima self-select RLS.
create or replace function smije_brisati_zapis(p_kreirao uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when je_admin() then true
    when je_pregled() then false
    else exists (
      select 1 from korisnici k
      where k.id = auth.uid() and k.aktivan
        and case when p_kreirao is not distinct from auth.uid()
                 then k.smije_brisati_svoje
                 else k.smije_brisati_tudje end)
  end;
$$;

create or replace function smije_brisati_klijente() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when je_admin() then true
    when je_pregled() then false
    else exists (select 1 from korisnici k
                 where k.id = auth.uid() and k.aktivan and k.smije_brisati_klijente)
  end;
$$;

create or replace function smije_zatvoriti_bez_nalaza() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when je_admin() then true
    when je_pregled() then false
    else exists (select 1 from korisnici k
                 where k.id = auth.uid() and k.aktivan and k.smije_zatvoriti_bez_nalaza)
  end;
$$;

-- ── DELETE politike ──────────────────────────────────────────────────────────
-- termini/lokacije/ugovori/kontakt_osobe/klijent_provjere su do sada imali `for all`
-- politiku koja je pokrivala i DELETE. Razbijamo je na ins/upd (nepromijenjena semantika)
-- + zaseban del (novi uslov). Isti obrazac koji je 20260703100000 primijenio na dokumenti.

-- termini
drop policy if exists termini_wr on termini;
drop policy if exists termini_ins on termini;
drop policy if exists termini_upd on termini;
drop policy if exists termini_del on termini;
create policy termini_ins on termini for insert
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy termini_upd on termini for update
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy termini_del on termini for delete
  using ( ima_pristup_klijentu(klijent_id) and smije_brisati_zapis(kreirao_id) );

-- lokacije (dio "klijent, ugovor i lokacija" prekidača)
drop policy if exists lokacije_wr on lokacije;
drop policy if exists lokacije_ins on lokacije;
drop policy if exists lokacije_upd on lokacije;
drop policy if exists lokacije_del on lokacije;
create policy lokacije_ins on lokacije for insert
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy lokacije_upd on lokacije for update
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy lokacije_del on lokacije for delete
  using ( ima_pristup_klijentu(klijent_id) and smije_brisati_klijente() );

-- ugovori (dio istog prekidača)
drop policy if exists ugovori_wr on ugovori;
drop policy if exists ugovori_ins on ugovori;
drop policy if exists ugovori_upd on ugovori;
drop policy if exists ugovori_del on ugovori;
create policy ugovori_ins on ugovori for insert
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy ugovori_upd on ugovori for update
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy ugovori_del on ugovori for delete
  using ( ima_pristup_klijentu(klijent_id) and smije_brisati_klijente() );

-- klijenti
drop policy if exists klijenti_del on klijenti;
create policy klijenti_del on klijenti for delete
  using ( ima_pristup_klijentu(id) and smije_brisati_klijente() );

-- kontakt_osobe: vezane za klijenta, prate isti prekidač
drop policy if exists kontakt_wr on kontakt_osobe;
drop policy if exists kontakt_ins on kontakt_osobe;
drop policy if exists kontakt_upd on kontakt_osobe;
drop policy if exists kontakt_del on kontakt_osobe;
create policy kontakt_ins on kontakt_osobe for insert
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy kontakt_upd on kontakt_osobe for update
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy kontakt_del on kontakt_osobe for delete
  using ( ima_pristup_klijentu(klijent_id) and smije_brisati_klijente() );

-- klijent_provjere: veza klijent↔usluga, nije "zapis" ni "klijent" — prati brisanje zapisa
-- po vlasništvu bi tražilo kreirao_id i na njoj; drži se prekidača za klijente (uža kapija).
drop policy if exists kp_wr on klijent_provjere;
drop policy if exists kp_ins on klijent_provjere;
drop policy if exists kp_upd on klijent_provjere;
drop policy if exists kp_del on klijent_provjere;
create policy kp_ins on klijent_provjere for insert
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy kp_upd on klijent_provjere for update
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy kp_del on klijent_provjere for delete
  using ( ima_pristup_klijentu(klijent_id) and smije_brisati_klijente() );

-- dokumenti: 20260703100000 je DELETE svela na je_admin(). Naručilac je 30.07.2026. potvrdio
-- da operater smije brisati po prekidačima → proširujemo na isti helper (admin i dalje prolazi).
drop policy if exists dokumenti_del on dokumenti;
create policy dokumenti_del on dokumenti for delete
  using ( ima_pristup_klijentu(klijent_id) and smije_brisati_zapis(kreirao_id) );
