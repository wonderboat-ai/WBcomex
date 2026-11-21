# Calculadora de Importação de Eletrônicos · Wonder BOAT

Especificação para o Claude Code construir a página. Versão 1, de 21/11/2026.

## 0. Objetivo e escopo

Página única, estática, que calcula o custo nacionalizado e o preço de venda de produtos eletrônicos importados, item a item.

**O v1 entrega só três coisas:**
1. **Custo com tudo discriminado.** Cada item mostra NCM, frete rateado, valor aduaneiro, II, IPI, PIS, COFINS, Siscomex, ICMS e despesas.
2. **Markup ajustável.** Um multiplicador global e, se quiser, um diferente por item.
3. **Preço final.** Custo unitário nacionalizado e preço de venda unitário e total, com a margem.

**Premissas fixas do v1:**
- regime aduaneiro comum (DUIMP/DI);
- comprador no Simples Nacional, sem crédito de imposto, então todo tributo vira custo;
- modal aéreo ou courier, sem AFRMM;
- frete rateado pelo valor FOB.

O que fica para depois está na seção 13. Não implementar nada dessa lista no v1.

## 1. Stack e restrições

- **Tecnologia:** HTML, CSS e JavaScript puro (ES modules). Sem framework, sem build e sem dependência em runtime.
- **Hospedagem:** GitHub Pages, servido em `https://<usuario>.github.io/<repo>/`. Por isso **todos os caminhos devem ser relativos** (`./assets/...`, nunca `/assets/...`).
- **Ambiente local:** ES modules não rodam em `file://`. Use um servidor local, como `python -m http.server 8000` ou `npx serve`. Coloque isso no README.
- **Testes:** `node --test`, sem dependências. O `package.json` existe só para declarar `"type": "module"` e o script `test`.
- **Separação de camadas:** o cálculo fica num módulo puro (`calc.js`), sem DOM, sem `fetch` e sem estado global. A interface só monta a entrada, chama `calcular()` e renderiza o resultado.
- **Idioma e formatos:** interface em pt-BR. Números com `Intl.NumberFormat('pt-BR')`. Os campos aceitam `1.234,56` e `1234.56`.

## 2. Estrutura de arquivos

```
/
├── index.html
├── assets/
│   ├── css/styles.css        # tokens da marca + layout + @media print
│   ├── js/app.js             # estado, eventos, renderização
│   ├── js/calc.js            # cálculo puro: calcular(entrada), taxaSiscomex(n)
│   ├── js/format.js          # parse/format pt-BR, moeda, %
│   ├── js/storage.js         # localStorage, exportar/importar JSON
│   ├── js/export.js          # CSV e impressão
│   ├── js/fx.js              # busca de câmbio (opcional, ver seção 7)
│   └── img/                  # logos reais (ver seção 9)
├── data/
│   ├── regras-2026.js        # PIS, COFINS, Siscomex, teto RTS, ICMS padrão, data de vigência
│   └── ncm.js                # NCMs com alíquota, fonte e data de leitura
├── tests/
│   ├── calc.test.js
│   └── fixtures/             # courier-8-itens-valor-pago.json, courier-8-itens-cambio.json
├── .github/workflows/test.yml  # roda node --test em push e PR
├── package.json
├── CLAUDE.md
└── README.md
```

## 3. Layout da página

No desktop (≥ 1024 px) são duas colunas: entradas à esquerda (≈ 62%) e um painel de resumo fixo (sticky) à direita. Abaixo delas, em largura total, ficam o resultado por item, a composição do custo e a memória de cálculo. No celular tudo empilha, e uma barra fixa no rodapé mostra o custo total e o faturamento.

