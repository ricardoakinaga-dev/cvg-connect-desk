# Contratos de Integração — CVG Connect Desk

## 1. Objetivo
Este documento define os contratos de integração entre:
- Gateway como fonte de eventos de canal;
- CVG Connect Desk;
- Agent Secretary;
- Frontend, indiretamente via realtime.

Este documento estabelece:
- formato de entrada inbound;
- formato de saída outbound;
- regras de idempotência;
- regras de erro;
- regras de segurança;
- responsabilidades de cada parte.

## 2. Estado Atual do Repositório e Leitura Correta deste Documento
No estado atual do repositório:
- já existem handlers e rotas iniciais de inbound e outbound no recorte de chat, além de controllers REST para `tasks`, `notes` e `alerts`;
- ainda não existe integração materializada com `secretary-adapter`, nem runtimes reais de worker ou realtime para completar o pipeline descrito neste documento;
- `chatwoot-compat`, `packages/realtime` e parte relevante de `packages/integrations` continuam como fronteiras arquiteturais ainda não concluídas.

Portanto, este documento define os **contratos-alvo obrigatórios** da integração. Ele não deve ser lido como afirmação de que todos os contratos aqui descritos já estejam plenamente endurecidos, protegidos ou implementados no runtime atual.

## 3. Princípios Gerais

### 3.1 Fonte da Verdade
- Gateway é a fonte da verdade para eventos de canal;
- Connect Desk é a fonte da verdade do estado operacional;
- Secretary é responsável por decisões de IA.

### 3.2 Idempotência Obrigatória
Todo evento inbound deve ser tratado como potencialmente duplicado.

O sistema deve:
- identificar eventos únicos por ID externo;
- evitar duplicação de mensagens;
- garantir processamento seguro;
- preservar consistência mesmo sob retry, reentrega ou reordenação parcial.

### 3.3 Não Acoplamento ao Legado
- o formato do Gateway deve ser adaptado, nunca propagado diretamente ao core;
- compatibilidade com Chatwoot deve ficar isolada;
- integrações externas não podem definir o modelo interno do Desk.

### 3.4 Validação na Fronteira
- todo payload externo deve ser validado antes de atingir o core;
- payload inválido não deve contaminar estado operacional interno;
- dados sensíveis de integração devem permanecer restritos às camadas de adapter e observabilidade.

## 4. Responsabilidades por Parte

### 4.1 Gateway
Responsável por:
- receber eventos do canal;
- normalizar e encaminhar eventos para o Desk;
- receber solicitações outbound vindas do Desk;
- atuar como borda oficial entre Desk e canal.

Não é responsável por:
- persistir estado operacional do Desk;
- decidir regras de negócio internas do atendimento;
- substituir a Secretary.

### 4.2 Connect Desk
Responsável por:
- validar e adaptar contratos externos;
- persistir o estado operacional interno;
- tratar idempotência inbound;
- rastrear intentos e resultados de outbound;
- registrar handoffs, mensagens e eventos operacionais;
- decidir persistência final do que entra no estado do Desk.

Não é responsável por:
- substituir o Gateway;
- conectar diretamente com a Evolution API se o Gateway já é a borda oficial;
- terceirizar a fonte da verdade operacional para a Secretary.

### 4.3 Agent Secretary
Responsável por:
- produzir decisão de IA;
- responder com ação de automação ou handoff;
- não alterar diretamente o estado operacional do Desk.

### 4.4 Frontend via Realtime
Responsável por:
- consumir projeções e eventos já persistidos;
- não atuar como fonte primária de estado;
- não depender de payload cru de integração externa.

## 5. Inbound Contract (Gateway → Desk)

### 5.1 Entrada
O Gateway envia eventos para o Desk via webhook HTTP ou mecanismo equivalente de integração definido na borda oficial do sistema.

### 5.2 Estrutura Esperada Normalizada
```json
{
  "event_id": "string",
  "channel": "whatsapp",
  "external_message_id": "string",
  "timestamp": "ISO8601",
  "from": {
    "id": "string",
    "name": "string"
  },
  "to": {
    "id": "string"
  },
  "message": {
    "type": "text|image|audio|document",
    "content": "string",
    "media_url": "string|null"
  },
  "metadata": {
    "raw": {}
  }
}
```

### 5.3 Regras Obrigatórias
- `event_id` deve ser usado para idempotência sempre que estiver disponível;
- `external_message_id` deve ser armazenado sempre que estiver disponível;
- o payload deve ser validado antes de qualquer persistência no core;
- o payload normalizado é o único que pode atravessar a fronteira para o modelo interno;
- dados inválidos devem ser rejeitados com registro de erro adequado;
- processamento inbound deve ser seguro para reentrega.

