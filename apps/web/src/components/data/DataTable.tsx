import type { ReactNode } from "react";
import { Card } from "@/components/ui";

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  cell: (row: T) => ReactNode;
}

// Tableau générique des écrans de gestion (clients, produits). Réservé aux
// données réellement tabulaires : quand les lignes ont une identité forte
// plutôt que des colonnes comparables, InvoiceList lit mieux sur téléphone.
//
// Le conteneur défile horizontalement pour lui seul (`overflow-x-auto`) : sur
// un écran de 320px, un tableau à quatre colonnes doit pouvoir déborder sans
// que ce soit la PAGE qui parte de côté — un défilement horizontal du body
// casse la navigation au pouce.
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  emptyMessage,
}: {
  columns: readonly Column<T>[];
  rows: readonly T[];
  getRowKey: (row: T) => string;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <p className="p-8 text-center text-sm text-navy-600">{emptyMessage}</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-navy-50">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`px-5 py-3 font-sans text-[11px] font-semibold tracking-wide text-navy-600 uppercase ${
                  column.align === "right" ? "text-right" : "text-left"
                }`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-navy-50">
          {rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-5 py-4 text-navy-950 ${column.align === "right" ? "text-right" : "text-left"}`}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
