export interface LocalizedErrorBody {
  messageKey: string;
  params?: Record<string, string | number>;
}

/** throw new BadRequestException(err(ERRORS.ITEM_SOLD_OUT, { name })) */
export const err = (
  messageKey: string,
  params?: Record<string, string | number>,
): LocalizedErrorBody => ({ messageKey, params });

export const isLocalizedErrorBody = (v: unknown): v is LocalizedErrorBody =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as LocalizedErrorBody).messageKey === 'string';
