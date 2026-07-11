export type AkcijaUI = "NAVIGATE" | "VIEW" | "LOGIN" | "LOGOUT" | "FILTER"
export type Akcija = "INSERT" | "UPDATE" | "DELETE" | AkcijaUI

export interface DogadjajUnos {
  akcija: AkcijaUI
  entitet: string | null
  entitet_id: string | null
  detalji: Record<string, unknown> | null
}
