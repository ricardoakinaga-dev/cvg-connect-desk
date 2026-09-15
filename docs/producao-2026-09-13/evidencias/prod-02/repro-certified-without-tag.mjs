// PROD-02 repro (c): o gate mestre emite TRIPLE_AAA_CERTIFIED sem verificar tag,
// assinatura ou política de release — basta o modo --with-external-evidence com
// todos os arquivos presentes e status PASS. Extrai o bloco de veredito REAL do
// arquivo antes da correção (copiado em triple-aaa-verify.before.mjs) e executa
// em vm com gates todos PASS.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./triple-aaa-verify.before.mjs', import.meta.url), 'utf8');
const verdict = source.slice(source.indexOf('let aaa ='), source.indexOf('const report ='));

const context = {
  gates: { lint: { status: 'PASS' }, 'external-codeql': { status: 'PASS' } },
  withExternal: true,
  console,
};
// localPass/externalPass/anyExternalNotRun dependem de variáveis externas; injeta.
vm.runInNewContext(
  `const localPass = Object.entries(gates).filter(([n]) => !n.startsWith('external-')).every(([, v]) => v.status === 'PASS');
   const externalPass = Object.entries(gates).filter(([n]) => n.startsWith('external-')).every(([, v]) => v.status === 'PASS');
   const anyExternalNotRun = Object.entries(gates).some(([n, v]) => n.startsWith('external-') && v.status === 'NOT_RUN');
   ${verdict}
   globalThis.__final = final;
   console.log('FINAL=' + final);`,
  context,
);

// Verifica estaticamente se existe QUALQUER checagem de tag/assinatura no arquivo.
const tagCheck = /git\s+tag|refs\/tags|verify-tag|GPG|signature|signed/i.test(source);
console.log(`tag/signature check presente no gate: ${tagCheck}`);
console.log(`final observado: ${context.__final}`);
console.log(`CERTIFIED emitido só por status local: ${context.__final === 'TRIPLE_AAA_CERTIFIED' && !tagCheck}`);
