# Roadmap — rodada R3

O DAG canônico determina a ordem; marcos agrupam resultados e podem se sobrepor quando dependências/locks permitirem. Sem datas artificiais: calibrar duração por capacidade após primeira entrega aceita.

| Marco | Tarefas | Pontos relativos | Saída |
|---|---|---|---|
| M0 | PROD-00, PROD-01, PROD-02, PROD-03, PROD-44 | 22 | Candidato/isolamento registrados, bootstrap nativo restaurado e adversariais de evidência rejeitados. |
| M1 | PROD-04, PROD-05, PROD-06, PROD-07, PROD-08, PROD-09, PROD-10, PROD-11, PROD-12, PROD-13, PROD-14, PROD-15, PROD-16 | 66 | Garantias de dados, sessão, ingresso/IA/mídia comprovadas com negativos reais. |
| M2 | PROD-17, PROD-18, PROD-19, PROD-20, PROD-21, PROD-22, PROD-23, PROD-24, PROD-25, PROD-26, PROD-27 | 79 | Atendimento e administração completos, com versão obrigatória e links/seletores humanos. |
| M3 | PROD-28, PROD-29, PROD-30, PROD-31, PROD-32, PROD-34, PROD-36 | 47 | UI consistente/acessível, atualização multioperador, CI/runtime/telemetria preparados. |
| M4 | PROD-33, PROD-35, PROD-37, PROD-38 | 42 | Mesmas imagens validadas em scan/boot/E2E; storage/scanner, carga e restore representativos. |
| M5 | PROD-39, PROD-40, PROD-41 | 18 | Documentação reconciliada, crítica independente do candidato e pacote de decisão. |
| M6 | PROD-42 | 5 | Piloto autorizado, abort/rollback e serviços observados. |
| M7 | PROD-43 | 5 | Janela operacional/SLO de campo medidos e pendências encerradas. |


## Sequência executável

1. PROD-00 congela a nova baseline e prepara provas em diretório próprio. PROD-44 pode iniciar em seguida, sem esperar decisões de produto; corrige interop e testa CLI. PROD-01 e PROD-02 avançam com ownership separado; PROD-03 depende de contratos/gate.
2. PROD-05 depende de PROD-44,01,06: reexecutar17 casos após boot corrigido. PROD-36 continua posterior para imagem/TLS/health real, evitando ciclo semântico. Não esconder falha com exclusão de teste.
3. Priorizar PROD-16,10/12,14 e18 conforme dependências. Fechar legado privacidade, reconciliação IA, concorrência do pool e versão API/UI. Manter retry renovado/ACK correto como regressões.
4. Entregar fluxos PROD-17–27 em fatias verticais com suas APIs. Correção pequena do drawer pode ser subentrega antecipada de PROD-29; fechamento integral permanece após PROD-28. Não condicionar todo trabalho de UI a uma reescrita transversal.
5. Integrar PROD-28–38 por dependências: boot/imagens e observabilidade real, scanner/MinIO, falhas físicas, SQL/carga, DR, E2E e a11y. Infra não exercitada recebe NOT_RUN/BLOCKED, sem PASS inferido.
6. PROD-39–41 produzem documentos finais, revisão independente e pacote concreto. PROD-42/43 são implantação autorizada e estabilização.

## Trabalho paralelo e bloqueios

Separar runtime/shared exports de gates; respeitar locks em auth, schema, composição e deploy. Integrador arbitra migrations e arquivos compartilhados. Dono do recurso deve provar runId/attempt e teardown apenas do próprio ambiente. Tarefa dependente não encerra antes dos predecessores; preparação independente pode virar subentrega explícita.

D03 bloqueia decisão relacional de PROD-25, não sessões/timezone em PROD-06. D02 não impede bloquear rota insegura ou dry-run sintético. D05 mantém ferramentas desabilitadas até ratificação. D06 não impede preparar pacote/ensaio isolado, mas condições operacionais e autorização aplicável antecedem promoção. Falta de MinIO não bloqueia correção do gate; bloqueia apenas a prova que depende do storage.
