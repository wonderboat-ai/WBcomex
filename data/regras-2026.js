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

  // Data em que as alíquotas de NCM (data/ncm.js) foram lidas.
  aliquotasNcmLidasEm: '2026-11-20'
});

export const UFS = Object.freeze([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
]);
