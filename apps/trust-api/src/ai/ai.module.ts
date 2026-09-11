import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { OcrValidationService } from "./ocr-validation.service";
import { OCR_VISION_PROVIDER, UnconfiguredOcrVisionProvider } from "./ocr-vision.provider";
import { OcrVisionService } from "./ocr-vision.service";

// Hub de Vision Souveraine (ADR-122). Aucune file BullMQ à cette tranche : le
// scan est SYNCHRONE — la PWA attend le verdict (inséré / à relire / rejeté)
// pour afficher OcrReviewAlert dans la foulée. Un modèle qui dépasserait le
// budget de la requête justifierait une file ; ce serait un ADR, pas un détail.
//
// OCR_VISION_PROVIDER est lié à l'implémentation NON CONFIGURÉE (503 explicite)
// tant qu'aucun point d'inférence n'est défini. Le jour où le modèle est câblé,
// c'est CETTE ligne qui change — et rien d'autre dans le module.
@Module({
  controllers: [AiController],
  providers: [
    OcrValidationService,
    OcrVisionService,
    { provide: OCR_VISION_PROVIDER, useClass: UnconfiguredOcrVisionProvider },
  ],
  exports: [OcrVisionService, OcrValidationService],
})
export class AiModule {}
