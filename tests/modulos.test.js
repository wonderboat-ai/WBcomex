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
  test('URL usa datas MM-DD-AAAA entre aspas', () => {
    const url = urlPtax(new Date(2026, 10, 21), 10);
    assert.match(url, /@dataInicial=%2711-11-2026%27/);
    assert.match(url, /@dataFinalCotacao=%2711-21-2026%27/);
    assert.match(url, /^https:\/\/olinda\.bcb\.gov\.br\//);
  });

  test('pega a última PTAX de venda do período', async () => {
    const fetchFalso = async () => ({
      ok: true,
      json: async () => ({ value: [
        { cotacaoCompra: 5.61, cotacaoVenda: 5.6143, dataHoraCotacao: '2026-11-18 13:08:21.353' },
        { cotacaoCompra: 5.888, cotacaoVenda: 5.8889, dataHoraCotacao: '2026-11-19 13:04:00.000' }
      ] })
    });
    const r = await buscarPtax(new Date(2026, 10, 21), fetchFalso);
    assert.deepEqual(r, { venda: 5.8889, data: '2026-11-19', fonte: 'PTAX venda · BCB' });
  });

  test('erro do BCB vira exceção legível', async () => {
    await assert.rejects(buscarPtax(new Date(), async () => ({ ok: false, status: 503 })), /BCB respondeu 503/);
    await assert.rejects(buscarPtax(new Date(), async () => ({ ok: true, json: async () => ({ value: [] }) })), /não retornou cotação/);
  });
});
