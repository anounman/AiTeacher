interface TableArtifactProps {
  columns: string[];
  rows: (string | number)[][];
}

export function TableArtifact({ columns, rows }: TableArtifactProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-left text-[12px] leading-relaxed text-content">
        <thead className="mono border-b border-border text-[10px] tracking-wide text-content-faint">
          <tr>
            {columns.map((column) => <th key={column} scope="col" className="px-3 py-2 font-medium">{column}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, columnIndex) => <td key={columnIndex} className="px-3 py-2 align-top">{String(cell)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
