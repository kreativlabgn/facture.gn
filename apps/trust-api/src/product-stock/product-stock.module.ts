import { Module } from "@nestjs/common";
import { ProductStockController } from "./product-stock.controller";
import { ProductStockService } from "./product-stock.service";

@Module({
  controllers: [ProductStockController],
  providers: [ProductStockService],
})
export class ProductStockModule {}
