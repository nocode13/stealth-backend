/**
 * Сравнение версий вида "1.0.21" — посегментно, численно, без semver-зависимости:
 * пререлизных суффиксов у нас не бывает, `expo.version` всегда `x.y.z`.
 *
 * Разная длина не проблема ("1.1" > "1.0.9"): недостающие сегменты считаем нулями.
 *
 * ⚠️ Нечисловой сегмент делает всю строку неразбираемой — тогда возвращается `null`,
 * и вызывающий обязан трактовать это как «обновления нет». Молча подставлять 0
 * нельзя: мусор в поле версии превратился бы в force-update для всех.
 */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;

  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

function parseVersion(value: string): number[] | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parts = trimmed.split('.');
  const numbers: number[] = [];
  for (const part of parts) {
    // Number('') === 0 и Number(' 1 ') === 1 — оба случая надо отсечь явно.
    if (!/^\d+$/.test(part)) return null;
    numbers.push(Number(part));
  }
  return numbers;
}
