import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';
import { toBoolean, toNumber } from '../../common/to-boolean';

/**
 * Payload for POST /api/v1/insurance/quote.
 *
 * The global ValidationPipe runs with whitelist + forbidNonWhitelisted, so
 * anything not declared here is rejected rather than quietly ignored.
 */
export class CreateQuoteDto {
  /** CareShield Max is sold to adults up to age 80. */
  @Transform(toNumber)
  @IsInt({ message: 'age must be a whole number' })
  @Min(18, { message: 'CareShield Max is only available from age 18' })
  @Max(80, { message: 'CareShield Max is only available up to age 80' })
  age!: number;

  @Transform(toBoolean)
  @IsBoolean()
  hasPreExistingConditions!: boolean;
}
