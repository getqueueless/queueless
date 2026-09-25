import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

/** Live connectivity status. `isConnected` starts `true` (optimistic) until the first NetInfo event. */
export function useNetworkStatus(): { isConnected: boolean } {
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    return NetInfo.addEventListener((state) => {
      setIsConnected(state.isConnected ?? true);
    });
  }, []);

  return { isConnected };
}
