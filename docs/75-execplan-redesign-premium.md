# ExecPlan — Redesign premium do CVG Connect Desk

## Resultado observável

Entregar um frontend React funcionalmente preservado e visualmente reconstruído como “Pulso Operacional”: responsivo, acessível, com design system próprio, texturas e motion com propósito, conceito editável no OpenDesign e assets rastreáveis de ComfyUI/Blender.

## Perfil de execução

- Projeto: brownfield React/Vite em monorepo.
- Modo: redesign + refatoração visual incremental.
- Tier: T3, por atravessar shell, rotas, cascade global, estados responsivos, assets e evidência visual.
- Autorização: escrita local, sem deploy/publicação e sem alterar contratos do backend.
- Worktree: alterações preexistentes de backend e Dockerfile devem ser preservadas.
- Barra congelada: `docs/design/cvg-quality-bar.json` v1.

## Baseline confirmado

- Frontend: 47/47 testes, typecheck e build passam.
- Desktop é funcional, porém o Inbox móvel tem 753px de largura em viewport de 375px.
- Não há `prefers-reduced-motion`; foco/semântica e contraste têm gaps altos.
- CSS global tem seletores colidentes e muitas cores/medidas fora de tokens.
- E2E full-stack local bloqueado por permissão no Docker socket; render controlado de layout é possível.

## Milestones

1. **Marca e conceito** — pesquisa primária, brief, OpenDesign, paleta segura e uso íntegro do logo fornecido/autorizado.
2. **Fundação visual** — tokens, fontes/fallbacks, iconografia SVG, primitives e shell responsivo.
3. **Superfícies prioritárias** — Login, Inbox e Dashboard com estados e motion reduzível.
4. **Cobertura sistêmica** — harmonizar as demais páginas pelo sistema central e corrigir vazamentos relevantes do cascade.
5. **Assets dirigidos** — integrar somente textura/escultura que passem orçamento, procedência e adequação.
6. **Gauntlet** — testes, build, screenshots, keyboard/reduced motion, métricas, críticas frescas, correções e revisão final.

## Contratos de preservação

- Rotas, requests, DTOs, localStorage `auth-storage`, eventos realtime e query `conversation` não mudam por finalidade estética.
- Estados de loading, empty, error e degradação premium permanecem explícitos.
- Conteúdo e controles críticos não dependem de raster ou animação.
- No mobile, cada etapa do Inbox permanece alcançável e a conversa selecionada não é descartada ao alternar painéis.
- Smartphone e tablet recebem layouts próprios: safe-area support, alvos de toque, master/detail em painel único e alternativas a interações drag-only.

## Estratégia de verificação

- Foco: testes do frontend, typecheck, build e novos testes de layout/semântica.
- Regressão: Playwright existente quando o ambiente permitir; caso contrário, browser controlado com rede interceptada e limitação declarada.
- Visual: screenshots 375/390/768/1024/1440, normal e reduced-motion, com inspeção por região.
- Qualidade: auditor de tokens/assets, contraste, overflow, console, duas críticas frescas e um Final Critic distinto.

## Riscos ativos

- CSS global pode vazar entre rotas: mitigar com scoping e tokens antes de polir.
- Settings e Notes já têm incompatibilidades de API fora do escopo visual: não esconder; preservar como gaps conhecidos.
- Fotografias públicas continuam sem licença explícita e não serão incorporadas.
- O logo fornecido foi declarado registrado/licenciado pelo usuário e está autorizado para uso integral; preservar proporções e não criar derivados da cruz fora do selo.
- Blender interativo não estava conectado no discovery; tentar rota isolada e registrar bloqueio se continuar indisponível.

## Próxima ação canônica

Fechar os gaps móveis e acessíveis identificados na primeira crítica, recapturar a matriz de telas e executar a crítica final independente.
