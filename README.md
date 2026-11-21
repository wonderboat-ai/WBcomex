# Calculadora de Importação de Eletrônicos · Wonder BOAT

Página estática que calcula, item a item, o custo nacionalizado e o preço de venda de eletrônicos importados.

> **Estimativa.** O resultado é uma estimativa para cotação e precificação. Confirme NCM, alíquotas, câmbio fiscal e despesas com o despachante antes de fechar preço ou registrar a declaração.

## O que a calculadora entrega

1. **Custo discriminado.** Por item: NCM, frete rateado, valor aduaneiro, II, IPI, PIS, COFINS, Siscomex, ICMS (por dentro) e despesas, além da memória de cálculo linha a linha.
2. **Markup ajustável.** Multiplicador global (campo + slider de 1,00 a 4,00) e, se quiser, um markup por item.
3. **Preço final.** Custo unitário, preço unitário e total, lucro e margem líquida (depois das deduções da venda).
4. **Câmbio do dia.** Invoice em dólar ou euro. Ao abrir, a página busca a PTAX de venda no Banco Central e preenche o câmbio fiscal e o do pagamento. A taxa digitada nunca é sobrescrita.
5. **Pesquisa de NCM.** A lupa em cada item pesquisa a nomenclatura oficial por descrição ou código. Ao escolher a NCM, II e IPI vêm das tabelas oficiais (MDIC/Camex e TIPI), com fonte e data.
6. **Regime do comprador.** Simples Nacional (tudo no DAS) ou Simples híbrido (IBS/CBS fora do DAS), com o efeito de cada um explicado na tela.

**Premissas fixas:** regime aduaneiro comum (DUIMP/DI); comprador no Simples Nacional, sem crédito de imposto (todo tributo vira custo em 2026, também no híbrido); modal aéreo ou courier, sem AFRMM; frete e seguro rateados pelo valor FOB; regras de 2026.

Especificação do v1: [`SPEC.md`](./SPEC.md). Regras do projeto: [`CLAUDE.md`](./CLAUDE.md).

## Rodar localmente

ES modules não rodam em `file://`. Use um servidor local na raiz do projeto:

```bash
python -m http.server 8000
```

ou

```bash
npx serve
```

Depois abra `http://localhost:8000`.

## Testes

Sem dependências, só Node 20 ou mais novo:

```bash
npm test
```

O comando roda `node --test`. `tests/calc.test.js` carrega cada fixture de `tests/fixtures/`, roda `calcular(entrada)` e compara cada campo de `esperado`. A tolerância é R$ 0,01 para valores em reais e 0,0001 para fator, markup e margem. **Os fixtures são a verdade**: as contas foram conferidas no Excel em 20/11/2026. Se um teste falhar, o erro está no código.

| Fixture | Cenário | Custo total | Tributos | Faturamento |
|---|---|---|---|---|
| `courier-8-itens-valor-pago.json` | 8 itens, valor pago em R$ | R$ 34.843,36 | R$ 15.526,03 | R$ 54.576,88 |
| `courier-8-itens-cambio.json` | mesmos itens, câmbio R$ 5,87 + IOF 3,5% | R$ 36.742,26 | R$ 15.735,80 | R$ 57.565,15 |

Outros testes cobrem a busca de NCM, a resolução das alíquotas oficiais, a PTAX (com respostas simuladas), o câmbio em euro, o regime híbrido, abrir/salvar JSON e o CSV. O workflow `.github/workflows/test.yml` roda tudo em todo push e pull request.

## Estrutura

```
index.html
assets/css/styles.css       tokens da marca, layout e @media print
assets/js/calc.js           cálculo puro: calcular(entrada), taxaSiscomex(n), validarEntrada, gerarAlertas
assets/js/aliquotas.js      II e IPI oficiais por NCM (regra conservadora, vigência das exceções)
assets/js/ncm-busca.js      pesquisa na nomenclatura NCM oficial
assets/js/fx.js             PTAX do BCB (dólar e euro)
assets/js/app.js            estado, eventos e renderização
assets/js/format.js         parse e formatação pt-BR
assets/js/storage.js        rascunho no localStorage, NCMs personalizadas, abrir/salvar JSON
assets/js/export.js         CSV e impressão
assets/img/                 logos reais (branco na tela, ciano na impressão)
data/regras-2026.js         PIS, COFINS, Siscomex, teto do RTS, ICMS padrão, regimes, vigência e fontes
data/ncm.js                 as 8 NCMs da SPEC v1 (buscadorncm, não oficial), com observações e alertas
data/ncm-nomenclatura.json  nomenclatura NCM oficial (Siscomex), só código e descrição
data/aliquotas-oficiais.json II (Anexos da Res. Gecex 272/2021) e IPI (TIPI) por NCM, com fonte e sha256
scripts/atualizar-ncm.mjs   baixa e compacta a nomenclatura do Siscomex
scripts/gerar-aliquotas.py  lê as planilhas do MDIC e da Receita e gera aliquotas-oficiais.json
tests/                      node --test e fixtures
```

