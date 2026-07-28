import { Button } from '../ui';

/**
 * Imports Button THROUGH the barrel (`../ui`). The credit must land on Button's
 * declaration file, and the barrel (`ui/index.ts`) must NOT be counted.
 */
export function Sidebar() {
  return (
    <aside>
      <Button>Menu</Button>
    </aside>
  );
}
