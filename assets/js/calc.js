// Cálculo puro da calculadora de importação (regime comum, Simples Nacional).
// Sem DOM, sem fetch, sem estado global. Entrada e saída no formato de tests/fixtures/.
// Precisão total em todos os cálculos; arredondamento só na exibição.

import { REGRAS_2026 } from '../../data/regras-2026.js';

export class ErroEntrada extends Error {
  constructor(erros) {
    super(erros.map((e) => e.mensagem).join(' '));
    this.name = 'ErroEntrada';
    this.erros = erros;
  }
}

/**
 * Taxa de utilização do Siscomex para n adições.
 * @param {number} n número de adições (NCMs distintas)
 * @param {object} [tabela] tabela no formato de REGRAS_2026.siscomex
 */
export function taxaSiscomex(n, tabela = REGRAS_2026.siscomex) {
  const adicoes = Math.floor(Number(n));
  if (!Number.isFinite(adicoes) || adicoes <= 0) return 0;
  let total = tabela.porDeclaracao;
  for (const faixa of tabela.faixas) {
    const ate = faixa.ate == null ? Infinity : faixa.ate;
    const naFaixa = Math.min(adicoes, ate) - faixa.de + 1;
    if (naFaixa > 0) total += naFaixa * faixa.valor;
  }
  return total;
}

/** Normaliza NCM para só dígitos (chave de comparação). */
export function chaveNcm(ncm) {
  return String(ncm ?? '').replace(/\D/g, '');
}

/** Moedas da invoice. Os campos *USD da entrada/saída guardam valores na moeda da operação
 *  (nome mantido por compatibilidade com o formato da SPEC v1; padrão USD). */
export const MOEDAS_ACEITAS = Object.freeze(['USD', 'EUR']);

/** Regimes do comprador. Pelas regras de 2026 o custo é o mesmo nos dois: no "híbrido"
 *  (IBS/CBS fora do DAS, LC 214/2025) a opção só produz efeitos a partir de 01/01/2027 e os
 *  optantes do Simples estão fora das alíquotas-teste de 2026 (LC 214, art. 348, III, "c"). */
export const REGIMES_ACEITOS = Object.freeze(['simples', 'simples-hibrido']);

const ehNumero = (v) => typeof v === 'number' && Number.isFinite(v);
const vazio = (v) => v === null || v === undefined || v === '';
const ouZero = (v) => (vazio(v) ? 0 : v);

function rotuloItem(item, i) {
  const nome = item?.codigo || item?.descricao;
  return nome ? `Item ${i + 1} (${nome})` : `Item ${i + 1}`;
}

/**
 * Valida a entrada. Devolve lista de erros legíveis (vazia = ok).
 * Campos opcionais em branco (seguro, deduções, despesas) contam como zero.
 */
