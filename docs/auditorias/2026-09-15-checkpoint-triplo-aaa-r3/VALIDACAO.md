# Validação da auditoria R3

## Escopo executado

- Reconciliação independente de estados, dependências, aceites, referências e hashes.
- Reprodução do candidato e controle negativo do gerador de manifesto.
- Typecheck, lint, build e regressão em runner isolado.
- Reexecução focada de SA-015 e SA-019.
- Execução direta do harness `prod-36`.
- Duas críticas I1 com contexto novo; somente a crítica de evidências preservou um veredito utilizável.

## Resultado

`FAIL / NOT_READY`. O relatório reabre as 17 tarefas antes promovidas porque nenhuma possui conjunto completo de evidência corrente e I1 final para o candidato declarado. O produto e o histórico foram preservados.

Após a atualização documental, `programa.py validate` e `programa.py next` retornaram `valid=true`, 63 tarefas, 59 requisitos, 411 pontos, **19 REWORK, 44 PLANNED, 0 DONE** e somente SA-001 elegível. Todos os JSON do programa e desta auditoria foram parseados, e o verificador local não encontrou links Markdown relativos quebrados. O manifesto documental R3 cobre os arquivos normativos/derivados e exclui evidências mutáveis, caches e o próprio manifesto; a contagem e os hashes finais constam nos manifestos do programa e desta auditoria.

Artefatos: [índice com SHA256](ARTIFACTS.json), [inventário reproduzível](EVIDENCE-INVENTORY.json), [manifesto da auditoria](MANIFESTO.json) e [primeira crítica I1](REVISAO-I1-01.md).

## Critério de revalidação

Após atualizar o backlog e gerar suas projeções:

```bash
python3 docs/programa-triplo-aaa-2026-09-14/programa.py render
python3 docs/programa-triplo-aaa-2026-09-14/programa.py validate
python3 docs/programa-triplo-aaa-2026-09-14/programa.py next
```

Essa validação continua estrutural. A requalificação exige os procedimentos e críticas descritos no backlog R3.
