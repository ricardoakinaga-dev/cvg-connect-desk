# Politica de Dependencias Transitivas

**Data:** 2026-04-28  
**Status:** politica operacional vigente  
**Relacionado:** `package.json`, `pnpm-lock.yaml`, `docs/88-backlog-pos-bloqueios-98.md`

## 1. Objetivo

Definir como o projeto trata vulnerabilidades, warnings e overrides de dependencias transitivas sem mascarar risco de supply chain.

## 2. Gate obrigatorio

O gate minimo e:

```bash
pnpm audit --audit-level moderate
```

Resultado da ultima validacao em 2026-04-28: PASS, `No known vulnerabilities found`.

## 3. Overrides permitidos

Overrides em `package.json` so podem existir quando atendem todos os criterios:

- corrigem vulnerabilidade conhecida ou incompatibilidade operacional;
- apontam para versao segura e mantida;
- possuem validacao por `pnpm install --frozen-lockfile`, testes e audit;
- sao revisados no proximo ciclo de atualizacao de dependencias.

Overrides atuais:

| Pacote | Regra | Motivo |
|---|---|---|
| `@fastify/static` | `>=9.1.1` | Manter versao segura transitiva. |
| `esbuild` | `>=0.25.0` | Manter versao segura transitiva. |
| `follow-redirects` | `>=1.16.0` | Manter versao segura transitiva. |
| `postcss` | `>=8.5.10` | Manter versao segura transitiva. |
| `vite` | `7.3.2` | Fixar runtime frontend validado. |

## 4. Excecoes

Uma excecao de dependencia so pode ser aceita se tiver:

- severidade e pacote afetado;
- motivo para nao atualizar imediatamente;
- impacto no produto;
- mitigacao temporaria;
- owner;
- data limite de revisao;
- evidencia de que `pnpm audit --audit-level moderate` foi avaliado.

Sem esses campos, a excecao nao e valida.

## 5. Cadencia de revisao

- A cada PR com alteracao de dependencias: rodar `pnpm audit --audit-level moderate`.
- A cada release: revisar overrides e remover os que nao forem mais necessarios.
- A cada alerta de seguranca: priorizar acima de melhorias P2.

## 6. Owner

Owner padrao: engenharia/backend ou responsavel pelo PR que introduzir a dependencia.

Quando a dependencia afetar frontend, o owner deve incluir revisao da UI e do bundle.
