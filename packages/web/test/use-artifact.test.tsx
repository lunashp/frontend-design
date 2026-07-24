// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

// Mock the transport so no host is needed. The hook's job is orchestration:
// memoize, expose status, and let Retry bust the memo after a failure.
const getArtifact = vi.fn();
vi.mock('../src/api/client.js', () => ({ getArtifact: (...a: unknown[]) => getArtifact(...a) }));

import { clearArtifactCache, useArtifact } from '../src/api/useArtifact.js';

function Probe({ id }: { id: string | null }) {
  const s = useArtifact('/proj', id);
  return (
    <div>
      <span data-testid="status">{s.status}</span>
      <span data-testid="error">{s.error ?? ''}</span>
      <span data-testid="name">{s.artifact?.descriptor.name ?? ''}</span>
      <button type="button" onClick={s.reload}>
        retry
      </button>
    </div>
  );
}

const fakeArtifact = (name: string) =>
  ({ descriptor: { name } }) as unknown as Awaited<ReturnType<typeof getArtifact>>;

beforeEach(() => {
  clearArtifactCache();
  getArtifact.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('useArtifact', () => {
  it('resolves to ready and exposes the built artifact', async () => {
    getArtifact.mockResolvedValueOnce(fakeArtifact('Button'));
    render(<Probe id="c1" />);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(screen.getByTestId('name').textContent).toBe('Button');
  });

  it('surfaces the engine error message on failure', async () => {
    getArtifact.mockRejectedValueOnce(new Error('bundle blew up'));
    render(<Probe id="c1" />);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
    expect(screen.getByTestId('error').textContent).toBe('bundle blew up');
  });

  it('Retry rebuilds after a failure instead of re-reading an empty cache', async () => {
    getArtifact.mockRejectedValueOnce(new Error('transient')); // first build fails
    getArtifact.mockResolvedValueOnce(fakeArtifact('Recovered')); // retry succeeds
    render(<Probe id="c1" />);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));

    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(screen.getByTestId('name').textContent).toBe('Recovered');
    expect(getArtifact).toHaveBeenCalledTimes(2);
  });

  it('a re-open hits the memo — no second build for the same id', async () => {
    getArtifact.mockResolvedValue(fakeArtifact('Cached'));
    const { rerender } = render(<Probe id="c1" />);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    // Bounce to Details (id null) and back — the classic Preview<->Details flap.
    act(() => rerender(<Probe id={null} />));
    act(() => rerender(<Probe id="c1" />));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(getArtifact).toHaveBeenCalledTimes(1);
  });
});
