**Decisões, riscos e mudança de escopo**

Os valores abaixo são propostas de planejamento. Nenhuma decisão de retenção, aceitação de risco alto ou publicação foi fabricada. AAA-01 deve usar o código e requisitos existentes para resolver escolhas técnicas rotineiras; somente uma decisão material sem autorização existente permanece pendente para o responsável. A pendência bloqueia a tarefa dependente, não o programa inteiro.

| ID | Decisão | Proposta / evidência a obter | Responsável e efeito |
|---|---|---|---|
| D01 | Sessão, conversa sem setor, admin, prazo de revogação | **[SESSÃO RESOLVIDA 2026-09-12]** durações preservadas (7d normal / 30d absoluto / 24h idle), lastSeenAt só em sucesso, rotação preserva absoluto; HTTP efeito imediato na próxima requisição e WS ≤5s via C02 — registro em `runtime/decisions/D01-session-policy.md` e C01 FROZEN. Pendentes de authz (conversa sem setor, admin, markRead) seguem para AAA-04/AAA-05 sem bloquear AAA-03 | Lead backend; C01 congelado. Authz restante não enfraquece default-deny |
| D02 | Privacidade e retenção por cópia | Inventariar antes de apagar; prazo/finalidade por contato/mensagem/nota/outbox/DLQ/asset/audit/backup e relações tutor/paciente. Retenção operacional antiga não prova autorização atual | Responsável pelos dados; AAA-17 fica bloqueada para mutação dependente até decisão registrada; execução de inventário pode avançar |
| D03 | Transporte e limite de anexos | Manter capacidade de 16 MiB prometida; preferir transporte que não multiplique payload base64, validar tamanho real e scanner fail-closed. Avaliar storage já existente e compatibilidade | Lead backend/frontend/infra; C05 congelado antes de AAA-10/13; mudança de limite de produto precisa decisão explícita |
| D04 | Runtime, workload e ambientes | Selecionar Node suportado compatível e pin único por evidência atual; PostgreSQL/Redis/serviços efêmeros; perfil de carga proposto em QA12. Não comparar local Node24 com CI Node20 como equivalentes | Lead plataforma/SRE; C00/C08 antes de upgrade/benchmarks; alternativa ao Docker local aceita se prova mesma fronteira |

**Riscos operacionais com responsável sugerido**

| Risco | Controle | Sinal para replanejar |
|---|---|---|
| Alteração de schema rompe versões em rollout | Expand/contract, migration em cópia sintética, leitor antigo/novo, roll-forward ensaiado | Rollback exige apagar dados ou consumidor antigo não funciona |
| Duas tasks mudam mesmo arquivo | Lotes filtrados por prefixo/locks e lease manual no coordenador | Diff fora de ownership; parar somente o writer conflitante |
| Upgrade troca comportamento de contratos | Atualização em grupos, fixação do lock e testes de consumidores | Fonte mudou fora do escopo previsto; redistribuir cartão |
| Validação oculta skips/erros | Capturar exit code, inventário de suítes e caso conhecido ruim | Gate verde com fixture ausente, mocks no objeto julgado ou `|| true` |
| Provider não oferece idempotência | Reconciliação e estado desconhecido explícitos, limites de retry | Ack externo perdido; não reenviar cegamente |
| Política de privacidade insuficiente | Inventário de cópias e decisão por classe, registrar alcance | Responsável não definiu retenção de conteúdo/backup |
| Visual forte sem operação funcional | Mesma revisão: browser real + rede + teclado + tarefa operacional | Controle sem efeito, indicador Online estático, erro escondido |
| Evidência antiga ou adulterada | Fonte e artefatos com SHA-256, manifesto e reexecução do integrador | Candidato/hash diverge ou reviewer tocou o produto |

**Registro de mudança.** Criar registro datado em runtime/decisions com ID, premissa, alternativas, decisão, autor, evidência, contratos/tarefas afetadas e rollback. Propostas não contam como aprovadas. Não ampliar dependências, gerar assets pagos, publicar ou enviar mensagens a terceiros como efeito colateral de corrigir o programa.
