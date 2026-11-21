// Persistência: rascunho no localStorage, NCMs personalizadas e JSON da entrada.
// Toda leitura e escrita de storage vai em try/catch: a página funciona sem storage.

import { hojeISO, formatarNcm } from './format.js';

const CHAVE_RASCUNHO = 'wb-calc-importacao:rascunho:v1';
const CHAVE_NCMS = 'wb-calc-importacao:ncms-personalizadas:v1';

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function ler(chave) {
  try {
    const s = storage();
    const bruto = s ? s.getItem(chave) : null;
    return bruto ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
}

function gravar(chave, valor) {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(chave, JSON.stringify(valor));
    return true;
  } catch {
    return false;
  }
}

/** Item em branco: o app nunca supõe alíquota. */
export function itemVazio() {
  return { descricao: '', codigo: '', ncm: '', qtd: 1, fobUnitUSD: null, ii: null, ipi: null, markup: null };
}

/** Simulação nova com os padrões da SPEC. */
export function novaEntrada(regras, hoje = hojeISO()) {
  return {
    operacao: {
      referencia: '',
      data: hoje,
      regimeAduaneiro: 'comum',
      regimeTributario: 'simples',
      uf: 'SC',
      cambioFiscal: null,
      dataCambioFiscal: '',
      icms: regras.icmsPadrao.SC ?? null,
      pis: regras.pis,
      cofins: regras.cofins,
      freteUSD: null,
      seguroUSD: 0,
      rateio: 'fob',
      despesas: [],
      pagamento: { modo: 'cambio', cambioPagamento: null, iof: null, valorPagoBRL: null },
      siscomexManualBRL: null
    },
    itens: [itemVazio()],
    precificacao: { markupGlobal: 1, impostosVenda: null, taxaCartao: null, comissao: null, outrasDeducoes: null }
  };
}

class ErroArquivo extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroArquivo';
  }
}

/**
 * Valida e normaliza um JSON aberto pelo usuário (ou o rascunho) para o estado da tela.
 * Aceita a entrada pura (seção 4 da SPEC) ou um fixture ({ entrada, esperado }).
 * Lança ErroArquivo com mensagem legível se a estrutura estiver errada.
 */
export function normalizarEntrada(bruto, regras) {
  let obj = bruto;
  if (obj && typeof obj === 'object' && obj.entrada && !obj.operacao) obj = obj.entrada;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new ErroArquivo('O arquivo não contém uma simulação.');

  const { operacao: op, itens, precificacao: pr } = obj;
  if (!op || typeof op !== 'object') throw new ErroArquivo('Falta o bloco "operacao".');
  if (!Array.isArray(itens)) throw new ErroArquivo('Falta a lista "itens".');
  if (!pr || typeof pr !== 'object') throw new ErroArquivo('Falta o bloco "precificacao".');

  const numero = (v, campo) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    throw new ErroArquivo(`O campo "${campo}" deveria ser um número.`);
  };
  const texto = (v, campo) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    throw new ErroArquivo(`O campo "${campo}" deveria ser texto.`);
  };

  for (const [campo, esperado] of [['regimeAduaneiro', 'comum'], ['regimeTributario', 'simples'], ['rateio', 'fob']]) {
    if (op[campo] != null && op[campo] !== esperado) {
      throw new ErroArquivo(`O v1 só calcula ${campo} = "${esperado}" (o arquivo tem "${op[campo]}").`);
    }
  }

  const pg = op.pagamento;
  if (!pg || (pg.modo !== 'cambio' && pg.modo !== 'valorPagoBRL')) {
    throw new ErroArquivo('O campo "operacao.pagamento.modo" deve ser "cambio" ou "valorPagoBRL".');
  }
  if (op.despesas != null && !Array.isArray(op.despesas)) throw new ErroArquivo('O campo "operacao.despesas" deveria ser uma lista.');

  const uf = texto(op.uf, 'operacao.uf').toUpperCase() || 'SC';

  return {
    operacao: {
      referencia: texto(op.referencia, 'operacao.referencia'),
      data: texto(op.data, 'operacao.data'),
      regimeAduaneiro: 'comum',
      regimeTributario: 'simples',
      uf,
      cambioFiscal: numero(op.cambioFiscal, 'operacao.cambioFiscal'),
      dataCambioFiscal: texto(op.dataCambioFiscal, 'operacao.dataCambioFiscal'),
      icms: op.icms === undefined ? (regras.icmsPadrao[uf] ?? null) : numero(op.icms, 'operacao.icms'),
      pis: op.pis === undefined ? regras.pis : numero(op.pis, 'operacao.pis'),
      cofins: op.cofins === undefined ? regras.cofins : numero(op.cofins, 'operacao.cofins'),
      freteUSD: numero(op.freteUSD, 'operacao.freteUSD'),
      seguroUSD: numero(op.seguroUSD, 'operacao.seguroUSD') ?? 0,
      rateio: 'fob',
      despesas: (op.despesas || []).map((d, i) => {
        if (!d || typeof d !== 'object') throw new ErroArquivo(`A despesa ${i + 1} está mal formada.`);
        return {
          nome: texto(d.nome, `operacao.despesas[${i}].nome`),
          valorBRL: numero(d.valorBRL, `operacao.despesas[${i}].valorBRL`),
          baseICMS: Boolean(d.baseICMS)
        };
      }),
      pagamento: {
        modo: pg.modo,
        cambioPagamento: numero(pg.cambioPagamento, 'operacao.pagamento.cambioPagamento'),
        iof: numero(pg.iof, 'operacao.pagamento.iof'),
        valorPagoBRL: numero(pg.valorPagoBRL, 'operacao.pagamento.valorPagoBRL')
      },
      siscomexManualBRL: numero(op.siscomexManualBRL, 'operacao.siscomexManualBRL')
    },
    itens: itens.map((it, i) => {
      if (!it || typeof it !== 'object') throw new ErroArquivo(`O item ${i + 1} está mal formado.`);
      return {
        descricao: texto(it.descricao, `itens[${i}].descricao`),
        codigo: texto(it.codigo, `itens[${i}].codigo`),
        ncm: formatarNcm(texto(it.ncm, `itens[${i}].ncm`)),
        qtd: numero(it.qtd, `itens[${i}].qtd`),
        fobUnitUSD: numero(it.fobUnitUSD, `itens[${i}].fobUnitUSD`),
        ii: numero(it.ii, `itens[${i}].ii`),
        ipi: numero(it.ipi, `itens[${i}].ipi`),
        markup: numero(it.markup, `itens[${i}].markup`)
      };
    }),
    precificacao: {
      markupGlobal: numero(pr.markupGlobal, 'precificacao.markupGlobal') ?? 1,
      impostosVenda: numero(pr.impostosVenda, 'precificacao.impostosVenda'),
      taxaCartao: numero(pr.taxaCartao, 'precificacao.taxaCartao'),
      comissao: numero(pr.comissao, 'precificacao.comissao'),
      outrasDeducoes: numero(pr.outrasDeducoes, 'precificacao.outrasDeducoes')
    }
  };
}

