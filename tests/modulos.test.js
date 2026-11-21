import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { calcular } from '../assets/js/calc.js';
import { normalizarEntrada, exportarEntrada, novaEntrada } from '../assets/js/storage.js';
import { gerarCSV, nomeArquivo } from '../assets/js/export.js';
import { buscarPtax, urlPtax } from '../assets/js/fx.js';
import { REGRAS_2026 } from '../data/regras-2026.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const fixture = (nome) => JSON.parse(readFileSync(join(DIR, 'fixtures', nome), 'utf8'));

describe('abrir e salvar JSON (storage.js)', () => {
  test('aceita o fixture inteiro ({ entrada, esperado }) e calcula igual', () => {
    const fx = fixture('courier-8-itens-valor-pago.json');
    const estado = normalizarEntrada(fx, REGRAS_2026);
    assert.ok(Math.abs(calcular(estado).totais.custoTotal - 34843.36) <= 0.01);
  });

  test('salvar → abrir preserva o cálculo (modo câmbio)', () => {
    const fx = fixture('courier-8-itens-cambio.json');
    const estado = normalizarEntrada(fx.entrada, REGRAS_2026);
    const salvo = JSON.parse(JSON.stringify(exportarEntrada(estado)));
    assert.deepEqual(Object.keys(salvo.operacao.pagamento).sort(), ['cambioPagamento', 'iof', 'modo']);
    const reaberto = normalizarEntrada(salvo, REGRAS_2026);
    assert.ok(Math.abs(calcular(reaberto).totais.custoTotal - 36742.26) <= 0.01);
  });

  test('o JSON salvo tem o formato da seção 4 e não grava markup vazio', () => {
    const estado = normalizarEntrada(fixture('courier-8-itens-valor-pago.json').entrada, REGRAS_2026);
    const salvo = exportarEntrada(estado);
    assert.deepEqual(Object.keys(salvo), ['operacao', 'itens', 'precificacao']);
    assert.equal('markup' in salvo.itens[0], false);
    assert.equal(salvo.itens[2].markup, 1.4);
    assert.deepEqual(salvo.operacao.pagamento, { modo: 'valorPagoBRL', valorPagoBRL: 18317.33 });
  });

  test('arquivo inválido devolve mensagem legível', () => {
    assert.throws(() => normalizarEntrada([], REGRAS_2026), /não contém uma simulação/);
    assert.throws(() => normalizarEntrada({ operacao: {}, precificacao: {} }, REGRAS_2026), /"itens"/);
    const fx = fixture('courier-8-itens-valor-pago.json').entrada;
    assert.throws(() => normalizarEntrada({ ...fx, itens: [{ ...fx.itens[0], qtd: 'dois' }] }, REGRAS_2026), /itens\[0\]\.qtd/);
    assert.throws(() => normalizarEntrada({ ...fx, operacao: { ...fx.operacao, pagamento: { modo: 'pix' } } }, REGRAS_2026), /pagamento\.modo/);
    assert.throws(() => normalizarEntrada({ ...fx, operacao: { ...fx.operacao, regimeTributario: 'presumido' } }, REGRAS_2026), /simples/);
  });

  test('simulação nova segue os padrões da SPEC', () => {
    const e = novaEntrada(REGRAS_2026, '2026-11-21');
    assert.equal(e.operacao.uf, 'SC');
    assert.equal(e.operacao.icms, 0.17);
    assert.equal(e.operacao.seguroUSD, 0);
    assert.equal(e.precificacao.markupGlobal, 1);
    for (const campo of ['impostosVenda', 'taxaCartao', 'comissao', 'outrasDeducoes']) assert.equal(e.precificacao[campo], null);
    assert.equal(e.itens[0].ii, null, 'item novo não supõe alíquota');
  });
});

describe('CSV (export.js)', () => {
  const saida = calcular(fixture('courier-8-itens-valor-pago.json').entrada);
  const csv = gerarCSV(saida);
  const linhas = csv.replace(/^\uFEFF/, '').trim().split('\r\n');

  test('BOM, separador ";" e uma linha por item', () => {
    assert.ok(csv.startsWith('\uFEFF'));
    assert.equal(linhas.length, 1 + saida.itens.length);
    const colunas = linhas[0].split(';').length;
    for (const l of linhas) assert.equal(l.split(';').length, colunas);
  });

  test('decimal com vírgula e sem separador de milhar', () => {
    const cab = linhas[0].split(';');
    const camera = linhas[3].split(';');
    assert.equal(camera[cab.indexOf('Custo total R$')], '20352,91');
    assert.equal(camera[cab.indexOf('Markup')], '1,4000');
    assert.equal(camera[cab.indexOf('Margem %')], '19,57');
    assert.equal(camera[cab.indexOf('NCM')], '8525.89.19');
  });

  test('nome de arquivo seguro', () => {
    assert.equal(nomeArquivo('Invoice nº 123/A', '2026-11-21', 'csv'), 'importacao-Invoice-no-123-A-2026-11-21.csv');
    assert.equal(nomeArquivo('', '', 'json'), 'importacao-simulacao.json');
  });
});

