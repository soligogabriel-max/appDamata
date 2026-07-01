-- =============================================================
-- MIGRAÇÃO DE SEGURANÇA — RLS + Supabase Auth
-- =============================================================
-- ATENÇÃO: Este script tem DUAS fases.
--
-- FASE 1 (executar agora): protege orcamentos e bloqueia tabelas
--   sensíveis para acesso anônimo direto.
--
-- FASE 2 (após migrar login para Supabase Auth): habilita RLS
--   completo com policies por papel (admin/equipe/cliente).
--
-- Execute cada bloco individualmente no SQL Editor do Supabase.
-- =============================================================


-- ─────────────────────────────────────────────────────────────
-- FASE 1 — Segurança imediata (não quebra o app atual)
-- ─────────────────────────────────────────────────────────────

-- 1A. Garantir RLS habilitado nas tabelas de preço (já existente,
--     reforçado aqui por clareza):
ALTER TABLE tabelas_preco        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tabelas_preco_grupos ENABLE ROW LEVEL SECURITY;
ALTER TABLE tabelas_preco_itens  ENABLE ROW LEVEL SECURITY;

-- Policies já existentes no fix_supabase_rls.sql — não recriar se já existem.
-- Se ainda não foram aplicadas:
-- CREATE POLICY "anon_read_tabelas_preco" ON tabelas_preco FOR SELECT TO anon USING (deleted_at IS NULL);
-- CREATE POLICY "anon_read_tabelas_preco_grupos" ON tabelas_preco_grupos FOR SELECT TO anon USING (true);
-- CREATE POLICY "anon_read_tabelas_preco_itens" ON tabelas_preco_itens FOR SELECT TO anon USING (true);

-- 1B. Orcamentos: anon pode apenas INSERT (formulário público).
--     SELECT/UPDATE/DELETE bloqueados para anon.
ALTER TABLE orcamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_insert_orcamentos" ON orcamentos;
CREATE POLICY "anon_insert_orcamentos"
  ON orcamentos FOR INSERT
  TO anon
  WITH CHECK (true);

-- NOTA: Com RLS habilitado e apenas a policy de INSERT acima,
-- o anon NÃO consegue fazer SELECT em orcamentos — o painel admin
-- (que usa anon key atualmente) vai parar de ver orçamentos.
-- Solução temporária: adicionar policy SELECT para anon também,
-- e migrar para Supabase Auth o quanto antes para remover esta concessão:
DROP POLICY IF EXISTS "anon_read_orcamentos_temp" ON orcamentos;
CREATE POLICY "anon_read_orcamentos_temp"
  ON orcamentos FOR SELECT
  TO anon
  USING (true);
-- ↑ REMOVER esta policy após FASE 2 estar completa.


-- ─────────────────────────────────────────────────────────────
-- FASE 2 — Após migrar login para Supabase Auth
-- ─────────────────────────────────────────────────────────────
-- Pré-requisito: o app deve usar supabase.auth.signInWithPassword()
-- e o papel (admin/equipe/cliente) deve estar em user_metadata.role
-- ou em app_metadata.role (definido pelo service_role no signup/approval).
--
-- Função auxiliar para ler o papel do JWT:
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION auth_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role'),
    (auth.jwt() -> 'user_metadata' ->> 'role'),
    'cliente'
  );
$$;

-- Helper: verificar se é admin ou equipe
CREATE OR REPLACE FUNCTION is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT auth_role() IN ('admin', 'equipe');
$$;


-- ── app_users ────────────────────────────────────────────────
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

-- Admin vê e edita todos. Equipe vê todos (sem senha). Cliente vê só o próprio.
DROP POLICY IF EXISTS "staff_all_app_users" ON app_users;
CREATE POLICY "staff_all_app_users"
  ON app_users FOR ALL
  TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

DROP POLICY IF EXISTS "client_own_app_users" ON app_users;
CREATE POLICY "client_own_app_users"
  ON app_users FOR SELECT
  TO authenticated
  USING (id = auth.uid()::text);

-- NUNCA expor coluna `password` — criar view sem a coluna após migração:
-- CREATE VIEW app_users_safe AS SELECT id,name,email,role,status,event_ids,personal,created_at FROM app_users;


-- ── app_config ───────────────────────────────────────────────
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_app_config" ON app_config;
CREATE POLICY "admin_all_app_config"
  ON app_config FOR ALL
  TO authenticated
  USING (auth_role() = 'admin')
  WITH CHECK (auth_role() = 'admin');


-- ── agenda ───────────────────────────────────────────────────
ALTER TABLE agenda ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_all_agenda" ON agenda;
CREATE POLICY "staff_all_agenda"
  ON agenda FOR ALL
  TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

-- Cliente vê apenas eventos vinculados ao seu usuário
DROP POLICY IF EXISTS "client_own_agenda" ON agenda;
CREATE POLICY "client_own_agenda"
  ON agenda FOR SELECT
  TO authenticated
  USING (
    cod IN (
      SELECT jsonb_array_elements_text(event_ids)
      FROM app_users
      WHERE id = auth.uid()::text
    )
  );


-- ── contas_a_receber / contas_a_pagar / extrato_bancario ─────
ALTER TABLE contas_a_receber  ENABLE ROW LEVEL SECURITY;
ALTER TABLE contas_a_pagar    ENABLE ROW LEVEL SECURITY;
ALTER TABLE extrato_bancario  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_all_receber" ON contas_a_receber;
CREATE POLICY "staff_all_receber" ON contas_a_receber FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());

DROP POLICY IF EXISTS "staff_all_pagar" ON contas_a_pagar;
CREATE POLICY "staff_all_pagar" ON contas_a_pagar FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());

DROP POLICY IF EXISTS "staff_all_extrato" ON extrato_bancario;
CREATE POLICY "staff_all_extrato" ON extrato_bancario FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());


-- ── ficha_do_evento ──────────────────────────────────────────
ALTER TABLE ficha_do_evento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_all_ficha" ON ficha_do_evento;
CREATE POLICY "staff_all_ficha" ON ficha_do_evento FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());

DROP POLICY IF EXISTS "client_own_ficha" ON ficha_do_evento;
CREATE POLICY "client_own_ficha"
  ON ficha_do_evento FOR SELECT
  TO authenticated
  USING (
    evento_cod IN (
      SELECT jsonb_array_elements_text(event_ids)
      FROM app_users WHERE id = auth.uid()::text
    )
  );


-- ── orcamentos ───────────────────────────────────────────────
-- Remover policy temporária da Fase 1 e adicionar policy definitiva:
DROP POLICY IF EXISTS "anon_read_orcamentos_temp" ON orcamentos;

DROP POLICY IF EXISTS "staff_all_orcamentos" ON orcamentos;
CREATE POLICY "staff_all_orcamentos"
  ON orcamentos FOR ALL
  TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());


-- ── Demais tabelas (staff only) ──────────────────────────────
ALTER TABLE assessorias      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fornecedores     ENABLE ROW LEVEL SECURITY;
ALTER TABLE naturezas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE contas_bancarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE nfse_config      ENABLE ROW LEVEL SECURITY;
ALTER TABLE nfse_emitidas    ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assessorias','fornecedores','naturezas','contas_bancarias','nfse_config','nfse_emitidas']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "staff_all_%I" ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY "staff_all_%I" ON %I FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff())',
      t, t
    );
  END LOOP;
END;
$$;
