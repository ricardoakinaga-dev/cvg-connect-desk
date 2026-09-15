# Retomada AAA-03 — conferência documental

Registro do assistente desta conversa em 12/09/2026, após retorno do coordenador paralelo. Este diretório guarda comunicações e conferências desta conversa; o estado operacional continua exclusivamente em `runtime/state.json`, sob responsabilidade do Agente 1. Não duplica despacho ou altera ownership. A partir deste retorno, esta conversa não escreve em `runtime/**` ou `CONTRATOS.md` durante o trabalho do coordenador paralelo.

## Conferência realizada

- [Despacho AAA-03](../runtime/dispatch/AAA-03.md) existe e atribui implementação ao Agente 3 em `packages/auth/**` e no teste dedicado da API.
- SHA-256 calculado de C01: `abd51f3226fdd7a6a6009f805a188f5c3ed54c893b10ee1f42d1021b18d30668`.
- SHA-256 calculado de D01: `36d9763dc5afb94a37c8df78f6ffd295b1d37d94597ce2e56e5d45654e57dd79`.
- Ambos coincidem com o despacho e o estado operacional lidos nesta rodada.
- [Registro de revisões](../runtime/reviews/AAA-03-precondicoes-2026-09-12.md) existe e registra a autorização do recorte de sessão e as limitações. Trata-se de consolidação do coordenador; não foram reexecutadas as verificações dos críticos nesta conversa.
- O estado operacional registra AAA-00 parcial, AAA-01 com contrato de sessão congelado e AAA-03 despachada. Não há declaração de aceitação integral de AAA-00/AAA-01.

Nenhum teste de produto, serviço ou banco foi executado/acessado nesta conferência. A disponibilidade atual e o marcador do ambiente devem ser conferidos pelo builder antes dos testes. A ausência do snapshot v1.0.1 permanece uma limitação histórica registrada pelo coordenador.

## Prompt de retomada do Agente 3

Retome AAA-03 em `/home/ricardo/cvg-connect-desk`. O despacho foi emitido em `docs/execucao-aaa-2026-09-12/runtime/dispatch/AAA-03.md`; leia-o integralmente, junto com C01, D01, ownership e estado operacional atuais.

Confira os hashes contra o despacho e verifique se há outro writer no seu escopo. Use apenas o ambiente atribuído, validando o marcador do run antes de qualquer escrita. As pendências integrais de AAA-00/AAA-01 têm liberação registrada para o recorte de sessão; não reabra o bloqueio antigo apenas por status PLANNED do catálogo.

Execute a reprodução negativa em PostgreSQL real antes da correção, implemente o contrato C01 e cumpra os testes do despacho: limites exatos, expiração/idle/revogação/usuário inativo, coerência dos endpoints, absoluto preservado/materializado, concorrência de rotações e rollback. Preserve tokens com hash em repouso e remova exposição do token em logs conforme o despacho.

Escreva somente no escopo atribuído. Não modifique contratos, estado operacional, harness, schema, lockfile ou arquivos de outros agentes. Para logs persistidos fora do escopo, use diretório temporário exclusivo e forneça caminhos e hashes ao coordenador para arquivamento; não registre segredos. Não reinicie nem encerre recursos alheios.

Retorne IMPLEMENTED, BLOCKED ou FAILED, com candidato identificado, arquivos alterados, reprodução antes/depois, comandos/exits, evidência de concorrência/rollback e limitações. Não declare DONE nem inicie outra task. O Agente 1 consolida a documentação, conduz a revisão e integra após regressão.
