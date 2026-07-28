interface Row {
  id: string;
  label: string;
  count: number;
}

interface RowTableProps {
  /** A required array the component maps immediately. Left undefined it throws
   *  on `.map`; synthesized as `[]` it renders an empty shell — the documented
   *  trade-off of never inventing data. */
  rows: Row[];
  caption?: string;
}

export const RowTable = ({ rows, caption }: RowTableProps) => (
  <table>
    <caption>{caption}</caption>
    <tbody>
      {rows.map((r) => (
        <tr key={r.id}>
          <td>{r.label}</td>
          <td>{r.count.toLocaleString()}</td>
        </tr>
      ))}
    </tbody>
  </table>
);
