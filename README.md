# Calculadora de Importação de Eletrônicos · Wonder BOAT

Página estática que calcula, item a item, o custo nacionalizado e o preço de venda de eletrônicos importados.

> **Estimativa.** O resultado é uma estimativa para cotação e precificação. Confirme alíquotas, câmbio fiscal e despesas com o despachante antes de fechar preço ou registrar a declaração.

## O que o v1 entrega

1. **Custo discriminado.** Por item: NCM, frete rateado, valor aduaneiro, II, IPI, PIS, COFINS, Siscomex, ICMS (por dentro) e despesas, além da memória de cálculo linha a linha.
2. **Markup ajustável.** Multiplicador global (campo + slider de 1,00 a 4,00) e, se quiser, um markup por item.
3. **Preço final.** Custo unitário, preço unitário e total, lucro e margem líquida (depois das deduções da venda).

**Premissas fixas do v1:** regime aduaneiro comum (DUIMP/DI); comprador no Simples Nacional, sem crédito de imposto (todo tributo vira custo); modal aéreo ou courier, sem AFRMM; frete e seguro rateados pelo valor FOB.

Especificação completa: [`SPEC.md`](./SPEC.md). Regras do projeto: [`CLAUDE.md`](./CLAUDE.md).

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

O workflow `.github/workflows/test.yml` roda os mesmos testes em todo push e pull request.

## Estrutura

```
index.html
assets/css/styles.css     tokens da marca, layout e @media print
assets/js/calc.js         cálculo puro: calcular(entrada), taxaSiscomex(n), validarEntrada, gerarAlertas
assets/js/app.js          estado, eventos e renderização
assets/js/format.js       parse e formatação pt-BR
assets/js/storage.js      rascunho no localStorage, NCMs personalizadas, abrir/salvar JSON
assets/js/export.js       CSV e impressão
assets/js/fx.js           busca da PTAX no BCB
assets/img/               logos (ver abaixo)
data/regras-2026.js       PIS, COFINS, Siscomex, teto do RTS, ICMS padrão, vigência e fontes
data/ncm.js               NCMs com alíquota, base legal, fonte e data de leitura
tests/                    node --test e fixtures
```

`calc.js` não usa DOM, `fetch` nem estado global. A interface monta a entrada, chama `calcular()` e mostra o resultado.

## De onde vêm as alíquotas

Nenhuma alíquota fica no código: tudo sai de `data/`.

- **`data/ncm.js`:** só as 8 NCMs da seção 6 da SPEC. Todas foram **lidas em buscadorncm.com.br em 20/11/2026, sem confirmação em fonte oficial** (TEC, TIPI ou Siscomex). Cada NCM traz II, IPI, a base do II como a página cita, fonte, data de leitura e observação. O gateway Wi‑Fi (8517.62.77) traz o alerta de homologação ANATEL.
- **`data/regras-2026.js`:** PIS 2,1% e COFINS 9,65% sobre o valor aduaneiro, Siscomex, teto de US$ 3.000 do regime simplificado e ICMS padrão de 17% para SC.
- **Siscomex (Portaria ME 4.131/2021):** R$ 115,67 por declaração mais o valor de cada adição. 1 adição = R$ 154,23 e 5 adições = R$ 285,34, conferidos. **As faixas a partir da 6ª adição estão marcadas como "a confirmar na Portaria ME 4.131/2021".**
- **NCM fora da tabela:** é aceita, mas II e IPI ficam em branco e destacados até alguém preencher. O app nunca supõe alíquota.
- **NCM personalizada:** pela tela "Tabela de NCMs" dá para cadastrar uma NCM com fonte e data de leitura. Ela fica só no `localStorage` do navegador, marcada como "personalizada".
- **ICMS de outras UFs:** só SC tem padrão. Para outras UFs o campo fica em branco até o usuário preencher.
- **2027:** com a reforma tributária, o IPI zera para a maioria dos itens a partir de 01/01/2027, e PIS/COFINS dão lugar à CBS. Isso **não** está no v1. Entra depois como `data/regras-2027.js`, com fonte.

## Câmbio

O câmbio fiscal (base dos tributos) é sempre digitável. O botão **Buscar PTAX** preenche a última PTAX de venda publicada pelo BCB e a data dela, sem travar o campo.

Teste de CORS feito no Chromium em 21/11/2026:

- **API PTAX do BCB** (`olinda.bcb.gov.br`): respondeu 200 com `access-control-allow-origin` igual à origem da página, testado com origem `*.github.io` e `localhost`. Por isso o botão está ativo.
- **AwesomeAPI** (`economia.awesomeapi.com.br`): respondeu 429 (cota excedida) sem cabeçalho CORS. Não é usada.

Se o BCB mudar a política, troque `PTAX_DISPONIVEL` para `false` em `assets/js/fx.js`. A página volta a mostrar só o campo manual e um link para as cotações do BCB. Não use proxy.

A PTAX é referência. Confirme com o despachante a taxa fiscal do dia do registro.

## Salvar, abrir, CSV e impressão

- **Rascunho automático:** a simulação atual fica no `localStorage`. Sem storage, a página funciona normalmente.
- **Salvar / Abrir:** baixa ou carrega o JSON da `entrada`, no formato da seção 4 da SPEC. O arquivo é validado ao abrir. Também aceita um fixture inteiro (`{ entrada, esperado }`). Os campos `referencia`, `data` e `dataCambioFiscal` em `operacao` são extras da tela; o cálculo os ignora.
- **CSV:** uma linha por item com todas as colunas do resultado, separador `;` e decimal com vírgula. Abre direto no Excel em pt-BR.
- **Imprimir:** A4 paisagem, fundo branco e logo azul. A 1ª página traz cabeçalho (referência, data, câmbio, pagamento), resumo, alertas e a tabela por item. A memória de cálculo sai aberta nas páginas seguintes.

## Logos

A página usa os arquivos reais, nunca uma versão redesenhada:

- `assets/img/logo-wonderboat-branco.png` (tela, fundo escuro), a partir de "Logo + Wonder BOAT Branca - fundo transparente.png";
- `assets/img/logo-wonderboat-azul.png` (impressão), a partir de "Logo + Wonder BOAT Azul - fundo transparente.png".

Enquanto os arquivos não estiverem na pasta, aparece um placeholder com o texto "Wonder BOAT" no mesmo tamanho.

## Publicação (GitHub Pages)

O site é servido da branch `main`, pasta raiz, sem workflow de deploy. Em **Settings → Pages**, escolha **Deploy from a branch**, branch **main**, pasta **/ (root)**. Todos os caminhos são relativos, então funciona em `https://<usuario>.github.io/<repo>/`.

## Fora do v1

- Regime simplificado (RTS) calculado; hoje só existe o alerta.
- Lucro Presumido e Real, com créditos de ICMS, IPI e PIS/COFINS.
- Modal marítimo, com AFRMM.
- Rateio por peso.
- Tabela de ICMS por UF e FCP.
- Modo "margem-alvo", que calcula o markup a partir da margem desejada.
- Colar itens direto de planilha.
- Histórico de simulações.
- Regras de 2027 (CBS/IBS, IPI zero).

---

Wonder BOAT | Wonder HUB.AI