export function validarEntrada(entrada) {
  const erros = [];
  const add = (campo, mensagem) => erros.push({ campo, mensagem });

  const op = entrada?.operacao;
  const itens = entrada?.itens;
  const pr = entrada?.precificacao;

  if (!op || typeof op !== 'object') {
    add('operacao', 'Dados da operação ausentes.');
    return erros;
  }

  if (op.regimeAduaneiro && op.regimeAduaneiro !== 'comum') {
    add('operacao.regimeAduaneiro', 'O v1 calcula só o regime aduaneiro comum.');
  }
  if (op.regimeTributario && !REGIMES_ACEITOS.includes(op.regimeTributario)) {
    add('operacao.regimeTributario', 'Regime do comprador deve ser Simples Nacional ou Simples híbrido (IBS/CBS fora do DAS).');
  }
  if (op.rateio && op.rateio !== 'fob') {
    add('operacao.rateio', 'O v1 rateia só pelo valor FOB.');
  }
  if (!vazio(op.moeda) && !MOEDAS_ACEITAS.includes(op.moeda)) {
    add('operacao.moeda', `Moeda da operação deve ser ${MOEDAS_ACEITAS.join(' ou ')}.`);
  }
  if (!vazio(op.paridadeUSD) && (!ehNumero(op.paridadeUSD) || op.paridadeUSD <= 0)) {
    add('operacao.paridadeUSD', 'Paridade US$ por unidade da moeda deve ser maior que zero.');
  }

  if (vazio(op.cambioFiscal)) add('operacao.cambioFiscal', 'Informe o câmbio fiscal (R$/US$).');
  else if (!ehNumero(op.cambioFiscal) || op.cambioFiscal <= 0) add('operacao.cambioFiscal', 'Câmbio fiscal deve ser um número maior que zero.');

  if (vazio(op.icms)) add('operacao.icms', 'Informe a alíquota de ICMS da UF de destino.');
  else if (!ehNumero(op.icms) || op.icms < 0 || op.icms >= 1) add('operacao.icms', 'ICMS deve estar entre 0% e 99,99%.');

  for (const campo of ['pis', 'cofins']) {
    if (vazio(op[campo])) add(`operacao.${campo}`, `Alíquota de ${campo.toUpperCase()} ausente.`);
    else if (!ehNumero(op[campo]) || op[campo] < 0) add(`operacao.${campo}`, `${campo.toUpperCase()} deve ser um número maior ou igual a zero.`);
  }

  for (const [campo, nome] of [['freteUSD', 'Frete'], ['seguroUSD', 'Seguro']]) {
    if (!vazio(op[campo]) && (!ehNumero(op[campo]) || op[campo] < 0)) add(`operacao.${campo}`, `${nome} deve ser um número maior ou igual a zero.`);
  }

  if (op.despesas != null && !Array.isArray(op.despesas)) add('operacao.despesas', 'Lista de despesas inválida.');
  (op.despesas || []).forEach((d, i) => {
    if (!vazio(d?.valorBRL) && (!ehNumero(d.valorBRL) || d.valorBRL < 0)) {
      add(`operacao.despesas.${i}.valorBRL`, `Despesa ${i + 1}${d?.nome ? ` (${d.nome})` : ''}: valor deve ser maior ou igual a zero.`);
    }
  });

  const pg = op.pagamento;
  if (!pg || (pg.modo !== 'cambio' && pg.modo !== 'valorPagoBRL')) {
    add('operacao.pagamento', 'Escolha o modo de pagamento: câmbio + IOF ou valor pago em R$.');
  } else if (pg.modo === 'cambio') {
    if (vazio(pg.cambioPagamento)) add('operacao.pagamento.cambioPagamento', 'Informe o câmbio do pagamento (R$/US$).');
    else if (!ehNumero(pg.cambioPagamento) || pg.cambioPagamento <= 0) add('operacao.pagamento.cambioPagamento', 'Câmbio do pagamento deve ser maior que zero.');
    if (vazio(pg.iof)) add('operacao.pagamento.iof', 'Informe o IOF do pagamento (use 0 se não houver).');
    else if (!ehNumero(pg.iof) || pg.iof < 0) add('operacao.pagamento.iof', 'IOF deve ser maior ou igual a zero.');
  } else {
    if (vazio(pg.valorPagoBRL)) add('operacao.pagamento.valorPagoBRL', 'Informe o valor total pago em R$.');
    else if (!ehNumero(pg.valorPagoBRL) || pg.valorPagoBRL <= 0) add('operacao.pagamento.valorPagoBRL', 'Valor pago em R$ deve ser maior que zero.');
  }

  if (!vazio(op.siscomexManualBRL) && (!ehNumero(op.siscomexManualBRL) || op.siscomexManualBRL < 0)) {
    add('operacao.siscomexManualBRL', 'Siscomex manual deve ser maior ou igual a zero.');
  }

  if (!Array.isArray(itens) || itens.length === 0) {
    add('itens', 'Inclua pelo menos um item.');
  } else {
    itens.forEach((item, i) => {
      const r = rotuloItem(item, i);
      if (!chaveNcm(item?.ncm)) add(`itens.${i}.ncm`, `${r}: informe a NCM.`);
      if (vazio(item?.qtd)) add(`itens.${i}.qtd`, `${r}: informe a quantidade.`);
      else if (!ehNumero(item.qtd) || item.qtd <= 0) add(`itens.${i}.qtd`, `${r}: quantidade deve ser maior que zero.`);
      if (vazio(item?.fobUnitUSD)) add(`itens.${i}.fobUnitUSD`, `${r}: informe o preço FOB unitário (US$).`);
      else if (!ehNumero(item.fobUnitUSD) || item.fobUnitUSD <= 0) add(`itens.${i}.fobUnitUSD`, `${r}: preço FOB deve ser maior que zero.`);
      for (const [campo, nome] of [['ii', 'II'], ['ipi', 'IPI']]) {
        if (vazio(item?.[campo])) add(`itens.${i}.${campo}`, `${r}: alíquota de ${nome} em branco. Preencha com a alíquota confirmada.`);
        else if (!ehNumero(item[campo]) || item[campo] < 0) add(`itens.${i}.${campo}`, `${r}: ${nome} deve ser maior ou igual a zero.`);
      }
      if (!vazio(item?.markup) && (!ehNumero(item.markup) || item.markup <= 0)) add(`itens.${i}.markup`, `${r}: markup deve ser maior que zero.`);
    });
  }

  if (!pr || typeof pr !== 'object') {
    add('precificacao', 'Dados de precificação ausentes.');
  } else {
    if (vazio(pr.markupGlobal)) add('precificacao.markupGlobal', 'Informe o markup global.');
    else if (!ehNumero(pr.markupGlobal) || pr.markupGlobal <= 0) add('precificacao.markupGlobal', 'Markup global deve ser maior que zero.');
    for (const [campo, nome] of [['impostosVenda', 'Impostos sobre a venda'], ['taxaCartao', 'Taxa de cartão'], ['comissao', 'Comissão'], ['outrasDeducoes', 'Outras deduções']]) {
      if (!vazio(pr[campo]) && (!ehNumero(pr[campo]) || pr[campo] < 0)) add(`precificacao.${campo}`, `${nome} deve ser maior ou igual a zero.`);
    }
  }

  return erros;
}

