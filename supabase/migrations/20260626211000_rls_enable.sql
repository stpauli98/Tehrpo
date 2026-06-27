-- EPIK A — Task 11: uključi RLS po dodjeli (BREAKING).
-- Korigovano prema STVARNOM stanju cloud baze (introspekcija 2026-06-26):
--   * NEMA tabele `obilasci` (Obilasci = termini sa vrstom "Obilazak") → bez obilasci politika.
--   * korisnici/korisnik_klijent/audit_log VEĆ imaju RLS=true (agentov eksperiment) ali BEZ
--     ijedne politike → trenutno user-scoped read korisnici vraća prazno (default-deny).
--     Ova migracija dodaje politike i time POPRAVLJA taj polom.
-- Re-run safe: drop policy if exists prije svakog create; enable RLS je idempotentan.

-- ───────────────────────── A) Viewovi → security_invoker ─────────────────────────
-- Bez ovoga viewovi zaobilaze RLS (izvršavaju se s privilegijama vlasnika).
alter view termini_view  set (security_invoker = on);
alter view klijenti_view set (security_invoker = on);

-- ───────────────────────── B) Tabele vezane za klijenta ─────────────────────────
alter table klijenti         enable row level security;
alter table lokacije         enable row level security;
alter table termini          enable row level security;
alter table dokumenti        enable row level security;
alter table podsjetnici      enable row level security;
alter table klijent_provjere enable row level security;

-- klijenti (klijent_id = id)
drop policy if exists klijenti_sel on klijenti;
drop policy if exists klijenti_ins on klijenti;
drop policy if exists klijenti_upd on klijenti;
drop policy if exists klijenti_del on klijenti;
create policy klijenti_sel on klijenti for select using ( ima_pristup_klijentu(id) );
create policy klijenti_ins on klijenti for insert with check ( auth.uid() is not null and not je_pregled() );
create policy klijenti_upd on klijenti for update using ( ima_pristup_klijentu(id) and not je_pregled() )
                                       with check ( ima_pristup_klijentu(id) and not je_pregled() );
create policy klijenti_del on klijenti for delete using ( ima_pristup_klijentu(id) and not je_pregled() );

-- Auto-dodjela kreatora: kad ne-admin kreira klijenta, dodaj mu korisnik_klijent red
-- da ga odmah vidi (admin ionako vidi sve).
create or replace function tg_klijent_auto_dodjela() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not je_admin() then
    insert into korisnik_klijent (korisnik_id, klijent_id)
    values (auth.uid(), NEW.id)
    on conflict do nothing;
  end if;
  return NEW;
end; $$;
drop trigger if exists klijent_auto_dodjela on klijenti;
create trigger klijent_auto_dodjela after insert on klijenti
  for each row execute function tg_klijent_auto_dodjela();

-- lokacije (klijent_id)
drop policy if exists lokacije_sel on lokacije;
drop policy if exists lokacije_wr on lokacije;
create policy lokacije_sel on lokacije for select using ( ima_pristup_klijentu(klijent_id) );
create policy lokacije_wr  on lokacije for all
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );

-- termini (klijent_id)
drop policy if exists termini_sel on termini;
drop policy if exists termini_wr on termini;
create policy termini_sel on termini for select using ( ima_pristup_klijentu(klijent_id) );
create policy termini_wr  on termini for all
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );

-- klijent_provjere (klijent_id)
drop policy if exists kp_sel on klijent_provjere;
drop policy if exists kp_wr on klijent_provjere;
create policy kp_sel on klijent_provjere for select using ( ima_pristup_klijentu(klijent_id) );
create policy kp_wr  on klijent_provjere for all
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );

-- dokumenti (preko termin_id → termini.klijent_id)
drop policy if exists dokumenti_sel on dokumenti;
drop policy if exists dokumenti_wr on dokumenti;
create policy dokumenti_sel on dokumenti for select using (
  exists (select 1 from termini t where t.id = dokumenti.termin_id and ima_pristup_klijentu(t.klijent_id)) );