```
┌──────────────────────────────────────────────────────────────────────┐
│ [logo]  Calculadora de Importação     [Nova] [Abrir] [Salvar] [CSV] [Imprimir] │
├───────────────────────────────────────────┬──────────────────────────┤
│ 1 OPERAÇÃO                                │ RESUMO (sticky)          │
│  Referência · Data · UF destino · ICMS %  │  FOB total      US$      │
│  Câmbio fiscal R$/US$ [ ] (Buscar PTAX)   │  Custo nacionalizado R$  │
│  Pagamento: (•) câmbio + IOF  ( ) valor   │  Fator R$ por US$ FOB    │
│            pago em R$                     │  Tributos R$ · % do VA   │
│ 2 ITENS                                   │  Faturamento R$          │
│  Descrição│Código│NCM▼│Qtd│FOB un│II│IPI│MK│  Lucro R$ · margem %     │
│  [+ item]                                 │  ⚠ alertas               │
│ 3 FRETE E DESPESAS                        │                          │
│  Frete US$ · Seguro US$                   │                          │
│  Despesas R$ [nome][valor][☐ base ICMS]   │                          │
│  Siscomex: automático (n adições) [editar]│                          │
│ 4 PRECIFICAÇÃO                            │                          │
│  Markup global [1,80] ═══●═══ (1,00–4,00) │                          │
│  Deduções da venda: impostos % · cartão % │                          │
│  · comissão % · outras %                  │                          │
├───────────────────────────────────────────┴──────────────────────────┤
│ RESULTADO POR ITEM                                                   │
│  Item│NCM│Qtd│Custo un R$│Fator│Markup│Preço un R$│Preço total│Margem│
│ COMPOSIÇÃO DO CUSTO (barra empilhada: mercadoria+frete │ tributos     │
│  federais │ ICMS │ despesas)                                          │
│ MEMÓRIA DE CÁLCULO (um <details> por item, com cada linha da fórmula) │
├──────────────────────────────────────────────────────────────────────┤
│ Wonder BOAT | Wonder HUB.AI · Regras vigentes em 2026 · alíquotas    │
│ lidas em 20/11/2026 · estimativa, confirmar com o despachante        │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.1 Campos

**Operação**
- Referência (texto livre, ex.: nº da invoice) e data.
- UF de destino, padrão SC. ICMS %, padrão 17% (vem de `regras-2026.js`, editável).
- Câmbio fiscal (R$/US$): é a base dos tributos. Campo obrigatório, com a data da taxa ao lado.
- Pagamento, com dois modos:
  - **Câmbio + IOF:** informar câmbio do pagamento e IOF %. Serve para cotação ou recompra.
  - **Valor pago em R$:** informar o total já pago (cartão + IOF). Serve para compra já feita; esse valor é rateado pelo FOB.

**Itens** (tabela editável, uma linha por item)
- Descrição, código, NCM, quantidade e preço FOB unitário em US$.
- **NCM:** autocomplete a partir de `data/ncm.js`. Escolher a NCM preenche II % e IPI %. O usuário pode sobrescrever as alíquotas; o valor sobrescrito fica marcado (ícone ou borda) e um botão restaura o da tabela.
- **NCM fora da tabela:** é aceita, mas II e IPI ficam vazios e destacados até alguém preencher. O app nunca supõe alíquota.
- Markup do item: opcional. Vazio = usa o global.
- Botões para adicionar, duplicar e remover linha.

**Frete e despesas**
- Frete internacional (US$) e seguro (US$, padrão 0).
- Lista de despesas em R$ (nome, valor e caixa "entra na base do ICMS"). Exemplos de placeholder: desembaraço do courier, despachante, armazenagem, frete interno.
- Siscomex: calculado sozinho pelo número de NCMs distintas, com opção de digitar o valor.

**Precificação**
- Markup global: campo numérico + slider de 1,00 a 4,00, passo 0,05. Padrão 1,00, ou seja, venda = custo até o usuário ajustar.
- Deduções da venda, todas em % e **em branco por padrão** (branco = 0): impostos sobre a venda (DAS), taxa de cartão, comissão, outras.

## 4. Modelo de dados

A entrada e a saída de `calcular()` usam **exatamente** o formato dos fixtures em `tests/fixtures/`. Resumo:

```js
entrada = {
  operacao: {
    regimeAduaneiro: 'comum', regimeTributario: 'simples', uf: 'SC',
    cambioFiscal: 5.79, icms: 0.17, pis: 0.021, cofins: 0.0965,
    freteUSD: 103, seguroUSD: 0, rateio: 'fob',
    despesas: [{ nome, valorBRL, baseICMS: false }],
    pagamento: { modo: 'cambio', cambioPagamento, iof }   // ou
               { modo: 'valorPagoBRL', valorPagoBRL },
    siscomexManualBRL: null            // opcional; null = automático
  },
  itens: [{ descricao, codigo, ncm, qtd, fobUnitUSD, ii, ipi, markup? }],
  precificacao: { markupGlobal, impostosVenda, taxaCartao, comissao, outrasDeducoes }
}