describe('PTAX (fx.js)', () => {
  test('URL do dólar e do euro: datas MM-DD-AAAA entre aspas e só o boletim de fechamento', () => {
    const usd = urlPtax('USD', new Date('2026-11-21T15:00:00Z'), 10);
    assert.match(usd, /^https:\/\/olinda\.bcb\.gov\.br\/olinda\/servico\/PTAX\/versao\/v1\/odata\/CotacaoMoedaPeriodo/);
    assert.match(usd, /@moeda=%27USD%27/);
    assert.match(usd, /@dataInicial=%2711-11-2026%27/);
    assert.match(usd, /@dataFinalCotacao=%2711-21-2026%27/);
    assert.match(usd, /startswith\(tipoBoletim,%27Fechamento%27\)/);
    assert.match(usd, /\$orderby=dataHoraCotacao%20desc/);
    assert.match(urlPtax('EUR', new Date('2026-11-21T15:00:00Z')), /@moeda=%27EUR%27/);
    // 01h UTC de 22/11 ainda é 21/11 em Brasília: a data final segue o calendário de Brasília
    assert.match(urlPtax('USD', new Date('2026-11-22T01:00:00Z'), 10), /@dataFinalCotacao=%2711-21-2026%27/);
    assert.throws(() => urlPtax('GBP'), /Moeda não suportada/);
  });

  test('dólar: pega a última PTAX de venda e paridade 1', async () => {
    const fetchFalso = async () => ({
      ok: true,
      json: async () => ({ value: [
        { paridadeVenda: 1, cotacaoCompra: 5.8096, cotacaoVenda: 5.8102, dataHoraCotacao: '2026-11-18 13:08:44.271', tipoBoletim: 'Fechamento' },
        { paridadeVenda: 1, cotacaoCompra: 5.8883, cotacaoVenda: 5.8889, dataHoraCotacao: '2026-11-19 13:04:18.325', tipoBoletim: 'Fechamento' }
      ] })
    });
    const r = await buscarPtax('USD', new Date(2026, 10, 21), fetchFalso);
    assert.deepEqual(r, { moeda: 'USD', venda: 5.8889, compra: 5.8883, paridadeUSD: 1, data: '2026-11-19', fonte: 'PTAX venda USD · BCB' });
  });

  test('euro: usa a paridade de venda (US$ por €) e ignora boletins intermediários', async () => {
    const fetchFalso = async () => ({
      ok: true,
      json: async () => ({ value: [
        { paridadeVenda: 1.0967, cotacaoCompra: 6.3702, cotacaoVenda: 6.372, dataHoraCotacao: '2026-11-18 13:08:44', tipoBoletim: 'Fechamento' },
        { paridadeVenda: 1.0999, cotacaoCompra: 6.50, cotacaoVenda: 6.51, dataHoraCotacao: '2026-11-19 11:00:00', tipoBoletim: 'Intermediário' },
        { paridadeVenda: 1.0982, cotacaoCompra: 6.4659, cotacaoVenda: 6.4672, dataHoraCotacao: '2026-11-19 13:04:18', tipoBoletim: 'Fechamento' }
      ] })
    });
    const r = await buscarPtax('EUR', new Date(2026, 10, 21), fetchFalso);
    assert.equal(r.venda, 6.4672);
    assert.equal(r.paridadeUSD, 1.0982);
    assert.equal(r.data, '2026-11-19');
  });

  test('aceita o rótulo "Fechamento PTAX" (endpoint por dia)', async () => {
    const r = await buscarPtax('EUR', new Date(), async () => ({ ok: true, json: async () => ({ value: [
      { paridadeVenda: 1.0982, cotacaoCompra: 6.4659, cotacaoVenda: 6.4672, dataHoraCotacao: '2026-11-19 13:04:18', tipoBoletim: 'Fechamento PTAX' }
    ] }) }));
    assert.equal(r.venda, 6.4672);
  });

  test('ignora o boletim "Fechamento Interbancário"', async () => {
    const r = await buscarPtax('USD', new Date(), async () => ({ ok: true, json: async () => ({ value: [
      { paridadeVenda: 1, cotacaoCompra: 5.88, cotacaoVenda: 5.8889, dataHoraCotacao: '2026-11-19 13:04:18', tipoBoletim: 'Fechamento' },
      { paridadeVenda: 1, cotacaoCompra: 5.95, cotacaoVenda: 5.96, dataHoraCotacao: '2026-11-19 18:00:00', tipoBoletim: 'Fechamento Interbancário' }
    ] }) }));
    assert.equal(r.venda, 5.8889);
  });

  test('erro 500 com corpo que não é JSON e falta de rede viram mensagens legíveis', async () => {
    await assert.rejects(buscarPtax('USD', new Date(), async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } })), /formato inesperado/);
    await assert.rejects(buscarPtax('USD', new Date(), async () => { throw new TypeError('Failed to fetch'); }), /Sem conexão/);
  });

  test('erro do BCB vira exceção legível', async () => {
    await assert.rejects(buscarPtax('USD', new Date(), async () => ({ ok: false, status: 503 })), /BCB respondeu 503/);
    await assert.rejects(buscarPtax('EUR', new Date(), async () => ({ ok: true, json: async () => ({ value: [] }) })), /não retornou cotação/);
  });
});