create policy dokumenti_wr on dokumenti for all using (
  exists (select 1 from termini t where t.id = dokumenti.termin_id and ima_pristup_klijentu(t.klijent_id)) and not je_pregled()
) with check (
  exists (select 1 from termini t where t.id = dokumenti.termin_id and ima_pristup_klijentu(t.klijent_id)) and not je_pregled() );

-- podsjetnici (preko termin_id → termini.klijent_id); upis radi cron (service role, bypass)
drop policy if exists podsjetnici_sel on podsjetnici;
create policy podsjetnici_sel on podsjetnici for select using (
  exists (select 1 from termini t where t.id = podsjetnici.termin_id and ima_pristup_klijentu(t.klijent_id)) );

-- ───────────────────────── C) Katalog / postavke ─────────────────────────
alter table vrste_provjera enable row level security;
alter table postavke       enable row level security;
drop policy if exists vrste_sel on vrste_provjera;
drop policy if exists vrste_wr on vrste_provjera;
create policy vrste_sel on vrste_provjera for select using ( auth.uid() is not null );
create policy vrste_wr  on vrste_provjera for all using ( je_admin() ) with check ( je_admin() );
drop policy if exists postavke_sel on postavke;
drop policy if exists postavke_wr on postavke;
create policy postavke_sel on postavke for select using ( auth.uid() is not null );
create policy postavke_wr  on postavke for all using ( je_admin() ) with check ( je_admin() );

-- ───────────────────────── D) Korisnici / dodjela (RLS već enabled, dodaj politike) ──────────────
alter table korisnici        enable row level security;
alter table korisnik_klijent enable row level security;
drop policy if exists korisnici_sel on korisnici;
drop policy if exists korisnici_wr on korisnici;
-- KLJUČNO: self-select (id = auth.uid()) — bez ovoga getTrenutniKorisnik/proxy aktivan ne rade.
create policy korisnici_sel on korisnici for select using ( id = auth.uid() or je_admin() );
create policy korisnici_wr  on korisnici for all    using ( je_admin() ) with check ( je_admin() );
drop policy if exists kk_sel on korisnik_klijent;
drop policy if exists kk_wr on korisnik_klijent;
create policy kk_sel on korisnik_klijent for select using ( korisnik_id = auth.uid() or je_admin() );
create policy kk_wr  on korisnik_klijent for all    using ( je_admin() ) with check ( je_admin() );

-- ───────────────────────── E) Audit log: čita samo admin ─────────────────────────
alter table audit_log enable row level security;
drop policy if exists audit_sel on audit_log;
create policy audit_sel on audit_log for select using ( je_admin() );

-- ───────────────────────── F) chat_poruke: samo prijavljeni (tehnički dug: per-korisnik) ──────────
alter table chat_poruke enable row level security;
drop policy if exists chat_all on chat_poruke;
create policy chat_all on chat_poruke for all using ( auth.uid() is not null ) with check ( auth.uid() is not null );

-- ───────────────────────── G) Storage: pristup objektima samo prijavljenima (minimum) ─────────────
-- Per-klijent storage RLS = tehnički dug (path: termini/{termin_id}/...).
drop policy if exists storage_dok_sel on storage.objects;
drop policy if exists storage_dok_wr on storage.objects;
create policy storage_dok_sel on storage.objects for select
  using ( bucket_id = 'tehpro-dokumenti' and auth.uid() is not null );
create policy storage_dok_wr on storage.objects for all
  using ( bucket_id = 'tehpro-dokumenti' and auth.uid() is not null )
  with check ( bucket_id = 'tehpro-dokumenti' and auth.uid() is not null );

-- NAPOMENA (tehnički dug, dokumentovati u ADR-u): fail-open proxy aktivan-check znači da
-- nalog obrisan iz korisnici ali prisutan u auth.users prolazi gate. Prihvaćeno za MVP.
