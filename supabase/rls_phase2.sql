-- ═══════════════════════════════════════════════════════════════════
-- DAMATA — RLS Phase 2
-- Row Level Security para todas as 26 tabelas.
--
-- Executar no Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wwnndsprpofmgbklqdgg/sql
--
-- ATENÇÃO: aplicar em horário de baixo uso pois bloqueia acesso
-- imediatamente. Testar login e funções críticas em seguida.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
-- 0. Funções auxiliares
--    SECURITY DEFINER: executam como owner, ignoram RLS ao ler
--    app_users — necessário para as políticas não entrarem em loop.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM public.app_users
  WHERE email = auth.email() AND status = 'approved'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.get_my_assessoria_cod()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT assessoria_cod FROM public.app_users
  WHERE email = auth.email() AND status = 'approved'
  LIMIT 1
$$;

-- Retorna o array de event_ids do usuário logado (fornecedor/assessoria)
CREATE OR REPLACE FUNCTION public.get_my_event_ids()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT COALESCE(event_ids, '[]'::jsonb) FROM public.app_users
  WHERE email = auth.email() AND status = 'approved'
  LIMIT 1
$$;


-- ─────────────────────────────────────────────────────────────────
-- 1. Habilitar RLS em todas as tabelas
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE agenda               ENABLE ROW LEVEL SECURITY;
ALTER TABLE ficha_do_evento      ENABLE ROW LEVEL SECURITY;
ALTER TABLE contas_a_pagar       ENABLE ROW LEVEL SECURITY;
ALTER TABLE contas_a_receber     ENABLE ROW LEVEL SECURITY;
ALTER TABLE extrato_bancario     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cartao_c6            ENABLE ROW LEVEL SECURITY;
ALTER TABLE notas_fiscais        ENABLE ROW LEVEL SECURITY;
ALTER TABLE centros_de_custo     ENABLE ROW LEVEL SECURITY;
ALTER TABLE naturezas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config           ENABLE ROW LEVEL SECURITY;
ALTER TABLE orcamentos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitas_comerciais   ENABLE ROW LEVEL SECURITY;
ALTER TABLE slots_visita         ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_visits          ENABLE ROW LEVEL SECURITY;
ALTER TABLE wpp_mensagens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE itens_pedido         ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessorias          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fornecedores         ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventario           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tabelas_preco        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tabelas_preco_grupos ENABLE ROW LEVEL SECURITY;
ALTER TABLE tabelas_preco_itens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitas_tecnicas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE vt_linhas            ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────
-- 2. agenda
--    Admin: tudo | Equipe: tudo | Assessoria: só seus eventos
--    Fornecedor: só eventos em seu event_ids
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "agenda_admin" ON agenda
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "agenda_select" ON agenda
  FOR SELECT TO authenticated
  USING (
    get_my_role() = 'equipe'
    OR (get_my_role() = 'assessoria'
        AND assessoria_cod IS NOT NULL
        AND assessoria_cod = get_my_assessoria_cod())
    OR (get_my_role() = 'fornecedor'
        AND get_my_event_ids() @> jsonb_build_array(cod))
  );

CREATE POLICY "agenda_equipe_insert" ON agenda
  FOR INSERT TO authenticated
  WITH CHECK(get_my_role() = 'equipe');

CREATE POLICY "agenda_equipe_update" ON agenda
  FOR UPDATE TO authenticated
  USING     (get_my_role() = 'equipe')
  WITH CHECK(get_my_role() = 'equipe');


-- ─────────────────────────────────────────────────────────────────
-- 3. ficha_do_evento
--    Admin: tudo | Equipe: tudo | Assessoria: via assessoria_cod → agenda
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "ficha_do_evento_admin" ON ficha_do_evento
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "ficha_do_evento_select" ON ficha_do_evento
  FOR SELECT TO authenticated
  USING (
    get_my_role() = 'equipe'
    OR (get_my_role() = 'assessoria'
        AND EXISTS (
          SELECT 1 FROM agenda a
          WHERE a.cod = ficha_do_evento.cod
            AND a.assessoria_cod IS NOT NULL
            AND a.assessoria_cod = get_my_assessoria_cod()
        ))
  );