/**
 * Calcula custo nacionalizado e preço de venda item a item.
 * Lança ErroEntrada (com .erros) se a entrada for inválida.
 * @param {object} entrada formato da SPEC, seção 4
 * @param {object} [opcoes] { tabelaSiscomex }
 */
export function calcular(entrada, opcoes = {}) {
  const erros = validarEntrada(entrada);
  if (erros.length) throw new ErroEntrada(erros);

  const op = entrada.operacao;
  const pr = entrada.precificacao;
  const tabelaSiscomex = opcoes.tabelaSiscomex || REGRAS_2026.siscomex;

  const cambio = op.cambioFiscal;
  const { icms, pis, cofins } = op;
  const freteSeguroUSD = ouZero(op.freteUSD) + ouZero(op.seguroUSD);
  const despesas = op.despesas || [];
  const despesasTotal = despesas.reduce((s, d) => s + ouZero(d.valorBRL), 0);
  const despesasBaseIcms = despesas.reduce((s, d) => s + (d.baseICMS ? ouZero(d.valorBRL) : 0), 0);
  const pg = op.pagamento;

  const deducoesPct = ouZero(pr.impostosVenda) + ouZero(pr.taxaCartao) + ouZero(pr.comissao) + ouZero(pr.outrasDeducoes);

  const fobs = entrada.itens.map((it) => it.qtd * it.fobUnitUSD);
  const fobTotal = fobs.reduce((s, v) => s + v, 0);

  const adicoes = new Set(entrada.itens.map((it) => chaveNcm(it.ncm))).size;
  const siscomexAuto = taxaSiscomex(adicoes, tabelaSiscomex);
  const siscomexManual = !vazio(op.siscomexManualBRL);
  const siscomexTotal = siscomexManual ? op.siscomexManualBRL : siscomexAuto;

  // 1ª passada: valor aduaneiro (precisa do total para ratear o Siscomex).
  const base = entrada.itens.map((it, i) => {
    const fobUSD = fobs[i];
    const part = fobUSD / fobTotal;
    const freteSeguroRateadoUSD = part * freteSeguroUSD;
    const valorAduaneiroUSD = fobUSD + freteSeguroRateadoUSD;
    const valorAduaneiroBRL = valorAduaneiroUSD * cambio;
    return { fobUSD, part, freteSeguroRateadoUSD, valorAduaneiroUSD, valorAduaneiroBRL };
  });
  const vaBrlTotal = base.reduce((s, b) => s + b.valorAduaneiroBRL, 0);

  const itens = entrada.itens.map((it, i) => {
    const b = base[i];
    const va = b.valorAduaneiroBRL;

    const ii = va * it.ii;
    const ipi = (va + ii) * it.ipi;
    const pisV = va * pis;
    const cofinsV = va * cofins;
    const partVA = va / vaBrlTotal;
    const siscomex = siscomexTotal * partVA;
    const despBaseIcmsBRL = despesasBaseIcms * b.part;
    const baseIcms = (va + ii + ipi + pisV + cofinsV + siscomex + despBaseIcmsBRL) / (1 - icms);
    const icmsV = baseIcms * icms;
    const tributos = ii + ipi + pisV + cofinsV + siscomex + icmsV;

    const pagamentoBRL = pg.modo === 'cambio'
      ? b.valorAduaneiroUSD * pg.cambioPagamento * (1 + pg.iof)
      : pg.valorPagoBRL * b.part;
    const despesasBRL = despesasTotal * b.part;
    const custoTotal = pagamentoBRL + tributos + despesasBRL;
    const custoUnit = custoTotal / it.qtd;
    const fatorBRLporUSD = custoTotal / b.fobUSD;

    const markupItem = !vazio(it.markup);
    const markup = markupItem ? it.markup : pr.markupGlobal;
    const precoUnit = custoUnit * markup;
    const deducoesUnit = precoUnit * deducoesPct;
    const lucroUnit = precoUnit - custoUnit - deducoesUnit;
    const margemLiquida = lucroUnit / precoUnit;

    return {
      codigo: it.codigo ?? '',
      descricao: it.descricao ?? '',
      ncm: it.ncm,
      qtd: it.qtd,
      fobUnitUSD: it.fobUnitUSD,
      aliquotaII: it.ii,
      aliquotaIPI: it.ipi,
      fobUSD: b.fobUSD,
      participacao: b.part,
      participacaoVA: partVA,
      freteSeguroRateadoUSD: b.freteSeguroRateadoUSD,
      valorAduaneiroUSD: b.valorAduaneiroUSD,
      valorAduaneiroBRL: va,
      ii,
      ipi,
      pis: pisV,
      cofins: cofinsV,
      siscomex,
      despesasBaseIcmsBRL: despBaseIcmsBRL,
      baseIcms,
      icms: icmsV,
      tributosFederais: ii + ipi + pisV + cofinsV + siscomex,
      tributos,
      pagamentoBRL,
      despesasBRL,
      custoTotal,
      custoUnit,
      fatorBRLporUSD,
      markup,
      markupDoItem: markupItem,
      precoUnit,
      precoTotal: precoUnit * it.qtd,
      deducoesUnit,
      lucroUnit,
      lucroTotal: lucroUnit * it.qtd,
      margemLiquida
    };
  });

  const soma = (campo) => itens.reduce((s, it) => s + it[campo], 0);
  const custoTotal = soma('custoTotal');
  const faturamento = soma('precoTotal');
  const lucro = soma('lucroTotal');

  const moeda = vazio(op.moeda) ? 'USD' : op.moeda;
  const paridadeUSD = moeda === 'USD' ? 1 : (ehNumero(op.paridadeUSD) ? op.paridadeUSD : null);
  const valorAduaneiroMoeda = soma('valorAduaneiroUSD');

  const totais = {
    regimeTributario: vazio(op.regimeTributario) ? 'simples' : op.regimeTributario,
    moeda,
    paridadeUSD,
    valorAduaneiroUSDTeto: paridadeUSD === null ? null : valorAduaneiroMoeda * paridadeUSD,
    fobUSD: fobTotal,
    adicoes,
    freteSeguroUSD,
    valorAduaneiroUSD: valorAduaneiroMoeda,
    valorAduaneiroBRL: vaBrlTotal,
    ii: soma('ii'),
    ipi: soma('ipi'),
    pis: soma('pis'),
    cofins: soma('cofins'),
    siscomex: siscomexTotal,
    siscomexAutomatico: siscomexAuto,
    siscomexManual,
    baseIcms: soma('baseIcms'),
    icms: soma('icms'),
    tributosFederais: soma('tributosFederais'),
    tributos: soma('tributos'),
    pagamentoBRL: soma('pagamentoBRL'),
    despesasBRL: despesasTotal,
    despesasBaseIcmsBRL: despesasBaseIcms,
    custoTotal,
    fatorBRLporUSD: custoTotal / fobTotal,
    deducoesPct,
    deducoes: itens.reduce((s, it) => s + it.deducoesUnit * it.qtd, 0),
    faturamento,
    lucro,
    margemMedia: faturamento > 0 ? lucro / faturamento : 0
  };

  return { itens, totais };
}

