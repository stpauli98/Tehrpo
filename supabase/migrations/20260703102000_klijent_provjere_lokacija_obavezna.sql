-- Poslovno pravilo (2026-07-03): svaka provjera u profilu mora imati konkretnu
-- lokaciju — svako mjesto koje se provjerava ima adresu; stavke "bez lokacije"
-- razbijaju strukturu podataka.
--
-- Backfill ide u parovima: klijent_provjere I termini nastali iz tih stavki
-- (profil se sa terminima uparuje po vrsta+lokacija — vidi klijenti/[id]/page.tsx
-- i dedup u createProfilProvjere; backfill samo profila bi ostavio naslijeđene
-- NULL-lokacija termine trajno neuparene i nevidljive dedup provjeri).
--
-- Grane za redove klijent_provjere sa lokacija_id IS NULL:
--  1) klijent ima tačno jednu lokaciju i NEMA konkretan duplikat za istu vrstu
--     → stavci i njenim NULL terminima dodijeli tu lokaciju;
--  2) postoji red iste (klijent, vrsta) sa konkretnom lokacijom → NULL red je
--     duplikat konfiguracije → briše se, a njegovi još-aktivni NULL termini se
--     otkazuju (duplirani rokovi/podsjetnici uz termin konkretne lokacije);
--  3) ostalo (klijent bez ijedne lokacije ili sa više njih) ne može se
--     automatski razriješiti → migracija namjerno PADA sa brojem redova;
--     dopuniti ručno pa ponovo primijeniti.
--
-- Napomena o trigerima na termini: tg_termini_compute_rok se okida na UPDATE i
-- rekomputira rok iz datum_zadnjeg + interval — determinističi no-op za redove
-- kojima je rok tako i izračunat; tg_termini_auto_cycle se ne okida (nema
-- tranzicije u 'izvrseno').

-- 1a) termini backfill za stavke koje će dobiti jedinu lokaciju klijenta
update termini t
set lokacija_id = (select l.id from lokacije l where l.klijent_id = t.klijent_id)
where t.lokacija_id is null
  and (select count(*) from lokacije l where l.klijent_id = t.klijent_id) = 1
  and exists (
    select 1 from klijent_provjere kp
    where kp.klijent_id = t.klijent_id
      and kp.vrsta_provjere_id = t.vrsta_provjere_id
      and kp.lokacija_id is null
  )
  and not exists (
    select 1 from klijent_provjere d
    where d.klijent_id = t.klijent_id
      and d.vrsta_provjere_id = t.vrsta_provjere_id
      and d.lokacija_id is not null
  );

-- 1b) otkaži aktivne NULL termine stavki koje se brišu kao duplikati
--     (termin konkretne lokacije za istu vrstu već postoji ili će nastati)
update termini t
set status = 'otkazano'
where t.lokacija_id is null
  and t.status in ('planirano', 'zakazano')
  and exists (
    select 1 from klijent_provjere kp
    where kp.klijent_id = t.klijent_id
      and kp.vrsta_provjere_id = t.vrsta_provjere_id
      and kp.lokacija_id is null
  )
  and exists (
    select 1 from klijent_provjere d
    where d.klijent_id = t.klijent_id
      and d.vrsta_provjere_id = t.vrsta_provjere_id
      and d.lokacija_id is not null
  );

-- 2) obriši NULL duplikate profila (izbjegava i koliziju sa uq_klijent_provjere
--    pri dodjeli iste lokacije)
delete from klijent_provjere kp
where kp.lokacija_id is null
  and exists (
    select 1 from klijent_provjere d
    where d.klijent_id = kp.klijent_id
      and d.vrsta_provjere_id = kp.vrsta_provjere_id
      and d.lokacija_id is not null
  );

-- 3) preostalim NULL stavkama dodijeli jedinu lokaciju klijenta
update klijent_provjere kp
set lokacija_id = (select l.id from lokacije l where l.klijent_id = kp.klijent_id)
where kp.lokacija_id is null
  and (select count(*) from lokacije l where l.klijent_id = kp.klijent_id) = 1;

-- 4) guard: ako je išta ostalo bez lokacije, prekini sa jasnom porukom
do $$
declare v_cnt int;
begin
  select count(*) into v_cnt from klijent_provjere where lokacija_id is null;
  if v_cnt > 0 then
    raise exception
      'klijent_provjere: % red(ova) bez lokacije nije moguće automatski razriješiti (klijent bez lokacija ili sa više njih) — dopuniti ručno pa ponoviti migraciju',
      v_cnt;
  end if;
end $$;

alter table klijent_provjere alter column lokacija_id set not null;

-- FK je bio "on delete set null" — sa NOT NULL to više nije moguće; brisanje
-- lokacije koja ima stavke profila sada je blokirano (restrict).
alter table klijent_provjere drop constraint klijent_provjere_lokacija_id_fkey;
alter table klijent_provjere add constraint klijent_provjere_lokacija_id_fkey
  foreign key (lokacija_id) references lokacije(id) on delete restrict;
