import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * C04/SA-008 — contexto de conversa vindo da URL.
 *
 * - `conversationId` só é aceito em formato UUID; qualquer outro valor é
 *   marcado como inválido para a tela exibir erro claro, sem chamar a API.
 * - `setConversationId(null)`/`clear` são a remoção EXPLÍCITA do filtro.
 * - back/refresh/deep-link preservam a seleção porque a URL é a fonte.
 */
export interface ConversationContext {
  conversationId: string | null;
  invalid: boolean;
  rawValue: string | null;
  setConversationId: (id: string | null) => void;
  clear: () => void;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useConversationContext(param = 'conversationId'): ConversationContext {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawValue = searchParams.get(param);
  const conversationId = useMemo(
    () => (rawValue && UUID_PATTERN.test(rawValue) ? rawValue : null),
    [rawValue],
  );
  const invalid = Boolean(rawValue) && conversationId === null;

  const setConversationId = useCallback((id: string | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set(param, id);
      else next.delete(param);
      return next;
    }, { replace: true });
  }, [param, setSearchParams]);

  const clear = useCallback(() => setConversationId(null), [setConversationId]);

  return { conversationId, invalid, rawValue, setConversationId, clear };
}
