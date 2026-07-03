-- Poslovno pravilo (2026-07-03): svaka provjera u profilu mora imati konkretnu
-- lokaciju — svako mjesto koje se provjerava ima adresu; stavke "bez lokacije"
-- razbijaju strukturu podataka.
--
-- Backfill postojećih redova sa lokacija_id IS NULL:
--  1) ako za isti (klijent, vrsta) već postoji red sa konkretnom lokacijom,
--     NULL red je duplikat konfiguracije → briše se (izbjegava i koliziju sa
--     uq_klijent_provjere pri dodjeli iste lokacije);
--  2) ako klijent ima tačno jednu lokaciju → dodijeli je;
--  3) preostali redovi (klijent bez ijedne lokacije ili sa više njih) ne mogu se
--     automatski razriješiti → migracija namjerno PADA sa brojem redova; dopuniti
--     ručno pa ponovo primijeniti.

delete from klijent_provjere kp
where kp.lokacija_id is null
  and exists (
    select 1 from klijent_provjere d
    where d.klijent_id = kp.klijent_id
      and d.vrsta_provjere_id = kp.vrsta_provjere_id
      and d.lokacija_id is not null
  );

update klijent_provjere kp
set lokacija_id = (select l.id from lokacije l where l.klijent_id = kp.klijent_id)
where kp.lokacija_id is null
  and (select count(*) from lokacije l where l.klijent_id = kp.klijent_id) = 1;

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