saida = {
  itens: [{ codigo, valorAduaneiroUSD, valorAduaneiroBRL, ii, ipi, pis, cofins, siscomex,
            baseIcms, icms, tributos, pagamentoBRL, despesasBRL, custoTotal, custoUnit,
            fatorBRLporUSD, markup, precoUnit, deducoesUnit, lucroUnit, margemLiquida }],
  totais: { fobUSD, adicoes, valorAduaneiroUSD, valorAduaneiroBRL, ii, ipi, pis, cofins,
            siscomex, icms, tributos, pagamentoBRL, despesasBRL, custoTotal,
            fatorBRLporUSD, faturamento, lucro }
}
```

Percentuais são guardados como fração (0,17 = 17%). Os cálculos usam precisão total, e só a exibição arredonda para 2 casas.

## 5. Fórmulas (regime comum, Simples Nacional)

Para cada item *i*:

```
FOB_i        = qtd_i × fobUnitUSD_i
part_i       = FOB_i / Σ FOB
VA_USD_i     = FOB_i + part_i × (freteUSD + seguroUSD)          # valor aduaneiro
VA_BRL_i     = VA_USD_i × cambioFiscal

II_i         = VA_BRL_i × ii_i
IPI_i        = (VA_BRL_i + II_i) × ipi_i
PIS_i        = VA_BRL_i × pis
COFINS_i     = VA_BRL_i × cofins
Siscomex_i   = Siscomex × VA_BRL_i / Σ VA_BRL
DespBase_i   = (Σ despesas com baseICMS) × part_i
BaseICMS_i   = (VA_BRL_i + II_i + IPI_i + PIS_i + COFINS_i + Siscomex_i + DespBase_i) / (1 − icms)
ICMS_i       = BaseICMS_i × icms                                # ICMS "por dentro"
Tributos_i   = II_i + IPI_i + PIS_i + COFINS_i + Siscomex_i + ICMS_i

Pagamento_i  = modo 'cambio'       → VA_USD_i × cambioPagamento × (1 + iof)
               modo 'valorPagoBRL' → valorPagoBRL × part_i
Despesas_i   = (Σ todas as despesas) × part_i
CustoTotal_i = Pagamento_i + Tributos_i + Despesas_i
CustoUnit_i  = CustoTotal_i / qtd_i
Fator_i      = CustoTotal_i / FOB_i                            # R$ por US$ FOB

