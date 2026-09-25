import { IsString, IsUUID, Matches, MaxLength } from 'class-validator';

/** Payload for POST /api/v1/insurance/checkout. */
export class CheckoutDto {
  @IsUUID('4', { message: 'quoteId must be a valid quote identifier' })
  quoteId!: string;

  /**
   * Opaque token from the payment SDK. Raw card data never reaches this API,
   * which keeps the service out of PCI scope.
   */
  @IsString()
  @MaxLength(128)
  @Matches(/^tok_[A-Za-z0-9_-]+$/, { message: 'paymentToken must be a payment gateway token' })
  paymentToken!: string;
}
