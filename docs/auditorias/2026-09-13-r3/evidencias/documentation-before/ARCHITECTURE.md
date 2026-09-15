# Arquitetura — estado auditado em13/09/2026

**Candidato:** `754f9bad` + worktree identificado na [auditoria de entregas](auditorias/2026-09-13-entregas/RELATORIO.md). Estado de produção: NOT_READY.

## Fluxo e runtimes

Gateway autenticado → desk-api → PostgreSQL (mensagem, estado, recibos e outbox) → message-worker / realtime-service → interface React. O worker processa intenção de Secretary; resposta passa pela entrega outbound e sua reconciliação. O processamento de mídia começa após persistência; sua recuperação durável ainda precisa de integração ao runtime.

| Runtime | Responsabilidade atual | Limite auditado |
|---|---|---|
| desk-api | HTTP, autenticação, ação/recurso, webhooks, operações transacionais, polling e readiness | Retry reassinado e rota legada de anonimização ainda precisam correção |
| message-worker | Consumidor outbox, efeitos deduplicados, Secretary assíncrona, ACK/NACK/DLQ, health do processo/loop | Reconciliação unknown e comportamento sob lease expirado/provider lento precisam fechamento |
| realtime-service | WebSocket por mensagem, autorização/revalidação, fanout e health/readiness | Matriz multirréplica e revogação integrais precisam prova atual |
| desk-web | React, bootstrap /auth/me, Inbox/cadastros/Kanban/admin | Contexto, mídia, ações, sincronização e responsive ainda incompletos |

## Persistência e contratos

Sessões opacas armazenam hash e preservam deadlines normal/absoluto/idle. PostgreSQL mantém outbox com consumidores e leases por owner/generation, DLQ persistente, recibos de ingresso/envio e registros de invocação IA. Transações operacionais abrangem entidade/histórico/auditoria/outbox; precondição de versão ainda é opcional em operações de conversa.

Mídia usa asset privado, quarentena e scan; DTOs evitam expor URL de origem. Recovery existente é chamado por migração/testes, sem ligação automática observada no runtime. A nova erasure verifica política e escopo; /anonymize legado ainda possui caminho separado inseguro.

OTel SDK e configuração de exportação existem; Compose transmite variáveis aos runtimes. Isso não prova spans completos no Collector nem alertas roteados. Conexões WebSocket em memória não significam outbox ou DLQ em memória.

## Decisões preservadas

Manter módulos, outbox PostgreSQL e sessões opacas; nenhum novo broker ou troca de stack é justificado pela auditoria. Tutor–paciente continua1:N no código, com proposta N:N e D03 aberta. Ferramentas IA permanecem desabilitadas por padrão com D05 aberta. D02 e condições operacionais continuam dependentes dos responsáveis.

Contratos e diferenças obrigatórias estão em [CONTRATOS](melhorias-2026-09-13/CONTRATOS.md); plano de evolução em [roadmap](melhorias-2026-09-13/ROADMAP.md). Este documento descreve código observado e limites, não certificação.
