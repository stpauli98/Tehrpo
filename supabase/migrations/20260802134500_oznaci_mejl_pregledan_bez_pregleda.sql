-- B6: RPC `oznaci_mejl_pregledan` je jedini put kojim uloga `pregled` može PISATI
-- u bazu (2026-08-02).
--
-- Zašto je to rupa: funkcija je SECURITY DEFINER (izvršava se sa pravima vlasnika,
-- RLS na `mejl_log` je ne dodiruje) i uslov je bio samo
--     je_admin() or ima_pristup_klijentu(v_klijent)
-- Nijedan od ta dva ne isključuje read-only ulogu — `ima_pristup_klijentu()` gleda
-- dodjelu firme, ne pravo pisanja. Uloga `pregled` sa dodijeljenom firmom je zato
-- mogla postaviti `pregledano_at`/`pregledano_od` i time ugasiti crveni bedž greške
-- slanja svima ostalima. Sve ostale tabele imaju `not je_pregled()` u RLS politici;
-- ova funkcija je bila izuzetak jer politiku zaobilazi po definiciji.
--
-- App-strana (`app/(dashboard)/poslati-mejlovi/actions.ts`) dobija isti gejt, ali
-- baza mora biti ta koja odlučuje — server akcija je javni endpoint.
--
-- Ponašanje ostaje „tiho preskoči" (return bez greške), isto kao za korisnika bez
-- pristupa firmi: pozivalac ne treba da razlikuje „nema prava" od „nema reda", a
-- promjena u `raise exception` bi promijenila ugovor funkcije prema postojećem UI-ju.
--
-- Idempotentno (create or replace) i sigurno za ponovno pokretanje.

create or replace function public.oznaci_mejl_pregledan(p_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_klijent uuid;
begin
  if auth.uid() is null then return; end if;
  -- Read-only uloga ne piše ni preko definer funkcije.
  if je_pregled() then return; end if;
  select klijent_id into v_klijent from mejl_log where id = p_id;
  if not ( je_admin() or ( v_klijent is not null and ima_pristup_klijentu(v_klijent) ) ) then
    return;  -- nema prava → tiho, bez izmjene
  end if;
  update mejl_log
     set pregledano_at = now(), pregledano_od = auth.uid()
   where id = p_id and pregledano_at is null;  -- idempotentno
end; $$;

-- `create or replace` čuva postojeće grantove; ponavljamo ih da migracija bude
-- samodovoljna i kad se pusti na bazu u kojoj je funkcija tek nastala.
revoke execute on function public.oznaci_mejl_pregledan(uuid) from public, anon;
grant  execute on function public.oznaci_mejl_pregledan(uuid) to authenticated;

comment on function public.oznaci_mejl_pregledan(uuid) is
  'Gasi bedž greške za jedan mejl. Odbija: neprijavljene, ulogu pregled (je_pregled), i korisnike bez pristupa klijentu reda. Tiho (bez greške).';