/**
 * Alertas do resumo. Não bloqueiam o cálculo.
 * @param {object} entrada
 * @param {object|null} saida resultado de calcular() ou null se a entrada for inválida
 * @param {object} ctx { tetoRtsUSD, ncms: [{ncm, ii, ipi, alerta?, personalizada?}] }
 *        ou { tetoRtsUSD, referencia: (chaveNcm) => {ii, ipi, alerta?, personalizada?, fonte?} | null }
 * @returns {{nivel:'info'|'aviso'|'erro', texto:string, item?:number}[]}
 */
export function gerarAlertas(entrada, saida, ctx = {}) {
  const alertas = [];
  const tabela = new Map((ctx.ncms || []).map((n) => [chaveNcm(n.ncm), n]));
  const referencia = typeof ctx.referencia === 'function' ? (c) => ctx.referencia(c) : (c) => tabela.get(c);
  const teto = ctx.tetoRtsUSD ?? REGRAS_2026.tetoRtsUSD;

  if (saida) {
    const va = saida.totais.valorAduaneiroUSDTeto ?? (saida.totais.moeda && saida.totais.moeda !== 'USD' ? null : saida.totais.valorAduaneiroUSD);
    if (va === null || va === undefined) {
      alertas.push({ nivel: 'aviso', texto: 'Informe a paridade em US$ para conferir o teto de US$ 3.000 do regime simplificado.' });
    } else if (va > teto) {
      alertas.push({ nivel: 'info', texto: 'Acima do teto do regime simplificado: regime comum.' });
    } else {
      alertas.push({ nivel: 'aviso', texto: 'Pode caber no regime simplificado (RTS). O v1 calcula só o regime comum.' });
    }
  }

  const pr = entrada?.precificacao || {};
  const somaDed = ouZero(pr.impostosVenda) + ouZero(pr.taxaCartao) + ouZero(pr.comissao) + ouZero(pr.outrasDeducoes);
  if (ehNumero(somaDed) && somaDed >= 1) {
    alertas.push({ nivel: 'erro', texto: 'Soma das deduções da venda ≥ 100%: revise impostos, cartão, comissão e outras.' });
  }

  (entrada?.itens || []).forEach((item, i) => {
    const r = rotuloItem(item, i);
    const chave = chaveNcm(item.ncm);
    if (!chave) return;
    const ref = referencia(chave);
    if (!ref) {
      alertas.push({ nivel: 'aviso', item: i, texto: `${r}: NCM ${item.ncm} fora da tabela. Confirmar II e IPI com o despachante.` });
    } else {
      if (ref.alerta) alertas.push({ nivel: 'aviso', item: i, texto: `${r}: ${ref.alerta}` });
      if (ref.personalizada) {
        alertas.push({ nivel: 'aviso', item: i, texto: `${r}: NCM personalizada (fonte: ${ref.fonte || 'não informada'}). Confirmar com o despachante.` });
      }
      const sobrescritas = [];
      if (ehNumero(item.ii) && !mesmaAliquota(item.ii, ref.ii)) sobrescritas.push('II');
      if (ehNumero(item.ipi) && !mesmaAliquota(item.ipi, ref.ipi)) sobrescritas.push('IPI');
      if (sobrescritas.length) {
        alertas.push({ nivel: 'aviso', item: i, texto: `${r}: ${sobrescritas.join(' e ')} sobrescrito. Confirmar com o despachante.` });
      }
    }
  });

  if (saida) {
    saida.itens.forEach((it, i) => {
      if (it.margemLiquida < 0) {
        alertas.push({ nivel: 'erro', item: i, texto: `${rotuloItem(it, i)}: margem negativa.` });
      }
    });
  }

  return alertas;
}

/** Compara alíquotas guardadas como fração, tolerando ruído de ponto flutuante. */
export function mesmaAliquota(a, b) {
  return ehNumero(a) && ehNumero(b) && Math.abs(a - b) < 1e-9;
}
