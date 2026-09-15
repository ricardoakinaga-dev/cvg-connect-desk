# Roadmap — revisão R2

Marcos agrupam resultados; o DAG dos cartões determina a ordem efetiva. M3 pode avançar antes do encerramento de M2 quando seus predecessores estiverem satisfeitos.

| Marco | Tarefas | Pontos restantes estimados | Critério de saída |
|---|---|---|---|
| M0 — Confiança no candidato | PROD-00, PROD-01, PROD-02, PROD-03 | 19 | Snapshot e contratos atuais; gates rejeitam os adversariais da auditoria. |
| M1 — Garantias de backend | PROD-04, PROD-05, PROD-06, PROD-07, PROD-08, PROD-09, PROD-10, PROD-11, PROD-12, PROD-13, PROD-14, PROD-15, PROD-16 | 66 | Retry, IA, dados e mídia corretos sob falha; conservar avanços e revalidar escopo. |
| M2 — Atendimento completo | PROD-17, PROD-18, PROD-19, PROD-20, PROD-21, PROD-22, PROD-23, PROD-24, PROD-25, PROD-26, PROD-27 | 79 | APIs e interface entregam contexto, anexos, tarefas/notas/alertas e administração. |
| M3 — Consistência e plataforma | PROD-28, PROD-29, PROD-30, PROD-31, PROD-32, PROD-34, PROD-36 | 47 | UI responsiva, atualização entre operadores, CI e runtime observáveis. |
| M4 — Qualificação | PROD-33, PROD-35, PROD-37, PROD-38 | 42 | Mesmas imagens em scan/boot/E2E; carga, integração e restore representativos. |
| M5 — Release revisável | PROD-39, PROD-40, PROD-41 | 18 | Documentação reconciliada, crítica final e pacote de decisão. |
| M6 — Implantação autorizada | PROD-42 | 5 | Piloto com abort/rollback e observação de serviços. |
| M7 — Estabilização | PROD-43 | 5 | Janela operacional e SLO de campo concluídos. |

## Ordem prática

1. PROD00 congela a nova baseline e isolamento. PROD01 fecha diferenças de contrato; PROD02 corrige a confiança na evidência. Podem avançar em paralelo se arquivos/recursos forem distintos.
2. Corrigir imediatamente os negativos de privacidade, assinatura renovada, Secretary unknown e mídia, respeitando contratos e dependências. Revalidar auth, sessões e transações já entregues.
3. Fechar versão/precondição em PROD18 e propagar ao Inbox; completar cada fluxo com sua API e teste de usuário. Não aguardar uma reescrita transversal da UI para entregar comportamento.
4. Finalizar composição, responsive/a11y e atualização entre operadores; validar CI, runtime, telemetria e imagens.
5. Executar carga, E2E e DR no candidato integrado; ajustar somente o necessário e repetir a prova afetada.
6. PROD39–41 reconciliam documentação, obtêm crítica fresca e preparam pacote revisável.
7. PROD42 depende de autorização vinculada ao pacote; PROD43 mede o período de campo declarado.

## Paralelismo e bloqueios

O predecessor precisa estar DONE para fechar uma tarefa dependente; preparações independentes podem ser subtarefas explícitas. Ownership e locks também bloqueiam escrita simultânea, mesmo sem aresta no DAG. Migrações são numeradas pelo integrador e bancos/providers/portas pertencem ao run.

D03 fica em PROD25; não bloqueia sessão/timezone em PROD06. Falta de MinIO ou sandbox não impede correção estática do gate; impede o aceite que exige a integração. D02 não impede implementar bloqueio da rota legada, mas impede eliminação real sem política ratificada. PROD16 não depende do aceite global de PROD04: usa C02 já definido e coordena pelo lock de auth; G02 exige ambos, evitando dependência circular semântica.

Cronograma será preenchido após medição de velocidade; não há datas de implantação presumidas. A janela mensal de SLO inicia após o deploy e não cria dependência circular para o primeiro lançamento.
