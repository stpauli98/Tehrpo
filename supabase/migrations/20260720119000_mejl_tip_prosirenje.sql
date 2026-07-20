-- Tri nove vrste mejla u dnevniku. ZASEBNA migracija i namjerno NAJNIŽI broj u ovom
-- PR-u: alter type ... add value mora biti commit-ovan prije nego se vrijednost upotrijebi,
-- a scripts/apply-cloud-migration.ts šalje cijeli fajl kao jedan query (jedna transakcija).
alter type mejl_tip add value if not exists 'podsjetnik_rok_istekao_interni';
alter type mejl_tip add value if not exists 'podsjetnik_rok_istekao_firma';
alter type mejl_tip add value if not exists 'podsjetnik_digest';
