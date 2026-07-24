// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LocalPreview } from '../src/features/preview/LocalPreview.js';

/**
 * The preview posts degraded-merge warnings (a prop edit that couldn't be
 * spliced into the entry) up to the embedder. Previously they reached only the
 * iframe console, so an edit that silently didn't take had no UI-level signal.
 * This proves LocalPreview surfaces them — and only from ITS OWN frame, and
 * clears them when a new build starts.
 */

afterEach(cleanup);

function postFromFrame(source: Window | null, data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { source: source as Window, data }));
}

describe('LocalPreview — preview warnings', () => {
  it('surfaces warnings the preview posts up', () => {
    const onWarnings = vi.fn();
    const { container } = render(
      <LocalPreview projectRoot="/p" id="c1" onWarnings={onWarnings} />,
    );
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    onWarnings.mockClear(); // ignore the initial reset-on-mount

    postFromFrame(iframe.contentWindow, {
      type: 'ce:preview-warnings',
      messages: ["Required prop(s) couldn't be auto-filled: handleNext"],
    });
    expect(onWarnings).toHaveBeenCalledWith(["Required prop(s) couldn't be auto-filled: handleNext"]);
  });

  it('ignores a message from a DIFFERENT window (not its iframe)', () => {
    const onWarnings = vi.fn();
    render(<LocalPreview projectRoot="/p" id="c1" onWarnings={onWarnings} />);
    onWarnings.mockClear();
    // A message whose source is not the preview iframe must be ignored.
    postFromFrame(window, { type: 'ce:preview-warnings', messages: ['spoofed'] });
    expect(onWarnings).not.toHaveBeenCalled();
  });

  it('ignores an unrelated message type from its frame', () => {
    const onWarnings = vi.fn();
    const { container } = render(
      <LocalPreview projectRoot="/p" id="c1" onWarnings={onWarnings} />,
    );
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    onWarnings.mockClear();
    postFromFrame(iframe.contentWindow, { type: 'ce:escape' });
    expect(onWarnings).not.toHaveBeenCalled();
  });

  it('clears warnings when the preview navigates to a new component', () => {
    const onWarnings = vi.fn();
    const { rerender } = render(<LocalPreview projectRoot="/p" id="c1" onWarnings={onWarnings} />);
    onWarnings.mockClear();
    // A new id changes the src → a fresh build → stale warnings must clear.
    rerender(<LocalPreview projectRoot="/p" id="c2" onWarnings={onWarnings} />);
    expect(onWarnings).toHaveBeenCalledWith([]);
  });
});
