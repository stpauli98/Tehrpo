-- Faza Dokumenti — Storage bucket za zapisnike/upload-ovane dokumente.
-- Privatni bucket; cleanup je app-level (vidi deleteDokumentAction).
-- Spec §4.4 DB trigger zamijenjen — PL/pgSQL ne može pozvati Storage backend lokalno.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tehpro-dokumenti',
  'tehpro-dokumenti',
  false,
  52428800, -- 50 MiB
  array[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
on conflict (id) do nothing;
