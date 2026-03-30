import fs from 'fs';
import path from 'path';

const dirs = [
  'apps/desk-api', 'apps/desk-web',
  'packages/shared', 'packages/database', 'packages/auth', 'packages/events', 'packages/realtime', 'packages/integrations',
  'modules/chat', 'modules/tasks', 'modules/notes', 'modules/alerts', 'modules/admin', 'modules/audit', 'modules/dashboard', 'modules/secretary-adapter', 'modules/chatwoot-compat'
];

dirs.forEach(dir => {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    const name = `@cvg/${dir.split('/')[1]}`;
    const content = {
      name,
      version: '0.0.0',
      private: true,
      main: 'index.ts',
      scripts: {
        build: 'echo build',
        lint: 'echo lint',
        test: 'echo test'
      }
    };
    fs.writeFileSync(pkgPath, JSON.stringify(content, null, 2));
    console.log(`Created ${pkgPath}`);
  }
});
