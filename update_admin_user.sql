-- Cria ou atualiza o usuário admin na tabela app_users
-- Execute este script no SQL Editor do Supabase Dashboard
-- ATENÇÃO: substitua <SUA_SENHA> pela senha desejada antes de executar.
-- Não commitar este arquivo com senha real.

INSERT INTO app_users (id, name, email, password, role, status, event_ids, personal)
VALUES (
  'admin-0',
  'Gabriel Soligo',
  'soligogabriel@gmail.com',
  '<SUA_SENHA>',
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