Markup_i     = markup do item ?? markupGlobal
PrecoUnit_i  = CustoUnit_i × Markup_i
Deducoes_i   = PrecoUnit_i × (impostosVenda + taxaCartao + comissao + outrasDeducoes)
Lucro_i      = PrecoUnit_i − CustoUnit_i − Deducoes_i
Margem_i     = Lucro_i / PrecoUnit_i
```

**Taxa Siscomex** (Portaria ME 4.131/2021): R$ 115,67 por declaração, mais o valor de cada adição por faixa:

| Adições | Valor de cada uma |
|---|---|
| 1ª e 2ª | R$ 38,56 |
| 3ª a 5ª | R$ 30,85 |
| 6ª a 10ª | R$ 23,14 |
| 11ª a 20ª | R$ 15,42 |
| 21ª a 50ª | R$ 7,71 |
| 51ª em diante | R$ 3,86 |

Número de adições = quantidade de NCMs distintas. Conferência: 1 adição = 154,23; 5 = 285,34. As faixas a partir da 6ª adição vieram de memória e não de busca: deixe-as em `regras-2026.js` marcadas como "a confirmar na Portaria ME 4.131/2021".

**Conta de mão para conferir** (1 item, NCM 8544.42.00, II 16%, IPI 5%):
- **Entradas:** FOB US$ 500, frete US$ 50, câmbio fiscal e de pagamento R$ 5,00, IOF 0, ICMS 17%, sem despesas.
- **Tributos:** VA = 2.750,00 · II = 440,00 · IPI = 159,50 · PIS = 57,75 · COFINS = 265,38 · Siscomex = 154,23.
- **ICMS:** base = 4.610,67 · ICMS = 783,81.
- **Custo:** 4.610,67, fator 9,22.
- **Venda:** com markup 1,8 o preço é 8.299,20. Com deduções de 6% + 3%, o lucro é 2.941,61, margem de 35,44%.

**Alertas** (mostrar no resumo, sem bloquear o cálculo):
- **Valor aduaneiro total (FOB + frete + seguro, em US$) acima de US$ 3.000:** "Acima do teto do regime simplificado: regime comum."
- **Valor aduaneiro total até US$ 3.000:** "Pode caber no regime simplificado (RTS). O v1 calcula só o regime comum."
- **NCM com `alerta` em `ncm.js`:** mostrar o texto do alerta, por exemplo ANATEL no gateway Wi‑Fi.
- **Alíquota sobrescrita ou NCM fora da tabela:** avisar que é preciso confirmar com o despachante.
- **Margem negativa:** destacar a linha.
- **Soma das deduções da venda ≥ 100%:** mostrar como erro de entrada.

## 6. Alíquotas como dados

- **Fonte única:** toda alíquota sai de `data/`, nunca fica no código. Cada NCM em `ncm.js` tem: `ncm`, `descricao`, `ii`, `ipi`, `baseLegalII`, `fonte`, `lidoEm`, `observacao`, `alerta` (opcional).
- **Regras datadas:** `regras-2026.js` traz `vigenteDesde`, `pis`, `cofins`, a tabela do Siscomex, `tetoRtsUSD: 3000`, `icmsPadrao: { SC: 0.17 }` e as fontes. O rodapé mostra "Regras vigentes em 2026" e a data de leitura das alíquotas.
- **Mudança de 2027:** não escrever regras de 2027 de memória. Com a reforma tributária, o IPI zera para a maioria dos itens a partir de 01/01/2027, e PIS/COFINS dão lugar à CBS. Isso entra depois, como `regras-2027.js`, com fonte.
- **Primeira carga de `ncm.js`:** só estas NCMs. Todas foram **lidas em buscadorncm.com.br em 20/11/2026, sem confirmação em fonte oficial** (TEC, TIPI ou Siscomex), e o site se contradiz em alguns pontos. Use `fonte: 'buscadorncm.com.br (não oficial)'` e `lidoEm: '2026-11-20'`. O IPI é o "TIPI vigente" da mesma página. A coluna "Base do II" é o ato que a página cita; copie para `baseLegalII` sem generalizar.

| NCM | Descrição | II | Base do II (como a página cita) | IPI | Observação / alerta |
|---|---|---|---|---|---|
| 9014.80.10 | Sondas acústicas (ecobatímetros) ou de ultrassom (sonar) | 20% | LEBIT/BK, Res. Gecex 852/2026 | 3,25% | transdutores de sonar |
| 9014.90.00 | Partes e acessórios de instrumentos de navegação | 20% | LEBIT/BK, Res. Gecex 852/2026 | 3,25% | |
| 8544.42.00 | Condutores elétricos ≤ 1.000 V com peças de conexão | 16% | Anexo II (alíquota aplicada Brasil) | 5% | a página também cita LETEC a 8% (Res. Gecex 318/2022), não confirmada |
| 8525.89.19 | Câmeras de televisão, outras | 20% | Anexo II (alíquota aplicada Brasil) | 20% | câmeras marítimas com sensor CMOS; não usar 8525.83 (visão noturna com fotocátodo) |
| 8525.89.29 | Câmeras digitais e câmeras de vídeo, outras | 20% | Anexo II (alíquota aplicada Brasil) | 15% | a página cita Ex 15/16 a 0% (desabastecimento, Res. Gecex 962/2026) sem escopo; não aplicar |
| 8517.62.59 | Outros aparelhos de dados em rede com fio | 20% | LEBIT/BK, Res. Gecex 347 | 15% | gateways e conversores NMEA; a página cita "Ex 1" a 12,6% (Res. Gecex 732) só para um ex específico |
| 8517.62.77 | Emissores com receptor digitais < 15 GHz | 20% | LEBIT/BK, Res. Gecex 852/2026 | 15% | alerta: equipamento Wi‑Fi pode exigir homologação ANATEL |
| 8517.62.99 | Outros (8517.62) | 18% | Anexo II (alíquota aplicada Brasil) | 13% | |

- **Novas NCMs:** o usuário pode adicionar uma NCM própria pela interface. Ela fica salva no `localStorage`, marcada como "personalizada".

## 7. Câmbio

- O campo de câmbio fiscal é sempre digitável e é o caminho principal.
- **Botão "Buscar PTAX":** é opcional. Antes de implementar, **teste no navegador** se algum endpoint público responde com CORS liberado. Candidatos: a API PTAX do BCB (olinda.bcb.gov.br) e a AwesomeAPI (economia.awesomeapi.com.br).
- **Se nenhum funcionar no GitHub Pages:** não use proxy. Deixe só o campo manual, com um link para a página de cotações do BCB.
- **Se funcionar:** preencha o valor e a data da cotação, sem travar o campo.

## 8. Precificação

- **"Markup" aqui = multiplicador sobre o custo nacionalizado:** preço = custo × markup. Há um valor global e um opcional por item.
- **Margem exibida:** é o resultado, já descontadas as deduções da venda (que vêm em branco).
- **Por item, mostrar:** custo unitário, markup aplicado, preço unitário, preço total, lucro unitário e margem %.
- **No resumo, mostrar:** faturamento total, lucro total e margem média ponderada.
- **Mover o slider recalcula na hora.** O total é calculado sobre o preço unitário com precisão total; a tela arredonda só na exibição.

## 9. Identidade visual

**Fonte da paleta:** Manual de Marca WonderHUB.AI v1.0 (julho/2026), confirmado como paleta oficial em 07/09/2026. Usar só estes tokens:

```css
:root {
  --wb-black:  #030712;  /* Wonder Black: fundo da página */
  --wb-navy:   #071525;  /* Deep Navy: cards, painéis, cabeçalho da tabela */
  --wb-cyan:   #12D6F4;  /* Electric Cyan: acento principal, foco, KPI de custo, botão primário */
  --wb-blue:   #3478F6;  /* Signal Blue: links, botões secundários, série "mercadoria+frete" */
  --wb-violet: #7C3AED;  /* Quantum Violet: preço de venda e markup (só em destaques grandes) */
  --wb-white:  #F5F7FA;  /* Soft White: texto */
  --wb-text-2: rgba(245, 247, 250, .72);   /* texto secundário */
  --wb-line:   rgba(18, 214, 244, .16);    /* bordas e divisórias */
  /* cores funcionais, fora da paleta oficial, só para estados */
  --wb-warn:   #F59E0B;
  --wb-error:  #EF4444;
}
```

- **Tipografia:** Montserrat (Google Fonts, pesos 400/500/600/700). Números com `font-variant-numeric: tabular-nums`.
- **Tema:** escuro por padrão. Fundo `--wb-black`, cards em `--wb-navy` com borda `--wb-line`, e foco visível em ciano.
- **Contraste:**
  - Violeta sobre preto tem contraste baixo. Use só em números grandes ou em fundos, nunca em texto corrido.
  - Verificar AA em todo texto.
- **Barra de composição do custo:** 4 grupos. Mercadoria + frete = `--wb-blue`, tributos federais (II, IPI, PIS, COFINS, Siscomex) = `--wb-violet`, ICMS = `--wb-cyan`, despesas = `--wb-text-2`. Fazer em CSS ou SVG, sem biblioteca de gráfico.
- **Logo:** usar o arquivo real, nunca redesenhar em SVG ou CSS.
  - Na tela (fundo escuro): `assets/img/logo-wonderboat-branco.png` (vem de "Logo + Wonder BOAT Branca - fundo transparente.png").
  - Na impressão: `assets/img/logo-wonderboat-azul.png` (vem de "Logo + Wonder BOAT Azul - fundo transparente.png").
  - O dono do projeto fornece os dois arquivos. Até lá, use um placeholder com o texto "Wonder BOAT" e o mesmo tamanho.
- **Rodapé:** "Wonder BOAT | Wonder HUB.AI".
- **Impressão (`@media print`):** fundo branco, texto escuro, logo azul, sem botões nem sliders. A primeira página deve ter resumo + tabela por item + data, câmbio e alertas.

## 10. Persistência e exportação

- **Rascunho automático:** a simulação atual fica no `localStorage`. Toda leitura e escrita vai dentro de `try/catch`, e a página funciona mesmo sem storage.
- **Salvar/Abrir:** baixa ou carrega o JSON da `entrada` (mesmo formato da seção 4). Validar ao abrir.
- **CSV:** uma linha por item com todas as colunas do resultado, separador `;` e decimal com vírgula (abre direto no Excel em pt-BR).
- **Imprimir:** `window.print()` com o CSS de impressão.

## 11. Testes e critérios de aceite

`tests/calc.test.js` carrega cada fixture, roda `calcular(entrada)` e compara cada campo de `esperado`. A tolerância é **R$ 0,01** para valores em reais e **0,0001** para fator, markup e margem. Os fixtures saíram de uma planilha cujas contas foram conferidas no Excel em 20/11/2026; se um teste falhar, o erro está no código, não no fixture.

| Fixture | Cenário | Custo total | Tributos | Faturamento (markup 1,8; câmera 1,4) |
|---|---|---|---|---|
| `courier-8-itens-valor-pago.json` | 8 itens, modo "valor pago em R$" | R$ 34.843,36 | R$ 15.526,03 | R$ 54.576,88 |
| `courier-8-itens-cambio.json` | mesmos itens, modo câmbio R$ 5,87 + IOF 3,5% | R$ 36.742,26 | R$ 15.735,80 | R$ 57.565,15 |

Testes extras:
- `taxaSiscomex(1)` = 154,23 e `taxaSiscomex(5)` = 285,34;
- a conta de mão da seção 5;
- entrada inválida (qtd 0, FOB negativo, câmbio vazio) devolve erro legível, sem `NaN` na tela.

**Aceite do v1:**
- [ ] `npm test` passa e o workflow de CI fica verde.
- [ ] Na página, os dados do fixture `courier-8-itens-valor-pago.json` geram os mesmos números.
- [ ] Mudar NCM, câmbio, frete, despesa ou markup recalcula tudo na hora.
- [ ] Funciona em 375 px de largura sem rolagem horizontal; a tabela de itens rola dentro do próprio card.
- [ ] Impressão em A4 legível.
- [ ] Nenhuma cor fora dos tokens da seção 9.
- [ ] Nenhum caminho absoluto; o site abre em `https://<usuario>.github.io/<repo>/`.

