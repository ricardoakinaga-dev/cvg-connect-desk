# Decisões para continuidade — revisão R3

D01–D06 permanecem `OPEN` segundo o registro recebido. Nesta solicitação estão autorizadas auditoria e atualização documental; a implementação futura depende de solicitação própria. Cada decisão tem responsável funcional indicado, mas a nomeação nominal e a autoridade ratificadora continuam pendentes. A aprovação de condições operacionais não substitui autorização vinculada ao pacote de implantação.

| ID | Decisão e proposta para análise | Responsável funcional (nomeação nominal pendente) | Afeta / momento de bloqueio |
|---|---|---|---|
| D01 | Fonte efetiva de papéis/permissões, memberships e exceções de recurso sem setor; preservar ação+recurso e revogação | Produto + segurança | PROD-04/24/26: contrato antes de modificar regras; nunca liberar bypass enquanto aberto |
| D02 | Retenção, bases/finalidades, exportação/eliminação, backups e subprocessadores; ratificar política existente | Responsável pelos dados + operação | PROD-16/37/41: execução irreversível e liberação de dados restaurados; inventário, dry-run e testes sintéticos avançam |
| D03 | Tutor–paciente N:N documentado versus 1:N implementado; proposta padrão implementar N:N compatível | Produto + dados | PROD-25: migração relacional e contrato definitivo; PROD-06 conclui inventário/proposta e correções independentes de schema |
| D04 | Limites de customização Kanban e filtros conforme documentação vigente | Produto | PROD-27: expansões ambíguas; navegação, filtros acordados e acessibilidade avançam |
| D05 | Ferramentas IA habilitadas, ações e aprovadores; conectar workflow exigido ou aprovar formalmente exclusão com superfície desabilitada | Produto + segurança | PROD-13/26: habilitação/efeitos; budget, validação e deny-default avançam |
| D06 | Ambiente, domínio/TLS, escala, custos, janela, piloto, abort/rollback, plantão e período de estabilização | Operador + responsável pelo release | PROD-41/42/43: promoção e operação; preparar pacote e ensaio isolado antes de solicitar autorização |

## Registro de autoridade

- Estado de D01–D06: `OPEN`; nenhuma foi apresentada como aprovada ou ratificada.
- Escopo de cada bloqueio é somente a ação dependente indicada na tabela. Inventário, documentação, dry-run, correções independentes e testes sintéticos podem avançar sem usá-la como autorização.
- O fechamento exige nome do aprovador, data, alcance, versão do contrato afetado e evidência de decisão. Ausência desses campos permanece bloqueio explícito, não `PASS` implícito.

## Recomendações e impacto (para apreciação dos donos)

### D01 — permissões efetivas
- **Recomendação:** manter a fonte efetiva no banco (`roles`, `role_permissions`, `sector_permissions`, memberships) com decisão sempre por ação+recurso; ausência de setores nunca significa admin; papel global exige marcação explícita.
- **Alternativa:** catálogo estático em código (mais simples, menos auditável) — não recomendada por contrariar a exigência de papéis editáveis.
- **Impacto se aprovada:** PROD-04/24/26 implementam a checagem unificada e a edição de permissões; permanece proibido qualquer bypass de autorização.
- **Avança sem decisão:** correção do helper para exigir ação+recurso, matriz de negativos HTTP/WS e trilha de auditoria. Bloqueado: ratificar nomes/finalidades do catálogo de papéis de produção.

### D02 — retenção e dados pessoais
- **Recomendação:** operar com bases/finalidades e prazos já documentados em `docs/LGPD_DATA_SUBJECT_REQUESTS.md`, retenção de mídia de quarentena 7d e exclusão com checkpoint; ratificar subprocessadores e formato de backup.
- **Alternativa:** manter retenção indefinida — não recomendada (risco LGPD/armazenamento).
- **Impacto se aprovada:** libera PROD-16 (política por cópia), restores de PROD-37 e o pacote PROD-41. Avançam sem decisão: inventário, dry-run, redaction e testes sintéticos. Bloqueado: eliminação real e liberação de dados restaurados.

### D03 — tutor–paciente N:N
- **Recomendação (técnica):** implementar N:N compatível (`tutor_patients` com FK composta e unicidade), migrando o 1:N atual com backfill idempotente e leitura dupla durante rollout. Proposta completa em `D03-PROPOSTA.md`.
- **Alternativa:** permanecer 1:N e atualizar a documentação — contraria `docs/09-data-model.md` §6.4.
- **Impacto se aprovada:** PROD-25 migra e adapta módulos; PROD-06 entrega apenas inventário/proposta. Avançam sem decisão: correções de sessão/timezone e webhook (PROD-05/07).

### D04 — Kanban
- **Recomendação:** congelar como limites da fase os filtros já existentes (setor/status) + agente/prioridade/período/labels por conversa; customização de colunas fica fora desta fase até ratificação.
- **Alternativa:** expandir customização agora — impacto de escopo e migração de board não mensurado.
- **Impacto se aprovada:** PROD-27 completa filtros/atualização; deep-link e acessibilidade avançam independentemente.

### D05 — ferramentas IA
- **Recomendação:** manter **deny-default** e todas as ferramentas desabilitadas em produção até ratificação; implementar budget durável por conversa e o fluxo de aprovação vinculado ao payload original com flag desligada.
- **Alternativa:** habilitar subconjunto read-only — requer nomear ações/aprovadores.
- **Impacto se aprovada:** PROD-13/26 habilitam efeitos de ferramentas. Avançam sem decisão: budget persistente, validação e degradação segura (Secretary).

### D06 — condições operacionais
- **Recomendação:** usar o ambiente de staging isolado do pacote (PostgreSQL/Redis/storage/scanner/Collector) para o ensaio, com janela, abort/rollback e plantão definidos; promoção somente após PROD-40/41.
- **Alternativa:** promoção direta sem piloto — não recomendada pelo plano.
- **Impacto se aprovada:** autoriza PROD-42 (não concedida por este programa). Avançam sem decisão: pacote PROD-41 e ensaio isolado.
