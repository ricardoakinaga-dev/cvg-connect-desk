# Validation Checklist por Fases

Critérios reais baseados nas demandas da prompt_master.md.

## Check da FASE 0 (Foundation)
- [x] Arquivos `.md` existem todos na pasta `/docs`.
- [x] O monorepo existe fisicamente com o manager especificado.
- [x] O linter roda com `pnpm run lint` ou sem jogar erros globais em tudo.
- [ ] O `.env.example` e o `docker-compose.yml` bootam num ambiente de subida normal na máquina dev (`docker-compose up -d` de redis + pg).

## Check da FASE 1 (Database/Auth)
- [ ] Conexão de Postgres configurada e acessível na `desk-api`.
- [ ] Criação do JWT token ao bater na Rota `/api/v1/auth/login`.

## Check da FASE 2 (Chat Inbound/Outbound)
- [ ] Payload JSON da Evolution bate no Webhook do desk-api.
- [ ] Desk API insere banco sem crash.
- [ ] Desk API não insere duplicado (Constraint external_id).
- [ ] Evento de Websocket cospe na tela do `desk-web` o inbound.

## Check da FASE 3 (Workflow)
- [ ] Da interface, FrontEnd clama "Create Task" e exalta no BD.
- [ ] Tarefa gerada clica e vincula pro Contact / Tutor / Participant atrelado ao número da UI.

## Check da FASE 4 (Handoff Secretary AI)
- [ ] O Agent Secretary chuta "handoff-event" para nossa camada.
- [ ] A Conversa no BD vira `status: open`, `assigned_to: none|queue` e `bot_active: false`.

## Check da FASE 5
- [ ] Dashboard conta quantas conversas foram para human handoff hoje.
