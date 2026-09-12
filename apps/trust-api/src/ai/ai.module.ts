import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { OcrValidationService } from "./ocr-validation.service";
import { OCR_VISION_PROVIDER } from "./ocr-vision.provider";
import { OcrVisionService } from "./ocr-vision.service";
import { ocrVisionProviderFromEnv } from "./sovereign-ocr-vision.provider";

// Hub de Vision Souveraine (ADR-122). Aucune file BullMQ à cette tranche : le
// scan est SYNCHRONE — la PWA attend le verdict (inséré / à relire / rejeté)
// pour afficher OcrReviewAlert dans la foulée. Un modèle qui dépasserait le
// budget de la requête justifierait une file ; ce serait un ADR, pas un détail.
//
// OCR_VISION_PROVIDER est résolu par l'environnement : OCR_VISION_ENDPOINT +
// OCR_VISION_TOKEN définis → connecteur souverain live (sovereign-ocr-vision
// .provider.ts) ; endpoint absent → implémentation NON CONFIGURÉE (503
// explicite), comportement inchangé depuis la PR #22. Endpoint sans jeton →
// refus au démarrage. Rien d'autre dans le module ne dépend de ce choix.
@Module({
  controllers: [AiController],
  providers: [
    OcrValidationService,
    OcrVisionService,
    { provide: OCR_VISION_PROVIDER, useFactory: ocrVisionProviderFromEnv },
  ],
  exports: [OcrVisionService, OcrValidationService],
})
export class AiModule {}
