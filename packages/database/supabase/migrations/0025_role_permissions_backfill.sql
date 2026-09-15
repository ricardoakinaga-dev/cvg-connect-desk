-- 0025_role_permissions_backfill.sql
-- PROD-04 / AC3 / D01 — fonte efetiva de permissões.
--
-- O runtime passa a decidir por `user_roles -> role_permissions -> permissions`
-- (packages/auth/src/permission-service.ts), com o catálogo estático de
-- `packages/auth/src/rbac.ts` apenas como fallback de instalações ainda não
-- provisionadas. Sem linhas em `role_permissions`, papéis customizados são
-- negados e built-ins dependem do fallback; esta migration provisiona o banco
-- com o catálogo estático VIGENTE (nenhum nome novo é inventado):
--   * garante as permissões que faltavam na tabela `permissions`
--     (deletes e demais nomes do catálogo);
--   * associa a cada papel built-in exatamente as permissões de RolePermissions.
--
-- Idempotente: pode rodar em banco já populado sem duplicar linhas
-- (ON CONFLICT DO NOTHING usa a unique de `permissions.name`, a unique de
-- `roles.name` e a PK composta de `role_permissions`). Nenhuma coluna/tabela
-- é criada, alterada ou removida.
--
-- Rollback (falha ensaiada): remover a linha do ledger
-- `drizzle.__drizzle_migrations` do tag 0025. As associações são reversíveis
-- com DELETE por nome de papel; não há DDL a desfazer.

--> statement-breakpoint
-- Papéis built-in precisam existir para a associação abaixo valer também em
-- banco recém-migrado (o seed roda depois e é idempotente).
INSERT INTO "roles" ("name")
VALUES ('Admin'), ('Receptionist'), ('Veterinarian'), ('Manager')
ON CONFLICT ("name") DO NOTHING;

--> statement-breakpoint
INSERT INTO "permissions" ("name", "description")
VALUES
  ('chat:read', 'Read chat messages'),
  ('chat:write', 'Send messages'),
  ('chat:delete', 'Delete conversations/messages'),
  ('tasks:read', 'Read tasks'),
  ('tasks:write', 'Create and update tasks'),
  ('tasks:delete', 'Delete tasks'),
  ('notes:read', 'Read notes'),
  ('notes:write', 'Create notes'),
  ('notes:delete', 'Delete notes'),
  ('alerts:read', 'Read alerts'),
  ('alerts:write', 'Acknowledge and resolve alerts'),
  ('alerts:delete', 'Delete alerts'),
  ('admin:read', 'Read admin resources'),
  ('admin:write', 'Manage admin resources'),
  ('dashboard:read', 'View dashboard')
ON CONFLICT ("name") DO NOTHING;

--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role_row.id, permission_row.id
FROM (VALUES
  -- Admin: catálogo completo.
  ('Admin', 'chat:read'), ('Admin', 'chat:write'), ('Admin', 'chat:delete'),
  ('Admin', 'tasks:read'), ('Admin', 'tasks:write'), ('Admin', 'tasks:delete'),
  ('Admin', 'notes:read'), ('Admin', 'notes:write'), ('Admin', 'notes:delete'),
  ('Admin', 'alerts:read'), ('Admin', 'alerts:write'), ('Admin', 'alerts:delete'),
  ('Admin', 'admin:read'), ('Admin', 'admin:write'), ('Admin', 'dashboard:read'),
  -- Receptionist.
  ('Receptionist', 'chat:read'), ('Receptionist', 'chat:write'),
  ('Receptionist', 'tasks:read'), ('Receptionist', 'tasks:write'),
  ('Receptionist', 'notes:read'), ('Receptionist', 'notes:write'),
  ('Receptionist', 'alerts:read'), ('Receptionist', 'dashboard:read'),
  -- Veterinarian.
  ('Veterinarian', 'chat:read'), ('Veterinarian', 'chat:write'),
  ('Veterinarian', 'tasks:read'), ('Veterinarian', 'tasks:write'),
  ('Veterinarian', 'notes:read'), ('Veterinarian', 'notes:write'),
  ('Veterinarian', 'alerts:read'), ('Veterinarian', 'alerts:write'),
  ('Veterinarian', 'dashboard:read'),
  -- Manager.
  ('Manager', 'chat:read'), ('Manager', 'chat:write'),
  ('Manager', 'tasks:read'), ('Manager', 'tasks:write'),
  ('Manager', 'notes:read'),
  ('Manager', 'alerts:read'), ('Manager', 'alerts:write'),
  ('Manager', 'admin:read'), ('Manager', 'dashboard:read')
) AS catalog(role_name, permission_name)
JOIN "roles" role_row ON role_row.name = catalog.role_name
JOIN "permissions" permission_row ON permission_row.name = catalog.permission_name
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
