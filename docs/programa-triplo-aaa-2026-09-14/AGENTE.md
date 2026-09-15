# Guia operacional do agente executor

## Missão

Executar este programa até fechar todos os 48 itens e 11 dimensões UX com as provas exigidas. Preservar o objetivo completo ao retomar. Não substituir a melhoria de uma área por alteração da sua nota, documentação ou teste.

## Ordem de leitura

1. Instrução atual do usuário e AGENTS.md aplicáveis.
2. README, PLANO-EXECUTIVO, CRITERIOS, CONTRATOS e DECISOES deste pacote.
3. BACKLOG.json, cartão da tarefa e RASTREABILIDADE.
4. Evidências recentes e código/runtime atual no limite da tarefa; auditoria é baseline.

Na entrada da R3 não existe runner iniciado por esta auditoria. O primeiro executor começa em SA-001-R3-A1. O host pode conter recursos de outros trabalhos; identificar ownership e não interrompê-los. Se já houver trabalho novo, reconciliar antes de rodar qualquer tarefa.

## Fonte canônica e utilitário

BACKLOG.json controla ID, estado, dependências, aceites e próxima ação; REQUISITOS.json controla IDs, baseline e meta. BACKLOG.md, RASTREABILIDADE.md e cartões são gerados:

```bash
python3 docs/programa-triplo-aaa-2026-09-14/programa.py validate
python3 docs/programa-triplo-aaa-2026-09-14/programa.py next
python3 docs/programa-triplo-aaa-2026-09-14/programa.py render
```

`next` avalia somente dependências. Lead ainda verifica decisões, ambiente e reserva de escrita. O utilitário não executa tarefas nem aprova evidência técnica. Não promover estado com base apenas no seu exit0.

## Protocolo por tarefa

1. Ler resultado/ACs, inspecionar fonte e reproduzir lacuna ou baseline de capacidade.
2. Reservar arquivos concretos e recursos; congelar exemplos de contrato com consumidores.
3. Registrar hipótese e teste que reprovaria o comportamento atual/defeituoso.
4. Implementar a menor mudança coerente que feche o resultado completo, incluindo consumidor e persistência quando necessários.
5. Executar prova pública, negativos, falhas e regressões proporcionais; capturar dados sanitizados.
6. Fazer revisão própria distinta, então crítica independente sem autoria.
7. Resolver achado de maior gravidade; repetir teste afetado e regressão, preservando a falha anterior.
8. Enviar o artefato corrigido a uma nova crítica independente. A crítica anterior não aprova mudanças feitas depois dela.
9. Integrar e verificar candidato atual; atualizar estado/evidências e regenerar derivados.

Se a capacidade já satisfaz o aceite ao revalidar, documentar a prova e preservar regressão. Não criar refatoração para simular progresso. Melhorar prova/mecanismo de prevenção pode ser a entrega justificada de um item já maduro.

## Estados

PLANNED → READY → RUNNING → IMPLEMENTED → REVIEW → VERIFIED → DONE. Falha volta aREWORK; dependência real indisponível ficaBLOCKED com causa/ação precisa. Toda promoção exige suas condições:

- READY: dependênciasDONE, contratos disponíveis, autoridade pertinente e ownership concreto.
- IMPLEMENTED: código/artefato existe; ainda não aprovado.
- VERIFIED: ACs atuais passam, provas com hash e revisão referenciada.
- DONE: integração e regressões aceitas, no candidato identificado.

Ao alterar arquivo/contrato relevante, invalidar estados/provas dependentes. Tarefas bloqueadas não impedem outras elegíveis. Decisão humana aberta só bloqueia a subação indicada; não avançar a ação dependente por silêncio.

## Divisão do trabalho

Até4 agentes ativos, incluindo o lead. Use lead+2 builders+1crítico como padrão. Sem descendentes automáticos. Cada pacote de delegação contém objetivo, IDs de AC, entradas, arquivos permitidos, exclusões, dependências, ambiente, comandos, provas esperadas e condição de retorno.

Reservar nomes reais de arquivos antes de escrever. `modules/*` ou `apps/desk-web` no cartão é superfície de investigação, não autorização de dois escritores simultâneos. Schema/migrações, lockfile, Compose, CI, tokens/primitivas e conjuntos de fixtures recebem dono único. Bancos, portas, filas e logs também são recursos compartilhados.

Crítico novo usa contexto sem histórico do builder e somente objetivo, critérios, artefato e reprodução segura. Registrar nível de independência e sentinela antes/depois. Não executar builders, testes que mutem caches no mesmo escopo nem atualização documental durante a sentinela. Se houver mutação concorrente, o veredito é INVALID e deve ser repetido. Se não houver capacidade para crítica independente, declarar limitação e manter a certificação AAA pendente; não simular outro revisor na mesma resposta.

