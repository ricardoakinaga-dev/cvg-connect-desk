# Security and Access Control — CVG Connect Desk

## 1. Objetivo
Definir a estratégia de segurança e controle de acesso do **CVG Connect Desk** de forma coerente com:
- escopo atual do projeto;
- arquitetura de backend;
- arquitetura de frontend;
- contratos de integração;
- modelo de dados;
- operação real do hospital.

Este documento estabelece:
- autenticação de usuários internos;
- autorização por RBAC;
- segregação entre rotas internas e integrações externas;
- proteção de webhook;
- gestão de segredos;
- princípios mínimos de hardening operacional.

## 2. Estado Atual do Repositório
No estado atual do repositório:
- `packages/auth` já possui tipos, RBAC e middleware de autenticação;
- autenticação real implementada com login, logout, sessões e tokens;
- middleware de RBAC implementado (`requirePermission`, `requireRole`);
- frontend integrado com autenticação real;
- módulo de audit trail implementado;
- existem rotas Fastify materializadas no `desk-api`, incluindo webhook inbound e endpoints operacionais de chat, tasks, notes, alerts e dashboard;
- o realtime-service já possui autenticação por handshake de message;
- webhook security ainda precisa de endurecimento adicional (rate limiting, assinatura);
- este documento descreve o **estado atual** e o **alvo de refinement**.

Este documento reflete o que já foi implementado (auth real, RBAC, audit) e o que ainda precisa de refinement (rate limiting, webhook hardening).

## 3. Princípios Gerais

### 3.1 Segurança por Padrão
Toda rota, integração e ação sensível deve partir do princípio de negação por padrão, liberando acesso somente quando houver regra explícita.

### 3.2 Backend como Autoridade
Autenticação e autorização reais são garantidas no backend.

O frontend apenas reflete capacidades esperadas de uso.

### 3.3 Menor Privilégio
Usuários, serviços e integrações devem operar com o menor conjunto de permissões necessário.

### 3.4 Separação de Contextos
Acesso interno, webhook externo, integrações de sistema e realtime autenticado devem ter mecanismos de proteção compatíveis com seus contextos, sem reutilizar cegamente o mesmo fluxo.

### 3.5 Segredos Fora do Código
Nenhum segredo sensível deve ser hardcoded no repositório.

Segredos devem ser obtidos de ambiente ou runtime seguro.

## 4. Contextos de Acesso
O sistema deve tratar separadamente pelo menos os seguintes contextos:

### 4.1 Usuário Interno Autenticado
Exemplos:
- atendente;
- gestor;
- administrador;
- equipe clínica com acesso permitido.

### 4.2 Webhook Externo
Exemplo:
- Gateway enviando inbound ao Desk.

### 4.3 Integração Serviço-a-Serviço
Exemplos:
- Desk chamando Secretary;
- Desk chamando Gateway para outbound.

### 4.4 Canal Realtime Autenticado
Exemplo:
- frontend autenticado consumindo eventos ou projeções.

Cada contexto deve ter proteção adequada ao seu risco e papel.

## 5. Autenticação de Usuários Internos

### 5.1 Objetivo
Garantir identidade confiável de usuários humanos que operam o Desk.

### 5.2 Requisitos Mínimos
- login autenticado;
- armazenamento seguro de credencial;
- sessão ou token com expiração controlada;
- invalidação ou revogação quando aplicável;
- diferenciação entre usuário ativo, inativo e bloqueado.

### 5.3 Regras Obrigatórias
- senhas nunca devem ser armazenadas em texto puro;
- comparação de credencial deve usar mecanismo seguro;
- credencial comprometida deve poder ser rotacionada;
- status do usuário deve ser validado no momento do acesso.

### 5.4 Sessão / Token
A solução pode ser baseada em sessão, JWT ou padrão equivalente, desde que:
- seja compatível com o runtime adotado;
- tenha política de expiração clara;
- não vaze segredo no frontend;
- permita proteção adequada das rotas internas.

A escolha final deve ser documentada sem abrir brecha para implementação insegura.

## 6. Autorização por RBAC

