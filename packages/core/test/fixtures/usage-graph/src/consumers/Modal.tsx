import Button from '../ui/Button/Button';

/**
 * DEFAULT import of Button. `traceNamedImports` bails on default imports, so the
 * usage index resolves the module specifier's default export to a declaration
 * and matches it to the same componentId the named importers credit.
 */
export function Modal() {
  return (
    <div role="dialog">
      <Button>OK</Button>
    </div>
  );
}
