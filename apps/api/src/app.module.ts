import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { HealthController } from './health.controller';
import { InsuranceModule } from './insurance/insurance.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, InsuranceModule],
  controllers: [HealthController],
})
export class AppModule {}
