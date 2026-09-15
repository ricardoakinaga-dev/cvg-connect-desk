# CVG Connect Desk — Design system operacional

Status: v1, consolidado em 2026-09-13 (AAA-20). Barra vigente: `QUALIDADE.json`
áreas 9/10 e `DESIGN_QA.md` (C09). Este documento governa tokens, primitivas,
estados e regras de uso do frontend; a direção visual permanece a de
`cvg-visual-brief.md` ("Pulso Operacional").

## 1. Fonte de verdade e procedência

- Marca e paleta: observação pública do Centro Veterinário Guarapiranga,
  registrada em `cvg-visual-brief.md`; logo fornecida e autorizada pelo titular.
- Nenhum asset novo foi gerado externamente nesta consolidação. Artefatos
  opcionais (ComfyUI/Blender/OpenDesign) e suas hashes seguem em
  `cvg-tool-provenance.md`; uso é opcional, nunca condição de aceite.
- Dono único de escrita das folhas globais: `apps/desk-web/src/index.css`
  (tokens, base, primitivas), `apps/desk-web/src/premium-surfaces.css`
  (compatibilidade carregada por último) e
  `apps/desk-web/src/pages/EntityPages.css` (páginas de entidade).
- Manifesto legível por máquina: `docs/design/cvg-design-system.json`
  (156 tokens + pares de contraste medidos).

## 2. Tokens

Todos os tokens vivem em `:root` de `index.css`. Tokens herdados da marca
(`--color-primary`, `--color-navy`, `--radius-*`, `--shadow-*`,
`--duration-*`, `--ease-*`) mantêm o nome para não quebrar páginas.

### Cor

