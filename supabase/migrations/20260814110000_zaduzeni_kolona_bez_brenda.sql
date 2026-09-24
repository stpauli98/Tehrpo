-- supabase/migrations/20260814110000_zaduzeni_kolona_bez_brenda.sql
--
-- `klijenti.zaduzeni_tehpro_id` → `klijenti.zaduzeni_korisnik_id`.
--
-- Ime kolone nije interna stvar: `AktivnostTabela.poljeLabel()` pada na `prettify(kljuc)`
-- kad polje nema prevod, pa je ekran Aktivnost doslovno ispisivao „Zaduzeni tehpro id".
-- Isto ime stoji i kao `name=` atribut na <Select>-u u formama klijenta, dakle u HTML-u
-- koji vidi svako ko otvori izvor stranice. Na instanci koja se drugim firmama pokazuje
-- kao demo to je vidljiv tuđi brend.
--
-- Rename, ne add+copy+drop: kolona zadržava podatke, FK i indeks, nema prozora u kojem
-- su dvije kolone u neskladu. Re-run safe preko provjere u information_schema.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'klijenti'
      and column_name = 'zaduzeni_tehpro_id'
  ) then
    alter table klijenti rename column zaduzeni_tehpro_id to zaduzeni_korisnik_id;
  end if;
end $$;

alter index if exists idx_klijenti_zaduzeni rename to idx_klijenti_zaduzeni_korisnik;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'klijenti_zaduzeni_tehpro_id_fkey'
      and conrelid = 'public.klijenti'::regclass
  ) then
    alter table klijenti
      rename constraint klijenti_zaduzeni_tehpro_id_fkey to klijenti_zaduzeni_korisnik_id_fkey;
  end if;
end $$;