### 5.4 Regra de Idempotência
O inbound deve operar com deduplicação por:
- `event_id`, como chave primária de idempotência quando fornecida;
- `external_message_id`, como chave complementar quando fornecida;
- fallback controlado apenas quando não houver identificador externo confiável.

O Desk não deve gerar múltiplas mensagens internas para o mesmo evento de canal por falha de retry ou duplicação de entrega.

## 6. Outbound Contract (Desk → Gateway)

### 6.1 Estrutura Esperada
```json
{
  "conversation_id": "string",
  "to": "string",
  "message": {
    "type": "text",
    "content": "string"
  },
  "metadata": {
    "internal_message_id": "string"
  }
}
```

### 6.2 Regras Obrigatórias
- toda mensagem outbound deve ser persistida internamente antes do envio;
- deve existir rastreabilidade entre:
  - mensagem interna;
  - intenção de envio;
  - tentativa de envio;
  - confirmação ou falha observada, quando houver retorno;
- falhas devem ser registradas;
- outbound não deve depender de estado mantido exclusivamente fora do Desk.

### 6.3 Regra de Rastreabilidade
Toda solicitação outbound deve ser auditável internamente.

O contrato e o fluxo de integração devem preservar vínculo mínimo entre:
- `conversation_id`;
- `internal_message_id`;
- tentativa executada;
- resultado observado pelo sistema, quando disponível.

## 7. Secretary Contract (Desk ↔ Secretary)

### 7.1 Entrada para Secretary
```json
{
  "conversation_id": "string",
  "messages": [],
  "context": {
    "tutor_id": "string|null",
    "patient_id": "string|null"
  }
}
```

### 7.2 Resposta da Secretary
```json
{
  "action": "respond|handoff",
  "response": "string|null",
  "confidence": "number",
  "reason": "string|null"
}
```

### 7.3 Regras Obrigatórias
- Secretary não altera estado diretamente;
- Desk decide a persistência final;
- handoff deve ser registrado;
- respostas da Secretary devem ser auditáveis;
- integração com a Secretary deve passar exclusivamente pelo `secretary-adapter`.

## 8. Handoff Contract

### 8.1 Tipos
- bot → humano;
- humano → bot.

### 8.2 Regras
Todo handoff deve gerar rastreabilidade operacional por eventos como:
- `handoff.requested`;
- `handoff.completed`.

Todo handoff deve registrar:
- origem;
- destino;
- motivo;
- timestamp.

## 9. Error Handling

### 9.1 Inbound
- erro de validação: rejeitar;
- erro interno transitório: retry controlado;
- erro crítico: log e alerta operacional quando aplicável.

### 9.2 Outbound
- falha de envio: retry controlado;
- falha persistente: alerta operacional;
- falha de persistência anterior ao envio: não deve haver envio sem rastreabilidade interna.

### 9.3 Secretary
- resposta inválida: rejeitar integração e registrar erro;
- indisponibilidade externa: fallback controlado conforme política operacional;
- handoff ou resposta não podem entrar no estado do Desk sem validação mínima.

## 10. Security

### 10.1 Webhook
- validar origem;
- validar assinatura, se disponível;
- rejeitar requests inválidos;
- não aceitar payload externo sem validação de fronteira.

### 10.2 Autenticação Interna
- rotas internas devem ser protegidas;
- tokens e segredos devem ser tratados de forma segura;
- credenciais de integração não devem ficar espalhadas por múltiplos módulos.

## 11. Frontend via Realtime
O frontend não integra diretamente com Gateway ou Secretary.

O frontend consome apenas:
- estado operacional persistido;
- projeções em tempo real;
- eventos internos já aceitos pelo sistema.

O contrato de realtime detalhado pertence ao documento de eventos e realtime.

## 12. Chatwoot Compatibility (Se Necessário)
- deve existir apenas como adapter;
- não pode contaminar o core;
- não deve definir contratos internos;
- não deve se tornar dependência obrigatória do modelo operacional do Desk.

## 13. Regras de Implementação
Antes de implementar qualquer integração, é obrigatório:
- verificar se já existe rota inbound equivalente;
- verificar se já existe integração com Gateway;
- verificar se já existe adapter contratual correspondente;
- não criar endpoint duplicado;
- não alterar contrato sem atualizar este documento.

Se houver divergência entre integração desejada e arquitetura preservada:
- adaptar a implementação ao Gateway como borda oficial;
- preservar o `secretary-adapter` como ponto único com a Secretary;
- atualizar este documento explicitamente antes de consolidar novo contrato.

## 14. Regra de Precedência
Este documento define os contratos externos e de fronteira do sistema.

Nenhuma implementação pode:
- alterar contrato sem atualizar este documento;
- criar integração paralela;
- ignorar idempotência;
- ignorar validação de entrada;
- propagar payload externo cru para o core.