CREATE POLICY "ficha_do_evento_equipe_insert" ON ficha_do_evento
  FOR INSERT TO authenticated
  WITH CHECK(get_my_role() = 'equipe');

CREATE POLICY "ficha_do_evento_equipe_update" ON ficha_do_evento
  FOR UPDATE TO authenticated
  USING     (get_my_role() = 'equipe')
  WITH CHECK(get_my_role() = 'equipe');


-- ─────────────────────────────────────────────────────────────────
-- 4. contas_a_pagar — admin only
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "contas_a_pagar_admin" ON contas_a_pagar
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');


-- ─────────────────────────────────────────────────────────────────
-- 5. contas_a_receber
--    Admin: tudo | Assessoria: só recebíveis dos seus eventos
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "contas_a_receber_admin" ON contas_a_receber
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "contas_a_receber_assessoria_select" ON contas_a_receber
  FOR SELECT TO authenticated
  USING (
    get_my_role() = 'assessoria'
    AND EXISTS (
      SELECT 1 FROM agenda a
      WHERE a.cod = contas_a_receber.cod_evento
        AND a.assessoria_cod IS NOT NULL
        AND a.assessoria_cod = get_my_assessoria_cod()
    )
  );


-- ─────────────────────────────────────────────────────────────────
-- 6. extrato_bancario — admin only
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "extrato_bancario_admin" ON extrato_bancario
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');


-- ─────────────────────────────────────────────────────────────────
-- 7. cartao_c6 — admin only
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "cartao_c6_admin" ON cartao_c6
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');


-- ─────────────────────────────────────────────────────────────────
-- 8. notas_fiscais — admin only
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "notas_fiscais_admin" ON notas_fiscais
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');


-- ─────────────────────────────────────────────────────────────────
-- 9. centros_de_custo
--    Admin: tudo | Equipe: leitura
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "centros_de_custo_admin" ON centros_de_custo
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "centros_de_custo_equipe_select" ON centros_de_custo
  FOR SELECT TO authenticated
  USING (get_my_role() = 'equipe');


-- ─────────────────────────────────────────────────────────────────
-- 10. naturezas
--     Admin: tudo | Equipe: leitura
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "naturezas_admin" ON naturezas
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "naturezas_equipe_select" ON naturezas
  FOR SELECT TO authenticated
  USING (get_my_role() = 'equipe');


-- ─────────────────────────────────────────────────────────────────
-- 11. app_users
--     Admin: tudo.
--     Qualquer autenticado: lê e atualiza o PRÓPRIO registro.
--     (Necessário: o app busca o perfil logo após o login)
--
--     RISCO: um usuário autenticado poderia fazer PATCH em seu
--     próprio registro e alterar o campo `role`. Mitigação:
--     mover aprovações para Edge Function com service role.
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "app_users_admin" ON app_users
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "app_users_own_select" ON app_users
  FOR SELECT TO authenticated
  USING (email = auth.email());

CREATE POLICY "app_users_own_update" ON app_users
  FOR UPDATE TO authenticated
  USING     (email = auth.email())
  WITH CHECK(email = auth.email());

-- INSERT: após signUp o usuário já está autenticado (se email confirm desativado)
CREATE POLICY "app_users_own_insert" ON app_users
  FOR INSERT TO authenticated
  WITH CHECK(email = auth.email());

-- INSERT anon: caso email confirm esteja ativado (usuário ainda não autenticado)
CREATE POLICY "app_users_anon_insert" ON app_users
  FOR INSERT TO anon
  WITH CHECK(true);


-- ─────────────────────────────────────────────────────────────────
-- 12. app_config
--     Admin: tudo | Anon: leitura (landing page: fotos, vídeos, PDFs)
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "app_config_admin" ON app_config
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "app_config_anon_select" ON app_config
  FOR SELECT TO anon
  USING (true);


-- ─────────────────────────────────────────────────────────────────
-- 13. orcamentos
--     Admin: tudo | Equipe: leitura + escrita (sem DELETE)
--     Orçamentos públicos devem usar a Edge Function orcamento-publico.
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "orcamentos_admin" ON orcamentos
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "orcamentos_equipe_select" ON orcamentos
  FOR SELECT TO authenticated
  USING (get_my_role() = 'equipe');

