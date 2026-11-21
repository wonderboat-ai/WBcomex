# Calculadora de Importação · Wonder BOAT

A especificação completa está em `SPEC.md`. Leia antes de mudar qualquer coisa.

## Regras do projeto

- **Cálculo:**
  - Fica em `assets/js/calc.js`, como função pura, sem DOM, sem `fetch` e sem estado global.
  - Toda mudança de fórmula precisa vir com teste em `tests/`.
- **Fixtures:**
  - Os de `tests/fixtures/` são a verdade: as contas foram conferidas no Excel em 20/11/2026.
  - Se um teste falhar, corrija o código; nunca mexa no fixture para o teste passar.
- **Alíquotas:**
  - São dados: ficam em `data/` e cada uma leva fonte e data de leitura.
  - Nunca inventar nem completar alíquota de memória. NCM sem alíquota com fonte fica em branco e destacada na tela.
- **Dados oficiais de NCM:**
  - `data/ncm-nomenclatura.json` e `data/aliquotas-oficiais.json` são gerados por `scripts/atualizar-ncm.mjs` e `scripts/gerar-aliquotas.py` a partir das fontes oficiais (Siscomex, MDIC/Camex, Receita). Nunca editar à mão.
  - II sugerido = maior alíquota oficial válida para a NCM inteira (a regra de prevalência entre anexos não foi confirmada no texto oficial). Ex-tarifário, quota e exceção menor só geram alerta.
- **Cores e fontes:**
  - Use só os tokens CSS da seção 9 da SPEC e a fonte Montserrat.
  - Cor nova precisa do OK do dono do projeto.
- **Logo:** sempre o arquivo real em `assets/img/`. Nunca redesenhar em SVG ou CSS.
- **Caminhos:** sempre relativos, porque o site roda em `/<repo>/` no GitHub Pages.
- **Idioma e formatos:** interface e textos em pt-BR, números com `Intl.NumberFormat('pt-BR')`.
- **Dados da empresa:** nada de CNPJ, endereço, e-mail ou nome de fornecedor no repositório.
- **Antes de commitar:** rodar `npm test`.
- **Git e GitHub:** só criar o repositório e dar push com o OK do dono do projeto. Na primeira vez, pergunte se o repositório é público ou privado.

## Rodar localmente

```bash
python -m http.server 8000   # abrir http://localhost:8000
npm test                     # node --test
```
