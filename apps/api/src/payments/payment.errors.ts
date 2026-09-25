/** The gateway reached the issuer and the issuer said no. Not retryable. */
export class PaymentDeclinedError extends Error {
  constructor(
    public readonly reason: string,
    public readonly gatewayCode: string,
  ) {
    super(`Payment declined by issuer: ${reason}`);
    this.name = 'PaymentDeclinedError';
  }
}

/** We could not get a definitive answer from the gateway. Retryable. */
export class PaymentGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentGatewayError';
  }
}
