import { Global, Module } from "@nestjs/common";
import { getPrismaClient, PrismaClient } from "@facture-gn/db";

export const PRISMA_CLIENT = Symbol("PRISMA_CLIENT");

@Global()
@Module({
  providers: [
    {
      provide: PRISMA_CLIENT,
      useFactory: (): PrismaClient => getPrismaClient(),
    },
  ],
  exports: [PRISMA_CLIENT],
})
export class PrismaModule {}
