-- Aktivnost log (admin nadzor): proširuje audit_log u jedinstveni tok DB+UI događaja.
-- akcija dobija UI glagole: NAVIGATE, VIEW, LOGIN, LOGOUT, FILTER (pored INSERT/UPDATE/DELETE).

-- 1) UI kontekst (labela ekrana, filter parametri). Za UI redove staro/novo = null.
alter table audit_log add column if not exists detalji jsonb;

-- LOGIN/LOGOUT i sl. UI događaji nemaju entitet → dozvoli null (tg_audit uvijek postavlja TG_TABLE_NAME).
alter table audit_log alter column entitet drop not null;

-- 2) Indeksi za filtriranje na admin ekranu (postoje već: vrijeme desc, entitet+entitet_id).
create index if not exists idx_audit_korisnik on audit_log (korisnik_id);
create index if not exists idx_audit_akcija   on audit_log (akcija);

-- 3) Batch upis UI događaja kao trenutni korisnik. Korisnik ne može lažirati tuđi id.
create or replace function zabiljezi_dogadjaje(p_dogadjaji jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into audit_log (korisnik_id, akcija, entitet, entitet_id, detalji)
  select auth.uid(),
         e->>'akcija',
         nullif(e->>'entitet', ''),
         nullif(e->>'entitet_id', ''),
         e->'detalji'
  from jsonb_array_elements(coalesce(p_dogadjaji, '[]'::jsonb)) as e
  where e->>'akcija' in ('NAVIGATE','VIEW','LOGIN','LOGOUT','FILTER');
end; $$;

grant execute on function zabiljezi_dogadjaje(jsonb) to authenticated;

-- 4) Read model: log + ime aktera. security_invoker=on da poštuje audit_log admin-only RLS.
create or replace view aktivnost_view
with (security_invoker = on) as
select a.id, a.vrijeme, a.korisnik_id, a.akcija, a.entitet, a.entitet_id,
       a.staro, a.novo, a.detalji,
       k.ime   as korisnik_ime,
       k.email as korisnik_email
from audit_log a
left join korisnici k on k.id = a.korisnik_id;

-- 5) Paginirano + filtrirano čitanje u jednom round-tripu. security invoker → RLS admin-only važi.
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
        or coalesce(a.korisnik_ime,'') ilike '%'||p_pretraga||'%'))
  )
  select f.id, f.vrijeme, f.korisnik_id, f.korisnik_ime, f.korisnik_email,
         f.akcija, f.entitet, f.entitet_id, f.staro, f.novo, f.detalji,
         count(*) over () as ukupno
  from f
  order by f.vrijeme desc
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

grant execute on function get_aktivnost(timestamptz,timestamptz,uuid,text,text,text,int,int) to authenticated;

-- 6) Retencija: briši starije od 90 dana. security definer (poziva se iz cron admin konteksta).
create or replace function obrisi_stare_dogadjaje()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_broj integer;
begin
  delete from audit_log where vrijeme < now() - interval '90 days';
  get diagnostics v_broj = row_count;
  return v_broj;
end; $$;
