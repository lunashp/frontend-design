/**
 * The preview iframe is sandboxed to an opaque origin (allow-scripts, and
 * deliberately no allow-same-origin), so its key events are invisible to the
 * embedder and the bridge script is the only way Escape/Tab reach the Inspector.
 * There is no jsdom in this repo, so the script — plain ES5 by design — is driven
 * inside a `node:vm` context with a hand-built window/document, which tests the
 * real behaviour rather than the presence of a substring.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import { PREVIEW_KEYBOARD_BRIDGE, renderPreviewHtml } from '../src/bundle-preview.js';

interface Posted {
  readonly message: { readonly type?: string; readonly shiftKey?: boolean };
  readonly targetOrigin: string;
}

interface FakeElement {
  offsetParent: object | null;
}

interface FakeKeyEvent {
  key: string;
  shiftKey?: boolean;
  preventDefault: () => void;
}

interface FakeMessageEvent {
  source: unknown;
  data: unknown;
}

/**
 * Run the bridge against a fake document and return a driver for it.
 *
 * `embedder: 'listening'` (the default) performs the embedder's half of the
 * handshake, because that is the state every assertion about key forwarding is
 * about. `'silent'` is the case that matters for keyboard traps: nobody is
 * listening, so the bridge must not touch the key.
 */
function mountBridge(
  options: {
    stops?: FakeElement[];
    active?: FakeElement | null;
    embedder?: 'listening' | 'silent';
  } = {},
) {
  const stops = options.stops ?? [];
  const all: Posted[] = [];
  let onKeyDown: ((event: FakeKeyEvent) => void) | undefined;
  let onMessage: ((event: FakeMessageEvent) => void) | undefined;

  const parentWindow = {
    postMessage: (message: Posted['message'], targetOrigin: string) =>
      all.push({ message, targetOrigin }),
  };
  const sandbox = {
    window: {
      addEventListener: (type: string, handler: (event: never) => void) => {
        if (type === 'keydown') onKeyDown = handler;
        if (type === 'message') onMessage = handler;
      },
    },
    document: { activeElement: options.active ?? null, querySelectorAll: () => stops },
    parent: parentWindow,
    location: { protocol: 'http:', host: '127.0.0.1:4173' },
  };
  runInNewContext(PREVIEW_KEYBOARD_BRIDGE, sandbox);

  /** The embedder answering the bridge's announcement. */
  const ack = (source: unknown = parentWindow) =>
    onMessage?.({ source, data: { type: 'ce:embedder-ready' } });
  if ((options.embedder ?? 'listening') === 'listening') ack();

  let prevented = 0;
  const press = (key: string, shiftKey = false) => {
    onKeyDown?.({ key, shiftKey, preventDefault: () => (prevented += 1) });
  };
  return {
    /** Forwarded keys only; the readiness announcement has its own accessor. */
    get posted(): Posted[] {
      return all.filter((p) => p.message.type !== 'ce:preview-ready');
    },
    announced: (): Posted[] => all.filter((p) => p.message.type === 'ce:preview-ready'),
    ack,
    press,
    prevented: () => prevented,
    registered: () => onKeyDown !== undefined,
  };
}

const el = (): FakeElement => ({ offsetParent: {} });

