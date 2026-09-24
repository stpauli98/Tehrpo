-- Vraća u repo anon-revoke koji je 29.07.2026. primijenjen na baze ali je fajl
-- migracije obrisan (`20260729150000_revoke_anon_definer_rpc.sql`) — pominje ga
-- 20260730120000_vremenska_zona_belgrade.sql:11-12, ali ga nema ni u repou ni u
-- git historiji. Posljedica drifta: `pnpm db:reset`, nova firma ili nova Supabase
-- instanca izgrađena iz ovih migracija OTVARA RPC-jeve potpuno anonimnom pozivaocu
-- (anon ključ je javan — nalazi se u browser bundle-u).
--
-- Zašto `revoke ... from public` NIJE dovoljan na Supabaseu: bootstrap radi
--   alter default privileges in schema public grant all on functions
--     to postgres, anon, authenticated, service_role;
-- dakle EXECUTE ide DIREKTNO roli `anon`, ne preko `PUBLIC`. Repo to već piše
-- doslovno u 20260710140000:142, 20260720122000:59 i 20260728121000:103, ali ova
-- tri RPC-a su ostala na golom `from public`.
--
-- Provjereno na DEMO 31.07.2026. prije pisanja: anon=false za sve tri (out-of-band
-- zakrpa jeste primijenjena), authenticated=true. Ova migracija je idempotentna —
-- na zakrpljenoj bazi ne mijenja ništa, na svježoj zatvara rupu.
--
-- Interna provjera pozivaoca (da ACL ne bude JEDINA kontrola) je odvojena
-- migracija: 20260731102000_definer_rpc_provjera_pozivaoca.sql.

revoke execute on function public.get_admini()            from public, anon;
revoke execute on function public.get_aktivni_korisnici()  from public, anon;
revoke execute on function public.get_zaduzeni_dodjele()   from public, anon;

grant execute on function public.get_admini()             to authenticated;
grant execute on function public.get_aktivni_korisnici()  to authenticated;
grant execute on function public.get_zaduzeni_dodjele()   to authenticated;

-- Helperi za dozvole: vraćaju samo boolean o SAMOM pozivaocu i za anon su uvijek
-- false, pa ovo nije zakrpa nego higijena — anon nema razloga da ih zove.
-- `tg_*` trigger funkcije se NAMJERNO ne diraju: EXECUTE se za njih provjerava pri
-- KREIRANJU trigera, pa bi revoke bio bez sigurnosne koristi a sa rizikom po restore.
revoke execute on function public.smije_brisati_klijente()      from public, anon;
revoke execute on function public.smije_brisati_zapis(uuid)     from public, anon;
revoke execute on function public.smije_zatvoriti_bez_nalaza()  from public, anon;

grant execute on function public.smije_brisati_klijente()       to authenticated;
grant execute on function public.smije_brisati_zapis(uuid)      to authenticated;
grant execute on function public.smije_zatvoriti_bez_nalaza()   to authenticated;
