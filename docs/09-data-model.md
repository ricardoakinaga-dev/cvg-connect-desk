# Data Model — CVG Connect Desk

## 1. Objetivo
Definir o modelo de dados relacional inicial do **CVG Connect Desk** de forma coerente com:
- escopo atual do projeto;
- arquitetura alvo;
- modelo de domínios;
- contratos de integração;
- necessidades de auditoria, dashboard e operação em tempo real.

Este documento estabelece:
- tabelas principais;
- chaves primárias e estrangeiras;
- índices;
- restrições de unicidade;
- enums e status;
- históricos mínimos obrigatórios;
- regras de integridade e evolução.

## 2. Estado Atual do Repositório
No estado atual do repositório:
- já existe modelagem concreta em `packages/database/src/schema.ts` cobrindo IAM, Chat Core e Operations;
- existem migrations `0000_famous_whirlwind.sql`, `0001_chat_core.sql` e `0002_operations.sql` materializando as fases já implementadas;
- a modelagem atual continua parcial em relação ao alvo completo deste documento, especialmente em `admin`, `dashboard`, integrações futuras e refinamentos de constraints;
- ainda não existe schema relacional consolidado para tudo o que está previsto além das fases já implementadas;
- este documento descreve o **modelo alvo obrigatório** para orientar migrations e implementação futura;
- nada aqui deve ser lido como afirmação de que todas as tabelas já existem no banco.

Regra de leitura:
- o schema atual de IAM, Chat e Operations deve convergir para este modelo de forma incremental;
- diferenças entre o schema já iniciado e o alvo documental não autorizam mudança destrutiva sem migration explícita e revisão de compatibilidade.

## 3. Princípios de Modelagem

### 3.1 Banco Relacional como Base Operacional
O banco relacional é a base do estado operacional do sistema.

Ele deve armazenar, no mínimo:
- conversas;
- mensagens;
- atribuições;
- tags;
- tasks;
- notes;
- alerts;
- usuários;
- permissões;
- trilha auditável.

### 3.2 Integridade Antes de Conveniência
A modelagem deve privilegiar:
- integridade referencial;
- rastreabilidade;
- idempotência;
- evolutividade.

Evitar:
- duplicação desnecessária;
- colunas genéricas sem propósito;
- estado derivado persistido sem necessidade clara;
- acoplamento direto ao payload cru externo.

### 3.3 Estado Atual vs Histórico
Sempre que houver diferença entre:
- estado atual;
- histórico de transições ou eventos;

o modelo deve separar ambos explicitamente.

Exemplos:
- assignment atual vs histórico de assignments;
- status atual vs histórico de status;
- alert atual vs lifecycle histórico.

### 3.4 Contexto Operacional, Não HIS
O banco deve armazenar contexto operacional mínimo de `Contact`, `Tutor` e `Patient`.

Ele não deve virar prontuário clínico completo nem substituir HIS.

## 4. Convenções Gerais

### 4.1 Chaves Primárias
Todas as tabelas principais devem possuir PK estável, preferencialmente UUID, ULID ou equivalente consistente com o padrão do projeto.

### 4.2 Timestamps Obrigatórios
Toda tabela principal deve possuir, quando aplicável:
- `created_at`;
- `updated_at`.

Tabelas históricas ou de eventos podem usar apenas `created_at` quando fizer mais sentido.

### 4.3 Soft Delete
Soft delete não deve ser adotado indiscriminadamente.

Só usar quando houver necessidade operacional real e claramente documentada.

### 4.4 Campos JSON
Campos JSON só devem ser usados para:
- metadados auxiliares;
- payload bruto controlado;
- contextos não estruturais.

Nunca como substituto de modelagem relacional principal.

## 5. IAM / Admin

### 5.1 Observação de Compatibilidade com o Schema Atual
O schema atual já iniciado em `packages/database/src/schema.ts` contém versões simplificadas de:
- `users`;
- `roles`;
- `permissions`;
- `user_roles`;
- `role_permissions`;
- `queues`;
- `teams`.

Além do schema, existe uma migration inicial já gerada para esse mesmo recorte de IAM em `packages/database/supabase/migrations/0000_famous_whirlwind.sql`.

