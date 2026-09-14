import sanitizeHtml from 'sanitize-html';

/**
 * Описания каталога и продавца — HTML из rich-text редактора админки (tiptap). Пишут их
 * и продавцы, а мобилка рендерит сохранённое как есть, поэтому allowlist применяется на
 * входе, до записи в БД. Ссылок, картинок и видео в описании нет по продукту: `a`
 * раскрывается в текст, медиа вырезаются вместе с содержимым.
 */
export const RICH_TEXT_MAX_LENGTH = 20_000;

// Внутренности этих тегов — не текст описания: без списка содержимое iframe/svg и т.п.
// утекло бы в описание строкой после удаления самого тега.
const NON_TEXT_TAGS = [
  'script',
  'style',
  'textarea',
  'option',
  'noscript',
  'template',
  'iframe',
  'object',
  'video',
  'audio',
  'svg',
  'math',
  'title',
];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'em',
    'u',
    's',
    'h2',
    'h3',
    'ul',
    'ol',
    'li',
    'blockquote',
  ],
  allowedAttributes: {},
  // Вставка из Word/браузера приносит синонимы — приводим к тегам редактора.
  transformTags: {
    b: 'strong',
    i: 'em',
    strike: 's',
    del: 's',
    h1: 'h2',
    h4: 'h3',
    h5: 'h3',
    h6: 'h3',
  },
  nonTextTags: NON_TEXT_TAGS,
  disallowedTagsMode: 'discard',
};

const TEXT_ONLY: sanitizeHtml.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
  nonTextTags: NON_TEXT_TAGS,
};

/**
 * Санитизированный HTML. Документ без текста (`<p></p>` пустого редактора, одни пробелы)
 * → `''`, дальше `clean()` в `normalize*Translations` превращает его в `null` — фолбэк на RU
 * и `auto` работают так же, как с плоским текстом.
 */
export function sanitizeRichText(html: string): string {
  const clean = sanitizeHtml(html, OPTIONS).trim();
  return sanitizeHtml(clean, TEXT_ONLY).trim() ? clean : '';
}

/** `@Transform` для DTO: `ValidationPipe({ transform })` применяет его до валидации. */
export const toRichText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? sanitizeRichText(value) : value;
