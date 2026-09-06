import type { ReactNode } from "react";
import { Card, CardBody } from "@/components/ui";

// Carte du tunnel public (inscription, onboarding). Elle pose le <h1> de
// l'écran — contrairement à CardHeader, qui rend un <h2> parce qu'une carte ne
// s'arroge jamais le titre d'une page. Ici la carte EST la page : un seul
// niveau de titre, et le lecteur d'écran entre directement dans l'étape.
export function AuthCard({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardBody className="p-6 sm:p-7">
        <h1 className="font-display text-xl font-bold text-navy-950">{title}</h1>
        {description ? <p className="mt-2 text-sm leading-relaxed text-navy-600">{description}</p> : null}
        <div className="mt-6">{children}</div>
      </CardBody>
      {footer ? (
        <div className="border-t border-navy-50 px-6 py-4 text-center text-sm text-navy-600">{footer}</div>
      ) : null}
    </Card>
  );
}
