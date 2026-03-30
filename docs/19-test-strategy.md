# Estratégia Mínima de Testes

## Smoke Tests Automáticos (Obrigatório)
Se o Gateway quebrar, toda a esteira do Hospital cai.

1. **Testes de Inbound Idempotente:** 
   O Worker envia o `{"id": "msg_xyz123", "text":"Oi"}` 4 vezes consecutivas. Só **UMA** mensagem pode aparecer no banco na mesma `conversation`.

2. **Testes de Handoff (Adapter):** 
   Se AI Secretary envia { "event": "agent.assign" }, o `api` precisa testar o endpoint validando que a permissão de Agent = "Human Receptionist" existe na `role` designada, ou joga Queue assignment error.

## Unidade
- Para `desk-api`: Jest ou Vitest testando as Service Layers sem acoplar com Express/Fastify request e Response.

## Integration / E2E
- A ser coberto limitadamente nesta primeira etapa. Playwright só será injetado fase tardia. Focaremos em Integração End2End testando o EndPoint `FASTIFY` (mockando o Redis interno + SQLite em memória para o PG).