`calc.js`, `aliquotas.js` e `ncm-busca.js` não usam DOM, `fetch` nem estado global. A interface monta a entrada, chama `calcular()` e mostra o resultado.

## De onde vêm as alíquotas

Nenhuma alíquota fica no código: tudo sai de `data/`, com fonte e data.

**Prioridade:** NCM personalizada pelo usuário > dados oficiais > tabela do app.

- **Dados oficiais (`data/aliquotas-oficiais.json`):**
  - **II:** planilha "Tarifas vigentes" do MDIC/Camex com os Anexos da Resolução Gecex nº 272/2021, atualizada em 11/11/2026. Anexo I traz a TEC; Anexo II, a alíquota aplicada pelo Brasil; os Anexos IV, V (LETEC), VI (LEBIT/BK), VIII, IX, X e XI (LETEC+) trazem as exceções temporárias.
  - **IPI:** TIPI da Receita Federal ("TIPI 2022 – Atualizada ADE 001-2026", de 13/02/2026). "NT" vira 0.
- **Regra conservadora do II:** não consegui ler no texto oficial (Diário Oficial inacessível a partir do ambiente de desenvolvimento) a regra que diz qual anexo prevalece. Por segurança, o app sugere a **maior** alíquota entre as que valem para a NCM inteira na data da operação (Anexo II ou TEC, e exceções sem "Ex" e sem quota).
  - Quando existe exceção menor, a tela avisa com o anexo e o ato. Exemplo: 8544.42.00, sugerido 16% (Anexo II), com LETEC de 8% vigente pela Res. Gecex 318.
  - Ex-tarifário e quota nunca são aplicados sozinhos. Exemplo: o Ex 1 da 8517.62.59, a 12,6%, só gera alerta.
- **Tabela do app (`data/ncm.js`):** as 8 NCMs da SPEC v1, lidas em buscadorncm.com.br (não oficial) em 20/11/2026. Ficam como reserva se os dados oficiais não carregarem e para as observações (ex.: alerta de homologação ANATEL no gateway Wi‑Fi). Nas 8 NCMs, a alíquota oficial sugerida é igual à da tabela.
- **Siscomex (Portaria ME 4.131/2021):** R$ 115,67 por declaração mais o valor de cada adição. 1 adição = R$ 154,23 e 5 adições = R$ 285,34, conferidos. As faixas a partir da 6ª adição estão marcadas como "a confirmar na Portaria ME 4.131/2021".
- **NCM inexistente na nomenclatura vigente:** a tela aponta, e II e IPI ficam em branco e destacados. O app nunca supõe alíquota.
- **NCM personalizada:** pela tela "Pesquisar NCM" dá para cadastrar uma NCM com fonte e data de leitura. Ela fica só no `localStorage` do navegador e prevalece sobre a oficial. Serve para Ex-tarifário ou alíquota confirmada pelo despachante.
- **ICMS de outras UFs:** só SC tem padrão (17%). Para outras UFs o campo fica em branco até o usuário preencher.

### Atualizar os dados oficiais

A nomenclatura e as tabelas mudam com novas resoluções. Para atualizar:

```bash
node scripts/atualizar-ncm.mjs
```

```bash
pip install openpyxl
```

```bash
python3 scripts/gerar-aliquotas.py --tec ANEXOS.xlsx --tipi TIPI.xlsx --tec-url URL_DO_XLSX_DA_TEC --tec-atualizada-em AAAA-MM-DD --tipi-url URL_DO_XLSX_DA_TIPI --tipi-arquivo "NOME DO ARQUIVO" --tipi-atualizada-em AAAA-MM-DD
```

As planilhas ficam nas páginas indicadas em `data/aliquotas-oficiais.json` (campo `pagina`). Rode `npm test` antes de commitar: os testes conferem as 8 NCMs da SPEC e os fixtures.

## Câmbio

- **Moeda da invoice:** dólar (US$) ou euro (€). Preços FOB, frete e seguro são lidos na moeda escolhida. No JSON, os campos `*USD` guardam o valor na moeda da operação (`operacao.moeda`); o nome foi mantido para não quebrar o formato da SPEC.
- **PTAX automática:** ao abrir, a página busca a última PTAX de venda (boletim de fechamento) na API do Banco Central (`olinda.bcb.gov.br`), que responde com CORS liberado. Ela preenche o câmbio fiscal, a data da taxa e o câmbio do pagamento.
  - Taxa digitada ou vinda de arquivo aberto nunca é sobrescrita. O botão "Usar PTAX" aplica a cotação do dia quando você quiser.
