import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { toBoolean, toNumber } from '../../common/to-boolean';
import { DIAGNOSED_CONDITIONS, type DiagnosedCondition } from '../engines/underwriting.engine';

/** Structured health disclosures. Free text is deliberately not accepted. */
export class DisclosuresDto {
  @Transform(toBoolean)
  @IsBoolean()
  smoker!: boolean;

  @Transform(toNumber)
  @IsNumber()
  @Min(0)
  @Max(200)
  alcoholUnitsPerWeek!: number;

  @Transform(toNumber)
  @IsInt()
  @Min(120)
  @Max(250)
  heightCm!: number;

  @Transform(toNumber)
  @IsNumber()
  @Min(25)
  @Max(400)
  weightKg!: number;

  @Transform(toBoolean)
  @IsBoolean()
  hospitalisedInLast12Months!: boolean;

  @Transform(toBoolean)
  @IsBoolean()
  onRegularMedication!: boolean;

  @IsArray()
  @ArrayUnique()
  @IsIn(DIAGNOSED_CONDITIONS as readonly string[], {
    each: true,
    message: `each diagnosed condition must be one of: ${DIAGNOSED_CONDITIONS.join(', ')}`,
  })
  diagnosedConditions!: DiagnosedCondition[];
}

/** Payload for POST /api/v1/insurance/quote/:quoteId/medical-declaration. */
export class SubmitMedicalDeclarationDto {
  // IsDefined + IsObject matter here: on their own @ValidateNested/@Type let a
  // missing object through (class-validator early-returns on undefined) and
  // validate an array element by element, and the service then dereferences
  // disclosures.diagnosedConditions and 500s.
  @IsDefined({ message: 'disclosures are required' })
  @IsObject({ message: 'disclosures must be an object' })
  @ValidateNested()
  @Type(() => DisclosuresDto)
  disclosures!: DisclosuresDto;

  /**
   * The applicant must affirm the disclosures are true and complete - this is
   * the contractual basis the policy is issued on.
   */
  @Transform(toBoolean)
  @IsBoolean()
  @IsIn([true], { message: 'You must confirm the declaration is true and complete' })
  declarationAccepted!: boolean;
}