CREATE POLICY "orcamentos_equipe_insert" ON orcamentos
  FOR INSERT TO authenticated
  WITH CHECK(get_my_role() = 'equipe');

CREATE POLICY "orcamentos_equipe_update" ON orcamentos
  FOR UPDATE TO authenticated
  USING     (get_my_role() = 'equipe')
  WITH CHECK(get_my_role() = 'equipe');


-- ─────────────────────────────────────────────────────────────────
-- 14. visitas_comerciais
--     Admin: tudo | Equipe: leitura + escrita + delete
--
--     ATENÇÃO: o formulário público de agendamento (landing page)
--     cria registros sem login. Se usa sbFetch direto (não Edge Function),
--     adicione: CREATE POLICY "visitas_comerciais_anon_insert" ON visitas_comerciais
--               FOR INSERT TO anon WITH CHECK (true);
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "visitas_comerciais_admin" ON visitas_comerciais
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "visitas_comerciais_equipe_select" ON visitas_comerciais
  FOR SELECT TO authenticated
  USING (get_my_role() = 'equipe');

CREATE POLICY "visitas_comerciais_equipe_insert" ON visitas_comerciais
  FOR INSERT TO authenticated
  WITH CHECK(get_my_role() = 'equipe');

CREATE POLICY "visitas_comerciais_equipe_update" ON visitas_comerciais
  FOR UPDATE TO authenticated
  USING     (get_my_role() = 'equipe')
  WITH CHECK(get_my_role() = 'equipe');

CREATE POLICY "visitas_comerciais_equipe_delete" ON visitas_comerciais
  FOR DELETE TO authenticated
  USING (get_my_role() = 'equipe');


-- ─────────────────────────────────────────────────────────────────
-- 15. slots_visita
--     Admin: tudo | Equipe: tudo | Anon: leitura (agendamento público)
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "slots_visita_admin" ON slots_visita
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "slots_visita_equipe_select" ON slots_visita
  FOR SELECT TO authenticated
  USING (get_my_role() = 'equipe');

CREATE POLICY "slots_visita_equipe_insert" ON slots_visita
  FOR INSERT TO authenticated
  WITH CHECK(get_my_role() = 'equipe');

CREATE POLICY "slots_visita_equipe_update" ON slots_visita
  FOR UPDATE TO authenticated
  USING     (get_my_role() = 'equipe')
  WITH CHECK(get_my_role() = 'equipe');

CREATE POLICY "slots_visita_equipe_delete" ON slots_visita
  FOR DELETE TO authenticated
  USING (get_my_role() = 'equipe');

CREATE POLICY "slots_visita_anon_select" ON slots_visita
  FOR SELECT TO anon
  USING (true);


-- ─────────────────────────────────────────────────────────────────
-- 16. site_visits — admin only
--     Analytics de visitantes. INSERT vem da landing page —
--     se não usar Edge Function, adicione:
--     CREATE POLICY "site_visits_anon_insert" ON site_visits
--     FOR INSERT TO anon WITH CHECK (true);
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "site_visits_admin" ON site_visits
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');


-- ─────────────────────────────────────────────────────────────────
-- 17. wpp_mensagens — admin only
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "wpp_mensagens_admin" ON wpp_mensagens
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');


-- ─────────────────────────────────────────────────────────────────
-- 18. pedidos
--     Admin: tudo | Equipe: leitura + escrita
--     Assessoria: leitura dos pedidos dos seus eventos
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "pedidos_admin" ON pedidos
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "pedidos_select" ON pedidos
  FOR SELECT TO authenticated
  USING (
    get_my_role() = 'equipe'
    OR (get_my_role() = 'assessoria'
        AND EXISTS (
          SELECT 1 FROM agenda a
          WHERE a.cod = pedidos.cod_evento
            AND a.assessoria_cod IS NOT NULL
            AND a.assessoria_cod = get_my_assessoria_cod()
        ))
  );

CREATE POLICY "pedidos_equipe_insert" ON pedidos
  FOR INSERT TO authenticated
  WITH CHECK(get_my_role() = 'equipe');