## Registro de evidência

Criar diretório por tarefa/run em `evidencias/SA-NNN/` somente durante execução. Registrar emJSONL append-only: task_id, AC/gate, candidate_id, source/lock/build hashes, image digests, command/procedure, tool/version, environment_id, fixture, start/end/observed_at, run_id, attempt, result, exit_status, artifact paths/hashes, limitations, builder e reviewer.

Para BACKLOG.json terminal, adicionar `evidence_state: CURRENT`, lista `evidence` com `path` relativo ao programa e `sha256`, e `review_ref` para o registro de revisão. Cada aceite obrigatório precisa de registro executado no candidato completo; `reviewer: pending`, candidato genérico ou selo antigo impedem DONE. O `review_ref` deve representar crítica posterior à última alteração e não pode transformar um resultado PARTIAL em aprovação por texto acrescentado pelo builder/lead. O validador verifica estrutura/hashes de arquivos; o lead e o crítico verificam conteúdo, escopo, cronologia e frescor. Prova falsa não se torna válida por ter hash.

O manifesto pode ocultar conteúdo sensível, mas deve incluir no selo um digest criptográfico local de todo arquivo versionado que afete build, configuração, teste ou operação. Validar o gerador contra mudança de bytes com mesmo tamanho, mudança de modo, arquivo adicionado/removido e mudança apenas no livro-caixa. Identidade de produto e integridade do livro-caixa devem ter digests separados e ligados pela revisão.

### Convenção de selo do SA-001-R3

O gerador `scripts/programa-triplo-aaa/candidate_manifest.py` produz o schema de manifesto v2. `candidate.product_sha256` cobre todos os arquivos inventariados fora de `docs/programa-triplo-aaa-2026-09-14/` e `docs/auditorias/`; `candidate.ledger_sha256` cobre os documentos canônicos desses dois prefixos. Os dois selos carregam a mesma `candidate.revision`, e `tree_sha256` permanece apenas como alias compatível do selo de produto.

Arquivos dotenv reais versionados são lidos somente para o digest local: nenhum valor é serializado. Arquivos de exemplo, como `.env.production.example`, não são tratados como segredo e seus bytes entram normalmente no selo. O inventário registra modo, estado Git, adições/remoções e symlinks; o destino de um symlink participa do hash por digest do alvo textual.

Evidências e manifests gerados ficam fora do `ledger_sha256` e dos prefixos de inventário bruto para evitar autorreferência; cada artefato relevante tem hash próprio no JSONL. O escopo e as exclusões são publicados no próprio manifesto e em `evidencias/SA-001/environment-r3.json`. A comparação com `docs/auditorias/2026-09-14/evidencias/source-manifest.json` fica em `evidencias/SA-001/source-manifest-comparison-r3.json`; diferença de escopo é esperada, drift do worktree exige review e diferenças de bytes nunca são apagadas.

Não guardar segredos nem dados de produção em evidências. Mocks, fixtures, serviço real de homologação eprodução devem estar identificados por artefato. Print de UI não comprova transação; unit test não comprova imagem implantada; gate verde não comprova coverage que foi excluída.

## Comandos existentes: uso condicionado ao ambiente

Lint/typecheck/build estão no package.json. `test:ci` exclui suites e pode depender de PG/Redis. `test:postgres-real` executa migração. Playwright smoke e scriptsDR existentes precisam ser inspecionados e adaptados ao runner isolado antes do uso. **Não executar scripts destrutivos contra URLs implícitas ou bancos compartilhados.**

Testes específicos descritos como “criar” nos cartões são trabalho planejado. Não anunciar que já existem nem substituir ausência de harness por aprovação manual informal.

## Recuperação e ações externas

Confirmar que processo/handle está vivo antes de esperar; timeout de observação não prova término. Consultar efeito externo porID antes de repetir mensagem, migração, deploy ou eliminação. Preservar diff alheio; nenhum reset/clean global nem teardown de fora do runner.

Antes de pedir decisão, preparar proposta, pacote e provas que independem dela. Conferir se o usuário já autorizoua ação. Autoridade ausente pode bloquear deploy/dados/provedor, mas não justifica interromper um inventário, teste sintético ou correção independente já autorizada.

## Quando parar

Concluir tarefa só com aceites integrados. Concluir qualificação só em SA-059, com 48 itens + 11 dimensões UX≥95 e G01–G12 atuais. Implantar só após conferir autoridade de SA-061. Estabilizar requer observação de SA-062. Se houver bloqueio, manter estado honesto e próximo passo executável; não reduzir escopo para declarar sucesso.
