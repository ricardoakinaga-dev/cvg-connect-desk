# Auditoria plataforma/CI/evidências



Veredito: avanços reais, candidato não qualificado. 94/94 testes puros passam; três adversariais novos são aceitos indevidamente pelo gate. Nenhum banco existente, Docker ou deploy usado.



## OPS01 — High — Digest esperado é ignorado na reavaliação

scripts/triple-aaa-verify.mjs:160 · PROD-02 · G01/G09 · confiança high

O CLI passa o candidato selado ao evaluateGate e compara drift somente commit/lock/source. --evaluate --image-digest diferente aceita o digest antigo com VERIFIED_CANDIDATE exit 0.

Reprodução: `node /tmp/cvg-audit-deliveries-ufq9_ejh/ops/probe.mjs`

Backlog: Comparar imageDigest live/selado e exigir identidade de imagem não vazia para gates de imagem; regressão trocar apenas digest.



## OPS02 — High — Manifesto contraditório com log vazio recebe PASS

scripts/production/evidence-gate.mjs:544 · PROD-02 · G01/G08 · confiança high

evaluateCheck aceita command=true em check pnpm typecheck, exitCode=99, log vazio hash correto e timestamp 2099; não valida comando esperado, exit 0, log não vazio, futuro, run/attempt. Reprodução direta retorna PASS sem razões.

Reprodução: `node /tmp/cvg-audit-deliveries-ufq9_ejh/ops/probe.mjs`

Backlog: Validar comando/escopo efetivos, exitCode/status, janela temporal, metadados e log não vazio; coverage exige métricas/denominadores e thresholds em vez de só status.



## OPS03 — High — Query-performance sem medição recebe PASS

scripts/production/evidence-gate.mjs:371 · PROD-02/33 · G01/G11 · confiança high

queries:[{}] satisfaz minEntries=1 e ausência de acceptable:false/error; nenhum SQL, plano, tempo, dataset ou orçamento é exigido.

Reprodução: `node /tmp/cvg-audit-deliveries-ufq9_ejh/ops/probe.mjs`

Backlog: Schema por query exige identidade, plano/medição e orçamento, dataset/perfil; rejeitar objeto vazio e conjunto incompleto.



## OPS04 — High — Evento desconhecido cai silenciosamente em push

.github/scripts/certification-aggregator.mjs:451 · PROD-03 · G01/G09 · confiança high

main resolve EVENT desconhecido como push; typo release pode remover coverage-global/load/DR obrigatórios do release. A própria evidência RELATORIO-CORRECOES de PROD02 registra L5 aberto.

Reprodução: `Inspeção main requestedEvent/POLICIES fallback.`

Backlog: Rejeitar enum desconhecido com exit não zero; testes EVENT=relase e dispatch sem política; manter required congelado por evento.



## OPS05 — High — Smoke real MinIO não consegue provar delete

scripts/staging-smoke.mjs:42 · PROD-32 · G04/G10 · confiança high

DeleteObjectCommand não é importado na linha 11 e é instanciado na 42 (ReferenceError após put/get); HEAD de objeto apagado lança 404 e condição tem || true.

Reprodução: `Inspeção import versus uso; não executado para evitar serviços externos.`

Backlog: Importar DeleteObjectCommand, aceitar somente HEAD 404 esperado, remover tautologia, provar erro/credenciais/objeto e scanner com reais isolados.



## OPS06 — High — Prova de imagem identifica build local, sem ligação com boot/scan/entrega

.github/workflows/triple-aaa-gate.yml:222 · PROD-35/03 · G09 · confiança high

Image identity extrai docker inspect .Id; builds próprios efêmeros não são publicados ou executados nesse job. Agregador valida formato/nomes/commit, sem comparar digest consumido no Smoke E2E/scans. SHA source não prova identidade de imagem entregue.

Reprodução: `Inspeção jobs image-identity e REQUIRED image=true somente image-identity.`

Backlog: Build once, registry manifest digest por serviço, boot/scan/E2E usando mesmos digests; agregador compara artefatos e source/lock/run.



## OPS07 — High — Conjunto entregue não sela candidato atual

docs/producao-2026-09-13/evidencias/prod-36/prod-36-evidence.json:1 · PROD-00/36/40 · G01/G12 · confiança high

