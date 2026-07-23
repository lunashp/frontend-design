import { Widget } from './Widget';

/**
 * A story file. It DOES import Widget, but story files are excluded from the ts
 * program, so this import is invisible to the usage index — which is exactly why
 * Widget legitimately reads 0 and must never be hidden on that basis.
 */
export const Default = () => <Widget />;
