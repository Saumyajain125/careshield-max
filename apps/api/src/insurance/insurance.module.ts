import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../common/idempotency/idempotency.module';
import { PaymentsModule } from '../payments/payments.module';
import { CheckoutService } from './checkout.service';
import { InsuranceController } from './insurance.controller';
import { MedicalDeclarationService } from './medical-declaration.service';
import { QuoteService } from './quote.service';

@Module({
  imports: [PaymentsModule, IdempotencyModule],
  controllers: [InsuranceController],
  providers: [QuoteService, MedicalDeclarationService, CheckoutService],
})
export class InsuranceModule {}
