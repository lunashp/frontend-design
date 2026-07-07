/**
 * Extracts structural signals for a component (child components, JSX depth,
 * hooks, router/store/data-fetch usage, context consumers, client-ness). These
 * feed the pure Classifier — the adapter reads the AST, the classifier decides.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { ComponentDescriptor, ClassificationSignals } from '../../types/component.js';
import type { ReactProgramHandle } from './ts-program.js';
import { componentBodyOf, findComponentDeclaration } from './node-utils.js';

const ROUTER_HOOKS = /^(useNavigate|useRouter|useParams|useLocation|useSearchParams|usePathname)$/;
const STORE_HOOKS = /^(useSelector|useDispatch|useStore|useAtom|useAppSelector|useAppDispatch)$/;
const FETCH_HOOKS = /^(useQuery|useMutation|useInfiniteQuery|useSWR|useSWRInfinite)$/;
const ROUTER_TAGS = new Set(['Link', 'NavLink', 'Route', 'Routes', 'Outlet', 'Navigate']);
const KNOWN_CONTEXT_HOOKS = /^use(Theme|Auth|Session|User|Locale|Translation|Intl|I18n)$/;

const EMPTY: ClassificationSignals = {
  childComponentCount: 0,
  jsxDepth: 0,
  hookNames: [],
  usesRouter: false,
  usesStore: false,
  usesDataFetching: false,
  contextConsumers: [],
  isClientComponent: true,
  propCount: 0,
};

function jsxTagName(node: Node): string | null {
  if (Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node)) {
    return node.getTagNameNode().getText();
  }
  return null;
}

function jsxDepthOf(root: Node): number {
  let max = 0;
  const visit = (node: Node, depth: number): void => {
    const isElement =
      Node.isJsxElement(node) || Node.isJsxSelfClosingElement(node) || Node.isJsxFragment(node);
    const next = isElement ? depth + 1 : depth;
    if (next > max) max = next;
    node.forEachChild((child) => visit(child, next));
  };
  visit(root, 0);
  return max;
}

function firstParamPropCount(decl: Node): number {
  const fn = componentBodyOf(decl as never);
  if (!fn || !Node.isFunctionLikeDeclaration(fn)) return 0;
  const param = fn.getParameters()[0];
  if (!param) return 0;
  const binding = param.getNameNode();
  if (Node.isObjectBindingPattern(binding)) return binding.getElements().length;
  return 0;
}

function hasUseClientDirective(text: string): boolean {
  const head = text.trimStart().slice(0, 40);
  return /^['"]use client['"]/.test(head);
}

export function extractSignals(
  descriptor: ComponentDescriptor,
  handle: ReactProgramHandle,
): ClassificationSignals {
  const decl = findComponentDeclaration(handle, descriptor);
  if (!decl) return EMPTY;
  const body = componentBodyOf(decl);
  if (!body) return EMPTY;

  const childTags = new Set<string>();
  const hookNames = new Set<string>();
  const contextConsumers = new Set<string>();
  let usesRouter = false;
  let usesStore = false;
  let usesDataFetching = false;

  // Child components: capitalized JSX tags.
  for (const kind of [SyntaxKind.JsxOpeningElement, SyntaxKind.JsxSelfClosingElement]) {
    for (const el of body.getDescendantsOfKind(kind)) {
      const tag = jsxTagName(el);
      if (tag && /^[A-Z]/.test(tag)) {
        childTags.add(tag);
        if (ROUTER_TAGS.has(tag)) usesRouter = true;
      }
    }
  }

  // Hook calls + specific effects.
  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    const name = expr.getText();
    if (/^use[A-Z]/.test(name)) {
      hookNames.add(name);
      if (ROUTER_HOOKS.test(name)) usesRouter = true;
      if (STORE_HOOKS.test(name)) usesStore = true;
      if (FETCH_HOOKS.test(name)) usesDataFetching = true;
      if (KNOWN_CONTEXT_HOOKS.test(name) || /Context$/.test(name)) contextConsumers.add(name);
      if (name === 'useContext') {
        const arg = call.getArguments()[0];
        if (arg) contextConsumers.add(arg.getText());
      }
    } else if (name === 'fetch') {
      usesDataFetching = true;
    }
  }

  const isClientComponent =
    hasUseClientDirective(decl.getSourceFile().getFullText()) ||
    !handle.isNext ||
    hookNames.size > 0;

  return {
    childComponentCount: childTags.size,
    jsxDepth: jsxDepthOf(body),
    hookNames: [...hookNames],
    usesRouter,
    usesStore,
    usesDataFetching,
    contextConsumers: [...contextConsumers],
    isClientComponent,
    propCount: firstParamPropCount(decl),
  };
}
