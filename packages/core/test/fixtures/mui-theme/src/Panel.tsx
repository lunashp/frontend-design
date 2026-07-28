interface PanelProps {
  title: string;
}

/** A trivial presentational component so the pipeline has something to build. */
export const Panel = ({ title }: PanelProps) => <div className="panel">{title}</div>;
