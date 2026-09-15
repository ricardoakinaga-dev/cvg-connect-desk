"""Testes das invariantes do catálogo; fixtures independentes do backlog vivo."""
import copy
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('plan', Path(__file__).with_name('plan.py'))
plan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plan)


def task(task_id, deps=(), paths=None, locks=(), exclusive=False):
    return dict(id=task_id, title='Tarefa', status='PLANNED', objective='Objetivo',
                owner_role='builder', risk='R2', phase=0, effort_points=3,
                rollback='Reverter commit próprio', budget='Duas tentativas', next_action='Revalidar',
                return_status='IMPLEMENTED', findings=sorted(plan.FINDINGS), areas=list(range(1, 19)),
                dependencies=list(deps), write_paths=paths or ['src/' + task_id], read_paths=['audit.md'],
                forbidden_paths=['protected'], contracts=['C00'], exclusive_repo=exclusive,
                resource_locks=list(locks), acceptance=['Caso negativo'], evidence_required=['Revisão independente'],
                decision_gates=[], checks=[dict(command='check futuro', availability='TO_CREATE', environment='isolated')])


class PlanningTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'audit.md').write_text('auditoria', encoding='utf-8')
        self.data = dict(schema='cvg-aaa-planning-v1', kind='planning_catalog_not_runtime_ledger',
                         version=1, created_at='2026-09-12', baseline_revision='a' * 40,
                         audit_path='audit.md', audit_sha256=hashlib.sha256(b'auditoria').hexdigest(),
                         scope='Planejamento', status_policy='PLANNED', max_total_agents=4,
                         suggested_builder_slots=2, reserved_review_slots=1,
                         tasks=[task('AAA-00')], areas=[dict(id=i, name='Área', baseline_score=50,
                         target_minimum=90, task_ids=['AAA-00']) for i in range(1, 19)])

    def invalid(self, text):
        self.assertTrue(any(text in e for e in plan.validate(self.data, self.root)), plan.validate(self.data, self.root))

    def test_valid(self):
        self.assertEqual(plan.validate(self.data, self.root), [])

    def test_cycle(self):
        self.data['tasks'][0]['dependencies'] = ['AAA-00']
        self.invalid('ciclo')

    def test_missing_dependency(self):
        self.data['tasks'][0]['dependencies'] = ['AAA-99']
        self.invalid('dependência ausente')

    def test_duplicate_id(self):
        self.data['tasks'].append(copy.deepcopy(self.data['tasks'][0]))
        self.invalid('duplicados')

    def test_findings_coverage(self):
        self.data['tasks'][0]['findings'].remove('A16')
        self.invalid('cobertura incompleta')

    def test_area_coverage(self):
        self.data['areas'].pop()
        self.invalid('18 áreas')

    def test_area_exact_relationship(self):
        self.data['tasks'][0]['areas'].remove(1)
        self.invalid('referências não correspondem')

    def test_missing_contract(self):
        self.data['tasks'][0]['contracts'] = ['C10']
        self.invalid('contrato desconhecido')

    def test_audit_tampering(self):
        (self.root / 'audit.md').write_text('alterada', encoding='utf-8')
        self.invalid('SHA-256')

    def test_check_availability_required(self):
        del self.data['tasks'][0]['checks'][0]['availability']
        self.invalid('TO_CREATE')

    def test_no_runtime_status(self):
        self.data['tasks'][0]['status'] = 'VERIFIED'
        self.invalid('PLANNED')

    def test_path_traversal(self):
        for path in ('../outside', 'src/../../outside', '/etc/passwd', 'C:/escape', 'src\\file'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                plan.safe_path(path, self.root)
        self.assertEqual(plan.safe_path('./new//future/file', self.root), 'new/future/file')

    def test_symlink_escape(self):
        with tempfile.TemporaryDirectory() as outside:
            (self.root / 'escape').symlink_to(outside, target_is_directory=True)
            with self.assertRaises(ValueError):
                plan.safe_path('escape/future', self.root)

    def test_ownership_parent_child_and_boundary(self):
        a = task('AAA-00', paths=['./src//auth'])
        b = task('AAA-01', paths=['src/auth/session.py'])
        c = task('AAA-02', paths=['src/authentication'])
        self.assertTrue(plan.conflicts(a, b, self.root))
        self.assertTrue(plan.conflicts(b, a, self.root))
        self.assertFalse(plan.conflicts(a, c, self.root))
        self.assertEqual(plan.waves([a, b, c], root=self.root), [['AAA-00', 'AAA-02'], ['AAA-01']])

    def test_lock(self):
        tasks = [task('AAA-00', locks=['db']), task('AAA-01', locks=['db'])]
        self.assertEqual(plan.waves(tasks, root=self.root), [['AAA-00'], ['AAA-01']])

    def test_exclusivity(self):
        tasks = [task('AAA-00', exclusive=True), task('AAA-01'), task('AAA-02')]
        self.assertEqual(plan.waves(tasks, root=self.root), [['AAA-00'], ['AAA-01', 'AAA-02']])

    def test_dag_without_loss_or_mutation(self):
        tasks = [task('AAA-28', ['AAA-31', 'AAA-00']), task('AAA-31', ['AAA-00']),
                 task('AAA-00'), task('AAA-29', ['AAA-00']), task('AAA-30', ['AAA-29'])]
        before = copy.deepcopy(tasks)
        batches = plan.waves(tasks, root=self.root)
        self.assertEqual(batches, plan.waves(list(reversed(tasks)), root=self.root))
        ids = [i for batch in batches for i in batch]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(set(ids), {t['id'] for t in tasks})
        positions = {i: index for index, batch in enumerate(batches) for i in batch}
        for t in tasks:
            self.assertTrue(all(positions[d] < positions[t['id']] for d in t['dependencies']))
        self.assertEqual(before, tasks)
        self.assertTrue(all(len(b) <= 2 for b in batches))
        self.assertEqual(len(plan.waves([task(f'AAA-{i:02}') for i in range(3)], 3, self.root)[0]), 3)
        with self.assertRaises(ValueError):
            plan.waves(tasks, 4, self.root)

    def test_forbidden_parent(self):
        self.data['tasks'][0]['write_paths'] = ['protected/file']
        self.invalid('forbidden_paths')

    def test_render_check_write_and_manual_preservation(self):
        manual = self.root / 'CONTRATOS.md'
        manual.write_text('manual', encoding='utf-8')
        self.assertEqual(set(plan.render(self.data, self.root)), {'BACKLOG.md', 'tasks/AAA-00.md'})
        self.assertFalse((self.root / 'BACKLOG.md').exists())
        plan.render(self.data, self.root, True)
        self.assertEqual(plan.render(self.data, self.root), [])
        (self.root / 'tasks/AAA-00.md').write_text('drift', encoding='utf-8')
        self.assertEqual(plan.render(self.data, self.root), ['tasks/AAA-00.md'])
        self.assertEqual(manual.read_text(encoding='utf-8'), 'manual')

    def test_render_rejects_symlink_to_manual(self):
        manual = self.root / 'CONTRATOS.md'
        manual.write_text('manual', encoding='utf-8')
        (self.root / 'BACKLOG.md').symlink_to(manual)
        with self.assertRaises(ValueError):
            plan.render(self.data, self.root, True)
        self.assertEqual(manual.read_text(encoding='utf-8'), 'manual')
        self.assertFalse((self.root / 'tasks').exists())

    def test_brief_conditions_and_checks(self):
        text = plan.brief(self.data['tasks'][0])
        for phrase in ('PLANNED', 'TO_CREATE', 'Objetivo', 'Escrita proibida', 'Rollback', 'Revisão independente', 'IMPLEMENTED'):
            self.assertIn(phrase, text)


if __name__ == '__main__':
    unittest.main()
