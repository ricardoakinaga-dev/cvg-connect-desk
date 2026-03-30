# Arquitetura Alvo — CVG Connect Desk

## 1. Objetivo Arquitetural
A arquitetura alvo do **CVG Connect Desk** deve permitir:
- evolução incremental sem quebrar a operação existente;
- separação clara entre integração, domínio, processamento assíncrono e realtime;
- preservação do Gateway e da Agent Secretary;
- centralização do estado operacional no Connect Desk;
- compatibilidade legada isolada em adapters.

Nesta fase, a arquitetura adota:
- modularidade por domínio;
- ports and adapters;
- event-driven interno;
- processamento síncrono e assíncrono com fronteiras explícitas.

## 2. Princípio Central
O **Connect Desk** é a fonte da verdade do estado operacional de:
- conversas;
- mensagens persistidas internamente;
- atribuições;
- status;
- tags;
- tarefas;
- notas;
- alertas.

O sistema **não** é fonte da verdade para:
- canal WhatsApp;
- conexão com o canal;
- inteligência da IA;
- infraestrutura do Gateway.

Esses componentes permanecem externos e preservados.

## 3. Estado Atual do Repositório e Leitura Correta desta Arquitetura
No estado atual do monorepo:
- existem `apps/desk-api` e `apps/desk-web` como aplicações scaffoldadas;
- existem `packages/events` e `packages/realtime` como pacotes de apoio;
- existem módulos previstos em `modules/` para `chat`, `tasks`, `notes`, `alerts`, `admin`, `audit`, `dashboard`, `secretary-adapter` e `chatwoot-compat`;
- não existem ainda serviços de runtime implementados para `message-worker` ou `realtime-service`.

Portanto, este documento descreve a **arquitetura alvo obrigatória**. Quando nomes como `message-worker` e `realtime-service` aparecerem abaixo, eles representam papéis arquiteturais e componentes de runtime esperados para as próximas fases, não serviços já implementados no código atual.

## 4. Fluxo Arquitetural Alvo

```mermaid
graph TD
    A[WhatsApp] --> B[Evolution API]
    B --> C[Gateway Existente]

    C -->|Inbound Webhook/Event| D[desk-api: inbound adapter]
    D --> E[Chat Core Application Service]
    E --> F[(PostgreSQL)]
    E --> G[Internal Event Bus / Queue]

    G --> H[message-worker]
    H --> I[Tasks Domain]
    H --> J[Alerts Domain]
    H --> K[Notes Domain]
    H --> L[Secretary Adapter]

    L --> M[Agent Secretary]

    E --> N[Outbound Message Service]
    N --> C

    G --> O[realtime-service]
    O --> P[desk-web]

    Q[chatwoot-compat adapter]:::legacy
    Q -. optional / transitional .- E

classDef legacy fill:#f5f5f5,stroke:#999,stroke-dasharray: 5 5;
```

## 5. Camadas e Responsabilidades

### 5.1 Channel Edge (Externo)
Componentes:
- WhatsApp;
- Evolution API;
- Gateway existente.

Responsabilidades:
- conectividade com o canal;
- envio e recebimento físico de mensagens;
- transporte externo.

Regras:
- não alterar nesta fase;
- não duplicar a integração de canal dentro do Connect Desk;
- o Connect Desk não deve falar diretamente com a Evolution API se o Gateway já é a borda oficial.

### 5.2 Inbound / Outbound Adapter Layer
Componentes:
- inbound adapter no `desk-api`;
- outbound message service;
- `secretary-adapter`;
- `chatwoot-compat` quando estritamente necessário.

Responsabilidades:
- receber eventos do Gateway;
- validar e normalizar payload;
- traduzir contratos externos para o modelo interno;
- enviar mensagens para o Gateway;
- concentrar compatibilidade legada.

Regras:
- payload externo nunca deve vazar cru para o core;
- todo processamento inbound deve ser idempotente, com deduplicação baseada em identificador externo de evento ou mensagem sempre que esse identificador estiver disponível;
- toda solicitação outbound deve ser rastreável internamente, preservando o vínculo entre intenção de envio, tentativa executada e resultado observado;
- toda compatibilidade com legado deve ficar nessa camada;
- nenhum domínio interno deve depender diretamente de formato legado;
- integração com a Secretary deve passar por um único adapter dedicado.

### 5.3 Application / Domain Core
Componentes:
- chat;
- tasks;
- notes;
- alerts;
- admin;
- audit;
- dashboard.

Responsabilidades:
- executar regras de negócio;
- persistir estado operacional;
- publicar eventos internos;
- aplicar políticas de domínio.

Regras:
- o core é dono do estado operacional;
- o core não conhece detalhes de Evolution API, Gateway ou Chatwoot;
- integrações externas entram apenas por adapters;
- dashboard e audit são capacidades de leitura e rastreabilidade sobre o estado do core, não centros independentes de domínio.

