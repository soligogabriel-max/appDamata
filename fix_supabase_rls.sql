-- Permite leitura anônima nas tabelas de pacotes (necessário para o orçamento público)
CREATE POLICY "anon_read_tabelas_preco"
  ON tabelas_preco FOR SELECT
  TO anon
  USING (deleted_at IS NULL);

CREATE POLICY "anon_read_tabelas_preco_grupos"
  ON tabelas_preco_grupos FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "anon_read_tabelas_preco_itens"
  ON tabelas_preco_itens FOR SELECT
  TO anon
  USING (true);
