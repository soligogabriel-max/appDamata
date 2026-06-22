# appDamata — instruções para Claude

## Início de cada sessão

Antes de fazer qualquer mudança, sincronizar os arquivos principais com o main:

```bash
git fetch origin
git checkout origin/main -- index.html gerador-contrato-damata.html
```

Isso garante que partimos sempre da versão mais recente, evitando perder fixes anteriores.

## Arquitetura

App de página única. Toda a lógica está em dois arquivos:
- `index.html` — app principal (admin): CSS, JS, templates base64, integração Supabase
- `gerador-contrato-damata.html` — gerador de contratos (iframe dentro do index)

### Templates embutidos (base64)
- `CLIENT_B64` em `index.html` — template do contrato enviado ao cliente (casamento/evento)
- `HOSPEDAGEM_B64` em `index.html` e no gerador — template do contrato de hospedagem

Para editar um template: decodificar com Python, editar o HTML, re-codificar, substituir a variável.

```python
import base64
# decodificar
html = base64.b64decode(B64_VALUE).decode('utf-8')
# re-codificar
b64 = base64.b64encode(html.encode('utf-8')).decode('ascii')
```

## Backend: Supabase (PostgREST)

- Apenas anon key disponível no código — DDL requer Dashboard > SQL Editor
- Tabela principal: `agenda` (eventos/contratos)
- Campos relevantes: `cod`, `nome_evento`, `data_evento`, `data_fim`, `tipo_evento`,
  `valor_locacao`, `cin`, `cout`, `status`, `payments_json`, `spaces_json`, `obs`

## Workflow de branches

- Trabalhar sempre no branch designado pela sessão
- Usar Python para edições em massa (arquivo é grande demais para Edit direto)
- Commits atômicos com todas as mudanças relacionadas juntas
- Nunca usar `git stash pop` entre branches diferentes com `index.html`
