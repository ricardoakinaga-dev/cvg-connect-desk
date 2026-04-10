# Relatório de Análise: Documentação vs Implementação

**Data da análise:** 2026-04-09  
**Escopo:** leitura completa da pasta `/docs`, inspeção do monorepo e comparação entre o que está documentado e o que está implementado  
**Status geral:** implementação ampla e consistente, com documentação parcialmente desatualizada e algumas divergências arquiteturais reais

## 1. Resumo Executivo

Foi realizada a leitura integral dos arquivos da pasta `/docs`, seguida da inspeção do código do monorepo. A conclusão principal é que o projeto está significativamente mais implementado do que algumas auditorias antigas indicam, mas a documentação atual mistura:

- documentação normativa de arquitetura e produto;
- registro histórico de execução;
- auditorias intermediárias já superadas;
- plano enterprise futuro.

Isso gera contradições aparentes entre os documentos e o código atual.

Em termos práticos, o sistema já possui:

- API principal com múltiplos módulos registrados;
- schema de banco robusto, incluindo extensões enterprise;
- frontend funcional com múltiplas telas operacionais;
- autenticação, RBAC, auditoria, worker e realtime;
- suíte de testes existente e executável.

Ao mesmo tempo, permanecem divergências importantes entre documentação e realidade, especialmente em:

- maturidade real do pipeline assíncrono;
- autenticação efetiva do realtime;
- atualização e coerência entre documentos de auditoria e o estado do código.

## 2. Metodologia

A análise foi feita em três etapas:

1. leitura estrutural e temática de todos os arquivos Markdown em `/docs`;
2. inspeção dos apps, modules e packages do monorepo;
3. comparação direta entre claims documentais e evidências concretas no código.

Também foi executada a suíte atual de testes com `pnpm test`, que concluiu com sucesso.

## 3. Leitura da Documentação

### 3.1 Grupos documentais identificados

Os documentos em `/docs` se organizam, na prática, em quatro grupos:

#### A. Base normativa do produto e arquitetura

Inclui principalmente:

- `01-product-vision.md`
- `02-business-context.md`
- `03-scope-and-non-scope.md`
- `04-target-architecture.md`
- `05-domain-model.md`
- `06-integration-contracts.md`
- `07-backend-architecture.md`
- `08-frontend-architecture.md`
- `09-data-model.md`
- `10-realtime-and-events.md`
- `11-security-and-access-control.md`
- `12-audit-and-observability.md`
- `13-dashboard-and-kpis.md`
- `14-roadmap.md`
- `15-implementation-phases.md`
- `16-validation-checklist.md`
- `17-open-decisions.md`
- `18-deployment-and-runtime.md`
- `19-test-strategy.md`

Esses documentos descrevem o alvo arquitetural e as regras de implementação esperadas.

#### B. Registro histórico de execução

Principalmente:

- `20-master-execution-log.md`

Esse arquivo registra a evolução por fases e deve ser lido como histórico, não como fotografia exata do estado final.

#### C. Guias operacionais

Principalmente:

- `21-instalacao-local.md`

Esse é um dos documentos mais alinhados ao estado atual do código.

#### D. Auditorias e planos enterprise

Principalmente:

- `22-enterprise-premium-plan.md`
- `23-auditoria-executiva.md`
- `24-plano-implementacao-enterprise.md`
- `25-plano-testes-completo.md`
- `AUDITORIA_IMPLEMENTACAO.md`

Esses documentos têm alto valor analítico, mas parte deles já ficou desatualizada em relação ao código atual.

### 3.2 Observação crítica sobre a documentação

O principal problema documental não é falta de material. É excesso de camadas sem separação explícita entre:

- alvo futuro;
- estado atual;
- diagnóstico antigo;
- correções já implementadas.

Isso reduz a confiabilidade operacional da pasta `/docs` como fonte única da verdade.

## 4. Inspeção do Programa na Raiz

