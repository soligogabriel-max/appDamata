-- Cria ou atualiza o usuário admin na tabela app_users
-- Execute este script no SQL Editor do Supabase Dashboard

INSERT INTO app_users (id, name, email, password, role, status, event_ids, personal)
VALUES (
  'admin-0',
  'Gabriel Soligo',
  'soligogabriel@gmail.com',
  'ogilos-1',
  'admin',
  'approved',
  '[]',
  '{}'
)
ON CONFLICT (id) DO UPDATE SET
  name     = EXCLUDED.name,
  email    = EXCLUDED.email,
  password = EXCLUDED.password,
  role     = EXCLUDED.role,
  status   = EXCLUDED.status;
