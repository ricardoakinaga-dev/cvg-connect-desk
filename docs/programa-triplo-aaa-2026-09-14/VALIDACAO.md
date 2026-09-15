# Validação atual do programa

**Atualização:** auditoria R3 de 15/09/2026. **Veredito do produto:** `FAIL / NOT_READY`.

## Estrutura

O programa preserva 63 tarefas, 59 requisitos, 411 pontos e 8 marcos. Após a auditoria R3, o estado canônico é **0 DONE, 19 REWORK e 44 PLANNED**. A única tarefa elegível por dependência é SA-001.

O validador confere IDs, metas ≥95, DAG, cobertura estrutural de requisitos/achados/gates, campos obrigatórios, dependências, presença de revisões e hashes declarados pelo backlog. Ele não comprova suficiência por aceite, cronologia da revisão, independência ou vínculo semântico ao candidato.

## Evidência atual

- Candidato de entrada `#c486a63f...` reproduzido antes da persistência R3, mas G01 falha: o selo não detecta mudança de conteúdo em `.env.production.example` e mistura `docs/auditorias/` com a identidade do produto.
- No snapshot de entrada, 101 referências terminais e 88 registros JSONL foram auditados. O [inventário reproduzível R3](../auditorias/2026-09-15-checkpoint-triplo-aaa-r3/EVIDENCE-INVENTORY.json) registra agora 104 referências e 105 registros após execuções concorrentes. As provas novas permanecem sem selo G01 válido e sem I1 final independente; 0/17 promoções atendem à barra terminal R3.
- Typecheck passa 33/33.
- Regressão `test:ci` passa em runner isolado, com suítes AAA/production ainda excluídas.
- Lint falha em 1/33 pacotes.
- Build passa; budget JS falha.
- `prod-36` é `FAIL_HARNESS`: 4/5 passaram e 1 falhou por drift, deixando G09 sem prova válida; não representa falha comportamental do produto.
- UX, coverage por camada, carga, DR durável e E2E final permanecem sem execução atual.

Relatório e dados: [auditoria R3](../auditorias/2026-09-15-checkpoint-triplo-aaa-r3/RELATORIO.md).

## Revalidação

```bash
python3 docs/programa-triplo-aaa-2026-09-14/programa.py render
python3 docs/programa-triplo-aaa-2026-09-14/programa.py validate
python3 docs/programa-triplo-aaa-2026-09-14/programa.py next
```

PASS estrutural não certifica produto. Cada retorno a DONE exige evidência corrente por aceite e crítica I1 posterior à última correção.