describe('preview keyboard bridge', () => {
  it('registers a keydown listener inside the preview document', () => {
    expect(mountBridge().registered()).toBe(true);
  });

  it('forwards Escape to the embedder', () => {
    const bridge = mountBridge();
    bridge.press('Escape');

    expect(bridge.posted).toHaveLength(1);
    expect(bridge.posted[0].message).toEqual({ type: 'ce:escape' });
  });

  it('addresses the embedder origin, never a wildcard', () => {
    const bridge = mountBridge();
    bridge.press('Escape');

    // '*' would hand the message to a hostile page that framed the preview.
    expect(bridge.posted[0].targetOrigin).toBe('http://127.0.0.1:4173');
    expect(bridge.posted.map((p) => p.targetOrigin)).not.toContain('*');
  });

  it('ignores keys the embedder has no handler for', () => {
    const bridge = mountBridge();
    bridge.press('a');
    bridge.press('Enter');

    expect(bridge.posted).toEqual([]);
  });

  it('leaves Tab alone inside the previewed component', () => {
    const [first, middle, last] = [el(), el(), el()];
    const bridge = mountBridge({ stops: [first, middle, last], active: middle });
    bridge.press('Tab');

    // The preview has to stay usable for testing a component's own keyboard
    // behaviour, so only the edges of its tab order are forwarded.
    expect(bridge.posted).toEqual([]);
    expect(bridge.prevented()).toBe(0);
  });

  it('hands focus back at the end of the preview tab order', () => {
    const [first, last] = [el(), el()];
    const bridge = mountBridge({ stops: [first, last], active: last });
    bridge.press('Tab');

    expect(bridge.prevented()).toBe(1);
    expect(bridge.posted[0].message).toEqual({ type: 'ce:tab-out', shiftKey: false });
  });

  it('hands focus back at the start of it when shift-tabbing', () => {
    const [first, last] = [el(), el()];
    const bridge = mountBridge({ stops: [first, last], active: first });
    bridge.press('Tab', true);

    expect(bridge.posted[0].message).toEqual({ type: 'ce:tab-out', shiftKey: true });
  });

  it('hands focus back immediately when the preview has nothing focusable', () => {
    const bridge = mountBridge({ stops: [] });
    bridge.press('Tab');

    // Otherwise Tab strands the user on an iframe that can never yield focus.
    expect(bridge.prevented()).toBe(1);
    expect(bridge.posted[0].message).toEqual({ type: 'ce:tab-out', shiftKey: false });
  });

  it('skips hidden elements when deciding where the tab order ends', () => {
    const visible = el();
    const hidden: FakeElement = { offsetParent: null };
    const bridge = mountBridge({ stops: [visible, hidden], active: visible });
    bridge.press('Tab');

    expect(bridge.posted[0].message).toEqual({ type: 'ce:tab-out', shiftKey: false });
  });
});

/**
 * Intercepting Tab is only safe while someone is on the other end to move focus.
 * When the sender was unconditional and the receiver was not, every viewport
 * wider than the inspector's compact breakpoint became a WCAG 2.1.2 keyboard
 * trap: preventDefault() fired and nothing moved focus. So the bridge asks
 * first, and no answer means it keeps its hands off the key.
 */
describe('preview keyboard bridge handshake', () => {
  it('announces itself so an embedder can declare it is listening', () => {
    const bridge = mountBridge({ embedder: 'silent' });

    expect(bridge.announced()).toHaveLength(1);
    expect(bridge.announced()[0].message).toEqual({ type: 'ce:preview-ready' });
    expect(bridge.announced()[0].targetOrigin).toBe('http://127.0.0.1:4173');
  });

  it('leaves Tab to the browser while no embedder has answered', () => {
    const bridge = mountBridge({ stops: [], embedder: 'silent' });
    bridge.press('Tab');

    // Native Tab moves focus out of the frame by itself. Swallowing it here with
    // nobody to hand focus to is precisely the trap.
    expect(bridge.prevented()).toBe(0);
    expect(bridge.posted).toEqual([]);
  });

  it('starts forwarding Tab once the embedder answers', () => {
    const bridge = mountBridge({ stops: [], embedder: 'silent' });
    bridge.ack();
    bridge.press('Tab');

    expect(bridge.prevented()).toBe(1);
    expect(bridge.posted[0].message).toEqual({ type: 'ce:tab-out', shiftKey: false });
  });

  it('ignores an acknowledgement that did not come from the embedder', () => {
    const bridge = mountBridge({ stops: [], embedder: 'silent' });
    // A nested frame or an unrelated window cannot talk us into trapping keys.
    bridge.ack({ postMessage: () => undefined });
    bridge.press('Tab');

    expect(bridge.prevented()).toBe(0);
    expect(bridge.posted).toEqual([]);
  });

  it('still reports Escape with no embedder, since it never swallows the key', () => {
    const bridge = mountBridge({ embedder: 'silent' });
    bridge.press('Escape');

    expect(bridge.posted[0].message).toEqual({ type: 'ce:escape' });
    expect(bridge.prevented()).toBe(0);
  });
});

describe('renderPreviewHtml', () => {
  it('ships the bridge inside the preview document', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-preview-test-'));
    try {
      const html = await renderPreviewHtml({
        targetRoot: root,
        spec: {
          files: { '/index.js': 'document.getElementById("root").textContent = "hi";' },
          entryPath: '/index.js',
          template: 'react-ts',
          dependencies: {},
          renderability: 'full',
          notes: [],
        },
      });

      expect(html).toContain(PREVIEW_KEYBOARD_BRIDGE);
      expect(html).toContain('ce:escape');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
