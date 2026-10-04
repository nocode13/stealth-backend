// Артикул в поиске: «10001» или «#10001» (решётка — как его показывают на фото и
// в карточке). 4–7 цифр: названия растений цифрами не бывают, так что такой
// запрос однозначно артикул, а не опечатка в названии.
const LISTING_CODE_SEARCH = /^\s*#?\s*(\d{4,7})\s*$/;

export function parseListingCode(search: string): number | null {
  const match = LISTING_CODE_SEARCH.exec(search);
  return match ? Number(match[1]) : null;
}

// Параметр карточки товара: артикул из короткой ссылки или cuid из старой.
// cuid начинается с буквы, так что чисто цифровой параметр — всегда артикул.
export function isListingCode(idOrCode: string): boolean {
  return /^\d{1,9}$/.test(idOrCode);
}
