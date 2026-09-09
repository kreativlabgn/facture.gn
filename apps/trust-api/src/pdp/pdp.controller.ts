import { Body, Controller, HttpStatus, Post, Res, UseGuards } from "@nestjs/common";
import { ApiSecurity, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import type { Prisma } from "@facture-gn/db";
import { Public } from "../auth/public.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { createPdpInvoiceSchema, type CreatePdpInvoiceDto } from "./dto/create-pdp-invoice.dto";
import { PdpApiKeyAuthGuard } from "./pdp-api-key-auth.guard";
import { PdpClient, type PdpClientContext } from "./pdp-client.decorator";
import { PdpInvoiceService } from "./pdp-invoice.service";

// ADR-107 — passerelle PDP. Route VERSIONNÉE (/api/v1/...), divergence assumée
// du reste de l'API (flat, non versionnée) et pour la même raison que
// PartnersController : c'est un contrat public tenu vis-à-vis d'éditeurs
// externes, qui ne se redéploient pas au même rythme que nous. Le jour où le
// payload devra changer, v1 devra survivre le temps que les connecteurs migrent.
//
// @Public() court-circuite JwtAuthGuard — un éditeur d'ERP n'est pas un
// utilisateur facture.gn. PdpApiKeyAuthGuard est le seul garde réel, même
// posture que PartnersController (ADR-082). Aucun @Roles() : il n'y a pas de
// membership organisationnelle derrière une clé API, l'autorisation est
// entièrement portée par le garde (palier commercial) — RolesGuard sort donc
// avant toute résolution, ce qui interdit d'employer @CurrentOrganizationId()
// ici (d'où @PdpClient()).
@ApiTags("pdp")
@Controller("api/v1/pdp")
export class PdpController {
  constructor(private readonly pdpInvoiceService: PdpInvoiceService) {}

  // Throttle DESSERRÉ, contrairement à tous les autres @Throttle de ce repo qui
  // le resserrent. Le filet générique (100 req/min par IP) est calibré pour un
  // humain derrière un navigateur ; un connecteur ERP qui pousse son lot du
  // matin dépasse ce seuil en quelques secondes, et se ferait rejeter en 429 sur
  // des factures parfaitement légitimes. 600/min laisse passer un lot réaliste
  // tout en gardant une borne — la vraie protection sur ce chemin est la clé API
  // et le palier commercial, pas le comptage par IP (plusieurs connecteurs d'un
  // même hébergeur partagent une adresse de sortie).
  @Post("invoices")
  @Public()
  @UseGuards(PdpApiKeyAuthGuard)
  @ApiSecurity("pdp-api-key")
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async createInvoice(
    // DEUX @Body() sur le même handler, et c'est délibéré : le premier est
    // validé et transformé (montants en BigInt centimal), le second est le corps
    // JSON intact. C'est ce dernier qui est archivé dans payload — la pièce à
    // produire si un client conteste ce que son ERP a réellement envoyé. Un DTO
    // normalisé ne prouverait que ce que NOUS en avons compris. Nest ne mute pas
    // request.body : les pipes transforment la valeur remise au paramètre, pas
    // la requête.
    @Body(new ZodValidationPipe(createPdpInvoiceSchema)) dto: CreatePdpInvoiceDto,
    @Body() payloadBrut: Prisma.InputJsonValue,
    @PdpClient() client: PdpClientContext,
    // passthrough: true — Nest continue de sérialiser la valeur retournée, on ne
    // reprend la main que sur le CODE. Deux codes sont dus ici et un seul
    // @HttpCode() ne saurait les rendre : 202 pour un document nouveau (le
    // travail est accepté, pas terminé), 200 pour un rejeu déjà certifié (rien
    // n'a été créé, le reçu est joint). Les confondre mentirait au connecteur —
    // c'est sur ce code qu'il décide de rejouer ou non.
    @Res({ passthrough: true }) response: Response,
  ) {
    const resultat = await this.pdpInvoiceService.ingest(dto, client, payloadBrut);

    response.status(resultat.outcome === "duplicate" ? HttpStatus.OK : HttpStatus.ACCEPTED);

    return resultat;
  }
}
