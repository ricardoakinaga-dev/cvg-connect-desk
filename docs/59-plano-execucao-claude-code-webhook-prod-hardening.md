# Plano de Execucao — Webhook Prod Hardening

Data: 2026-04-10
Status: Ativo
Escopo: Reduzir o gap G-04 com endurecimento explicito do webhook em producao

## 1. Objetivo

O projeto ja melhorou bastante em seguranca e observabilidade, mas o gap G-04 continua aberto:

- em desenvolvimento, o webhook aceita operacao sem `WEBHOOK_SECRET`;
- em producao, o comportamento precisa ser inequivoco, fail-secure e bem documentado;
- o runbook/configuracao ainda podem ser reforcados para evitar deploy inseguro por acidente.

O objetivo desta task e:

- endurecer o comportamento de `WEBHOOK_SECRET` para producao;
- garantir checks de runtime/configuracao claros;
- alinhar testes e documentacao operacional ao comportamento real.

## 2. Fonte da Verdade Obrigatoria

Antes de qualquer alteracao, o Codex deve ler:

1. `docs/59-plano-execucao-claude-code-webhook-prod-hardening.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/11-security-and-access-control.md`
4. `docs/06-integration-contracts.md`
5. `docs/18-deployment-and-runtime.md`
6. `docs/19-test-strategy.md`
7. `docs/25-plano-testes-completo.md`

## 3. Estado Atual a Revalidar no Codigo

O Codex deve confirmar:

- como `packages/shared/src/webhook-guard.ts` se comporta hoje;
- quais sinais definem “producao” no projeto;
- se existe boot-time/runtime check para variaveis obrigatorias;
- onde o webhook inbound e registrado e como o guard e usado;
- quais testes cobrem esse comportamento hoje.

Arquivos/areas para inspecao inicial:

- `packages/shared/src/webhook-guard.ts`
- `modules/chat/src/presentation/http/inbound.controller.ts`
- `apps/desk-api/src/app.ts`
- testes de webhook em `packages/shared` e `apps/desk-api`
- docs operacionais e de seguranca

## 4. Objetivo Tecnico da Task

Executar esta task nesta ordem:

1. revalidar o comportamento atual;
2. definir o endurecimento minimo seguro para producao;
3. implementar checks e mensagens operacionais;
4. reforcar testes;
5. atualizar documentacao/runbook.

## 5. Escopo Obrigatorio

### Frente A — Runtime Behavior

Garantir que o comportamento em producao seja explicito e fail-secure.

Exemplos de endurecimento aceitavel:

- rejeitar operacao em producao sem `WEBHOOK_SECRET`;
- emitir mensagem/log claro e acionavel;
- falhar cedo em bootstrap, se isso fizer mais sentido que falhar na primeira requisicao.

O Codex deve escolher a menor opcao segura e justificar.

### Frente B — Testes

Adicionar ou ajustar cobertura para provar:

- dev sem `WEBHOOK_SECRET` continua comportamento de DX, se isso for mantido;
- producao sem `WEBHOOK_SECRET` falha de forma segura;
- assinatura invalida continua rejeitada;
- assinatura valida continua aceita.

### Frente C — Documentacao Operacional

Atualizar no minimo:

- `docs/GAPS-TECNICOS.md`
- `docs/18-deployment-and-runtime.md`
- `docs/11-security-and-access-control.md`
- `docs/25-plano-testes-completo.md`

Se necessario:

- `docs/21-instalacao-local.md`

## 6. Criterios de Aceite

Esta task so pode ser considerada bem-sucedida se:

1. o comportamento do webhook em producao estiver inequivoco e seguro;
2. houver evidencia de teste adequada;
3. a documentacao operacional deixar claro o requisito de `WEBHOOK_SECRET`;
4. os trade-offs de DX em dev estiverem honestamente documentados.

## 7. Fora de Escopo

Nao abrir nesta task:

- redesign completo do gateway;
- novo mecanismo criptografico;
- rotacao automatica de segredos;
- observabilidade ampla de secrets management.

## 8. Entregavel Obrigatorio

Ao final, o Codex deve entregar um relatorio contendo:

1. documentos consultados;
2. estado atual confirmado no codigo;
3. estrategia escolhida;
4. o que foi implementado;
5. arquivos alterados;
6. testes adicionados/executados;
7. riscos remanescentes;
8. decisao final:
   - `PRONTO`
   - `PARCIAL`
   - `PENDENTE`

## 9. Instrucao Final

Leia este documento inteiro antes de qualquer alteracao.

Depois:

1. leia os documentos obrigatorios;
2. valide o comportamento atual do webhook;
3. implemente o endurecimento minimo e seguro para producao;
4. ajuste testes e documentacao;
5. entregue o relatorio final no formato deste plano.