Este documento define a evolução alvo dessas tabelas e de seus relacionamentos adicionais.

### 5.2 `users`
Responsável por usuários internos do sistema.

Campos mínimos:
- `id` PK;
- `name`;
- `email`;
- `password_hash` ou equivalente;
- `status` (`active`, `inactive`, `blocked`) ou representação equivalente claramente convergente com o schema atual;
- `created_at`;
- `updated_at`.

Restrições:
- `email` único.

Índices:
- índice único em `email`;
- índice em `status`.

### 5.3 `roles`
Campos mínimos:
- `id` PK;
- `name`;
- `description`;
- `created_at`;
- `updated_at`.

Restrições:
- `name` único.

### 5.4 `permissions`
Campos mínimos:
- `id` PK;
- `code` ou outro identificador canônico único compatível com a evolução do schema atual;
- `description`;
- `created_at`;
- `updated_at`.

Restrições:
- identificador canônico único.

### 5.5 `user_roles`
Relacionamento N:N entre usuários e papéis.

Campos mínimos:
- `id` PK ou chave composta conforme padrão adotado;
- `user_id` FK → `users.id`;
- `role_id` FK → `roles.id`;
- `created_at`.

Restrições:
- unicidade em (`user_id`, `role_id`).

Índices:
- índice em `user_id`;
- índice em `role_id`.

### 5.6 `role_permissions`
Relacionamento N:N entre papéis e permissões.

Campos mínimos:
- `id` PK ou chave composta;
- `role_id` FK → `roles.id`;
- `permission_id` FK → `permissions.id`;
- `created_at`.

Restrições:
- unicidade em (`role_id`, `permission_id`).

### 5.7 `queues`
Campos mínimos:
- `id` PK;
- `name`;
- `code` quando adotado como identificador operacional;
- `description`;
- `status` (`active`, `inactive`) ou representação equivalente claramente validada;
- `created_at`;
- `updated_at`.

Restrições:
- `code` único quando adotado.

### 5.8 `teams`
Campos mínimos:
- `id` PK;
- `name`;
- `code` quando adotado como identificador operacional;
- `description`;
- `status` (`active`, `inactive`) ou representação equivalente claramente validada;
- `created_at`;
- `updated_at`.

Restrições:
- `code` único quando adotado.

### 5.9 `user_queues`
Relacionamento N:N entre usuários e filas.

Campos mínimos:
- `id` PK ou chave composta;
- `user_id` FK → `users.id`;
- `queue_id` FK → `queues.id`;
- `created_at`.

Restrições:
- unicidade em (`user_id`, `queue_id`).

### 5.10 `user_teams`
Relacionamento N:N entre usuários e times.

Campos mínimos:
- `id` PK ou chave composta;
- `user_id` FK → `users.id`;
- `team_id` FK → `teams.id`;
- `created_at`.

Restrições:
- unicidade em (`user_id`, `team_id`).

## 6. Contexto Operacional

### 6.1 `contacts`
Representa identidade de contato operacional oriunda do canal.

Campos mínimos:
- `id` PK;
- `channel` (`whatsapp`);
- `external_contact_id`;
- `display_name`;
- `phone_e164` quando aplicável;
- `created_at`;
- `updated_at`.

Restrições:
- unicidade em (`channel`, `external_contact_id`) quando existir;
- unicidade parcial ou documentada para `phone_e164` se adotada como identificador confiável.

Índices:
- índice em `phone_e164`;
- índice em (`channel`, `external_contact_id`).

### 6.2 `tutors`
Campos mínimos:
- `id` PK;
- `contact_id` FK → `contacts.id` nullable quando ainda não vinculado;
- `external_reference` nullable;
- `name`;
- `document_id` nullable;
- `phone_e164` nullable;
- `created_at`;
- `updated_at`.

Índices:
- índice em `contact_id`;
- índice em `phone_e164`;
- índice em `external_reference`.

### 6.3 `patients`
Campos mínimos:
- `id` PK;
- `external_reference` nullable;
- `name`;
- `species`;
- `breed` nullable;
- `sex` nullable;
- `birth_date` nullable;
- `status` nullable ou enum controlado;
- `created_at`;
- `updated_at`.

Índices:
- índice em `external_reference`;
- índice em `name`.