### 4.1 Estrutura geral do monorepo

O projeto está organizado como monorepo com:

- `apps/`
- `modules/`
- `packages/`
- `services/`
- `infra/`

O `README.md` descreve corretamente o formato geral do sistema, mas simplifica alguns pontos que hoje já são mais amplos do que o texto sugere.

### 4.2 Apps existentes

Os apps principais identificados foram:

- `apps/desk-api`
- `apps/desk-web`
- `apps/message-worker`
- `apps/realtime-service`

Isso confirma que os runtimes centrais previstos na arquitetura já existem como código.

### 4.3 Módulos existentes

Os módulos implementados incluem:

- `chat`
- `tasks`
- `notes`
- `alerts`
- `admin`
- `audit`
- `dashboard`
- `secretary-adapter`
- `labels`
- `sectors`
- `transfers`
- `contact-groups`
- `contacts`
- `kanban`
- `gateway-adapter`

Isso mostra que a implementação já foi além do núcleo MVP inicial e absorveu boa parte da camada enterprise.

### 4.4 Packages existentes

Os packages compartilhados relevantes incluem:

- `database`
- `auth`
- `events`
- `realtime`
- `integrations`
- `shared`

Essa base está coerente com o desenho arquitetural proposto na documentação principal.

## 5. O Que Está Implementado de Fato

### 5.1 API principal

A API em `apps/desk-api/src/index.ts` registra múltiplos módulos e hardenings:

- error handler global;
- `helmet`;
- `cors`;
- `@fastify/rate-limit`;
- Swagger/OpenAPI;
- `/health`;
- `/readiness`;
- endpoint `/events` para consumo do realtime;
- endpoint `/admin/dead-letters`.

Também há inicialização condicional do client da Secretary.

### 5.2 Banco de dados

O schema em `packages/database/src/schema.ts` está bem mais completo do que uma leitura superficial da documentação base poderia sugerir.

Estão implementados:

- IAM: `users`, `roles`, `permissions`, `user_roles`, `sessions`, `audit_logs`;
- chat: `contacts`, `tutors`, `patients`, `conversations`, `messages`, `conversation_status_history`, `conversation_assignments`;
- operações: `tasks`, `task_status_history`, `internal_notes`, `alerts`, `alert_events`;
- extensões enterprise: `labels`, `conversation_labels`, `contact_labels`, `sectors`, `contact_sectors`, `contact_groups`, `contact_group_members`, `contact_transfers`, `user_sectors`.

Há também enums relevantes como:

- `conversation_status_v2`;
- `conversation_handler`;
- `contact_group_type`;
- `transfer_status`;
- `note_reference_type`.

### 5.3 Chat e inbound

O fluxo de inbound já possui:

- webhook com guard dedicado;
- idempotência por `externalMessageId`;
- criação de conversa quando necessário;
- persistência de mensagem;
- publicação de eventos;
- chamada de Secretary no fluxo quando a conversa está com `currentHandler = bot`;
- trigger de handoff e atualização do handler.

Isso contradiz documentos antigos que afirmam que a integração com a Secretary ainda não foi ativada.

### 5.4 Auth e RBAC

Há autenticação baseada em sessão/token com lookup em banco, usuário ativo/inativo e leitura de papéis.  
O RBAC existe com middleware centralizado.

Isso está coerente com a documentação de segurança em alto nível.

### 5.5 Frontend

O frontend já implementa múltiplas rotas protegidas:

- login;
- inbox;
- contacts;
- kanban;
- tasks;
- notes;
- alerts;
- sectors;
- labels;
- contact groups;
- dashboard;
- admin;
- audit;
- settings.

O Inbox já faz conexão com realtime e mantém polling de fallback.

### 5.6 Testes

A suíte atual não é inexistente. Ela existe e passou quando executada.

Os testes cobrem hoje:

- packages base como `shared`, `database` e `events`;
- app web;
- app api;
- worker;
- realtime service;
- vários testes estruturais de módulos;
- testes de repository no chat.

O problema real não é ausência total de testes, mas profundidade limitada e cobertura desigual.

## 6. Comparação Entre Documentação e Implementação

## 6.1 Pontos com boa aderência

Há boa aderência entre documentação e código nos seguintes aspectos:

- separação geral entre apps, modules e packages;
- existência dos domínios centrais documentados;
- presença de schema relacional consistente com os domínios;
- autenticação e RBAC;
- auditoria persistida;
- existência de worker e realtime;
- frontend operacional em múltiplas áreas;
- expansão enterprise em labels, sectors, transfers e kanban.

Em termos estruturais, o repositório segue a visão arquitetural macro descrita na pasta `/docs`.

## 6.2 Documentos claramente desatualizados

### `docs/23-auditoria-executiva.md`

Esse documento afirma, entre outras coisas:

- que testes estão ausentes;
- que realtime não está conectado ao frontend;
- que Secretary não está integrada ao inbound;
- que o kanban move não estava verificado.

Hoje isso está parcialmente ou totalmente incorreto:

- testes existem e passam;
- o frontend já conecta ao realtime;
- a Secretary já é chamada no fluxo inbound;
- o endpoint de move do kanban existe.

Portanto, esse documento deve ser tratado como auditoria histórica, não como retrato fiel do estado atual.

### `docs/AUDITORIA_IMPLEMENTACAO.md`

Esse documento contém múltiplas afirmações hoje incorretas, por exemplo:

- `admin` vazio;
- Secretary não integrada;
- eventos de handoff sem publicação;
- rate limiting não implementado;
- notes sem `reference_type` genérico;
- tasks sem `tutorId`/`patientId`.

O código atual contradiz essas conclusões.

### `docs/18-deployment-and-runtime.md`

Esse documento está parcialmente correto, mas contém divergências operacionais relevantes:

- documenta realtime na porta `3001`, enquanto o código usa `8080` por padrão;
- afirma que rate limiting não está implementado, o que não é mais verdade;
- mantém parte do texto como se worker e realtime fossem mais conceituais do que já são.

### `README.md`

O `README` é útil como introdução, mas:

- não explicita que os scripts de banco da raiz são placeholders;
- não faz a mesma distinção clara que `21-instalacao-local.md` faz sobre comandos reais;
- mostra um retrato mais simplificado do sistema do que o estado efetivo atual.

## 6.3 Divergências reais e relevantes

Aqui estão as divergências que não são apenas documentais, mas técnicas.

### A. Pipeline assíncrono não é realmente distribuído

O `message-worker` consome eventos a partir de um `InMemoryEventPublisher`.

Isso significa que:

- o publisher da API vive em memória do processo da API;
- o worker, rodando como processo separado, tem sua própria memória;
- portanto, o worker não consome de fato os eventos produzidos pela API em um cenário real de múltiplos processos.

Essa é uma divergência arquitetural importante em relação à documentação de eventos e processamento assíncrono.

Em outras palavras: a arquitetura fala em desacoplamento assíncrono entre runtimes, mas a implementação atual ainda não sustenta isso de modo real fora do processo local.

### B. Realtime com autenticação fraca

O frontend passa `token` na URL do WebSocket e depois envia `userId` em uma mensagem de autenticação.  
O servidor realtime aceita esse `userId` sem validar a sessão no banco.

Consequências:

- o realtime existe;
- o frontend realmente tenta usá-lo;
- mas a autenticação do canal não é forte o suficiente para cumprir o que a documentação de segurança exige.

Esse é um dos principais gaps reais do projeto hoje.

### C. Webhook protegido, mas de forma opcional

Existe guard HMAC para o webhook inbound. Porém, quando `WEBHOOK_SECRET` não está configurado, a validação é desabilitada.