### 6.1 Princípio
O sistema deve usar RBAC real para controlar acesso a:
- módulos;
- telas;
- ações;
- rotas;
- operações administrativas;
- ações sensíveis sobre conversas, tasks, alerts e configurações.

### 6.2 Componentes Mínimos
- `users`;
- `roles`;
- `permissions`;
- `user_roles`;
- `role_permissions`.

### 6.3 Regras Obrigatórias
- permissão não pode ficar hardcoded em múltiplos pontos;
- autorização deve ser centralizada em `packages/auth` e aplicada nas fronteiras adequadas;
- UI pode refletir permissão, mas não substitui validação do backend;
- regra de autorização deve ser verificável e auditável.

### 6.4 Granularidade Mínima Esperada
Permissões devem diferenciar pelo menos:
- leitura vs alteração;
- operação padrão vs administração;
- ações críticas vs ações comuns.

## 7. Segregação de Rotas e Fronteiras

### 7.1 Rotas Internas Autenticadas
Devem exigir autenticação de usuário interno e autorização adequada.

Exemplos:
- inbox;
- tasks;
- alerts;
- dashboard;
- administração;
- auditoria.

### 7.2 Webhook Externo
Deve ter fluxo de proteção separado do login interno.

Regras:
- não usar autenticação de usuário para webhook;
- validar origem, assinatura, token compartilhado ou mecanismo equivalente;
- rejeitar request inválido antes de tocar o core.

### 7.3 Realtime Autenticado
O acesso ao canal realtime deve exigir identidade já validada e autorização coerente com o escopo de dados expostos.

### 7.4 Integrações Serviço-a-Serviço
Chamadas para Gateway e Secretary devem usar credenciais ou segredos próprios, segregados do contexto de usuário humano.

## 8. Webhook Security

### 8.1 Objetivo
Proteger a entrada inbound contra uso indevido, spoofing e tráfego malicioso.

### 8.2 Requisitos Mínimos
Sempre que tecnicamente possível, o webhook deve validar:
- token compartilhado;
- assinatura HMAC ou equivalente;
- origem esperada;
- cabeçalhos mínimos exigidos;
- formato mínimo do payload.

### 8.3 Regras Obrigatórias
- request inválido deve ser rejeitado cedo;
- validação de segurança precede persistência;
- falhas repetidas devem ser observáveis;
- eventos rejeitados não devem contaminar o pipeline interno.

### 8.4 Proibições
- aceitar webhook anônimo sem justificativa documentada;
- tratar payload externo como confiável por padrão.

## 9. Segurança de Integrações Externas

### 9.1 Gateway
Chamadas outbound para o Gateway devem usar segredo ou canal próprio e ser rastreáveis.

### 9.2 Secretary
Chamadas para a Secretary devem usar credencial segregada e não podem reutilizar token de usuário final.

### 9.3 Regras Obrigatórias
- segredos por integração devem ser independentes;
- falhas de autenticação ou autorização externa devem ser observáveis;
- credenciais devem poder ser rotacionadas.

## 10. Gestão de Segredos

### 10.1 Regras Obrigatórias
- segredos devem viver em `.env` ou solução equivalente de runtime seguro;
- `.env.example` deve documentar nomes necessários sem expor valores reais;
- segredos não devem ser commitados;
- logs não devem vazar tokens, senhas, hashes ou chaves.

### 10.2 Tipos de Segredo Esperados
- segredo de autenticação interna;
- segredo ou token de webhook;
- credenciais do Gateway;
- credenciais da Secretary;
- credenciais de banco;
- credenciais de Redis quando aplicável.

### 10.3 Rotação
Segredos críticos devem ser rotacionáveis sem exigir redesenho da arquitetura.

## 11. Controle de Acesso por Dados e Contexto

### 11.1 Princípio
Nem todo usuário autenticado deve ver tudo.

O sistema deve permitir restringir acesso conforme:
- papel;
- ação;
- fila ou time quando aplicável;
- contexto operacional.

### 11.2 Aplicação Prática
Mesmo dentro de RBAC, pode haver política adicional por contexto, por exemplo:
- acesso administrativo amplo;
- operação limitada a determinadas filas;
- visualização restrita de certos módulos.

