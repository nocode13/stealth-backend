/** К единому виду для сравнения/хранения: без пробелов по краям, в нижнем регистре. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