| Grupo | Tokens | Regra |
|---|---|---|
| Marca | `--color-primary`, `--color-primary-hover`, `--color-primary-bright`, `--color-primary-soft`, `--color-primary-mist` | Decoração, ícones, bordas e fundos. `--color-primary` (#0284c7) não é usado como texto pequeno nem como fundo com texto branco. |
| AA sobre claro | `--color-primary-strong`, `--color-primary-strong-hover`, `--color-primary-text` | Botão primário e texto/links pequenos. Contraste médio 5,93:1. |
| Texto | `--color-text`, `--color-text-secondary`, `--color-text-tertiary` | Terciário escurecido para `#5b7184` (5,07:1 no branco; 4,74:1 no fundo). |
| Superfícies | `--color-bg`, `--color-surface`, `--color-surface-muted`, `--color-surface-dark` | Fundos de página, cartões e faixas. |
| Limites | `--color-border`, `--color-border-strong` | Limites de repouso e de hover/controles. |
| Estados | `--color-success|warning|error|critical` + trios `*-soft` / `*-border` / `*-text` | Texto sempre em `*-text` sobre `*-soft`; nenhum estado é comunicado só por cor. |
| Neutro/desabilitado | `--color-neutral-*`, `--color-disabled-*` | Desabilitado tem fundo, borda e texto próprios além de atributo `disabled`. |
| Foco | `--color-focus` (#0369a1, 5,93:1 no branco), `--color-focus-inverse` (#7dd3fc, 10,49:1 no navy), `--focus-ring`, `--focus-ring-inverse` | Anel visível ≥3:1 sobre claro e escuro. |
| Shell | `--color-shell-*` | Paleta do sidebar/topbar; consumida só por `Layout.css`. |

### Espaçamento, raio, tipografia, elevação, camadas e movimento

- Espaçamento na base 4px: `--space-1..--space-12` (4→48px).
- Raio: `--radius-xs|sm|md|lg|xl|pill`.
- Tipografia: `--font-sans`, `--font-size-2xs..--font-size-display`,
  `--font-weight-regular..bold`, `--line-height-tight|normal`,
  `--letter-spacing-tight|caps`.
- Elevação: `--shadow-xs..--shadow-lg`; shell usa sombras próprias em tokens.
- Camadas: `--z-base|sticky|header|backdrop|sidebar|modal|toast|skip`
  (valores preservam a ordem existente: topbar 900, backdrop 950, sidebar
  1000, modal 1200, skip 3000).
- Movimento: `--duration-instant|fast|normal|slow` (80/160/220/320ms),
  `--ease-standard`, `--ease-emphasized`. Alvo ergonômico interno:
  `--control-height` e `--touch-target` = 44px; `--control-height-sm` = 36px.
  Itens de navegação do shell usam `min-height: var(--touch-target)`.
  `--color-mask` (#000) existe só para `mask-image`, onde apenas o alpha
  importa; não é cor de interface.

### Contraste (medido em `cvg-design-system.json`)

Todo par texto/fundo usado por primitivas atinge ≥4,5:1 (AA texto). Foco e
bordas de estado atingem ≥3:1 (AA não textual). Nenhum par do sistema
depende de cor isolada para leitura assistiva.

## 3. Primitivas

Importe do barril `components/ui` (`apps/desk-web/src/components/ui/index.ts`).
As classes CSS canônicas usam o prefixo `ui-`; classes legadas continuam
válidas por alias.

### Button (`ui-btn`)

- Variantes: `primary`, `secondary`, `ghost`, `danger`; tamanhos `md`, `sm`,
  `icon`; prop `loading` (spinner com `aria-hidden`, `aria-busy="true"` e
  `disabled`); `icon`/`iconRight` decorativos.
- Nome acessível: texto do filho ou `aria-label` obrigatório no modo `icon`.
- Aliases legados: `.btn`, `.btn-primary`, `.btn-secondary` compartilham a
  base e foram ajustados para AA (`--color-primary-strong`).

### TextField (`ui-field` + `ui-input`)

- `label` sempre presente; `hint` e `error` ligados por `aria-describedby`;
  `error` usa `aria-invalid="true"` e `role="alert"`.
- Aliases: `.input` (foco por `:focus` com anel de token, `aria-invalid`
  estilizado, `disabled` com tokens).
- Nunca use placeholder como rótulo.

### Card (`ui-card`)

- `padding` (`none|sm|md|lg`), `interactive` para hover/elevação, `as` para
  elemento semântico. Aliases: `.card`.

### Badge (`ui-badge`)

- Tons `neutral|info|success|warning|error`; `status` força ícone + texto
  para que o significado não dependa de cor. Aliases: `.badge` (só layout),
  `.badge-success|warning|error|info`.

### Estados (`LoadingState`, `EmptyState`, `ErrorState`)

- `LoadingState`: `role="status"`, `aria-live="polite"`, spinner oculto da
  árvore acessível.
- `EmptyState`: título textual, descrição opcional até 46ch, ícone
  decorativo, ação opcional.
- `ErrorState`: `role="alert"`, mensagem real e ação de retry nomeada.
- Aliases: `.loading`, `.error-message`, `.ui-alert--*`.

### Conectividade (`ConnectionStatus` + `useRealtimeStatus`)

- Fonte única: `RealtimeClient` em `lib/realtime.ts` expõe
  `getConnectionState()` e `subscribeConnectionState()` (aditivo, sem alterar
  resolução de URL/autenticação/reconexão do AAA-06).
- Estados reais: `idle` (sem sessão iniciada/encerrada pelo app),
  `connecting`, `connected` (socket aberto **e** `auth.success`),
  `reconnecting` (degradado, reconexão automática) e `offline` (sem
  credencial/URL, auth rejeitada ou queda final), com `reason` auditável.
- `useRealtimeStatus(client?)` observa o singleton (ou instância injetada em
  teste). `ConnectionStatus` e `presencePresentation` derivam texto, tom e
  ícone do mesmo estado — nunca há segunda fonte de verdade.
- Regra: a UI só afirma conexão com `status === 'connected'`; qualquer outro
  estado mostra "Conectando", "Reconectando", "Offline" ou "Sem conexão" com
  detalhe textual e `role="status"`/`aria-live="polite"`. É proibido texto
  fixo do tipo "Online"/"Central ativa".

## 4. Estados e regras de comportamento

| Estado | Contrato visual/comportamental |
|---|---|
| Foco | `:focus-visible` global com anel de token; em superfícies escuras o anel inverte. Não remover `outline` sem substituir por indicador ≥3:1. |
| Hover/press | Cores mudam só em superfície/borda; `active` desloca 1px; sem animação contínua. |
| Disabled | `disabled` real + tokens de desabilitado; não usar apenas opacidade em controles primários. |
| Loading | `aria-busy` + spinner + controle desabilitado; mensagem em `role="status"`. |
| Error | `role="alert"` com mensagem textual acionável; nunca erro só em vermelho ou em `console.error`. |
| Empty | Estados vazios reais com texto; não substituir dado ausente por exemplo fictício. |
| Status | Sempre texto (e ícone quando `status`); cor é reforço, não informação. |
| Movimento | `prefers-reduced-motion` zera animações/transições e desliga scroll suave, inclusive nos componentes do shell. |
| Teclado | Ordem natural do DOM; foco preso em modais/drawers via `useModalFocus`; Escape fecha e o foco retorna ao acionador. |
| Alvos | Controles primários de toque com 44×44 CSS px (`--control-height`); alvo interno de ergonomia, não requisito universal de AA. |

## 5. Responsividade

Viewports de referência (DESIGN_QA): 375×812, 390×844, 768×1024, 1024×768,
1440×900, com atenção aos breakpoints 860 e 1260 px. O shell usa 272px de
sidebar (228px entre 861–1120px), topbar fixa abaixo de 861px, painel móvel
com `inert`, backdrop e restauração de foco. Sem overflow global horizontal
(`overflow-x: clip` no conteúdo). Nenhuma rota deve rolar em dois eixos.

## 6. Fronteira de migração

- AAA-20 entrega tokens, primitivas e shell. Páginas de lote
  (AAA-21/29/30/31) migram o markup consumindo `components/ui` e removendo
  CSS local duplicado; até lá, `premium-surfaces.css` normaliza foco,
  cartões, botões e campos das páginas legadas.
- Adoção já feita nesta entrega: shell (`Button` no menu/close/logout,
  `ConnectionStatus`/`useRealtimeStatus` para conectividade real e
  `ErrorBoundary` com `ErrorState`).
- **Follow-up bloqueante (AAA-21/29/30/31):** cada página de rota deve
  renderizar loading com `role="status"` e erro com `role="alert"`
  (adotando `LoadingState`/`ErrorState` ou equivalente local), sem engolir
  falha de API. Lista nominal e donos em
  `docs/design/cvg-page-state-adoption.json`. Evidência da pendência:
  falha de API em `/tasks` cai em vazio silencioso (sem `role`), enquanto
  `/tutors` e `/patients` já exibem `role="alert"` via `.entity-error`.
- `EntityPages.css` já consome tokens; classes legadas `.btn-primary`,
  `.btn-create`, `.entity-button` continuam funcionando.
- Alterar token global exige atualizar `cvg-design-system.json` e a tabela
  de contraste; mudança de primitiva exige teste em
  `components/ui/__tests__/primitives.test.tsx`.

## 7. Orçamento e verificação

- Orçamentos DESIGN_QA: CSS gzip ≤25 KiB; JS inicial gzip ≤120 KiB.
  Medição local do candidato: ver `RETORNO.md` (AAA-20) e evidência de build.
- Verificações: `pnpm --filter @cvg/desk-web test|typecheck|build` e lint
  sem erros (warnings preexistentes contados). Evidência durável do
  candidato: `docs/execucao-aaa-2026-09-12/runtime/candidates/AAA-20/evidence/`
  (capturas do harness Playwright com API simulada; servidor de tempo real
  de teste quando indicado; não aprova auth/upload/produção).
