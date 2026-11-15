-- Quantos hóspedes cabem e que camas tem cada acomodação.
--
-- O contrato (evento e hospedagem) lista as acomodações contratadas com nome e
-- descrição, mas não dizia capacidade nem camas — e é isso que o locatário
-- precisa conferir antes de assinar.
--
-- Fica no inventário, ao lado de descricao_orc, porque é atributo da
-- acomodação e não do contrato: cadastra-se uma vez e vale para todos.
-- Texto livre em camas de propósito ("1 cama king", "4 camas de solteiro",
-- "1 king + 1 sofá-cama"): a realidade dos quartos não cabe num número.

ALTER TABLE inventario
  ADD COLUMN IF NOT EXISTS hospedes int,
  ADD COLUMN IF NOT EXISTS camas    text;

COMMENT ON COLUMN inventario.hospedes IS 'Capacidade da acomodação, em hóspedes. Sai no contrato. Nulo = não informado.';
COMMENT ON COLUMN inventario.camas    IS 'Camas da acomodação, texto livre ("1 cama king", "4 camas de solteiro"). Sai no contrato.';