CREATE POLICY "pedidos_equipe_update" ON pedidos
  FOR UPDATE TO authenticated
  USING     (get_my_role() = 'equipe')
  WITH CHECK(get_my_role() = 'equipe');


-- ─────────────────────────────────────────────────────────────────
-- 19. itens_pedido
--     Admin: tudo | Equipe: leitura + escrita
--     Assessoria: leitura via pedido → agenda → assessoria_cod
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "itens_pedido_admin" ON itens_pedido
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "itens_pedido_select" ON itens_pedido
  FOR SELECT TO authenticated
  USING (
    get_my_role() = 'equipe'
    OR (get_my_role() = 'assessoria'
        AND EXISTS (
          SELECT 1 FROM pedidos p
          JOIN agenda a ON a.cod = p.cod_evento
          WHERE p.id = itens_pedido.pedido_id
            AND a.assessoria_cod IS NOT NULL
            AND a.assessoria_cod = get_my_assessoria_cod()
        ))
  );

CREATE POLICY "itens_pedido_equipe_insert" ON itens_pedido
  FOR INSERT TO authenticated
  WITH CHECK(get_my_role() = 'equipe');

CREATE POLICY "itens_pedido_equipe_update" ON itens_pedido
  FOR UPDATE TO authenticated
  USING     (get_my_role() = 'equipe')
  WITH CHECK(get_my_role() = 'equipe');


-- ─────────────────────────────────────────────────────────────────
-- 20. assessorias
--     Admin: tudo | Equipe: leitura + escrita
--     Assessoria: leitura de todas (necessário para preencher selects)
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "assessorias_admin" ON assessorias
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "assessorias_select" ON assessorias
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('equipe', 'assessoria'));

CREATE POLICY "assessorias_equipe_insert" ON assessorias
  FOR INSERT TO authenticated
  WITH CHECK(get_my_role() = 'equipe');

CREATE POLICY "assessorias_equipe_update" ON assessorias
  FOR UPDATE TO authenticated
  USING     (get_my_role() = 'equipe')
  WITH CHECK(get_my_role() = 'equipe');


-- ─────────────────────────────────────────────────────────────────
-- 21. fornecedores
--     Admin: tudo | Equipe: leitura + escrita
--     Fornecedor: leitura de todos (para preencher selects)
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "fornecedores_admin" ON fornecedores
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "fornecedores_select" ON fornecedores
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('equipe', 'fornecedor'));

CREATE POLICY "fornecedores_equipe_insert" ON fornecedores
  FOR INSERT TO authenticated
  WITH CHECK(get_my_role() = 'equipe');

CREATE POLICY "fornecedores_equipe_update" ON fornecedores
  FOR UPDATE TO authenticated
  USING     (get_my_role() = 'equipe')
  WITH CHECK(get_my_role() = 'equipe');


-- ─────────────────────────────────────────────────────────────────
-- 22. inventario
--     Admin: tudo | Equipe: leitura + escrita
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "inventario_admin" ON inventario
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "inventario_equipe_select" ON inventario
  FOR SELECT TO authenticated
  USING (get_my_role() = 'equipe');

CREATE POLICY "inventario_equipe_insert" ON inventario
  FOR INSERT TO authenticated
  WITH CHECK(get_my_role() = 'equipe');

CREATE POLICY "inventario_equipe_update" ON inventario
  FOR UPDATE TO authenticated
  USING     (get_my_role() = 'equipe')
  WITH CHECK(get_my_role() = 'equipe');


-- ─────────────────────────────────────────────────────────────────
-- 23-25. tabelas_preco, tabelas_preco_grupos, tabelas_preco_itens
--        Admin: tudo | Equipe: leitura
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "tabelas_preco_admin" ON tabelas_preco
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "tabelas_preco_equipe_select" ON tabelas_preco
  FOR SELECT TO authenticated
  USING (get_my_role() = 'equipe');

CREATE POLICY "tabelas_preco_grupos_admin" ON tabelas_preco_grupos
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "tabelas_preco_grupos_equipe_select" ON tabelas_preco_grupos
  FOR SELECT TO authenticated
  USING (get_my_role() = 'equipe');

