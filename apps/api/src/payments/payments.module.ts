import { Module } from '@nestjs/common';
import { MockPaymentClient } from './mock-payment.client';

@Module({
  providers: [MockPaymentClient],
  exports: [MockPaymentClient],
})
export class PaymentsModule {}
