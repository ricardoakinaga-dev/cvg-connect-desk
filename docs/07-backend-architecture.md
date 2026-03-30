# Backend Architecture — CVG Connect Desk

## 1. Objetivo
Definir a arquitetura de backend do **CVG Connect Desk** de forma executável, modular e segura para evolução incremental.

Este documento estabelece:
- estrutura de código;
- separação entre camadas;
- responsabilidades de API, worker, realtime e adapters;
- regras de fronteira entre módulos;
- padrões obrigatórios de implementação.

## 2. Estado Atual do Repositório
No estado atual do monorepo:
- `apps/desk-api` já possui bootstrap Fastify, `health`, `readiness`, documentação Swagger e rotas para `chat`, `tasks`, `notes`, `alerts`, `dashboard` e `auth`;
- `apps/desk-web` já possui frontend MVP operacional com Inbox 3 colunas, Tasks, Alerts e Dashboard;
- `apps/message-worker` já possui worker implementado com handlers para handoff e alerts;
- `apps/realtime-service` já possui servidor WebSocket implementado;
- `packages/shared`, `packages/auth`, `packages/database` e `packages/events` já possuem implementação completa;
- `packages/realtime` já possui tipos e projeções para realtime;
- `packages/integrations` já possui cliente para Secretary;
- `modules/chat`, `modules/tasks`, `modules/notes`, `modules/alerts`, `modules/dashboard` e `modules/audit` já possuem repositories, use cases e controllers;
- `modules/secretary-adapter` já possui integração com Secretary;
- autenticação real implementada com login, logout, sessões e RBAC;
- audit trail implementado com logs estruturados.

Este documento descreve o **estado atual** e a **arquitetura de produção**.

## 3. Princípios Obrigatórios

### 3.1 Modularidade por Domínio
O backend deve ser organizado por domínios reais do sistema, e não por pastas genéricas puramente técnicas.

Domínios previstos:
- chat;
- tasks;
- notes;
- alerts;
- admin;
- audit;
- dashboard;
- secretary-adapter;
- chatwoot-compat somente se necessário;
- iam/auth;
- integrations;
- events;
- realtime.

### 3.2 Separação de Camadas
A implementação deve separar claramente:
- **transport layer**: HTTP, autenticação de borda, schemas de entrada e serialização de saída;
- **application layer**: use cases, orchestration e políticas de negócio;
- **domain layer**: entidades, invariantes, contratos internos e regras centrais;
- **infrastructure layer**: banco, filas, clients externos, mappers e adapters técnicos.

### 3.3 Regra de Responsabilidade por Camada
- controller não contém regra central de negócio;
- use case não conhece detalhes de transporte HTTP;
- domínio não conhece payload cru de integração externa;
- adapter não decide regra principal de negócio;
- worker não substitui a API como fonte primária do estado;
- realtime não persiste nem decide regra de negócio.

### 3.4 Implementação Honesta
Se um componente ainda não existir no repositório, ele deve ser tratado como alvo arquitetural e de runtime futuro, não como estado já concluído.

## 4. Runtimes do Backend

### 4.1 `apps/desk-api`
Responsável por:
- expor rotas HTTP internas;
- receber inbound do Gateway;
- validar requests;
- autenticar e autorizar usuários internos;
- executar casos de uso síncronos;
- persistir estado operacional primário;
- publicar eventos internos;
- expor endpoints de health e readiness.

Regra obrigatória:
- transações síncronas da API devem ser curtas e limitadas à persistência do estado primário necessário;
- processamento externo, retries e efeitos secundários pesados não devem ficar dentro da mesma transação síncrona.

### 4.2 `message-worker`
Componente de runtime alvo.

Responsável por:
- consumir filas e eventos internos;
- processar efeitos secundários;
- executar retries controlados;
- acionar `secretary-adapter` quando aplicável;
- gerar projeções e derivados permitidos, como alerts e tasks quando a regra exigir.

Regra:
- não cria a verdade primária da conversa, da mensagem ou do estado operacional.

### 4.3 `realtime-service`
Componente de runtime alvo.

Responsável por:
- consumir eventos internos relevantes;
- projetar atualizações para clientes autenticados;
- atualizar inbox, conversa, tasks e alerts em tempo real.

Regra:
- não persiste estado primário nem executa regra de negócio central.

## 5. Pacotes Compartilhados

### 5.1 `packages/shared`
Responsável por:
- tipos compartilhados;
- utilitários comuns;
- erros padronizados;
- helpers de resultado e validação interna.

### 5.2 `packages/database`
Responsável por:
- client do banco;
- migrations;
- adapters de persistência;
- helpers transacionais locais.

### 5.3 `packages/auth`
Responsável por:
- autenticação;
- autorização;
- RBAC;
- guards e middlewares de acesso.

