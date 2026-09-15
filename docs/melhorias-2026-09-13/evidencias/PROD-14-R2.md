# PROD-14-R2 — Revalidacao do recovery de media

Data: 2026-09-13. Esta evidencia registra a correcao do achado BE-A04 no
worktree integrado. O backlog canonico permanece aberto; esta nota nao e
certificacao final nem autorizacao de deploy.

## Delta

- `0029_media_intake_recovery.sql` adiciona contador, lease, backoff e ultimo
  erro ao intake de mensagens, sem alterar migrations aplicadas.
- `recoverPendingInboundMedia` usa claim atomico com `FOR UPDATE SKIP LOCKED`,
  inclui `PENDING_SCAN`, `SCAN_FAILED` e `FAILED`, e limita tentativas.
- O `message-worker` executa recovery no poller no-overlap e espera tarefas de
  media no shutdown gracioso.
- O Compose entrega ao worker o mesmo storage S3 privado e scanner ClamAV do
  `desk-api`.
- O worker expõe `/metrics` com o mesmo Bearer token privado usado pelo
  Prometheus; staging materializa a credencial em tmpfs e injeta ao worker a
  configuração completa de S3/ClamAV/recovery.
- Assets da mesma mensagem e SHA256 sao atualizados no retry, evitando nova
  linha e removendo a copia de quarentena apos `CLEAN`.

## Provas

| Prova | Resultado |
|---|---|
| `prod-14.test.ts` | 13/13 PASS com PostgreSQL isolado, moto S3 e ClamAV real |
| BE-A04 scanner indisponivel -> CLEAN | PASS; lease liberado e asset unico |
| BE-A04 `SCAN_FAILED` -> CLEAN | PASS; mesmo asset promovido |
| BE-A04 owners concorrentes | PASS; uma unica reclamacao e um asset |
| BE-A04 limite de retry | PASS; `retry_exhausted:scanner_unavailable`, sem hot loop |
| `prod-15.test.ts` | 12/12 PASS com PostgreSQL isolado, moto S3 e ClamAV real |
| Fresh migration check | PASS; 41 tabelas e indice `idx_messages_media_intake_recovery` |
| Message worker `/metrics` | PASS; token obrigatório em produção, sem token 401/503 conforme configuração |
| Compose produção/staging | PASS; configuração resolvida sem erro (apenas warning de `version` obsoleto) |
| Typecheck afetado | PASS: database, media, chat, message-worker e desk-api |
| Lint/diff | PASS; warnings do chat sao baseline, sem erros novos |

## Artefatos

- `docs/producao-2026-09-13/evidencias/prod-14/prod-14-evidence.json`
- `docs/producao-2026-09-13/evidencias/prod-15/prod-15-evidence.json`
- `docs/producao-2026-09-13/evidencias/integration-runs/prod14-migcheck/`
- `docs/producao-2026-09-13/evidencias/R2-REVALIDACAO-2026-09-13.md`

## Limitacoes

- O ensaio comprova o estado equivalente a crash apos commit e antes do
  enqueue, mas nao mata um processo real com `SIGKILL` nessa janela.
- MinIO/Compose permanecem BLOCKED pela permissao do socket Docker; moto e um
  sandbox S3 por protocolo.
- Nao alterar `BACKLOG.json` para converter esta revalidacao em DONE; o
  integrador deve decidir o fechamento apos os gates restantes.
