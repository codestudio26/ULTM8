import { useEffect, useState } from 'react';
import { isNewLookOn, subscribeNewLook } from './look';

/** Whether the "Try the new look" switch is on, re-rendering when it changes. */
export function useNewLook(): boolean {
  const [on, setOn] = useState(isNewLookOn);
  useEffect(() => {
    setOn(isNewLookOn());
    return subscribeNewLook(setOn);
  }, []);
  return on;
}
