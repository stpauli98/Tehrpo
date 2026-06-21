-- Read-model za Klijenti ekran (Faza 4): per-klijent agregatni count-ovi
-- u jednom scanu (broj lokacija, termina, aktivnih, kasnih, izvršenih).

create view klijenti_view as
select
  k.id,
  k.naziv,
  k.napomena,
  k.created_at,
  k.updated_at,
  count(distinct l.id)                                                       as broj_lokacija,
  count(tv.id)                                                               as broj_termina,
  count(tv.id) filter (where tv.status_izvedeni in ('planirano','zakazano')) as broj_aktivnih,
  count(tv.id) filter (where tv.status_izvedeni = 'kasni')                    as broj_kasni,
  count(tv.id) filter (where tv.status = 'izvrseno')                         as broj_izvrseno
  -- NAPOMENA: broj_aktivnih koristi status_izvedeni (NE status) → isključuje
  -- prekoračene (kasni) termine, pa su broj_aktivnih i broj_kasni međusobno
  -- isključivi (nema dvostrukog brojanja na kartici).
from klijenti k
left join lokacije l       on l.klijent_id = k.id
left join termini_view tv  on tv.klijent_id = k.id
group by k.id, k.naziv, k.napomena, k.created_at, k.updated_at;
