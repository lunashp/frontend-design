import { describe, it, expect } from 'vitest';
import { componentRole } from '../../src/classify/role.js';
import type { ClassificationSignals } from '../../src/types/component.js';

/** A signals bag with every field defaulted, so a case sets only what it exercises. */
function sig(over: Partial<ClassificationSignals> = {}): ClassificationSignals {
  return {
    childComponentCount: 0,
    jsxDepth: 1,
    hookNames: [],
    usesRouter: false,
    usesStore: false,
    usesDataFetching: false,
    contextConsumers: [],
    isClientComponent: true,
    propCount: 0,
    domTags: [],
    ariaRoles: [],
    ...over,
  };
}

describe('componentRole — one high-confidence role per source', () => {
  it('reads a form control from its NAME', () => {
    expect(componentRole('TextField', sig(), [])).toBe('form-control');
    expect(componentRole('EmailInput', sig(), [])).toBe('form-control');
    expect(componentRole('CountrySelect', sig(), [])).toBe('form-control');
    expect(componentRole('AgreeCheckbox', sig(), [])).toBe('form-control');
  });

  it('reads a form control from the value+onChange PROP contract', () => {
    // A controlled input's contract is unmistakable even when the name is opaque.
    expect(componentRole('Widget', sig(), ['value', 'onChange'])).toBe('form-control');
    expect(componentRole('Widget', sig(), ['checked', 'onChange'])).toBe('form-control');
  });

  it('reads a form control from a rendered <input>/<select>/<textarea>', () => {
    expect(componentRole('Widget', sig({ domTags: ['input'] }), [])).toBe('form-control');
    expect(componentRole('Widget', sig({ domTags: ['label', 'select'] }), [])).toBe('form-control');
  });

  it('reads a data display from its NAME', () => {
    expect(componentRole('UserTable', sig(), [])).toBe('data-display');
    expect(componentRole('ProductList', sig(), [])).toBe('data-display');
    expect(componentRole('StatCard', sig(), [])).toBe('data-display');
  });

  it('reads a data display from rendered table/list DOM', () => {
    expect(componentRole('Widget', sig({ domTags: ['table', 'thead', 'tbody', 'tr'] }), [])).toBe(
      'data-display',
    );
    expect(componentRole('Widget', sig({ domTags: ['dl', 'dt', 'dd'] }), [])).toBe('data-display');
  });

  it('reads navigation from its NAME', () => {
    expect(componentRole('MainNav', sig(), [])).toBe('navigation');
    expect(componentRole('Breadcrumbs', sig(), [])).toBe('navigation');
    expect(componentRole('Pagination', sig(), [])).toBe('navigation');
    expect(componentRole('TabList', sig(), [])).toBe('navigation');
  });

  it('reads navigation from a <nav> element or role="navigation"', () => {
    expect(componentRole('Widget', sig({ domTags: ['nav'] }), [])).toBe('navigation');
    expect(componentRole('Widget', sig({ ariaRoles: ['navigation'] }), [])).toBe('navigation');
  });

  it('reads feedback/overlay from its NAME', () => {
    expect(componentRole('ConfirmModal', sig(), [])).toBe('feedback');
    expect(componentRole('ErrorToast', sig(), [])).toBe('feedback');
    expect(componentRole('InfoTooltip', sig(), [])).toBe('feedback');
  });

  it('reads feedback from the open+onClose / anchorEl PROP contract', () => {
    expect(componentRole('Widget', sig(), ['open', 'onClose'])).toBe('feedback');
    expect(componentRole('Widget', sig(), ['anchorEl'])).toBe('feedback');
  });

  it('reads feedback from role="dialog|alert|status"', () => {
    expect(componentRole('Widget', sig({ ariaRoles: ['dialog'] }), [])).toBe('feedback');
    expect(componentRole('Widget', sig({ ariaRoles: ['alert'] }), [])).toBe('feedback');
  });

  it('reads an action from its NAME', () => {
    expect(componentRole('SubmitButton', sig(), [])).toBe('action');
    expect(componentRole('IconButton', sig(), [])).toBe('action');
  });

  it('reads an action from onClick without a value, on a leaf', () => {
    expect(componentRole('Widget', sig(), ['onClick', 'disabled'])).toBe('action');
  });

  it('reads a layout from its NAME', () => {
    expect(componentRole('PageLayout', sig(), [])).toBe('layout');
    expect(componentRole('FlexRow', sig(), [])).toBe('layout');
    expect(componentRole('Stack', sig(), [])).toBe('layout');
  });
});

describe('componentRole — conservative precedence (a container never steals its own children)', () => {
  it('a Modal that contains an input is feedback, not a form control', () => {
    // The overlay identity dominates: its descendant <input>/<button> must not
    // outrank what the component itself IS.
    expect(
      componentRole('SettingsModal', sig({ domTags: ['input', 'button'] }), ['open', 'onClose']),
    ).toBe('feedback');
  });

  it('a Navbar full of buttons is navigation, not an action', () => {
    expect(componentRole('Navbar', sig({ domTags: ['nav', 'button', 'a'] }), [])).toBe('navigation');
  });

  it('does NOT read an SVG icon as an action from an inherited onClick', () => {
    // An icon typed `SVGAttributes<SVGElement>` expands to dozens of DOM handlers
    // including onClick; rendering only <svg>/<path>, it is not an action. The
    // onClick signal is trusted only on a FOCUSED prop contract.
    const iconProps = [
      'onClick', 'onFocus', 'onBlur', 'onMouseDown', 'onMouseUp', 'onKeyDown',
      'className', 'style', 'width', 'height', 'viewBox', 'fill',
    ];
    expect(componentRole('ChevronRight', sig({ domTags: ['svg', 'path'] }), iconProps)).toBe(
      'other',
    );
  });

  it('does NOT read an action from a stray descendant <button> in a composition', () => {
    // onClick is everywhere; a weak DOM-only button signal is only trusted on a
    // leaf, so a multi-child organism with a nested button stays uncommitted.
    expect(componentRole('Widget', sig({ domTags: ['button'], childComponentCount: 5 }), [])).toBe(
      'other',
    );
  });
});

describe('componentRole — unknown when no signal is decisive', () => {
  it('returns other for an opaque name, no telling DOM, no telling props', () => {
    expect(componentRole('Widget', sig(), ['title', 'subtitle'])).toBe('other');
    expect(componentRole('Thing', sig({ domTags: ['div', 'span'] }), ['className'])).toBe('other');
  });
});
