/**
 * A component that spreads `...props` onto a DOM element (or wraps a library
 * component like MUI's Chip) inherits React's ENTIRE global attribute surface —
 * every `aria-*`, every HTML global (`about`, `accessKey`, `className`, …), and
 * the exhaustive DOM event list (`onAbort`, `onAnimationStart`, `onPointerMove`,
 * every `*Capture` variant). react-docgen surfaces all of them as "props", so a
 * MUI wrapper reports ~290 props and its five real ones (`label`, `color`,
 * `variant`, `onDelete`, `avatar`) drown in the noise, and the sandbox tries to
 * fill some of them (an icon prop with a string → a runtime warning).
 *
 * This drops that inherited surface so the prop model is the component's OWN API.
 * The rule is deliberately CONSERVATIVE: it removes only names that are never a
 * meaningful design prop. Ambiguous names that overlap a real API — `color`,
 * `size`, `value`, `disabled`, `type`, `name`, `placeholder`, `checked` — are
 * kept, as are the interaction handlers a component genuinely exposes (`onClick`,
 * `onChange`, `onFocus`, `onKeyDown`, `onMouse*`, `onDrag*`, `onSelect`, …).
 */

/** Non-event HTML/global attributes that are pure DOM passthrough, never a design prop. */
const HTML_GLOBAL_ATTRS: ReadonlySet<string> = new Set([
  'about', 'accessKey', 'autoCapitalize', 'autoCorrect', 'autoSave', 'className',
  'contentEditable', 'contextMenu', 'dangerouslySetInnerHTML', 'datatype', 'dir',
  'draggable', 'enterKeyHint', 'exportparts', 'hidden', 'id', 'inert', 'inputMode',
  'is', 'itemID', 'itemProp', 'itemRef', 'itemScope', 'itemType', 'lang', 'nonce',
  'part', 'popover', 'popoverTarget', 'popoverTargetAction', 'prefix', 'property',
  'radioGroup', 'resource', 'results', 'role', 'security', 'slot', 'spellCheck',
  'style', 'suppressContentEditableWarning', 'suppressHydrationWarning', 'tabIndex',
  'translate', 'typeof', 'unselectable', 'vocab',
  // NOT here, though it is an HTML global: `title`. It is also one of the most
  // common real design props — a dialog's, a card's, a section's — and dropping
  // it removed a declared `title` from 89 components on the real target, leaving
  // their previews as boxes with no words in them. It belongs with the other
  // ambiguous names this filter deliberately keeps (`color`, `size`, `value`).
]);

// Media / animation / transition / pointer / touch / wheel / scroll / load / error
// DOM events — the exhaustive surface a component never means to expose.
const NOISE_EVENT_BASE =
  /^on(Abort|CanPlay|CanPlayThrough|DurationChange|Emptied|Encrypted|Ended|LoadedData|LoadedMetadata|LoadStart|Load|Pause|Playing|Play|Progress|RateChange|Seeked|Seeking|Stalled|Suspend|TimeUpdate|VolumeChange|Waiting|Animation|Transition|Pointer|Touch|Wheel|Scroll|GotPointerCapture|LostPointerCapture|AuxClick|BeforeInput|Error)/;

/** True for a prop inherited from React's global DOM/ARIA attribute surface. */
export function isDomNoiseProp(name: string): boolean {
  if (/^(aria|data)-/.test(name)) return true;
  if (HTML_GLOBAL_ATTRS.has(name)) return true;
  // Every capture-phase handler (`onClickCapture`, …) is noise; the bubble-phase
  // interaction handlers (`onClick`, `onChange`, …) are kept.
  if (name.startsWith('on') && name.endsWith('Capture')) return true;
  if (NOISE_EVENT_BASE.test(name)) return true;
  return false;
}
