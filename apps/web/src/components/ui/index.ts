// Point d'entrée unique des primitives : `import { Button, Card } from
// "@/components/ui"` plutôt qu'un import par fichier. Ne ré-exporte QUE les
// primitives — les composants métier (StatusPill, InvoiceList, TrustSeal)
// gardent leur import propre, sinon ce baril devient le fourre-tout par lequel
// tout transite et plus personne ne voit ce qui dépend de quoi.
export { Button, ButtonLink } from "./Button";
export { Badge, type BadgeTone } from "./Badge";
export { Card, CardBody, CardHeader } from "./Card";
export { DataField, Field, FieldLabel, SelectInput, TextInput } from "./Field";
export { EmptyState } from "./EmptyState";