### 5.4 `packages/events`
Responsável por:
- contratos internos de eventos;
- event envelope;
- publishers e consumers base;
- helpers de idempotência e metadata.

Regra obrigatória:
- contratos internos de eventos devem admitir versionamento quando houver risco de evolução incompatível entre produtores e consumidores.

### 5.5 `packages/realtime`
Responsável por:
- contratos de emissão realtime;
- autenticação de canal realtime;
- serialização de eventos para frontend.

### 5.6 `packages/integrations`
Responsável por:
- clients e contratos de integração externa;
- gateway client;
- secretary client;
- validação de payloads externos.

Regra obrigatória:
- contratos de integração externa devem admitir versionamento quando houver risco de evolução incompatível com sistemas externos ou adapters legados.

## 6. Módulos de Domínio

### 6.1 `modules/chat`
Responsável por:
- conversation;
- message;
- assignment;
- tags;
- lifecycle básico da conversa.

### 6.2 `modules/tasks`
Responsável por:
- task;
- prioridade;
- prazo;
- status;
- histórico de status.

### 6.3 `modules/notes`
Responsável por:
- notas internas;
- vínculo contextual;
- autoria.

### 6.4 `modules/alerts`
Responsável por:
- abertura de alerts;
- severidade;
- acknowledgement;
- resolução;
- lifecycle.

### 6.5 `modules/admin`
Responsável por:
- usuários;
- filas;
- times;
- configurações operacionais permitidas nesta fase.

### 6.6 `modules/audit`
Responsável por:
- trilha de auditoria;
- consulta de eventos auditáveis;
- normalização de metadados de auditoria.

### 6.7 `modules/dashboard`
Responsável por:
- métricas operacionais;
- queries agregadas;
- projeções de indicadores.

### 6.8 `modules/secretary-adapter`
Responsável por:
- traduzir contratos entre Desk e Secretary;
- registrar handoff;
- isolar a dependência da IA.

### 6.9 `modules/chatwoot-compat`
Responsável apenas por:
- compatibilidade transitória de contratos legados, se necessária.

Regra obrigatória:
- não pode virar centro do sistema;
- não pode receber regra nova de negócio.

## 7. Padrão Interno dos Módulos
Cada módulo deve, quando aplicável, seguir estrutura semelhante a:

```text
modules/<domain>/
  application/
    use-cases/
    services/
    dto/
  domain/
    entities/
    value-objects/
    contracts/
  infrastructure/
    repositories/
    mappers/
    adapters/
  presentation/
    http/
      routes/
      handlers/
      schemas/
```

### Regra
A estrutura física pode variar, mas as responsabilidades não podem ser misturadas.

## 8. Transport Layer

### 8.1 Responsabilidade
A camada HTTP deve:
- receber request;
- autenticar ou autorizar quando aplicável;
- validar input;
- chamar o use case apropriado;
- serializar resposta;
- mapear erros.

### 8.2 Regras Obrigatórias
- rota não executa regra central de negócio;
- handler ou controller não acessa banco diretamente, salvo exceção extremamente justificada e documentada;
- schema de entrada é obrigatório;
- toda rota deve ter dono claro em módulo e use case;
- webhook externo não compartilha o mesmo fluxo de autenticação das rotas internas.

### 8.3 Tipos de Rotas Esperadas
- rotas operacionais autenticadas;
- rotas administrativas autenticadas;
- webhook inbound do Gateway;
- endpoints de health e readiness.

## 9. Application Layer

### 9.1 Responsabilidade
A camada de aplicação deve:
- orquestrar casos de uso;
- aplicar políticas de negócio;
- coordenar repositórios e serviços;
- publicar eventos internos;
- acionar auditoria quando necessário.

### 9.2 Regras Obrigatórias
- use cases devem ser explícitos;
- services genéricos não podem virar lixeira de lógica;
- integração externa entra por contratos e adapters;
- regras de negócio ficam aqui ou no domínio, não em controllers.

## 10. Domain Layer

### 10.1 Responsabilidade
A camada de domínio deve conter:
- entidades;
- value objects quando fizer sentido;
- invariantes;
- contratos internos;
- regras centrais do domínio.

### 10.2 Regras Obrigatórias
- domínio não conhece HTTP;
- domínio não conhece payload cru de Gateway, Secretary ou legado;
- domínio não conhece detalhes de banco;
- domínio não depende de Chatwoot, Evolution API ou Secretary.

## 11. Infrastructure Layer

### 11.1 Responsabilidade
A camada de infraestrutura deve conter:
- persistência;
- clients externos;
- filas;
- serializers e mappers;
- adapters técnicos.