### 6.4 `tutor_patients`
Relacionamento N:N entre tutor e paciente.

Campos mínimos:
- `id` PK ou chave composta;
- `tutor_id` FK → `tutors.id`;
- `patient_id` FK → `patients.id`;
- `relationship_type` nullable;
- `created_at`.

Restrições:
- unicidade em (`tutor_id`, `patient_id`).

## 7. Chat Domain

### 7.1 `conversations`
Tabela central do estado operacional da conversa.

Campos mínimos:
- `id` PK;
- `contact_id` FK → `contacts.id`;
- `tutor_id` FK → `tutors.id` nullable;
- `patient_id` FK → `patients.id` nullable;
- `channel` (`whatsapp`);
- `external_conversation_id` nullable;
- `current_status`;
- `current_assignment_user_id` FK → `users.id` nullable;
- `current_queue_id` FK → `queues.id` nullable;
- `priority` nullable ou enum controlado;
- `bot_state` nullable ou enum controlado;
- `last_message_at` nullable;
- `created_at`;
- `updated_at`.

Índices:
- índice em `contact_id`;
- índice em `tutor_id`;
- índice em `patient_id`;
- índice em `current_status`;
- índice em `current_assignment_user_id`;
- índice em `current_queue_id`;
- índice em `last_message_at`.

Regras:
- `conversations` guarda o estado atual;
- histórico de status e assignment deve ficar separado.

### 7.2 `messages`
Registro operacional de mensagens inbound e outbound.

Campos mínimos:
- `id` PK;
- `conversation_id` FK → `conversations.id`;
- `direction` (`inbound`, `outbound`);
- `message_type` (`text`, `image`, `audio`, `document`, `system`);
- `sender_type` (`contact`, `user`, `bot`, `system`);
- `sender_user_id` FK → `users.id` nullable;
- `external_message_id` nullable;
- `event_id` nullable;
- `content_text` nullable;
- `media_url` nullable;
- `status` nullable ou enum controlado;
- `occurred_at`;
- `created_at`;
- `updated_at`.

Índices:
- índice em `conversation_id`;
- índice em `external_message_id`;
- índice em `event_id`;
- índice em `occurred_at`;
- índice em (`conversation_id`, `occurred_at`).

Restrições:
- unicidade parcial ou documentada para `external_message_id` quando fornecido;
- unicidade parcial ou documentada para `event_id` quando fornecido.

Regras:
- mensagens são registros operacionais essencialmente imutáveis;
- alterações posteriores devem se limitar a metadados permitidos de entrega, rastreabilidade ou classificação;
- a deduplicação inbound deve poder usar `event_id` e `external_message_id`, em coerência com `06-integration-contracts.md`.

### 7.3 `message_attachments`
Campos mínimos:
- `id` PK;
- `message_id` FK → `messages.id`;
- `attachment_type`;
- `url`;
- `mime_type` nullable;
- `file_name` nullable;
- `file_size` nullable;
- `created_at`.

Índices:
- índice em `message_id`.

### 7.4 `conversation_assignments`
Histórico de atribuições.

Campos mínimos:
- `id` PK;
- `conversation_id` FK → `conversations.id`;
- `assigned_user_id` FK → `users.id` nullable;
- `assigned_queue_id` FK → `queues.id` nullable;
- `assigned_by_user_id` FK → `users.id` nullable;
- `reason` nullable;
- `started_at`;
- `ended_at` nullable;
- `created_at`.

Índices:
- índice em `conversation_id`;
- índice em `assigned_user_id`;
- índice em `assigned_queue_id`;
- índice em `started_at`.

Regras:
- deve ser possível distinguir assignment atual e histórico;
- idealmente apenas um assignment aberto por conversa por vez, com constraint ou documentação apropriada.

### 7.5 `conversation_status_history`
Campos mínimos:
- `id` PK;
- `conversation_id` FK → `conversations.id`;
- `from_status` nullable;
- `to_status`;
- `changed_by_user_id` FK → `users.id` nullable;
- `reason` nullable;
- `created_at`.

Índices:
- índice em `conversation_id`;
- índice em `to_status`;
- índice em `created_at`.

