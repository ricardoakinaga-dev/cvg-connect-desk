#!/usr/bin/env python3
"""Consulta e validação estática; nunca executa os comandos do catálogo."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
FINDINGS = {f'A{i:02}' for i in range(1, 17)} | {'L01'}
CONTRACTS = {f'C{i:02}' for i in range(10)}
NOTICE = ('SIMULAÇÃO: todas as tarefas permanecem PLANNED. Cada lote é apenas uma '
          'sugestão condicionada à evidência, revisão e integração dos predecessores. '
          'Não lança agentes/serviços, não executa checks e não concede aceite.')


def safe_path(value, root):
    """Normaliza separadores POSIX e resolve aliases existentes, sem exigir existência."""
    if not isinstance(value, str) or not value.strip() or '\\' in value or '\x00' in value:
        raise ValueError(f'caminho relativo inválido: {value!r}')
    p = PurePosixPath(value)
    if p.is_absolute() or '..' in p.parts or ':' in value:
        raise ValueError(f'caminho inseguro: {value!r}')
    base = Path(root).resolve()
    try:
        resolved = (base / str(p)).resolve().relative_to(base)
    except (ValueError, RuntimeError, OSError) as exc:
        raise ValueError(f'caminho escapa da raiz: {value!r}') from exc
    return resolved.as_posix()


def overlaps(a, b):
    a, b = PurePosixPath(a), PurePosixPath(b)
    return a == b or a in b.parents or b in a.parents


def conflicts(a, b, root=ROOT):
    if a['exclusive_repo'] or b['exclusive_repo']:
        return True
    if set(a['resource_locks']) & set(b['resource_locks']):
        return True
    return any(overlaps(safe_path(x, root), safe_path(y, root))
               for x in a['write_paths'] for y in b['write_paths'])


def waves(tasks, slots=2, root=ROOT):
    """Lotes hipotéticos determinísticos; seleção só usa predecessores de lotes anteriores."""
    if type(slots) is not int or not 1 <= slots <= 3:
        raise ValueError('slots deve estar entre 1 e 3 (padrão: 2)')
    pending = {t['id']: t for t in tasks}
    if len(pending) != len(tasks):
        raise ValueError('IDs duplicados')
    simulated, batches = set(), []
    while pending:
        batch = []
        for task_id in sorted(pending):
            task = pending[task_id]
            if not set(task['dependencies']) <= simulated:
                continue
            if all(not conflicts(task, other, root) for other in batch):
                batch.append(task)
                if len(batch) == slots:
                    break
        if not batch:
            raise ValueError('DAG contém ciclo ou dependência ausente')
        ids = [t['id'] for t in batch]
        batches.append(ids)
        simulated.update(ids)
        for task_id in ids:
            del pending[task_id]
    return batches


def validate(data, root=ROOT):
    errors = []
    def require(condition, message):
        if not condition:
            errors.append(message)
    def strings(value, allow_empty=False):
        return (isinstance(value, list) and (allow_empty or bool(value))
                and all(isinstance(x, str) and x.strip() for x in value))
    if not isinstance(data, dict):
        return ['catálogo deve ser objeto JSON']
    require(data.get('schema') == 'cvg-aaa-planning-v1', 'schema inválido')
    require(data.get('kind') == 'planning_catalog_not_runtime_ledger', 'kind inválido')
    require(type(data.get('version')) is int and data['version'] >= 1, 'version inválida')
    for key in ('scope', 'status_policy', 'created_at'):
        require(isinstance(data.get(key), str) and bool(data[key].strip()), f'{key} obrigatório')
    require(bool(re.fullmatch(r'[0-9a-f]{40}', str(data.get('baseline_revision', '')))), 'baseline_revision inválida')
    require(data.get('max_total_agents') == 4, 'max_total_agents deve ser 4')
    require(type(data.get('suggested_builder_slots')) is int and 1 <= data['suggested_builder_slots'] <= 3,
            'suggested_builder_slots deve estar entre 1 e 3')
    require(type(data.get('reserved_review_slots')) is int and data['reserved_review_slots'] >= 1,
            'reserved_review_slots deve reservar revisão')
    if type(data.get('suggested_builder_slots')) is int and type(data.get('reserved_review_slots')) is int:
        require(data['suggested_builder_slots'] + data['reserved_review_slots'] + 1 <= 4,
                'builders + revisão + lead excedem 4 agentes')
    digest = data.get('audit_sha256', '')
    require(isinstance(digest, str) and bool(re.fullmatch(r'[0-9a-f]{64}', digest)), 'audit_sha256 inválido')
    try:
        audit = Path(root) / safe_path(data.get('audit_path'), root)
        require(audit.is_file(), 'relatório de auditoria ausente')
        if audit.is_file():
            require(hashlib.sha256(audit.read_bytes()).hexdigest() == digest, 'SHA-256 da auditoria divergente')
    except (ValueError, OSError) as exc:
        errors.append(str(exc))
    tasks, areas = data.get('tasks'), data.get('areas')
    if not isinstance(tasks, list) or not tasks or not all(isinstance(t, dict) for t in tasks):
        return errors + ['tasks deve conter objetos de tarefa']
    if not isinstance(areas, list) or not all(isinstance(a, dict) for a in areas):
        return errors + ['areas deve conter objetos de área']
    ids = [t.get('id') for t in tasks]
    if not all(isinstance(i, str) and re.fullmatch(r'AAA-\d{2}', i) for i in ids):
        return errors + ['ID de tarefa inválido; esperado AAA-xx']
    require(len(set(ids)) == len(ids), 'IDs de tarefas duplicados')
    by_id = dict(zip(ids, tasks))
    covered = set()
    for t in tasks:
        prefix = t['id'] + ': '
        require(t.get('status') == 'PLANNED', prefix + 'status deve permanecer PLANNED')
        for key in ('title', 'objective', 'owner_role', 'risk', 'rollback', 'budget', 'next_action', 'return_status'):
            require(isinstance(t.get(key), str) and bool(t[key].strip()), prefix + key + ' obrigatório')
        for key in ('phase', 'effort_points'):
            require(type(t.get(key)) is int and t[key] >= (1 if key == 'effort_points' else 0), prefix + key + ' inválido')
        require(type(t.get('exclusive_repo')) is bool, prefix + 'exclusive_repo deve ser booleano')
        for key in ('findings', 'contracts', 'read_paths', 'write_paths', 'forbidden_paths', 'acceptance', 'evidence_required', 'dependencies', 'resource_locks', 'decision_gates'):
            require(strings(t.get(key), key in ('dependencies', 'resource_locks', 'decision_gates')), prefix + key + ' deve ser lista de textos')
        if strings(t.get('findings')):
            require(set(t['findings']) <= FINDINGS, prefix + 'achado desconhecido')
            covered.update(t['findings'])
        if strings(t.get('contracts')):
            require(set(t['contracts']) <= CONTRACTS, prefix + 'contrato desconhecido (C00..C09)')
        if strings(t.get('dependencies'), True):
            require(set(t['dependencies']) <= set(ids), prefix + 'dependência ausente')
            require(len(set(t['dependencies'])) == len(t['dependencies']), prefix + 'dependência duplicada')
        valid_paths = {}
        for key in ('read_paths', 'write_paths', 'forbidden_paths'):
            valid_paths[key] = []
            if strings(t.get(key)):
                for value in t[key]:
                    try:
                        valid_paths[key].append(safe_path(value, root))
                    except ValueError as exc:
                        errors.append(prefix + str(exc))
        require(not any(overlaps(w, f) for w in valid_paths['write_paths'] for f in valid_paths['forbidden_paths']), prefix + 'write_paths conflita com forbidden_paths')
        require(isinstance(t.get('areas'), list) and bool(t['areas']) and
                all(type(a) is int and 1 <= a <= 18 for a in t['areas']), prefix + 'áreas inválidas')
        checks = t.get('checks')
        require(isinstance(checks, list) and bool(checks), prefix + 'checks obrigatórios')
        for c in checks if isinstance(checks, list) else []:
            require(isinstance(c, dict) and all(isinstance(c.get(k), str) and c[k].strip() for k in ('command', 'environment'))
                    and c.get('availability') in ('EXISTING', 'TO_CREATE'), prefix + 'check deve declarar command, environment e availability EXISTING ou TO_CREATE')
    require(covered == FINDINGS, 'cobertura incompleta dos achados A01..A16 + L01')
    area_ids = [a.get('id') for a in areas]
    require(all(type(a) is int for a in area_ids) and sorted(a for a in area_ids if type(a) is int) == list(range(1, 19)), 'cobertura deve conter exatamente 18 áreas (1..18)')
    for a in areas:
        aid = a.get('id')
        require(isinstance(a.get('name'), str) and bool(a['name'].strip()), f'área {aid}: nome obrigatório')
        for key in ('baseline_score', 'target_minimum'):
            require(type(a.get(key)) in (int, float) and 0 <= a[key] <= 100, f'área {aid}: {key} inválido')
        refs = a.get('task_ids')
        if not strings(refs):
            errors.append(f'área {aid}: task_ids obrigatório')
            continue
        expected = {t['id'] for t in tasks if isinstance(t.get('areas'), list) and aid in t['areas']}
        require(set(refs) == expected and set(refs) <= set(by_id) and len(refs) == len(set(refs)), f'área {aid}: referências não correspondem às áreas das tarefas')
    if not errors:
        try:
            waves(tasks, root=root)
        except ValueError as exc:
            errors.append(str(exc))
    return errors


def brief(task):
    lines = [f"# {task['id']} — {task['title']}", '', '> Gerado de BACKLOG.json por plan.py; não editar manualmente.', '', NOTICE, '',
             f"Status: {task['status']} | Responsável: {task['owner_role']} | Fase: {task['phase']} | Risco: {task['risk']} | Pontos: {task['effort_points']}", '',
             '## Objetivo', '', task['objective'], '', '## Contexto e dependências', '',
             'Achados: ' + ', '.join(task['findings']), 'Áreas: ' + ', '.join(map(str, task['areas'])),
             'Predecessores: ' + (', '.join(task['dependencies']) or 'nenhum'),
             'Contratos: ' + ', '.join(task['contracts']),
             'Exclusividade do repositório: ' + ('sim' if task['exclusive_repo'] else 'não'),
             'Locks de recursos: ' + (', '.join(task['resource_locks']) or 'nenhum'), '',
             'Antes de começar, obter evidência revisada e integrada dos predecessores, conferir o SHA candidato e contratos vigentes. A presença neste catálogo não autoriza início nem demonstra prontidão.', '']
    for key, title in [('decision_gates', 'Decisões condicionantes'), ('read_paths', 'Leitura'), ('write_paths', 'Escrita permitida'), ('forbidden_paths', 'Escrita proibida'), ('acceptance', 'Critérios de aceitação'), ('evidence_required', 'Evidência e revisão')]:
        lines.extend(['## ' + title, ''])
        lines.extend(['- ' + x for x in task[key]] or ['Nenhuma declarada.'])
        lines.append('')
    lines.extend(['## Checks declarados (não executados por esta ferramenta)', '',
                  'EXISTING significa declarado existente; revalidar disponibilidade no candidato. TO_CREATE exige criar o check antes de executá-lo e registrar a evidência. Nenhuma declaração equivale a check aprovado.', ''])
    for availability, label in [('EXISTING', 'Existentes'), ('TO_CREATE', 'A criar')]:
        lines.extend(['### ' + label, ''])
        lines.extend([f"- `{c['command']}` — ambiente: {c['environment']}" for c in task['checks'] if c['availability'] == availability] or ['Nenhum declarado.'])
        lines.append('')
    for key, title in [('rollback', 'Rollback'), ('budget', 'Limite e replanejamento'), ('next_action', 'Próxima ação'), ('return_status', 'Retorno exigido')]:
        lines.extend(['## ' + title, '', task[key], ''])
    lines.extend(['Devolver arquivos alterados, checks realmente executados com resultados, evidências, limitações e riscos residuais. Revisão independente, integração e reteste pelo lead são condições separadas; não alterar status do catálogo nem declarar aceite automático.', ''])
    return '\n'.join(lines)


def rendered(data):
    def cell(value):
        return str(value).replace('|', '\\|').replace('\n', ' ')
    lines = ['# Backlog AAA — catálogo de planejamento', '', '> Gerado de BACKLOG.json por plan.py; não editar manualmente.', '', NOTICE, '',
             f"Baseline: `{data['baseline_revision']}`", f"Auditoria: `{data['audit_path']}` — SHA-256 `{data['audit_sha256']}`", '',
             '| Tarefa | Objetivo | Status | Fase | Achados | Áreas | Dependências | Responsável | Risco | Pontos |',
             '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |']
    result = {}
    for t in sorted(data['tasks'], key=lambda t: t['id']):
        values = [f"[{t['id']}](tasks/{t['id']}.md)", t['title'], t['status'], t['phase'], ', '.join(t['findings']), ', '.join(map(str, t['areas'])), ', '.join(t['dependencies']) or '—', t['owner_role'], t['risk'], t['effort_points']]
        lines.append('| ' + ' | '.join(map(cell, values)) + ' |')
        result[f"tasks/{t['id']}.md"] = brief(t)
    result['BACKLOG.md'] = '\n'.join(lines) + '\n'
    return result


def render(data, directory, write=False):
    directory = Path(directory).resolve()
    outputs = rendered(data)
    # Preflight completo: nem symlinks internos podem sobrescrever um manual.
    targets = []
    for name, content in outputs.items():
        target = directory / name
        if target.is_symlink() or any(p.is_symlink() for p in target.parents if p != directory and directory in p.parents):
            raise ValueError(f'destino gerado contém symlink: {name}')
        targets.append((name, target, content))
    stale = sorted(p.name for p in (directory / 'tasks').glob('AAA-*.md') if 'tasks/' + p.name not in outputs)
    if stale:
        raise ValueError('pacotes gerados sem tarefa correspondente (não removidos): ' + ', '.join(stale))
    differing = []
    for name, target, content in targets:
        if not target.is_file() or target.read_text(encoding='utf-8') != content:
            differing.append(name)
            if write:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding='utf-8')
    return differing


def main(argv=None):
    parser = argparse.ArgumentParser(description='Consulta estática do planejamento AAA. Não executa tarefas nem modifica status.')
    parser.add_argument('--catalog', type=Path, default=HERE / 'BACKLOG.json', help='arquivo JSON do catálogo')
    parser.add_argument('--root', type=Path, default=ROOT, help='raiz para validar caminhos e hash da auditoria')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('validate', help='validar metadados, cobertura, caminhos, auditoria e DAG')
    sub.add_parser('list', help='listar tarefas PLANNED')
    w = sub.add_parser('waves', help='SIMULAR lotes condicionados à evidência de predecessores')
    w.add_argument('--slots', type=int, choices=range(1, 4), default=2, help='máximo de builders por lote (1..3; padrão 2)')
    b = sub.add_parser('brief', help='mostrar prompt completo derivado de uma tarefa')
    b.add_argument('task_id', help='ID AAA-xx')
    r = sub.add_parser('render', help='verificar documentos derivados; sem --write não escreve')
    mode = r.add_mutually_exclusive_group()
    mode.add_argument('--write', action='store_true', help='atualizar somente BACKLOG.md e tasks/AAA-xx.md')
    mode.add_argument('--check', action='store_true', help='verificar divergência (comportamento padrão)')
    args = parser.parse_args(argv)
    try:
        data = json.loads(args.catalog.read_text(encoding='utf-8'))
        errors = validate(data, args.root)
        if errors:
            print(json.dumps({'valid': False, 'errors': errors}, ensure_ascii=False, indent=2))
            return 1
        if args.command == 'validate':
            print(json.dumps({'valid': True, 'tasks': len(data['tasks']), 'status': 'PLANNED', 'checks_executed': False}, ensure_ascii=False))
        elif args.command == 'list':
            for t in sorted(data['tasks'], key=lambda t: t['id']):
                print(f"{t['id']} | PLANNED | {t['title']}")
        elif args.command == 'waves':
            print(json.dumps({'notice': NOTICE, 'slots': args.slots, 'batches': waves(data['tasks'], args.slots, args.root)}, ensure_ascii=False, indent=2))
        elif args.command == 'brief':
            task = next((t for t in data['tasks'] if t['id'] == args.task_id), None)
            if task is None:
                raise ValueError('tarefa desconhecida: ' + args.task_id)
            print(brief(task), end='')
        else:
            changed = render(data, args.catalog.parent, args.write)
            print(json.dumps({'mode': 'write' if args.write else 'check', 'divergent_files': changed, 'consistent': args.write or not changed}, ensure_ascii=False, indent=2))
            return int(bool(changed) and not args.write)
        return 0
    except (OSError, ValueError, RuntimeError) as exc:
        print('Erro: ' + str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