Se políticas contextuais forem adotadas, elas devem ser explícitas e não implícitas em hacks de UI.

## 12. Auditoria de Acesso e Ações Sensíveis
A segurança deve ser suportada por rastreabilidade.

No mínimo, as ações abaixo devem ser auditáveis:
- login bem-sucedido quando aplicável;
- falha de acesso relevante quando necessário;
- criação ou alteração de usuário, role ou permissão;
- mudança de assignment;
- handoff bot ↔ humano;
- resolução de alert;
- ações administrativas relevantes;
- eventos sensíveis em integrações externas.

A auditoria deve preservar:
- ator;
- ação;
- entidade afetada;
- timestamp;
- contexto mínimo útil.

## 13. Validação de Entrada e Hardening de Borda

### 13.1 Regras Obrigatórias
- toda entrada externa deve passar por validação;
- schemas devem existir para rotas e webhooks;
- campos inesperados devem ser tratados conforme política definida;
- erros de validação devem ser distintos de falhas internas.

### 13.2 Proibições
- aceitar input sem schema;
- confiar em payload vindo do frontend ou webhook sem validação.

## 14. Rate Limiting, Lockout e Proteções Operacionais

### 14.1 Objetivo
Reduzir abuso e impacto de tráfego indevido nos pontos mais sensíveis.

### 14.2 Aplicações Recomendadas
- tentativa de login;
- webhook inbound se houver risco operacional;
- endpoints sensíveis de administração;
- endpoints de autenticação ou revogação quando existirem.

### 14.3 Regra
A adoção exata pode variar por fase, mas a arquitetura deve permitir essas proteções sem refator destrutivo.

## 15. Regras para Frontend e Sessão

### 15.1 Regras Obrigatórias
- frontend não armazena segredo de integração externa;
- frontend só recebe o mínimo necessário para operar;
- credenciais de usuário devem ser tratadas com cuidado compatível ao mecanismo escolhido;
- dados sensíveis não devem ser expostos em payload desnecessário.

### 15.2 Proibições
- vazar token de integração em bundle ou frontend;
- confiar em hidden UI como autorização real.

## 16. Tratamento de Falhas de Segurança

### 16.1 Regras Obrigatórias
Falhas relevantes devem permitir:
- registro estruturado;
- correlação com contexto;
- investigação posterior;
- geração de alert operacional quando aplicável.

### 16.2 Exemplos
- webhook inválido repetido;
- token de integração rejeitado;
- tentativa de acesso sem permissão;
- falha crítica de autenticação em serviço externo.

## 17. Regras de Implementação
Antes de implementar autenticação, autorização, webhook security ou qualquer fronteira sensível, é obrigatório:
- verificar o estado real do repositório;
- verificar se já existe rota equivalente;
- verificar se já existe guard, middleware ou adapter relacionado;
- verificar se a proteção pertence ao contexto correto;
- impedir uso do mesmo mecanismo para contextos incompatíveis;
- impedir permissão hardcoded espalhada;
- impedir segredo em código;
- impedir rota interna exposta sem proteção.

Se a infraestrutura de segurança ainda não estiver pronta:
- documentar como alvo arquitetural;
- não fingir proteção implementada;
- não consolidar contrato inseguro provisório como definitivo.

## 18. Coerência com Outros Documentos
Este documento deve permanecer coerente com:
- `06-integration-contracts.md`;
- `07-backend-architecture.md`;
- `08-frontend-architecture.md`;
- `09-data-model.md`;
- `10-realtime-and-events.md`;
- `12-audit-and-observability.md`;
- `18-deployment-and-runtime.md`.

## 19. Regra de Precedência
Este documento orienta diretamente:
- implementação de autenticação;
- implementação de autorização;
- guards e middlewares;
- proteção de webhook;
- gestão de segredos;
- segregação de contextos de acesso.

Se houver conflito entre implementação e este documento, a implementação deve ser corrigida ou este arquivo atualizado explicitamente antes de prosseguir.
