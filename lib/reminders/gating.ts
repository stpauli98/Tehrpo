// Da li je automatsko (cron) slanje podsjetnika uključeno za ovu instancu.
// Nedostajući red/kolona = uključeno: sigurnosna tolerancija za trenutak
// između deploy-a koda i primjene migracije (spec §Ponašanje).
export function podsjetniciAktivni(
  row: { podsjetnici_aktivni: boolean } | null | undefined,
): boolean {
  return row?.podsjetnici_aktivni ?? true
}
