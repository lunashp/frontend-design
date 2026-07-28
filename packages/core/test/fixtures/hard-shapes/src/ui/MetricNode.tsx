import type { ReactNode } from 'react';

interface MetricNodeProps {
  /**
   * An OBJECT LITERAL with a ReactNode member. Same misclassification as an array
   * of them: the prop was called a `node` and filled with a string, so
   * `node.value.toLocaleString()` threw. It is a data object and must be
   * synthesized from its shape.
   */
  node: { id: string; label: string; icon?: ReactNode; value: number };
  interactive?: boolean;
}

export const MetricNode = ({ node, interactive }: MetricNodeProps) => (
  <div data-interactive={interactive}>
    {node.icon}
    <span>{node.label}</span>
    <strong>{node.value.toLocaleString()}</strong>
  </div>
);