CREATE POLICY "tabelas_preco_itens_admin" ON tabelas_preco_itens
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "tabelas_preco_itens_equipe_select" ON tabelas_preco_itens
  FOR SELECT TO authenticated
  USING (get_my_role() = 'equipe');


-- ─────────────────────────────────────────────────────────────────
-- 26. visitas_tecnicas
--     Admin: tudo | Equipe: leitura + escrita
--     Assessoria: leitura via assessoria_cod → agenda
--     Fornecedor: leitura via event_ids
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "visitas_tecnicas_admin" ON visitas_tecnicas
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "visitas_tecnicas_select" ON visitas_tecnicas
  FOR SELECT TO authenticated
  USING (
    get_my_role() = 'equipe'
    OR (get_my_role() = 'assessoria'
        AND EXISTS (
          SELECT 1 FROM agenda a
          WHERE a.cod = visitas_tecnicas.cod_evento
            AND a.assessoria_cod IS NOT NULL
            AND a.assessoria_cod = get_my_assessoria_cod()
        ))
    OR (get_my_role() = 'fornecedor'
        AND get_my_event_ids() @> jsonb_build_array(visitas_tecnicas.cod_evento))
  );

CREATE POLICY "visitas_tecnicas_equipe_insert" ON visitas_tecnicas
  FOR INSERT TO authenticated
  WITH CHECK(get_my_role() = 'equipe');

CREATE POLICY "visitas_tecnicas_equipe_update" ON visitas_tecnicas
  FOR UPDATE TO authenticated
  USING     (get_my_role() = 'equipe')
  WITH CHECK(get_my_role() = 'equipe');


-- ─────────────────────────────────────────────────────────────────
-- 27. vt_linhas
--     Admin: tudo | Equipe: leitura + escrita + delete
--     Assessoria: leitura via vt_id → visitas_tecnicas → agenda
--     Fornecedor: leitura via vt_id → visitas_tecnicas → event_ids
-- ─────────────────────────────────────────────────────────────────

CREATE POLICY "vt_linhas_admin" ON vt_linhas
  FOR ALL TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK(get_my_role() = 'admin');

CREATE POLICY "vt_linhas_select" ON vt_linhas
  FOR SELECT TO authenticated
  USING (
    get_my_role() = 'equipe'
    OR (get_my_role() = 'assessoria'
        AND EXISTS (
          SELECT 1 FROM visitas_tecnicas vt
          JOIN agenda a ON a.cod = vt.cod_evento
          WHERE vt.id = vt_linhas.vt_id
            AND a.assessoria_cod IS NOT NULL
            AND a.assessoria_cod = get_my_assessoria_cod()
        ))
    OR (get_my_role() = 'fornecedor'
        AND EXISTS (
          SELECT 1 FROM visitas_tecnicas vt
          WHERE vt.id = vt_linhas.vt_id
            AND get_my_event_ids() @> jsonb_build_array(vt.cod_evento)
        ))
  );

CREATE POLICY "vt_linhas_equipe_insert" ON vt_linhas
  FOR INSERT TO authenticated
  WITH CHECK(get_my_role() = 'equipe');

CREATE POLICY "vt_linhas_equipe_update" ON vt_linhas
  FOR UPDATE TO authenticated
  USING     (get_my_role() = 'equipe')
  WITH CHECK(get_my_role() = 'equipe');

CREATE POLICY "vt_linhas_equipe_delete" ON vt_linhas
  FOR DELETE TO authenticated
  USING (get_my_role() = 'equipe');


-- ═══════════════════════════════════════════════════════════════════
-- FIM DO SCRIPT
--
-- Após executar, testar obrigatoriamente:
-- 1. Login como admin → deve ver tudo normalmente
-- 2. Login como equipe → deve ver eventos, pedidos, etc.
-- 3. Login como assessoria → deve ver APENAS seus eventos
-- 4. Formulário público de agendamento de visitas (landing page):
--    se der erro 403, adicionar a política anon INSERT em visitas_comerciais
-- 5. Analytics da landing page (site_visits):
--    se não registrar mais visitas, adicionar política anon INSERT em site_visits
-- ═══════════════════════════════════════════════════════════════════
