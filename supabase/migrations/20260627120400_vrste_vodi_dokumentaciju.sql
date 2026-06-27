-- supabase/migrations/20260627120400_vrste_vodi_dokumentaciju.sql
-- PP-1: da li se za uslugu vodi dokumentacija (gap #5). Audit trigger na vrste već postoji.

alter table vrste_provjera add column if not exists vodi_dokumentaciju bool not null default true;