### 11.2 Regras Obrigatórias
- infraestrutura implementa contratos definidos acima;
- não concentra regra principal de negócio;
- payload externo é normalizado antes de tocar o core;
- payload externo sempre passa por mapeamento explícito para DTO ou contrato interno antes de chegar a use cases;
- retries e falhas técnicas ficam aqui ou no worker, não espalhados no domínio.

## 12. Workers e Processamento Assíncrono

### 12.1 Princípio
Fluxos assíncronos existem para desacoplar efeitos secundários e processamento pesado.

Eles não substituem o fluxo síncrono principal de persistência do estado operacional.

### 12.2 O Que Deve Ficar no Worker
- consumo de eventos internos;
- integrações assíncronas;
- retries;
- geração de alerts derivados;
- projeções derivadas;
- acionamento controlado da Secretary quando a estratégia definir isso.

### 12.3 O Que Não Deve Ficar no Worker
- criação da verdade primária da conversa;
- decisão implícita de negócio sem evento rastreável;
- lógica crítica sem auditoria;
- atalho para contornar a API como dono do estado.

## 13. Adapters e Integrações

### 13.1 Gateway Adapter
Responsável por:
- validar inbound;
- normalizar payload;
- mapear payload externo para contrato interno explícito;
- entregar ao caso de uso interno;
- despachar outbound.

### 13.2 Secretary Adapter
Responsável por:
- transformar contexto interno em contrato da Secretary;
- receber resposta da IA;
- mapear resposta externa para contrato interno controlado;
- devolver resultado controlado ao core;
- registrar handoff e metadados relevantes.

### 13.3 Chatwoot Compatibility Adapter
Responsável por:
- compatibilidade temporária de payloads e estados legados.

Regra:
- somente se necessário;
- sempre isolado;
- nunca como dependência do core.

## 14. Autenticação e Autorização

### 14.1 Obrigatório
- autenticação de usuários internos;
- autorização por RBAC;
- segregação entre rotas internas e webhook externo;
- secrets em `.env`;
- validação de origem ou assinatura do webhook quando disponível.

### 14.2 Regra de Fronteira
- webhook externo não usa o mesmo fluxo de autenticação das rotas internas;
- permissões não podem ficar hardcoded e espalhadas;
- política de acesso deve ser centralizada em `packages/auth` e nas fronteiras de aplicação.

## 15. Auditoria no Backend
O backend deve registrar, no mínimo:
- inbound recebido;
- outbound solicitado ou enviado;
- criação e mudança de status de conversa;
- assignment;
- criação e atualização de task;
- criação de note;
- abertura, ack e resolução de alert;
- handoff bot ↔ humano;
- mudanças administrativas relevantes.

A auditoria deve ser acionada pela camada de aplicação ou por hooks claramente definidos, nunca de forma invisível e inconsistente.

## 16. Tratamento de Erros

### 16.1 Regras Obrigatórias
- erros devem ser padronizados;
- erros de validação devem ser distintos de erros internos;
- falhas externas devem preservar contexto suficiente para troubleshooting;
- falhas críticas devem poder gerar alert operacional.

### 16.2 Não Permitido
- `throw` genérico sem contexto;
- retorno inconsistente entre rotas;
- swallow silencioso de erro em integrações.

## 17. Health, Readiness e Operabilidade
O backend deve expor endpoints de saúde apropriados, incluindo quando aplicável:
- `health`;
- `readiness`.

Esses endpoints devem refletir, no mínimo:
- processo ativo;
- conectividade mínima com banco;
- estado básico das dependências críticas quando fizer sentido.

Esta diretriz deve permanecer coerente com o runtime descrito em `18-deployment-and-runtime.md`, especialmente para `apps/desk-api` como processo Node/Fastify e para dependências como banco e Redis.

## 18. Regras de Implementação
Antes de criar ou alterar qualquer parte do backend, é obrigatório:
- verificar se já existe rota equivalente;
- verificar se já existe handler ou use case correspondente;
- verificar se já existe adapter de integração;
- verificar se a responsabilidade pertence à API, worker ou realtime;
- impedir rota solta;
- impedir service genérico sem fronteira;
- impedir duplicação entre app, module e package.

Se houver divergência entre a implementação desejada e o estado real do repositório:
- adaptar a implementação à arquitetura preservada;
- não inventar componente pronto onde hoje só existe scaffold;
- atualizar este documento explicitamente antes de consolidar novo padrão estrutural.

## 19. Regra de Precedência
Este documento orienta diretamente:
- organização de código do backend;
- implementação de rotas;
- criação de use cases;
- criação de workers;
- criação de adapters;
- integração com banco e serviços externos.

Se houver conflito entre implementação e este documento, a implementação deve ser corrigida ou este arquivo atualizado explicitamente antes de prosseguir.
