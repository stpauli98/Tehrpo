-- "Cilj" u aktivnost logu: čitljivo ime umjesto uuid-a.
-- cilj_ime     = vlastito ime zapisa iz staro/novo JSONB (naziv/ime)
-- cilj_klijent = naziv povezanog klijenta (preko klijent_id iz JSONB; za entitet='klijenti' preko id/entitet_id)

-- Siguran uuid iz teksta (NULL ako nije validan uuid — entitet_id/JSONB mogu biti ne-uuid ili prazni).
create or replace function tekst_u_uuid(t text) returns uuid
language sql immutable set search_path = public as $$
  select case
    when t ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then t::uuid
  end;
$$;

create or replace view aktivnost_view
with (security_invoker = on) as
select a.id, a.vrijeme, a.korisnik_id, a.akcija, a.entitet, a.entitet_id,
       a.staro, a.novo, a.detalji,
       k.ime   as korisnik_ime,
       k.email as korisnik_email,
       coalesce(a.novo->>'naziv', a.staro->>'naziv', a.novo->>'ime', a.staro->>'ime') as cilj_ime,
       kl.naziv as cilj_klijent
from audit_log a
left join korisnici k on k.id = a.korisnik_id
left join klijenti kl on kl.id = tekst_u_uuid(
  case when a.entitet = 'klijenti'
       then coalesce(a.novo->>'id', a.staro->>'id', a.entitet_id)
       else coalesce(a.novo->>'klijent_id', a.staro->>'klijent_id')
  end
);

-- get_aktivnost mora dobiti nove kolone → DROP+CREATE (mijenja se return tabela).
drop function if exists get_aktivnost(timestamptz,timestamptz,uuid,text,text,text,int,int);
create function get_aktivnost(
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
        or coalesce(a.cilj_klijent,'') ilike '%'||p_pretraga||'%'))
  )
  select f.id, f.vrijeme, f.korisnik_id, f.korisnik_ime, f.korisnik_email,
         f.akcija, f.entitet, f.entitet_id, f.staro, f.novo, f.detalji,
         f.cilj_ime, f.cilj_klijent,
         count(*) over () as ukupno
  from f
  order by f.vrijeme desc
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

grant execute on function get_aktivnost(timestamptz,timestamptz,uuid,text,text,text,int,int) to authenticated;
