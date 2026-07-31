-- Próximo código de contrato — etapa 3
-- Executado em 2026-07-31.
--
-- A regra estava reimplementada em três lugares (gerador + dois pontos do
-- salvarContrato) e só um deles estava correto. Os outros dois faziam
-- `order=cod.desc limit 1` sobre uma coluna text: a partir do centésimo
-- contrato do ano, "202699" vence "2026100" na ordenação lexicográfica e a
-- sequência trava. O cod é PK, então a colisão não passava em silêncio — mas o
-- gerador exibia um número errado até o salvarContrato corrigir.
--
-- Duas decisões embutidas aqui:
--   * max numérico em vez de ordenação de texto
--   * NÃO filtra deleted_at. O gerador filtrava, os outros não; com o filtro o
--     código de um evento apagado voltava a ser sorteado e o salvarContrato
--     caía no branch "ressuscita", sobrescrevendo o registro antigo. Havia 17
--     eventos soft-deleted em 2026 esperando por isso.

CREATE OR REPLACE FUNCTION public.proximo_cod_contrato(p_ano int DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ano int := COALESCE(p_ano, EXTRACT(year FROM CURRENT_DATE)::int);
  v_seq int;
BEGIN
  SELECT COALESCE(MAX(substring(cod from 5)::int), 0) + 1
    INTO v_seq
    FROM agenda
   WHERE cod ~ ('^' || v_ano::text || '[0-9]+$');

  -- lpad(x, 2) TRUNCA quando x tem mais de 2 dígitos: lpad('102',2,'0') = '10'.
  -- Do centésimo contrato em diante o código cresce para 3 dígitos.
  RETURN v_ano::text || CASE WHEN v_seq < 10 THEN '0' ELSE '' END || v_seq::text;
END;
$$;

-- O Supabase concede EXECUTE a anon por default privilege ao criar a função.
-- Revogar explicitamente: gerar código é operação de quem está logado.
REVOKE EXECUTE ON FUNCTION public.proximo_cod_contrato(int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.proximo_cod_contrato(int) TO authenticated;

-- Verificado: 2026 -> 202631, 2019 -> 201952, ano vazio -> 203001;
-- com 2026100 e 2026101 inseridos (em rollback) -> 2026102;
-- anon recebe 42501 permission denied.
