# PROD-01 — validação de contratos e decisões

Candidato: `754f9badac46278e77d21de91c58eedb15e80581` + worktree (ver `evidencias/prod-00/baseline/candidate-manifest.json`).
Data: 2026-09-13. Método: inspeção do código real por contrato + validação estrutural do plano.

## Aceites

- **PROD-01-AC1 — CONTRATOS C01–C10 publicados:** `docs/producao-2026-09-13/CONTRATOS.md` agora contém ficha por contrato com produtor (file:símbolo), consumidor, payload, erros, compatibilidade, prova existente e lacuna. Recortes congelados de sessão/canal (C01/C02) preservados; nenhum redesenho. Verificação de símbolos por inspeção direta (`packages/auth/src/session-policy.ts`, `resource-authz.ts`, `packages/shared/src/webhook-*.ts`, `packages/events/src/outbox-lease.ts`, `modules/chat/.../inbound-atomic.repository.ts`/`outbound-atomic.repository.ts`, `packages/media/src/index.ts`, `apps/realtime-service/src/authorization.ts`, `scripts/production/evidence-gate.mjs`, `.github/scripts/certification-aggregator.mjs`).
- **PROD-01-AC2 — D01–D06 com dono e alcance:** `docs/producao-2026-09-13/DECISOES.md` mantém as seis decisões OPEN, com responsável a designar, recomendação técnica, alternativa, impacto e fronteira do que avança sem ratificação. D03 usa a proposta de `evidencias/prod-06/D03-PROPOSTA.md`; nenhuma ratificação foi inventada.
- **PROD-01-AC3 — 55 itens cobertos:** `python3 docs/producao-2026-09-13/plan.py validate` → `VALID: 44 tasks; 330 relative points; 55 audit items; acyclic dependencies`. O `validate` falha se algum item ficar descoberto ou se houver duplicidade/ciclo/dependência inexistente/aceite ausente/DONE sem evidência.
- **PROD-01-AC4 — fronteira de autorização:** seção explícita em DECISOES.md distingue implementação local/testes/pacote (autorizados) de mudança de contrato (integrador) e de implantação/dados reais/mensagens externas (não autorizados; PROD-42/43 dependem de autorização).

## Limitações

- A inspeção é estática; a prova comportamental de cada contrato pertence às tarefas executoras (C01→PROD-05, C02→PROD-04, C03→PROD-07, C04→PROD-09/12, C05→PROD-11, C06→PROD-14/15, C07→PROD-18/19/27, C08→PROD-13/16/25, C09→PROD-32/36, C10→PROD-02/03/34/35).
- Nenhuma linha de `packages/**` foi alterada por PROD-01.
