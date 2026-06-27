-- supabase/migrations/20260627120300_klijent_provjere_ugovor.sql
-- PP-1: veza profil-provjera → ugovor (ugovorene usluge). Nullable, ne dira motor rokova.

alter table klijent_provjere add column if not exists ugovor_id uuid
  references ugovori(id) on delete set null;

create index if not exists idx_klijent_provjere_ugovor on klijent_provjere (ugovor_id);