## 12. GitHub

- **Repositório dedicado,** nome sugerido `calculadora-importacao`.
- **Antes de criar, perguntar ao dono do projeto se o repositório é público ou privado.** GitHub Pages em repositório privado exige plano pago. Não criar nem dar push sem essa resposta.
- **Nada de dado da empresa no repositório:** CNPJ, endereço, nome de fornecedor ou e-mail. Os fixtures trazem só produtos, preços e premissas.
- **Publicação:**
  - Pages servido da branch `main`, pasta raiz (Settings → Pages), sem workflow de deploy.
  - `.github/workflows/test.yml` roda `node --test` em push e PR.
- **README:** o que a calculadora faz, como rodar localmente, de onde vêm as alíquotas e um aviso de que o resultado é estimativa, a confirmar com o despachante.

## 13. Fora do v1

- Regime simplificado (RTS) calculado, hoje só existe o alerta.
- Lucro Presumido e Real, com créditos de ICMS, IPI e PIS/COFINS.
- Modal marítimo, com AFRMM.
- Rateio por peso.
- Tabela de ICMS por UF e FCP.
- Modo "margem-alvo", que calcula o markup a partir da margem desejada.
- Colar itens direto de planilha.
- Histórico de simulações.
- Regras de 2027 (CBS/IBS, IPI zero).

