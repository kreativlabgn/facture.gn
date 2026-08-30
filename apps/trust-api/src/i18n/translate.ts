import type { Locale } from "./locale";
import type { MessageCatalog, MessageKey, MessagesParams } from "./messages";
import { fr } from "./messages.fr";
import { pular } from "./messages.pular";

const CATALOGS: Record<Locale, Partial<MessageCatalog>> = { fr, pular };

// Rend un message dans `locale`, avec fallback sur `fr` clé par clé (une langue
// partiellement traduite reste utilisable). `params` est typé par clé.
export function t<K extends MessageKey>(key: K, locale: Locale, params: MessagesParams[K]): string {
  const render = (CATALOGS[locale][key] ?? fr[key]) as (p: MessagesParams[K]) => string;
  return render(params);
}