- **Regra fiscal:** os tributos usam a taxa de venda de fechamento do dia útil anterior ao registro da declaração (Portaria MF 6/1999; Portaria SRF 87/1999; Notícia Siscomex Importação 016/2019). A última PTAX publicada é, portanto, a taxa de uma DUIMP registrada no dia útil seguinte. Confirme com o despachante a taxa do dia do registro.
- **Euro e teto do RTS:** para conferir o teto de US$ 3.000 do regime simplificado, o valor em euro é convertido pela paridade US$/€ da própria PTAX (campo editável).
- **Câmbio do pagamento:** vem preenchido com a PTAX só como referência. O cartão ou o banco aplica a própria taxa; ajuste se souber.
- Se o BCB mudar a política de CORS, troque `PTAX_DISPONIVEL` para `false` em `assets/js/fx.js`: a página volta a mostrar só o campo manual e um link para as cotações do BCB. Não use proxy.

## Regime do comprador

- **Simples Nacional (tudo no DAS):** todo tributo da importação é custo.
- **Simples híbrido (IBS/CBS fora do DAS, LC 214/2025):**
  - **Em 2026:** o custo da importação é o mesmo do Simples puro. Os optantes do Simples estão fora das alíquotas-teste de CBS/IBS (art. 348, III, "c"), e a opção só produz efeitos a partir de 01/01/2027.
  - **A partir de 2027:** a CBS e o IBS pagos na importação viram crédito (art. 78), PIS e COFINS deixam de existir e o IPI muda.
  - **Prazo:** a opção pode ser cancelada de 03/11 a 20/12/2026, de forma irretratável (Resolução CGSN 194/2026).
- **Regras de 2027:** só entram em `data/regras-2027.js` quando a alíquota da CBS for fixada. O TCU calculou 11,3% (Acórdão 2.933/2026); falta a resolução do Senado. Com data de operação em 2027, a tela mostra um alerta de que o resultado não vale.
- **DAS na venda:** na revenda de importação própria, o optante é equiparado a industrial para o IPI, e a receita vai para o Anexo II do Simples (Resolução CGSN 140/2018, art. 25 §1º). Use a alíquota efetiva informada pelo contador.

## Salvar, abrir, CSV e impressão

- **Rascunho automático:** a simulação atual fica no `localStorage` e é gravada também ao sair da página. Sem storage, a página funciona normalmente.
- **Salvar / Abrir:** baixa ou carrega o JSON da `entrada`, no formato da seção 4 da SPEC, e valida ao abrir. Também aceita um fixture inteiro (`{ entrada, esperado }`). Em `operacao`, ficam os campos extras `referencia`, `data`, `moeda`, `paridadeUSD`, `dataCambioFiscal` e `origemCambioFiscal`.
- **CSV:** uma linha por item com todas as colunas do resultado, separador `;` e decimal com vírgula. Abre direto no Excel em pt-BR. Os cabeçalhos usam o símbolo da moeda da operação.
- **Imprimir:** A4 paisagem, fundo branco e logo ciano.
  - **1ª página:** cabeçalho (referência, data, regime, câmbio, pagamento), resumo, alertas e tabela por item.
  - **Páginas seguintes:** custo discriminado, composição e memória de cálculo aberta.

## Logos

Arquivos reais, recortados só na margem transparente:

- **Tela, fundo escuro:** `assets/img/logo-wonderboat-branco.png`.
- **Impressão:** `assets/img/logo-wonderboat-azul.png`.

## Publicação (GitHub Pages)

O site é servido da branch `main`, pasta raiz, sem workflow de deploy. Em **Settings → Pages**, escolha **Deploy from a branch**, branch **main**, pasta **/ (root)**. Todos os caminhos são relativos, então funciona em `https://<usuario>.github.io/<repo>/`.

## Fora do escopo atual

- Regras de 2027 (CBS/IBS, IPI zero com exceções), que dependem da resolução do Senado sobre a CBS e da lista do IPI.
- Regime simplificado (RTS) calculado; hoje só existe o alerta.
- Lucro Presumido e Real, com créditos de ICMS, IPI e PIS/COFINS.
- ICMS fora do DAS por sublimite estadual.
- Preferências tarifárias por origem (ex.: acordo Mercosul–UE) e aplicação automática de Ex-tarifário.
- Modal marítimo, com AFRMM.
- Rateio por peso.
- Tabela de ICMS por UF e FCP.
- Modo "margem-alvo", que calcula o markup a partir da margem desejada.
- Colar itens direto de planilha.
- Histórico de simulações.

---

Wonder BOAT | Wonder HUB.AI