/**
 * Estado da tela → JSON da entrada (formato da seção 4).
 * O pagamento leva só os campos do modo ativo; markup vazio do item não é gravado.
 */
export function exportarEntrada(estado) {
  const op = estado.operacao;
  const pagamento = op.pagamento.modo === 'cambio'
    ? { modo: 'cambio', cambioPagamento: op.pagamento.cambioPagamento, iof: op.pagamento.iof }
    : { modo: 'valorPagoBRL', valorPagoBRL: op.pagamento.valorPagoBRL };
  return {
    operacao: {
      referencia: op.referencia,
      data: op.data,
      regimeAduaneiro: op.regimeAduaneiro,
      regimeTributario: op.regimeTributario,
      uf: op.uf,
      cambioFiscal: op.cambioFiscal,
      dataCambioFiscal: op.dataCambioFiscal,
      icms: op.icms,
      pis: op.pis,
      cofins: op.cofins,
      freteUSD: op.freteUSD,
      seguroUSD: op.seguroUSD,
      rateio: op.rateio,
      despesas: op.despesas.map((d) => ({ nome: d.nome, valorBRL: d.valorBRL, baseICMS: Boolean(d.baseICMS) })),
      pagamento,
      siscomexManualBRL: op.siscomexManualBRL ?? null
    },
    itens: estado.itens.map((it) => {
      const saida = { descricao: it.descricao, codigo: it.codigo, ncm: it.ncm, qtd: it.qtd, fobUnitUSD: it.fobUnitUSD, ii: it.ii, ipi: it.ipi };
      if (it.markup !== null && it.markup !== undefined) saida.markup = it.markup;
      return saida;
    }),
    precificacao: { ...estado.precificacao }
  };
}

export function carregarRascunho(regras) {
  const salvo = ler(CHAVE_RASCUNHO);
  if (!salvo || !salvo.entrada) return null;
  try {
    return normalizarEntrada(salvo.entrada, regras);
  } catch {
    return null;
  }
}

export function salvarRascunho(estado) {
  return gravar(CHAVE_RASCUNHO, { versao: 1, salvoEm: new Date().toISOString(), entrada: estado });
}

/** NCMs personalizadas: [{ ncm, descricao, ii, ipi, fonte, lidoEm, observacao, personalizada: true }] */
export function carregarNcmsPersonalizadas() {
  const lista = ler(CHAVE_NCMS);
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((n) => n && typeof n.ncm === 'string' && Number.isFinite(n.ii) && Number.isFinite(n.ipi))
    .map((n) => ({ ...n, personalizada: true }));
}

export function salvarNcmsPersonalizadas(lista) {
  return gravar(CHAVE_NCMS, lista.map((n) => ({ ...n, personalizada: true })));
}

/** Lê um arquivo escolhido pelo usuário e devolve o objeto JSON. */
export function lerArquivoJSON(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new ErroArquivo('Não foi possível ler o arquivo.'));
    leitor.onload = () => {
      try {
        resolve(JSON.parse(String(leitor.result)));
      } catch {
        reject(new ErroArquivo('O arquivo não é um JSON válido.'));
      }
    };
    leitor.readAsText(arquivo, 'utf-8');
  });
}