### 7.6 `tags`
Campos mínimos:
- `id` PK;
- `code`;
- `name`;
- `description` nullable;
- `created_at`;
- `updated_at`.

Restrições:
- `code` único.

### 7.7 `conversation_tags`
Campos mínimos:
- `id` PK ou chave composta;
- `conversation_id` FK → `conversations.id`;
- `tag_id` FK → `tags.id`;
- `created_at`;
- `created_by_user_id` FK → `users.id` nullable.

Restrições:
- unicidade em (`conversation_id`, `tag_id`).

Índices:
- índice em `conversation_id`;
- índice em `tag_id`.

## 8. Tasks Domain

### 8.1 `tasks`
Campos mínimos:
- `id` PK;
- `title`;
- `description` nullable;
- `status`;
- `priority`;
- `task_type` nullable;
- `conversation_id` FK → `conversations.id` nullable;
- `tutor_id` FK → `tutors.id` nullable;
- `patient_id` FK → `patients.id` nullable;
- `assigned_user_id` FK → `users.id` nullable;
- `due_at` nullable;
- `created_by_user_id` FK → `users.id` nullable;
- `created_at`;
- `updated_at`.

Índices:
- índice em `status`;
- índice em `priority`;
- índice em `assigned_user_id`;
- índice em `conversation_id`;
- índice em `tutor_id`;
- índice em `patient_id`;
- índice em `due_at`.

Regras:
- task pode existir sem conversa, desde que ligada a outro contexto permitido;
- task deve ter ao menos um contexto operacional válido, conforme regra de aplicação.

### 8.2 `task_status_history`
Campos mínimos:
- `id` PK;
- `task_id` FK → `tasks.id`;
- `from_status` nullable;
- `to_status`;
- `changed_by_user_id` FK → `users.id` nullable;
- `reason` nullable;
- `created_at`.

Índices:
- índice em `task_id`;
- índice em `to_status`;
- índice em `created_at`.

### 8.3 `task_comments`
Opcional nesta fase, somente se adotado explicitamente.

Campos mínimos:
- `id` PK;
- `task_id` FK → `tasks.id`;
- `author_user_id` FK → `users.id`;
- `content`;
- `created_at`.

## 9. Notes Domain

### 9.1 `internal_notes`
Campos mínimos:
- `id` PK;
- `reference_type`;
- `reference_id`;
- `author_user_id` FK → `users.id`;
- `content`;
- `created_at`;
- `updated_at`.

Índices:
- índice em (`reference_type`, `reference_id`);
- índice em `author_user_id`;
- índice em `created_at`.

Regras:
- `reference_type` deve ser restrito a contextos permitidos nesta fase:
  - `conversation`;
  - `tutor`;
  - `patient`;
  - `task`.

## 10. Alerts Domain

### 10.1 `alerts`
Campos mínimos:
- `id` PK;
- `alert_type`;
- `severity`;
- `current_status` (`pending`, `acknowledged`, `resolved`);
- `title`;
- `description` nullable;
- `reference_type`;
- `reference_id`;
- `acknowledged_by_user_id` FK → `users.id` nullable;
- `acknowledged_at` nullable;
- `resolved_by_user_id` FK → `users.id` nullable;
- `resolved_at` nullable;
- `created_at`;
- `updated_at`.

Índices:
- índice em `current_status`;
- índice em `severity`;
- índice em (`reference_type`, `reference_id`);
- índice em `created_at`.

Regras:
- alerta mantém estado atual;
- histórico de lifecycle fica em tabela separada;
- não deve haver exclusão destrutiva do histórico operacional.

### 10.2 `alert_events`
Campos mínimos:
- `id` PK;
- `alert_id` FK → `alerts.id`;
- `event_type` (`created`, `acknowledged`, `resolved`);
- `from_status` nullable;
- `to_status` nullable;
- `performed_by_user_id` FK → `users.id` nullable;
- `metadata_json` nullable;
- `created_at`.

Índices:
- índice em `alert_id`;
- índice em `event_type`;
- índice em `created_at`.

## 11. Audit Domain

### 11.1 `audit_logs`
Campos mínimos:
- `id` PK;
- `actor_type` (`user`, `system`, `bot`, `external`);
- `actor_user_id` FK → `users.id` nullable;
- `action`;
- `entity_type`;
- `entity_id`;
- `context_json` nullable;
- `created_at`.

