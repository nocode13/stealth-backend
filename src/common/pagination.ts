export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

// rows приходит с take: limit + 1 — лишний элемент сигнализирует, что есть ещё страница.
export function toCursorPage<T extends { id: string }>(
  rows: T[],
  limit: number,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}