PROD36 só candidate commit/status/runs; faltam source/lock/digests/hashes e horários completos. runner-summary tampouco tem identidade de fonte. PROD00 fileHashes divergem em 6 de 42 arquivos, inclusive lock/schema/compose (baseline-drift.json). Provas históricas podem ser úteis, mas não qualificam worktree atual.

Reprodução: `Comparação SHA256 read-only em baseline-drift.json; inspeção manifests.`

Backlog: Reexecutar checks afetados e produzir manifestos C10 por run; separar histórico de prova atual, não regenerar selo sobrescrevendo baseline antigo.



## OPS08 — High — DR usa bancos fixos destrutivos e prova de fixture insuficiente

infra/scripts/dr-e2e.sh:11 · PROD-37 · G11 · confiança high

DROP DATABASE de connect_desk_dr_src/dst sem marcador/owner; backup padrão /tmp; valida fixture final por grep de uma única tag, aceitando message presente com outbox/DLQ ausentes. pg-restore.sh:20 permite ausência de checksum. Sem prova durável RPO/restore mídia/erasures.

Reprodução: `Inspeção estática somente; script não executado.`

Backlog: Namespace por run e ownership, checksum obrigatório, backup durável privado, comparação exata de todas entidades/assets, RPO/RTO e teardown idempotente.



## Status

- PROD-00: Histórico VERIFIED; identidade atual STALE; harness entregue, rerun destrutivo/escritor não executado

- PROD-01: IMPLEMENTED documental, decisões abertas sem ratificação fictícia; contratos C09 desatualizados frente ao worker health entregue

- PROD-02: REWORK: avanços reproduzidos mas OPS01–03 bloqueiam aceite

- PROD-03: REWORK/PARTIAL: política requerida e paginação entregues; OPS04/06; branch protection remota não comprovada

- PROD-36: IMPLEMENTED/PARTIAL: preflight/process health/loop/readiness e hardening entregues; AC3/4 externos pendentes e prova atual não selada

- PROD-31: PLANNED; implementações antecedentes parciais não equivalem a aceites verificados; evidência atual obrigatória ausente

- PROD-32: PLANNED; implementações antecedentes parciais não equivalem a aceites verificados; evidência atual obrigatória ausente

- PROD-33: PLANNED; implementações antecedentes parciais não equivalem a aceites verificados; evidência atual obrigatória ausente

- PROD-34: PLANNED; implementações antecedentes parciais não equivalem a aceites verificados; evidência atual obrigatória ausente

- PROD-35: PLANNED; implementações antecedentes parciais não equivalem a aceites verificados; evidência atual obrigatória ausente

- PROD-37: PLANNED; implementações antecedentes parciais não equivalem a aceites verificados; evidência atual obrigatória ausente

- PROD-38: PLANNED; implementações antecedentes parciais não equivalem a aceites verificados; evidência atual obrigatória ausente

- PROD-39: PLANNED; implementações antecedentes parciais não equivalem a aceites verificados; evidência atual obrigatória ausente

- PROD-40: PLANNED; implementações antecedentes parciais não equivalem a aceites verificados; evidência atual obrigatória ausente

- PROD-41: PLANNED operação condicional; nenhuma release/deploy/estabilização observada

- PROD-42: PLANNED operação condicional; nenhuma release/deploy/estabilização observada

- PROD-43: PLANNED operação condicional; nenhuma release/deploy/estabilização observada



## Avanços

- Gate cobre tracked+untracked e rejeita casos ruins já codificados; não emite CERTIFIED local

- Agregador inclui docker/staging, fresh versus upgrade e release coverage/load explicitamente pendentes

- Runtime worker observa processo/loop/fila; API/WS readiness e Redis probe reais no código

- Compose read_only/cap_drop/no-new-privileges e OTEL pass-through implementados; antigas lacunas de worker SELECT1 e OTEL ausente já superadas



## Cobertura/limites

- Read-only produto/docs; somente tmp escrito

- Sem DB existente/Docker/deploy/mensagens/rede GitHub

- PROD00 não executado: reescreve evidências no repo

- Runtime DB/Redis/browser/real providers não reexecutados nesta lane

- Nenhuma nota/score atribuída; gates obrigatórios não aprovados

- Artefatos: findings.json, unit-tests.log, probe.mjs, adversarial-results.json, baseline-drift.json. Tentativa inicial da fixture sem scope foi preservada em adversarial-first-attempt.json; corrigida apenas a fixture, sem alterar produto.