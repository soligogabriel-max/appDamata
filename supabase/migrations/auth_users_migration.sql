-- =============================================================
-- MIGRAÇÃO: Criar contas Supabase Auth para usuários existentes
-- =============================================================
-- PRÉ-REQUISITO: No Supabase Dashboard → Authentication → Settings
--   → Email → "Confirm email" → DESLIGAR
--
-- Execute este script no SQL Editor do Supabase Dashboard.
-- Cria contas auth para todos os app_users que ainda não têm.
-- As senhas plaintext são hasheadas com bcrypt automaticamente.
-- Após rodar, a coluna `password` em app_users pode ser zerada.
-- =============================================================

DO $$
DECLARE
  u RECORD;
  new_uid UUID;
BEGIN
  FOR u IN
    SELECT * FROM app_users
    WHERE status IN ('approved', 'pending')
    AND COALESCE(email, '') <> ''
    AND email NOT IN (
      SELECT email FROM auth.users WHERE email IS NOT NULL
    )
  LOOP
    new_uid := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      new_uid, 'authenticated', 'authenticated', u.email,
      crypt(COALESCE(NULLIF(u.password, ''), gen_random_uuid()::text), gen_salt('bf')),
      NOW(),
      jsonb_build_object('role', COALESCE(u.role, 'cliente'), 'provider', 'email', 'providers', '["email"]'::jsonb),
      jsonb_build_object('name', u.name),
      NOW(), NOW(),
      '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), new_uid,
      jsonb_build_object('sub', new_uid::text, 'email', u.email, 'email_verified', true),
      'email',
      NOW(), NOW(), NOW()
    );

    RAISE NOTICE 'Criado auth user para: % (%)', u.email, u.role;
  END LOOP;
END;
$$;

-- Após confirmar que o login está funcionando, limpar senhas plaintext:
-- UPDATE app_users SET password = '' WHERE password <> '';