Isso pode ser aceitável em ambiente controlado de desenvolvimento, mas entra em tensão com a documentação de segurança quando considerado como estado operacional geral.

### D. Dashboard ainda abaixo do escopo documental mais ambicioso

O dashboard implementa:

- métricas de conversas;
- volume;
- tasks;
- tasks vencidas;
- alerts;
- alerts ativos;
- summary agregado.

Mas ainda não implementa KPIs mais sofisticados documentados, como:

- tempo médio de primeira resposta;
- tempo médio de resposta;
- taxa de handoff.

Aqui a divergência é parcial: o dashboard existe, mas não cobre todo o repertório analítico que alguns documentos projetam.

### E. Scripts de banco da raiz seguem placeholders

O `package.json` da raiz ainda mantém:

- `db:migrate` como placeholder;
- `db:seed` como placeholder.

Já os scripts reais estão em `packages/database`.

Essa divergência é corretamente explicada em `21-instalacao-local.md`, mas não está igualmente clara para quem começa pelo `README`.

## 7. Principais Conclusões

### 7.1 Conclusão geral

O projeto está, no código, em estado mais avançado do que parte relevante da documentação faz parecer.

O sistema não é apenas um scaffold:

- há backend real;
- há schema robusto;
- há frontend funcional;
- há autenticação e permissões;
- há realtime;
- há worker;
- há testes.

### 7.2 Principal fragilidade atual

A principal fragilidade não é ausência de módulos, mas desalinhamento entre:

- documentação histórica;
- documentação normativa;
- maturidade real da infraestrutura assíncrona e de segurança.

### 7.3 Síntese do quadro atual

O estado atual pode ser resumido assim:

- **produto e aplicação**: amplamente construídos;
- **documentação**: extensa, mas heterogênea e parcialmente desatualizada;
- **arquitetura assíncrona**: conceitualmente correta, tecnicamente incompleta;
- **segurança do realtime**: abaixo do nível descrito como alvo;
- **testes**: existentes, porém ainda aquém de uma malha enterprise madura.

## 8. Recomendações Prioritárias

### Prioridade 1

Consolidar a documentação da pasta `/docs` em três categorias explícitas:

- estado atual;
- alvo futuro;
- histórico/auditoria.

Isso evita que auditorias antigas continuem sendo lidas como verdade corrente.

### Prioridade 2

Revisar a arquitetura de eventos para substituir o publisher in-memory por mecanismo interprocesso real, por exemplo:

- Redis streams;
- fila persistida;
- tabela de outbox;
- broker equivalente.

Sem isso, worker e realtime permanecem mais próximos de um modelo de demonstração do que de uma topologia de produção desacoplada.

### Prioridade 3

Implementar autenticação real do canal realtime:

- validação de token/sessão no handshake ou em etapa autenticada verificável;
- associação segura entre conexão e usuário;
- controle de autorização por escopo/canal.

### Prioridade 4

Atualizar ou marcar como históricos os documentos:

- `23-auditoria-executiva.md`
- `AUDITORIA_IMPLEMENTACAO.md`
- partes de `18-deployment-and-runtime.md`
- trechos do `README.md`

### Prioridade 5

Expandir os testes de comportamento real:

- auth end-to-end;
- inbound com idempotência;
- integração com Secretary em sucesso e falha;
- fluxo do kanban move;
- webhook security;
- realtime auth.

## 9. Fechamento

O repositório tem substância real e já entrega muito do que a documentação arquitetural propõe. O maior problema atual é que a pasta `/docs` deixou de ser uma fonte uniforme da verdade porque acumula versões de raciocínio, auditorias antigas e planos futuros sem demarcação forte.

Se a documentação for reorganizada e as duas lacunas mais sérias forem tratadas:

- eventos assíncronos interprocesso reais;
- autenticação forte do realtime;

o projeto ficará muito mais coerente entre discurso, implementação e operação.
