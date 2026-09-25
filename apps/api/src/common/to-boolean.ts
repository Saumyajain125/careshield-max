/**
 * Strict boolean coercion for DTOs.
 *
 * Accepts real booleans and the "true"/"false" strings an HTML form posts.
 * Anything else is passed through untouched so @IsBoolean() rejects it -
 * returning false for, say, "maybe" would silently answer a health question
 * on the applicant's behalf.
 */
export function toBoolean({ value }: { value: unknown }): unknown {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

/** Same idea for numbers: only coerce a string that is fully numeric. */
export function toNumber({ value }: { value: unknown }): unknown {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return value;
}
