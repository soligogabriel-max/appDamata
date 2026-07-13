-- =============================================================
-- FIX: auth_role() com fallback em app_users
-- =============================================================
-- Problema: auth_role() só lê o role do JWT (app_metadata/user_metadata).
-- Usuários cujo JWT não tem role definido recebem 'cliente' → is_staff()
-- retorna false → INSERT/UPDATE em tabelas protegidas por RLS falha.
--
-- Solução: adicionar fallback que consulta app_users.role pelo email do JWT.
-- A função usa SECURITY DEFINER para acessar app_users além do RLS.
--
-- Execute no SQL Editor do Supabase Dashboard.
-- =============================================================

CREATE OR REPLACE FUNCTION auth_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role'),
    (auth.jwt() -> 'user_metadata' ->> 'role'),
    (
      SELECT role FROM app_users
      WHERE email = (auth.jwt() ->> 'email')
        AND status IN ('approved', 'pending')
      LIMIT 1
    ),
    'cliente'
  );
$$;
