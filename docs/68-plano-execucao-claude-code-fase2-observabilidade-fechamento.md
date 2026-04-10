# Plano de Execução — Fechamento da Fase 2 de Observabilidade e Governança

**Data:** 2026-04-10  
**Origem:** pendências explícitas após a entrega parcial do plano 66  
**Objetivo:** Fechar de forma objetiva os itens restantes da Fase 2 de observabilidade/governança, cobrindo exatamente os quatro próximos passos já identificados.

---

## 1. Contexto

O corte anterior de observabilidade trouxe valor real:

- logs estruturados em `message-worker`;
- logs estruturados em `realtime-service`;
- melhorias úteis em `dead-letter` e `webhook`;
- documentação parcialmente atualizada.

Mas a fase **não está pronta** enquanto permanecerem em aberto os próximos passos já explicitados:

1. consolidar `docs/12-audit-and-observability.md` com a nova estrutura de log implementada;
2. adicionar endpoint `/admin/dead-letters/stats` se ainda não existir;
3. verificar se existe `GET /metrics/worker` e `GET /metrics/realtime` e, se não existir, considerar adição leve para health checks;
4. executar/validar suites PostgreSQL real em CI para integrar essa frente ao fluxo contínuo.

Este plano existe para fechar **exatamente** esses quatro itens, sem reabrir outras frentes.

---

## 2. Meta

Entregar um fechamento real da Fase 2 com:

- documentação consolidada;
- governança operacional mínima de dead-letter;
- métricas/health endpoints leves para runtimes críticos, se fizer sentido;
- validação/integração da esteira PostgreSQL real com esta frente.

---

## 3. Escopo Obrigatório

### 3.1 Consolidar `docs/12-audit-and-observability.md`

Atualizar o documento para refletir claramente:

- o formato atual dos logs estruturados;
- os campos realmente emitidos por `worker` e `realtime`;
- a função de `failureContext` no dead-letter;
- a distinção entre observabilidade implementada hoje e observabilidade futura.

O documento precisa sair desta task como **fonte útil de operação**, não apenas texto genérico.

### 3.2 Endpoint `/admin/dead-letters/stats`

Verificar se já existe:

- se não existir, implementar endpoint mínimo real;
- reutilizar o `deadLetterStore` e/ou lógica já existente;
- garantir consistência com a UI/Admin e com a noção atual de governança operacional.

Cobertura mínima esperada:

- teste útil do endpoint;
- documentação do contrato.

### 3.3 `GET /metrics/worker` e `GET /metrics/realtime`

Verificar o estado atual:

- se já existirem, documentar corretamente;
- se não existirem, implementar a menor versão útil e honesta.

A ideia não é criar observabilidade enterprise completa, e sim:

- um endpoint leve;
- útil para health checks/diagnóstico básico;
- sem acoplar o projeto a stack externa de metrics.

Campos aceitáveis, se implementados:

- runtime name;
- status;
- consumer id;
- poll interval;
- counts básicas disponíveis em memória;
- timestamp.

Se a implementação não for segura ou útil agora, justificar com clareza no relatório final.

### 3.4 Validar a frente em CI / PostgreSQL real

Verificar como integrar esta frente ao que já existe em:

- `.github/workflows/postgres-real-tests.yml`
- suites reais do projeto

O objetivo é um destes dois resultados honestos:

1. **integração real feita**, com suites relevantes incluídas na esteira;
2. **integração não feita por motivo concreto**, mas com documentação clara do porquê e do próximo passo exato.

Não marcar como concluído se ficar só no plano.

---

## 4. Estratégia

### 4.1 Ordem recomendada

1. auditar estado atual de `/admin/dead-letters/stats` e `/metrics/*`;
2. implementar endpoints mínimos se faltarem;
3. cobrir com testes úteis;
4. consolidar documentação;
5. validar encaixe em CI/PostgreSQL real.

### 4.2 O que evitar

- não criar observabilidade “grande demais”;
- não adicionar Prometheus/OpenTelemetry/etc. se o repo não estiver pronto para isso;
- não inventar métricas sem fonte real;
- não marcar CI como validada remotamente se não houver evidência.

---

## 5. Áreas Prováveis de Código

Dependendo do estado real do repositório, os arquivos mais prováveis são:

- `modules/admin/src/presentation/http/admin.controller.ts`
- `apps/desk-api/src/app.ts`
- `apps/message-worker/src/index.ts`
- `apps/realtime-service/src/index.ts`
- `apps/desk-api/src/__tests__/dead-letter-routes.integration.test.ts`
- novos testes em `apps/desk-api/src/__tests__/` ou nos runtimes
- `.github/workflows/postgres-real-tests.yml`

---

## 6. Documentação a Atualizar

Atualizar conforme a entrega real:

- `docs/12-audit-and-observability.md`
- `docs/18-deployment-and-runtime.md`
- `docs/16-validation-checklist.md`
- `docs/19-test-strategy.md`
- `docs/25-plano-testes-completo.md`
- `docs/GAPS-TECNICOS.md`

Se a fase realmente fechar, isso precisa ficar explícito nas docs.

---

## 7. Critério de Conclusão

Esta task será `PRONTO` apenas se:

1. `docs/12` ficar consolidado com o estado real;
2. `/admin/dead-letters/stats` existir e estar validado, ou ficar explicitamente confirmado como já existente;
3. `GET /metrics/worker` e `GET /metrics/realtime` forem resolvidos de forma honesta:
   - implementados e testados, ou
   - descartados com justificativa técnica forte;
4. o encaixe em CI/PostgreSQL real for tratado de forma concreta, não apenas sugerido.

Se qualquer um desses quatro itens ficar em aberto, a decisão deve ser `PARCIAL`.

---

## 8. Formato do Relatório Final

O relatório final deve conter:

1. documentos consultados;
2. estado atual confirmado no código;
3. status de cada um dos 4 itens do plano;
4. o que foi implementado;
5. arquivos alterados;
6. testes executados com resultado;
7. riscos remanescentes;
8. decisão final (`PRONTO` ou `PARCIAL`).

---

## 9. Resultado Esperado

Ao final desta execução, a Fase 2 de observabilidade/governança deve ficar:

- realmente consolidada; ou
- claramente delimitada como ainda parcial, sem ilusão de fechamento.

O mais importante aqui é **honestidade operacional com evidência real**.

