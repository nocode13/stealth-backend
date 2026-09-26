import { ValidateBy, ValidationOptions } from 'class-validator';
import { isBusinessDay } from '../business-day';

/**
 * День `YYYY-MM-DD` (граница — 00:00 по Ташкенту, см. business-day.ts). Настоящая
 * дата календаря: `2026-02-31` не проходит. null/undefined пропускает @IsOptional.
 */
export const IsBusinessDay = (options?: ValidationOptions) =>
  ValidateBy(
    {
      name: 'isBusinessDay',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && isBusinessDay(value),
        defaultMessage: () => '$property должен быть днём в формате YYYY-MM-DD',
      },
    },
    options,
  );
