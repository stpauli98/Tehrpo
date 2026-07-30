export type Uloga = "admin" | "operater" | "pregled"

export function mozeUrediti(uloga: Uloga): boolean {
  return uloga === "admin" || uloga === "operater"
}

export function jeAdmin(uloga: Uloga): boolean {
  return uloga === "admin"
}

/**
 * Smije li uloga iznositi podatke iz sistema (preuzimanje dokumenta, izvoz plana)?
 * Naručilac je 30.07.2026. potvrdio da `pregled` smije SAMO čitati na ekranu.
 * Odvojeno od `mozeUrediti` namjerno — to je pitanje pisanja, ovo je pitanje iznošenja.
 */
export function smijePreuzeti(uloga: Uloga): boolean {
  return uloga !== "pregled"
}
