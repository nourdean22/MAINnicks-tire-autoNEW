import { EmptyState } from "@/components/layout/ui";

type DataTableProps = {
  headers: string[];
  rows: React.ReactNode[][];
  emptyTitle: string;
  emptyCopy: string;
};

export function DataTable({ headers, rows, emptyTitle, emptyCopy }: DataTableProps) {
  if (!rows.length) {
    return <EmptyState title={emptyTitle} copy={emptyCopy} />;
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
