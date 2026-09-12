# ADR-006 — DR Verification

- Status: accepted. Data: 2026.
- Contexto: backup sem restore provado não é backup.
- Decisão: `infra/scripts/dr-e2e.sh` (migrate → fixture → backup+checksum → destroy → restore → estrutura/integrity → boot → smoke → comparação) + workflow semanal/manual que falha o CI; RPO ≤24h / RTO ≤2h formais.
- Alternativas: restore manual sob demanda (não prova nada); backup lógico via app (reinventa pg_dump).
- Consequências: runners precisam de pg client (ubuntu-latest tem); ~minutos por execução semanal.
- Segurança: confirmação destrutiva no restore manual; connection strings via secrets/env, nunca em log.
- Operacional: artifacts com logs; duração registrada; limpeza garantida.
