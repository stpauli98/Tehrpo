export type Uloga = "admin" | "operater" | "pregled"

export function mozeUrediti(uloga: Uloga): boolean {
  return uloga === "admin" || uloga === "operater"
}

export function jeAdmin(uloga: Uloga): boolean {
  return uloga === "admin"
}
