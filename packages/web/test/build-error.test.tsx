// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BuildError } from '../src/features/inspector/BuildError.js';

/**
 * The four live tabs (Preview / Variants / Portable / Customize) all hang off one
 * artifact build. When it fails they used to collapse to a single grey line with
 * no diagnosis and no way forward — the highest-traffic dead end in the app. This
 * proves the replacement: the engine's message is shown, and Retry is wired.
 */
describe('BuildError', () => {
  it('names the component and shows the engine message verbatim', () => {
    render(
      <BuildError
        error="Cannot resolve module './missing'"
        componentName="CustomChip"
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/Couldn't build CustomChip/i)).toBeTruthy();
    expect(screen.getByText(/Cannot resolve module '\.\/missing'/)).toBeTruthy();
  });

  it('offers a Retry that calls back', () => {
    const onRetry = vi.fn();
    render(<BuildError error={null} componentName="X" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('omits the detail block when the engine gave no message', () => {
    const { container } = render(
      <BuildError error={null} componentName="X" onRetry={() => {}} />,
    );
    // No <pre> when there is nothing to quote — the panel still explains + retries.
    expect(container.querySelector('pre')).toBeNull();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('is announced as an alert', () => {
    render(<BuildError error="boom" componentName="X" onRetry={() => {}} />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
