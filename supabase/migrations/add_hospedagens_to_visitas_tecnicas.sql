-- Hospedagens adicionais combinadas na visita técnica.
--
-- Mesmo princípio do mobiliário: o que está no contrato é lido ao vivo de
-- agenda.spaces_json (chaves acLoft, acCasa, acSuiteAss, acSf1..acSf5,
-- acSb1..acSb3) e nunca copiado para cá. Aqui fica só o que a visita acrescenta.
--
-- jsonb no formato do próprio spaces_json — {"acSf3": true, "acSb1": true} —
-- em vez de uma coluna booleana por suíte. São 11 hospedagens hoje e a lista
-- muda quando a fazenda abre quarto novo (AD_ESPACOS no admin.html já cresceu
-- assim); com coluna por item, cada quarto novo viraria uma migração.
--
-- Aditiva e nullable: as VTs existentes seguem válidas sem preencher nada.

alter table visitas_tecnicas add column if not exists hosp_add jsonb;

-- PostgREST cacheia o schema; sem isso a coluna nova só apareceria no próximo
-- reload do serviço.
notify pgrst, 'reload schema';
