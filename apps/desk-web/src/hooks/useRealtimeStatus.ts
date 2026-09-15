import { useEffect, useState } from 'react';
import { realtimeClient, type RealtimeClient, type RealtimeConnectionState } from '../lib/realtime';

/**
 * Observa o estado real de conexão do cliente de tempo real.
 * Aceita uma instância para testes/embed; por padrão usa o singleton do app.
 */
export function useRealtimeStatus(client: RealtimeClient = realtimeClient): RealtimeConnectionState {
  const [state, setState] = useState<RealtimeConnectionState>(() => client.getConnectionState());

  useEffect(() => {
    setState(client.getConnectionState());
    return client.subscribeConnectionState((next) => setState(next));
  }, [client]);

  return state;
}
