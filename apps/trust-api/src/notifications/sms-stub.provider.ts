import { Injectable, Logger } from "@nestjs/common";
import type { NotificationProvider, NotificationSendResult } from "./notification-provider.interface";

@Injectable()
export class SmsStubProvider implements NotificationProvider {
  private readonly logger = new Logger(SmsStubProvider.name);

  // TODO(provider SMS réel Guinée) : stub déterministe faute de credentials
  // sandbox — interface stable, migration sans impact sur les appelants (même
  // discipline que DjomyStubProvider). Numéro tronqué dans le log (4 derniers
  // chiffres) — jamais un PII complet en clair dans les logs.
  async send(phone: string, message: string): Promise<NotificationSendResult> {
    this.logger.log(`SMS stub → ***${phone.slice(-4)} : ${message}`);
    return { success: true };
  }
}
