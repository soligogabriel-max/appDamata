# appDamata — instruções para Claude

## Início de cada sessão

Sincronizar com o main antes de qualquer mudança:

```bash
git fetch origin
git checkout origin/main -- admin.html index.html gerador-contrato-damata.html \
  financeiro.js orcamentos.js crud.js pedidos-vt.js admin.css
```

## Arquitetura

Site estático no GitHub Pages (push no `main` = deploy) + Supabase.

- `index.html` — landing pública. Tracker (`dmv_sid`), fotos/vídeos, agendamento de visita.
- `admin.html` — o app. **Também é a página que atende os fluxos públicos** (ver abaixo).
- `financeiro.js`, `orcamentos.js`, `crud.js`, `pedidos-vt.js`, `admin.css` — módulos do admin.
  Carregados com `<script src>` (não ES modules), então o escopo global é compartilhado.
- `gerador-contrato-damata.html` — gerador de contratos, em iframe dentro do admin.
- `contrato.html` / `orcamento.html` — páginas que o cliente abre por link.
- `contrato-evento.tpl.html` / `contrato-hospedagem.tpl.html` — os dois contratos.
  São HTML normal, versionado. **Não existe mais base64**: editar direto.

### Fluxos públicos — checar SEMPRE antes de fechar acesso

`admin.html` não é só área logada. Estas entradas abrem sem login:

| Entrada | O que faz |
|---|---|
| `?orcamento` / `#orcamento` | wizard de orçamento (`orcamentos.js`) |
| `?visita` / `#visita` | agendamento de visita |
| `contrato.html?token=` | contrato do cliente |
| `orcamento.html?id=` | orçamento enviado por WhatsApp |

Sem sessão, `sbFetch` cai no `SB_KEY` (role `anon`). Dois clientes já foram
bloqueados em produção por mudanças de RLS que pareciam seguras na leitura do
código. **Antes de revogar qualquer acesso anon, exercitar cada fluxo acima com
a chave publishable** — ver "Como verificar".

## Backend: Supabase

- Projeto: `wwnndsprpofmgbklqdgg`
- Chave publishable: `admin.html`, constante `SB_KEY` (é pública, está no HTML)
- PAT em `~/.claude/damata-secrets`. O container é efêmero — se não existir,
  pedir ao usuário e recriar:
  `mkdir -p ~/.claude && printf 'PAT=TOKEN\n' > ~/.claude/damata-secrets`
- DDL e leitura de catálogo só pela Management API (o PostgREST não alcança
  `pg_catalog`):
  ```bash
  PAT=$(grep PAT ~/.claude/damata-secrets | cut -d= -f2)
  curl -s -X POST "https://api.supabase.com/v1/projects/wwnndsprpofmgbklqdgg/database/query" \
    -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
    -d '{"query": "SQL AQUI"}'
  ```
- Tabela principal: `agenda`. Campos: `cod` (PK), `nome_evento`, `data_evento`,
  `data_fim`, `tipo_evento`, `valor_locacao`, `cin`, `cout`, `payments_json`,
  `spaces_json` (ambos **text** com JSON dentro), `cliente_json` (jsonb),
  `assinatura_status`, `contrato_token`, `deleted_at`.
- Soft-delete: `agenda`, `contas_a_receber`, `contas_a_pagar`, `pedidos`,
  `itens_pedido`, `inventario`, `visitas_tecnicas`, `vt_linhas`, `tabelas_preco`.
  `dbGet()` já filtra `deleted_at is null`; consultas manuais precisam filtrar.

### RLS

Aplicado nas 26 tabelas (`supabase/rls_phase2.sql` e as seções seguintes).
Funções auxiliares: `get_my_role()`, `get_my_assessoria_cod()`, `get_my_event_ids()`.

Pendência conhecida: o `anon` ainda tem privilégios amplos de tabela
(SELECT/INSERT/UPDATE/DELETE/TRUNCATE) em ~21 tabelas. Hoje só o RLS o segura —
não há brecha aberta, mas falta a segunda camada. `REVOKE` ali exige exercitar
os fluxos públicos antes.

### Edge Functions

**Não servem HTML.** O gateway força `content-type: text/plain` e
`Content-Security-Policy: sandbox` em tudo que sai de
`*.supabase.co/functions/v1/` — proteção anti-phishing do domínio compartilhado.
Página HTML tem que ser servida do `fazendadamata.com`; a função devolve JSON
(`contrato-publico`) ou o HTML é buscado e renderizado por uma página estática
(`orcamento.html`).

Deploy:
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/wwnndsprpofmgbklqdgg/functions/deploy?slug=NOME" \
  -H "Authorization: Bearer $PAT" \
  -F 'metadata={"entrypoint_path":"index.ts","name":"NOME","verify_jwt":false}' \
  -F "file=@supabase/functions/NOME/index.ts;type=application/typescript"
```
`verify_jwt: false` para as funções chamadas com a chave publishable.

## Contrato

O contrato é um **link**, não um arquivo. O envio do `.html` foi cortado.

1. Gerador salva o evento e copia `fazendadamata.com/contrato.html?token=<uuid>`
2. `contrato.html` busca o preset em `contrato-publico` e injeta no template
3. O cliente preenche; a página **grava na base antes** de gerar o PDF
4. PDF vai para `assinar-contrato` → Autentique, que marca `enviado`
5. O link expira sozinho: só serve em `null`/`gerado`/`dados_preenchidos`

`contrato_token` é uuid porque `cod` é sequencial de 6 dígitos e seria enumerável.

### Código do contrato

`proximo_cod_contrato(ano)` no banco — não reimplementar em JS. Usa `max`
numérico (ordenar `cod` como texto quebra no centésimo contrato do ano) e não
filtra `deleted_at` (código de evento apagado não volta a ser usado).

## Versão

A cada commit funcional, atualizar `ll-version` no `admin.html`:

```html
<div id="ll-version" ...>v2026.07.31i</div>
```

Formato `v{ANO}.{MÊS}.{DIA}{letra}`. A versão também serve de cache-buster do
iframe do gerador — o Pages manda `max-age=600` e sem isso o iframe fica até 10
minutos servindo a versão anterior.

## Como verificar

Ler o código não basta — hoje já quebrou produção duas vezes assim. Exercitar
contra o ambiente real:

- **Leituras públicas**: replicar a chamada com a chave publishable via `curl`
- **Escritas**: simular como `anon` sem persistir —
  `BEGIN; SET LOCAL ROLE anon; <comando>; ROLLBACK;` pela Management API.
  Cuidado: `UPDATE` sem política afeta 0 linhas **sem erro** — medir com
  `WITH u AS (UPDATE ... RETURNING 1) SELECT count(*) FROM u`
- **Código publicado**: baixar o `.js` do ar e rodar em Node com stubs, em vez
  de reescrever a lógica no teste
- Chromium não passa pelo proxy deste ambiente: teste de navegador é do usuário
- Registro de teste em produção: marcar (`__TESTE CLAUDE__`) e apagar depois,
  conferindo que não sobrou nada

## Workflow

- Trabalhar no branch designado pela sessão; `main` é o que está no ar
- Usar Python para editar `admin.html` (610KB, grande demais para Edit direto)
- Commits atômicos, com o porquê da mudança na mensagem
- Nunca `git stash pop` entre branches diferentes com `admin.html`
