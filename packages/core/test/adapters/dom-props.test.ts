import { describe, it, expect } from 'vitest';
import { isDomNoiseProp } from '../../src/adapters/react/dom-props.js';

describe('isDomNoiseProp — drops React inherited DOM/ARIA surface', () => {
  it('drops every aria-* and data-*', () => {
    for (const n of ['aria-label', 'aria-atomic', 'aria-activedescendant', 'data-testid', 'data-x']) {
      expect(isDomNoiseProp(n)).toBe(true);
    }
  });

  it('drops the HTML global passthrough attributes', () => {
    for (const n of ['about', 'accessKey', 'className', 'style', 'id', 'role', 'tabIndex', 'title', 'dir', 'lang', 'hidden', 'spellCheck', 'dangerouslySetInnerHTML', 'suppressHydrationWarning']) {
      expect(isDomNoiseProp(n)).toBe(true);
    }
  });

  it('drops the exhaustive DOM event noise and every *Capture handler', () => {
    for (const n of ['onAbort', 'onAnimationStart', 'onTransitionEnd', 'onPointerMove', 'onTouchStart', 'onWheel', 'onScroll', 'onError', 'onLoad', 'onClickCapture', 'onChangeCapture', 'onKeyDownCapture']) {
      expect(isDomNoiseProp(n)).toBe(true);
    }
  });

  it('KEEPS the component\'s own semantic props', () => {
    for (const n of ['label', 'color', 'variant', 'size', 'value', 'disabled', 'type', 'name', 'placeholder', 'checked', 'defaultValue', 'onDelete', 'avatar', 'icon', 'clickable']) {
      expect(isDomNoiseProp(n)).toBe(false);
    }
  });

  it('KEEPS the common bubble-phase interaction handlers', () => {
    for (const n of ['onClick', 'onChange', 'onInput', 'onSubmit', 'onFocus', 'onBlur', 'onKeyDown', 'onKeyUp', 'onMouseEnter', 'onMouseLeave', 'onContextMenu', 'onCopy', 'onPaste', 'onDragStart', 'onDrop', 'onSelect']) {
      expect(isDomNoiseProp(n)).toBe(false);
    }
  });
});