Índices:
- índice em `actor_user_id`;
- índice em (`entity_type`, `entity_id`);
- índice em `action`;
- índice em `created_at`.

Regras:
- audit log é append-only;
- não deve ser sobrescrito para atualizar passado.

## 12. Dashboard / Métricas

### 12.1 Princípio
Nesta fase, dashboards devem preferir leitura a partir das tabelas operacionais e queries agregadas.

### 12.2 Tabelas Derivadas
Tabelas como `metric_snapshots` ou projeções materializadas só devem ser criadas se houver necessidade operacional clara e documentada.

## 13. Enums e Status Controlados
Os seguintes conjuntos devem ser controlados explicitamente por enum, check constraint, tabela de domínio ou convenção fortemente validada:
- `users.status` ou equivalente compatível com a evolução de `users.is_active`;
- `queues.status`;
- `teams.status`;
- `conversations.current_status`;
- `conversations.priority`;
- `conversations.bot_state`;
- `messages.direction`;
- `messages.message_type`;
- `messages.sender_type`;
- `tasks.status`;
- `tasks.priority`;
- `alerts.current_status`;
- `alerts.severity`;
- `internal_notes.reference_type`;
- `alerts.reference_type`.

A decisão técnica exata entre enum nativo, check constraint ou tabela dedicada deve seguir o padrão do projeto, mas sem deixar status livres em texto arbitrário.

## 14. Regras de Integridade e Constraints

### 14.1 Obrigatórias
- FKs devem ser explícitas;
- unicidades devem ser aplicadas quando houver identificador natural ou de idempotência;
- índices devem existir para consultas operacionais frequentes;
- colunas históricas devem ter ordenação temporal consistente.

### 14.2 Exemplos Críticos
- (`channel`, `external_contact_id`) em `contacts`;
- (`conversation_id`, `occurred_at`) em `messages`;
- (`conversation_id`, `tag_id`) em `conversation_tags`;
- (`user_id`, `role_id`) em `user_roles`;
- (`role_id`, `permission_id`) em `role_permissions`;
- (`tutor_id`, `patient_id`) em `tutor_patients`.

### 14.3 Constraint Recomendada
Onde tecnicamente suportado, garantir no máximo um assignment aberto por conversa.

## 15. Idempotência e Identificadores Externos

### 15.1 Inbound
Mensagens e eventos inbound devem preservar identificadores externos sempre que disponíveis, especialmente:
- `external_message_id`;
- `event_id`.

### 15.2 Regras
- deduplicação não deve depender apenas de lógica em memória;
- banco deve ajudar a proteger contra duplicação quando o identificador externo existir;
- regras exatas de idempotência devem ser coerentes com `06-integration-contracts.md` e `10-realtime-and-events.md`.

## 16. Evolução e Migrations

### 16.1 Princípios
- migrations devem ser incrementais;
- evitar alterações destrutivas precoces;
- mudanças estruturais devem preservar histórico quando esse histórico já tiver valor operacional.

### 16.2 Proibições
- não criar schema genérico demais esperando descobrir depois;
- não persistir payload cru como substituto de modelagem;
- não criar tabela sem dono de domínio claro.

## 17. Regras de Implementação
Antes de criar migrations, schemas ou repositórios, é obrigatório:
- verificar o estado real do repositório;
- verificar o que já existe em IAM;
- verificar se já existe tabela ou schema equivalente;
- verificar se a modelagem respeita `05-domain-model.md`;
- verificar se a modelagem atende `06-integration-contracts.md`;
- verificar se a modelagem suporta `07-backend-architecture.md` e `08-frontend-architecture.md`;
- impedir criação de coluna curinga sem semântica clara;
- impedir duplicação entre estado atual e histórico sem propósito explícito.

## 18. Regra de Precedência
Este documento orienta diretamente:
- schemas relacionais;
- migrations;
- repositories;
- queries operacionais;
- constraints de integridade;
- contratos de persistência.

Se houver conflito entre implementação e este documento, a modelagem deve ser corrigida ou este arquivo atualizado explicitamente antes de prosseguir.
