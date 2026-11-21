// Regras tributárias usadas pela calculadora para operações registradas em 2026.
// Regime aduaneiro comum, comprador no Simples Nacional (sem crédito), modal aéreo/courier.
// Nenhuma alíquota fica no código: tudo o que o cálculo usa sai daqui ou de ./ncm.js.
//
// Regras de 2027 (reforma tributária: IPI zero para a maioria dos itens, CBS no lugar de
// PIS/COFINS) NÃO estão aqui. Entram depois em regras-2027.js, com fonte.

export const REGRAS_2026 = Object.freeze({
  id: 'regras-2026',
  rotulo: 'Regras vigentes em 2026',
  vigenteDesde: '2026-01-01',
  vigenteAte: '2026-12-31',

  // PIS-Importação e COFINS-Importação, regime comum, sobre o valor aduaneiro.
  pis: 0.021,
  cofins: 0.0965,

  // Taxa de utilização do Siscomex: valor por declaração + valor de cada adição, por faixa.
  // Adição = NCM distinta na declaração.
  siscomex: Object.freeze({
    porDeclaracao: 115.67,
    faixas: Object.freeze([
      Object.freeze({ de: 1, ate: 2, valor: 38.56, confirmado: true }),
      Object.freeze({ de: 3, ate: 5, valor: 30.85, confirmado: true }),
      Object.freeze({ de: 6, ate: 10, valor: 23.14, confirmado: false }),
      Object.freeze({ de: 11, ate: 20, valor: 15.42, confirmado: false }),
      Object.freeze({ de: 21, ate: 50, valor: 7.71, confirmado: false }),
      Object.freeze({ de: 51, ate: null, valor: 3.86, confirmado: false })
    ]),
    // Conferência da SPEC: 1 adição = R$ 154,23; 5 adições = R$ 285,34.
    observacao: 'Faixas a partir da 6ª adição: a confirmar na Portaria ME 4.131/2021 (valores vieram de memória, não de busca).'
  }),

  // Teto do Regime de Tributação Simplificada (RTS), em US$, sobre FOB + frete + seguro.
  // O v1 só alerta; não calcula o RTS.
  tetoRtsUSD: 3000,

  // ICMS padrão por UF de destino. Só SC está definida no v1.
  // Outras UFs ficam em branco e precisam ser preenchidas pelo usuário (o app não supõe alíquota).
  icmsPadrao: Object.freeze({ SC: 0.17 }),

  fontes: Object.freeze({
    pis: 'Alíquota geral do PIS-Importação usada na planilha de referência do projeto (conferida no Excel em 20/11/2026). Base legal citada: Lei 10.865/2004, art. 8º, I — confirmar redação vigente.',
    cofins: 'Alíquota geral da COFINS-Importação usada na planilha de referência do projeto (conferida no Excel em 20/11/2026). Base legal citada: Lei 10.865/2004, art. 8º, II — confirmar redação vigente.',
    siscomex: 'Portaria ME 4.131/2021. Declaração e 1ª a 5ª adição conferidas pela SPEC (1 adição = R$ 154,23; 5 = R$ 285,34). Demais faixas: a confirmar na Portaria ME 4.131/2021.',
    tetoRtsUSD: 'SPEC v1 (21/11/2026): teto de US$ 3.000 do regime simplificado.',
    icmsPadrao: 'SPEC v1 (21/11/2026): ICMS padrão de 17% para SC, editável na tela.'
  }),

  // Data em que as alíquotas da tabela do app (data/ncm.js, buscadorncm, não oficial) foram lidas.
  // As alíquotas oficiais (data/aliquotas-oficiais.json) têm as próprias datas e prevalecem.
  aliquotasNcmLidasEm: '2026-11-20',

  // Regime padrão de uma simulação nova (a empresa informou estar no Simples híbrido em 21/11/2026).
  regimePadrao: 'simples-hibrido',

  // Regimes do comprador. Em 2026 os dois têm o MESMO custo de importação; a diferença começa em 2027.
  regimesTributarios: Object.freeze({
    simples: Object.freeze({
      rotulo: 'Simples Nacional (tudo no DAS)',
      efeito2026: 'Todo tributo da importação é custo: II, IPI e PIS/COFINS-Importação são recolhidos fora do DAS (LC 123/2006, art. 13 §1º) e o optante não aproveita crédito (art. 23); a taxa Siscomex é paga na DUIMP; o ICMS-importação também fica fora do DAS (art. 13 §1º, XIII).'
    }),
    'simples-hibrido': Object.freeze({
      rotulo: 'Simples híbrido (IBS/CBS fora do DAS)',
      efeito2026: 'Em 2026 o custo da importação é o mesmo do Simples puro: os optantes do Simples estão fora das alíquotas-teste de CBS/IBS de 2026 (LC 214/2025, art. 348, III, "c") e a opção pelo regime regular produz efeitos a partir de 01/01/2027.',
      efeito2027: 'A partir de 01/01/2027, a CBS e o IBS pagos na importação viram crédito (LC 214/2025, art. 78); PIS/COFINS deixam de existir e o IPI muda. Essas regras entram em regras-2027.js quando a alíquota da CBS for fixada pelo Senado (o TCU enviou o cálculo de 11,3%, Acórdão 2.933/2026).',
      prazo: 'A opção feita de 01/09 a 30/10/2026 produz efeitos a partir de 01/01/2027 e pode ser cancelada de 03/11 a 20/12/2026 (Receita Federal; Resolução CGSN 194/2026).'
    })
  }),

  // Preço de venda: alíquota do DAS para revenda de mercadoria de importação própria.
  dasRevendaImportacao: 'Revenda de importação própria: segundo a Receita (Perguntas e Respostas do Simples) e a Resolução CGSN 140/2018, art. 25 §1º, o importador é equiparado a industrial para o IPI e a receita vai para o Anexo II. Confirme com o contador e use a alíquota efetiva do DAS que ele informar.',

  // Fontes dos textos de regime (lidas em 21/11/2026). A notícia da Receita foi conferida na íntegra;
  // as demais vêm da pesquisa com verificação independente (compilações e notícias oficiais).
  fontesRegimes: Object.freeze([
    Object.freeze({ rotulo: 'Receita Federal: prazos do Simples e do regime regular de IBS/CBS para 2027', url: 'https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/setembro/simples-nacional-2027-entenda-os-novos-prazos-e-faca-sua-escolha-com-consciencia-e-tranquilidade', lidoEm: '2026-11-21' }),
    Object.freeze({ rotulo: 'Receita Federal: Perguntas e Respostas do Simples Nacional', url: 'https://www8.receita.fazenda.gov.br/simplesnacional/arquivos/manual/perguntaosn.pdf', lidoEm: '2026-11-21' }),
    Object.freeze({ rotulo: 'Senado: cálculo da alíquota de referência da CBS enviado pelo TCU', url: 'https://www12.senado.leg.br/noticias/materias/2026/11/03/senado-deve-receber-calculo-da-cbs-na-proxima-terca-para-definir-aliquota', lidoEm: '2026-11-21' }),
    Object.freeze({ rotulo: 'Lei Complementar 214/2025', url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm', lidoEm: '2026-11-21' }),
    Object.freeze({ rotulo: 'Lei Complementar 123/2006', url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm', lidoEm: '2026-11-21' })
  ])
});

export const UFS = Object.freeze([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
]);
