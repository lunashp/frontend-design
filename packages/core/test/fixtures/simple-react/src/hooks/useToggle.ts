import { useCallback, useState } from 'react';

/** A trivial hook used to test hook detection and classification signals. */
export function useToggle(initial = false): readonly [boolean, () => void] {
  const [on, setOn] = useState(initial);
  const toggle = useCallback(() => setOn((v) => !v), []);
  return [on, toggle];
}
