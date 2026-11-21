// Tabela de NCMs da calculadora. Primeira carga: só as NCMs da seção 6 da SPEC.
//
// Todas foram lidas em buscadorncm.com.br em 20/11/2026, SEM confirmação em fonte oficial
// (TEC, TIPI ou Siscomex). O site se contradiz em alguns pontos. O IPI é o "TIPI vigente"
// da mesma página. baseLegalII é o ato que a página cita, copiado sem generalizar.
//
// Nunca completar esta tabela de memória. NCM nova entra com fonte e data de leitura,
// ou pela interface como "personalizada" (fica só no localStorage do navegador).

const FONTE = 'buscadorncm.com.br (não oficial)';
const LIDO_EM = '2026-11-20';

export const NCMS = Object.freeze([
  {
    ncm: '9014.80.10',
    descricao: 'Sondas acústicas (ecobatímetros) ou de ultrassom (sonar)',
    ii: 0.20,
    ipi: 0.0325,
    baseLegalII: 'LEBIT/BK, Res. Gecex 852/2026',
    fonte: FONTE,
    lidoEm: LIDO_EM,
    observacao: 'Transdutores de sonar.'
  },
  {
    ncm: '9014.90.00',
    descricao: 'Partes e acessórios de instrumentos de navegação',
    ii: 0.20,
    ipi: 0.0325,
    baseLegalII: 'LEBIT/BK, Res. Gecex 852/2026',
    fonte: FONTE,
    lidoEm: LIDO_EM,
    observacao: ''
  },
  {
    ncm: '8544.42.00',
    descricao: 'Condutores elétricos ≤ 1.000 V com peças de conexão',
    ii: 0.16,
    ipi: 0.05,
    baseLegalII: 'Anexo II (alíquota aplicada Brasil)',
    fonte: FONTE,
    lidoEm: LIDO_EM,
    observacao: 'A página também cita LETEC a 8% (Res. Gecex 318/2022), não confirmada.'
  },
  {
    ncm: '8525.89.19',
    descricao: 'Câmeras de televisão, outras',
    ii: 0.20,
    ipi: 0.20,
    baseLegalII: 'Anexo II (alíquota aplicada Brasil)',
    fonte: FONTE,
    lidoEm: LIDO_EM,
    observacao: 'Câmeras marítimas com sensor CMOS. Não usar 8525.83 (visão noturna com fotocátodo).'
  },
  {
    ncm: '8525.89.29',
    descricao: 'Câmeras digitais e câmeras de vídeo, outras',
    ii: 0.20,
    ipi: 0.15,
    baseLegalII: 'Anexo II (alíquota aplicada Brasil)',
    fonte: FONTE,
    lidoEm: LIDO_EM,
    observacao: 'A página cita Ex 15/16 a 0% (desabastecimento, Res. Gecex 962/2026) sem escopo; não aplicar.'
  },
  {
    ncm: '8517.62.59',
    descricao: 'Outros aparelhos de dados em rede com fio',
    ii: 0.20,
    ipi: 0.15,
    baseLegalII: 'LEBIT/BK, Res. Gecex 347',
    fonte: FONTE,
    lidoEm: LIDO_EM,
    observacao: 'Gateways e conversores NMEA. A página cita "Ex 1" a 12,6% (Res. Gecex 732) só para um ex específico.'
  },
  {
    ncm: '8517.62.77',
    descricao: 'Emissores com receptor digitais < 15 GHz',
    ii: 0.20,
    ipi: 0.15,
    baseLegalII: 'LEBIT/BK, Res. Gecex 852/2026',
    fonte: FONTE,
    lidoEm: LIDO_EM,
    observacao: '',
    alerta: 'Equipamento Wi‑Fi pode exigir homologação ANATEL.'
  },
  {
    ncm: '8517.62.99',
    descricao: 'Outros (8517.62)',
    ii: 0.18,
    ipi: 0.13,
    baseLegalII: 'Anexo II (alíquota aplicada Brasil)',
    fonte: FONTE,
    lidoEm: LIDO_EM,
    observacao: ''
  }
].map(Object.freeze));