### 5.4 Asynchronous Processing
Componentes:
- fila interna;
- `message-worker` como papel arquitetural de consumo assíncrono.

Responsabilidades:
- processar efeitos secundários de eventos;
- disparar atualizações para tasks, alerts e integrações auxiliares;
- desacoplar processamento pesado do fluxo síncrono;
- acionar a Secretary de forma controlada quando o fluxo exigir.

Regras:
- controller ou webhook não deve conter regra de negócio pesada;
- worker não deve ser fonte primária de verdade do estado;
- efeitos assíncronos devem ser idempotentes;
- chamadas assíncronas externas devem partir de eventos já persistidos.

### 5.5 Realtime Projection
Componentes:
- `realtime-service` como papel arquitetural de projeção em tempo real;
- `packages/realtime` como base de suporte no monorepo;
- `desk-web` como consumidor autenticado.

Responsabilidades:
- transformar eventos internos em atualização para frontend;
- atualizar inbox, detalhe da conversa, tarefas e alertas em tempo real.

Regras:
- realtime não decide regra de negócio;
- realtime não persiste como fonte primária;
- realtime consome eventos do sistema já persistidos.

## 6. Componentes de Runtime Esperados
Os itens abaixo representam componentes operacionais esperados pela arquitetura alvo. Eles não precisam necessariamente existir como serviços separados já no estado atual do código, mas suas responsabilidades devem permanecer claras e isoladas.

### 6.1 `apps/desk-api`
Responsável por:
- autenticação;
- rotas administrativas;
- rotas operacionais;
- inbound adapter;
- orquestração síncrona inicial;
- publicação de eventos internos.

### 6.2 `message-worker`
Responsável por:
- consumo de filas e eventos internos;
- tarefas derivadas;
- alertas derivados;
- integrações assíncronas;
- acionamento controlado da Secretary quando aplicável.

Observação:
- no estado atual do monorepo, esse componente ainda não existe como aplicação ou processo scaffoldado dedicado.

### 6.3 `realtime-service`
Responsável por:
- notificação em tempo real para a interface web;
- projeção de eventos internos para consumidores autenticados.

Observação:
- no estado atual do monorepo, existe `packages/realtime`, mas não há ainda um serviço separado scaffoldado com esse nome.

### 6.4 `desk-web`
Responsável por:
- inbox operacional;
- detalhe da conversa;
- painel lateral;
- tarefas;
- alertas;
- dashboard;
- administração.

## 7. Regras de Fronteira

### 7.1 Gateway
- é a borda oficial de mensagens;
- não deve ser duplicado;
- não deve ser contornado por integração paralela.

### 7.2 Secretary
- é serviço externo e orquestrado;
- não é dona do estado da conversa;
- não deve ser chamada diretamente por múltiplos módulos;
- a integração deve passar pelo `secretary-adapter`.

### 7.3 Chatwoot Compatibility
- é módulo opcional e transitório;
- serve apenas para compatibilidade legada;
- não pode receber regra nova de domínio;
- não pode ser centro do sistema.

## 8. Eventos Internos em Nível Arquitetural
O sistema deve operar com eventos internos como:
- `conversation.created`;
- `message.inbound.received`;
- `message.outbound.requested`;
- `message.persisted`;
- `conversation.assigned`;
- `conversation.status.changed`;
- `task.created`;
- `alert.created`;
- `handoff.requested`;
- `handoff.completed`.

A definição detalhada de envelope, versionamento, retry e lifecycle pertence ao documento de realtime e eventos.

## 9. Decisões Arquiteturais Preservadas
São decisões fixas nesta fase:
- Gateway não será alterado;
- Evolution API não será integrada diretamente ao core;
- Agent Secretary não será reescrita;
- compatibilidade legada ficará isolada;
- estado operacional ficará centralizado no Connect Desk;
- lógica de domínio não ficará em adapters, worker de projeção ou realtime.

## 10. Regras de Implementação
Antes de implementar qualquer fluxo ou endpoint, é obrigatório:
- verificar se já existe rota equivalente;
- verificar se já existe adapter para a integração;
- verificar se a responsabilidade pertence ao core, ao processamento assíncrono ou ao realtime;
- impedir criação de rota solta;
- impedir duplicação de integração;
- impedir regra de negócio em camada errada.

Se houver divergência entre implementação e este documento:
- a arquitetura deve ser corrigida; ou
- o documento deve ser atualizado explicitamente antes de prosseguir.

## 11. Regra de Precedência
Este documento define a arquitetura alvo e tem precedência sobre:
- roadmap;
- implementation phases;
- decisões abertas de execução.

Arquitetura não pode ser alterada implicitamente por conveniência de implementação. Se houver conflito, a divergência deve ser resolvida de forma explícita na documentação antes de avançar.
