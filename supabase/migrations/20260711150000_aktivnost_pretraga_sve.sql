-- Pretraga u Aktivnost tabu: pored imena/id/aktera, hvataj i sadržaj Detalji kolone
-- (staro/novo/detalji JSONB kao tekst) i akciju. Server-side, svi redovi.
create or replace function get_aktivnost(
  p_od       timestamptz default null,
  p_do       timestamptz default null,
  p_korisnik uuid        default null,
  p_akcija   text        default null,
  p_entitet  text        default null,
  p_pretraga text        default null,
  p_limit    int         default 50,
  p_offset   int         default 0
)
returns table (
  id             bigint,
  vrijeme        timestamptz,
  korisnik_id    uuid,
  korisnik_ime   text,
  korisnik_email text,
  akcija         text,
  entitet        text,
  entitet_id     text,
  staro          jsonb,
  novo           jsonb,
  detalji        jsonb,
  cilj_ime       text,
  cilj_klijent   text,
  ukupno         bigint
)
language sql stable security invoker set search_path = public as $$
  with f as (
    select *
    from aktivnost_view a
    where (p_od is null or a.vrijeme >= p_od)
      and (p_do is null or a.vrijeme <  p_do)
      and (p_korisnik is null or a.korisnik_id = p_korisnik)
      and (p_akcija  is null or a.akcija  = p_akcija)
      and (p_entitet is null or a.entitet = p_entitet)
      and (p_pretraga is null or (
           coalesce(a.entitet,'')      ilike '%'||p_pretraga||'%'
        or coalesce(a.entitet_id,'')   ilike '%'||p_pretraga||'%'
        or coalesce(a.korisnik_ime,'') ilike '%'||p_pretraga||'%'
        or coalesce(a.cilj_ime,'')     ilike '%'||p_pretraga||'%'
        or coalesce(a.cilj_klijent,'') ilike '%'||p_pretraga||'%'
        or coalesce(a.akcija,'')       ilike '%'||p_pretraga||'%'
        or coalesce(a.staro::text,'')  ilike '%'||p_pretraga||'%'
        or coalesce(a.novo::text,'')   ilike '%'||p_pretraga||'%'
        or coalesce(a.detalji::text,'') ilike '%'||p_pretraga||'%'))
  )
  select f.id, f.vrijeme, f.korisnik_id, f.korisnik_ime, f.korisnik_email,
         f.akcija, f.entitet, f.entitet_id, f.staro, f.novo, f.detalji,
         f.cilj_ime, f.cilj_klijent,
         count(*) over () as ukupno
  from f
  order by f.vrijeme desc
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;