## 14. Adendo v1.1 (21/11/2026)

Mudanças pedidas pelo dono do projeto depois do v1. Onde este adendo diverge das seções acima, vale o adendo.

- **Seção 6 (alíquotas):** além de `data/ncm.js`, o app lê `data/ncm-nomenclatura.json` (nomenclatura oficial do Siscomex) e `data/aliquotas-oficiais.json` (II pelos Anexos da Res. Gecex 272/2021, do MDIC/Camex; IPI pela TIPI), gerados por `scripts/`. Prioridade: NCM personalizada > oficial > `data/ncm.js`. Regra do II: exceções temporárias dos Anexos IV, V, VI, VIII, IX e X prevalecem sobre os Anexos I e II enquanto vigentes (nota oficial da própria planilha); Ex e quota só geram alerta. NCM fora da nomenclatura vigente continua com II/IPI em branco.
- **Seção 3.1 (itens):** cada item tem pesquisa de NCM por descrição ou código (lupa).
- **Seção 7 (câmbio):** a PTAX de venda (fechamento) do BCB é buscada sozinha ao abrir, em dólar ou euro, sem sobrescrever taxa digitada. Regra fiscal: taxa do dia útil anterior ao registro (Portaria MF 6/1999).
- **Seção 4 (modelo de dados):** campos extras em `operacao`: `moeda` ('USD' | 'EUR'; os campos `*USD` guardam o valor na moeda da operação), `paridadeUSD`, `origemParidade`, `origemCambioFiscal`, `regimeTributario` ('simples' | 'simples-hibrido'). O formato dos fixtures não mudou.
- **Premissas (seção 0):** o comprador pode estar no Simples Nacional ou no Simples híbrido (IBS/CBS fora do DAS, LC 214/2025). Em 2026 o custo é o mesmo nos dois; as regras de 2027 continuam fora (seção 13).
- **Seção 9 (logo):** os arquivos reais estão em `assets/img/`.

