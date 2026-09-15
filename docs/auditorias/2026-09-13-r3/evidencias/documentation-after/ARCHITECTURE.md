# Arquitetura — estado auditado em 13/09/2026, R3

**Candidato:** HEAD `754f9bad` + worktree identificado por hashes na [auditoria R3](auditorias/2026-09-13-r3/RELATORIO.md). **Produção: NOT_READY.**

## Fluxo e runtimes

Gateway autenticado → desk-api → PostgreSQL (mensagem, recibos, estado e outbox) → message-worker/realtime-service → interface React. O worker processa intenção Secretary e entrega outbound; reconciliação e resultado durável da IA ainda exigem fechamento. Outbox/DLQ são persistentes.

| Runtime | Comportamento observado | Limite atual |
|---|---|---|
| desk-api | Sessões opacas, ação/recurso, webhook, operações transacionais, polling/readiness | Privacidade legada contorna núcleo; CAS opcional nas operações |
| message-worker | Outbox, leases/dedup, Secretary assíncrona, ACK/NACK/DLQ e health do loop | processing órfão pode receber ACK; recuperação de mídia pode saturar o pool |
| realtime-service | WebSocket autorizado e revalidado; handler health/readiness/metrics | CLI nativa falha ao importar metrics ESM/CommonJS; testes sob Vitest passam |
| desk-web | React, auth/me antes de consultas, Inbox/cadastros/Kanban/admin | Ações/contexto/mídia/vínculos/sincronização e matriz responsive/a11y incompletos |

## Persistência e contratos

Sessões armazenam hash e deadlines normal/absoluto/idle. PostgreSQL mantém outbox, consumidores, leases, DLQ, recibos e invocações IA. Retry autenticado com assinatura renovada e mesmo payload é aceito; recibo completed recebe2xx. Provas atuais desses dois defeitos são unitárias; confirmação provider/PG/crash permanece adicional.

unknown/processing não reabrem automaticamente a IA, mas falta retomada/reconciliação durável para processing órfão. Operações de conversa abrangem entidade/histórico/auditoria/outbox; expected* seguem opcionais e o cliente não os envia. Exigir versão ponta a ponta está planejado.

Mídia usa asset privado, quarentena e scan. Recovery agora é chamado pelo worker, inclui SCAN_FAILED e possui lease/backoff/tentativas; risco de concorrência pool10/lote50 precisa correção e prova PG real. Nova erasure verifica política/escopo, enquanto /anonymize legado ainda possui caminho separado inseguro.

## Observabilidade e inicialização

OTel SDK/configuração existem. Compose transmite METRICS_TOKEN para API/worker/realtime e Prometheus; scraper usa Bearer credentials_file. Handler realtime em produção responde503 sem token configurado,401 com credencial ausente/incorreta e200 com Bearer correto. Esses testes HTTP não provam scrape real.

A importação nomeada de metrics de @cvg/shared impede o entrypoint tsx observado de iniciar em Node24.20.0. PROD-05 atual falha no hook antes dos17 testes. Dockerfile usa esse comando, mas imagem real não foi executada nesta rodada. [Evidência](auditorias/2026-09-13-r3/evidencias/realtime-native-boot.log). PROD-44 corrige bootstrap; PROD-35/36 provam a imagem/ambiente final.

## Direção preservada

Manter módulos, outbox PostgreSQL e sessões opacas. Nenhum broker novo ou troca de stack foi justificado. Tutor–paciente permanece1:N, proposta N:N depende de D03; ferramentas IA desabilitadas por padrão dependem de D05. [Contratos](melhorias-2026-09-13-r3/CONTRATOS.md), [decisões](melhorias-2026-09-13-r3/DECISOES.md) e [roadmap](melhorias-2026-09-13-r3/ROADMAP.md).
