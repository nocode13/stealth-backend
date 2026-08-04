/** К единому виду `+998…`: Telegram отдаёт номер и без плюса. */
export function normalizePhone(phone: string): string {
  return `+${phone.replace(/\D/g, '')}`;
}
