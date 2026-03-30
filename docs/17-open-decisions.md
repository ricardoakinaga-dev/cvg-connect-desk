# Decisões Fechadas e Abertas (Brainstorms)

*Manter o controle sobre aberturas que podem estourar escopo.*

## DECISÕES FECHADAS (Fase 0)
1. **Package manager:** **pnpm**.
2. **Orquestração:** **Turborepo**.
3. **Repositório:** Único repositório Git na raiz. Nenhum git init isolado.
4. **Stack principal:** Backend: Fastify + TypeScript. Frontend: Next.js + React + TypeScript.

## EM ABERTO
### 1. Qual o ORM / Engine SQL? Recomendação = Kysely ou Drizzle
Como temos `cvg-his` na máquina atual, há grande chance de a arquitetura usar Drizzle. O Drizzle encaixa perfeitamente em Fastify e NextJS. Decidiremos na Fase 1.

### 2. Gestor de Filas: Redis Streams ou BullMQ? Recomendação = BullMQ
BullMQ é o mais adotado por Fastify no ecossistema Node para filas pesadas de inbound webhook. Manteremos essa sugestão para a Fase 1.
