# LGPD_DATA_SUBJECT_REQUESTS — CVG Connect Desk (LGPD arts. 18–19)

## Direitos atendidos

| Direito | Endpoint | Auth | Efeito |
|---|---|---|---|
| Confirmação + acesso (art. 18, I–II) | `GET /privacy/contacts/:id/export?reason=` | `admin:read` | pacote JSON: contato, conversas, mensagens, notas, labels, grupos, setores, transferências, referências de auditoria (sem old/new values) |
| Anonimização (art. 18, VI) | `POST /privacy/contacts/:id/anonymize {reason, requestId?}` | `admin:write` | PII direto anonimizado; histórico preservado |

## Anonimização (preferida à exclusão)

- `contacts.{phone,name,email,externalId,metadata}` → marcadores irreversíveis;
- `messages.sender` **somente** quando igual ao telefone do titular (outbound da equipe intacto);
- linhas e FKs preservadas (conversas, tarefas, auditoria continuam íntegras);
- conteúdo operacional das mensagens é **mantido** (obrigação operacional documentada;
  reavaliar com jurídico para retenção total).

## Retention policy (base)

- Logs operacionais (sem PII além de máscaras): 90 dias.
- `webhook_replay_log`: TTL 24h. Mídia em quarentena INFECTED: 7 dias, depois excluir.
- Backups: retenção 14 dias (`pg-backup.sh`), criptografia em repouso pelo provedor do volume.

## Auditoria

Toda operação grava `audit_logs` (`lgpd.export`/`lgpd.anonymize`) com
actor, reason, requestId, scope, counts/result e timestamp. Sem `reason` a API
rejeita (400) — pedido sem motivo documentado não executa.

## Não coberto (lacunas honestas)

- Portabilidade automatizada entre controladores (export manual via endpoint);
- eliminação física de backups (depende da retenção do provedor);
- DPO workflow (fora do escopo do código).
