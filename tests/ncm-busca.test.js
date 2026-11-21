import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { montarIndice, buscarNcm, acharNcm, descricaoCompleta, normalizarTexto, formatarCodigo } from '../assets/js/ncm-busca.js';
import { compactar } from '../scripts/atualizar-ncm.mjs';
import { NCMS } from '../data/ncm.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const nomenclatura = JSON.parse(readFileSync(join(DIR, '..', 'data', 'ncm-nomenclatura.json'), 'utf8'));
const indice = montarIndice(nomenclatura, NCMS.map((n) => ({ ncm: n.ncm, texto: `${n.descricao} ${n.observacao || ''}` })));

describe('nomenclatura oficial (data/ncm-nomenclatura.json)', () => {
  test('tem fonte, vigência, ato e data de download', () => {
    assert.match(nomenclatura.fonte, /Siscomex/);
    assert.match(nomenclatura.url, /^https:\/\/portalunico\.siscomex\.gov\.br\//);
    assert.ok(nomenclatura.vigencia && nomenclatura.ato && /^\d{4}-\d{2}-\d{2}$/.test(nomenclatura.baixadoEm));
  });
  test('tem as ~10 mil NCMs de 8 dígitos e nenhuma alíquota', () => {
    assert.ok(indice.entradas.length > 9000);
    assert.ok(nomenclatura.itens.every((i) => Array.isArray(i) && i.length === 2), 'só [código, descrição]');
  });
  test('as 8 NCMs da tabela de alíquotas existem na nomenclatura vigente', () => {
    for (const n of NCMS) assert.ok(acharNcm(indice, n.ncm), `${n.ncm} não está na nomenclatura`);
  });
});

describe('pesquisa', () => {
  test('por texto acha a sonda acústica (9014.80.10)', () => {
    const r = buscarNcm(indice, 'sonda ultrassom sonar');
    assert.equal(r[0].ncm, '9014.80.10');
  });
  test('sem acento e com início de palavra ("transdut")', () => {
    const r = buscarNcm(indice, 'transdut semicondut');
    assert.ok(r.some((x) => x.ncm === '8541.51.00'));
  });
  test('por código: prefixo com ou sem pontos', () => {
    assert.ok(buscarNcm(indice, '8517.62').every((x) => x.codigo.startsWith('851762')));
    assert.equal(buscarNcm(indice, '85176277')[0].ncm, '8517.62.77');
  });
  test('câmeras de televisão: o grupo 8525.89.1x inteiro aparece no topo', () => {
    const r = buscarNcm(indice, 'cameras televisao', 15).map((x) => x.ncm);
    const grupo = r.filter((c) => c.startsWith('8525.89.1'));
    assert.ok(grupo.includes('8525.89.19') && grupo.length >= 5, r.join(', '));
  });
  test('notas da tabela do app ajudam a achar (gateway NMEA, transdutor de sonar, câmera marítima)', () => {
    assert.equal(buscarNcm(indice, 'gateway nmea')[0].ncm, '8517.62.59');
    assert.equal(buscarNcm(indice, 'transdutor sonar')[0].ncm, '9014.80.10');
    assert.equal(buscarNcm(indice, 'camera maritima')[0].ncm, '8525.89.19');
  });
  test('sem ruído de palavra solta: "câmera marítima térmica" não traz trocador de calor', () => {
    const r = buscarNcm(indice, 'camera maritima termica');
    assert.equal(r[0].ncm, '8525.89.19');
    assert.ok(!r.some((x) => x.ncm.startsWith('8419')), r.map((x) => x.ncm).join(', '));
  });
  test('palavras que não estão na nomenclatura não zeram a busca', () => {
    assert.ok(buscarNcm(indice, 'cabo condutores conexão').length > 0);
  });
  test('consulta vazia ou só palavras comuns devolve lista vazia', () => {
    assert.deepEqual(buscarNcm(indice, ''), []);
    assert.deepEqual(buscarNcm(indice, 'de para com'), []);
  });
  test('descrição completa inclui os níveis acima', () => {
    const e = acharNcm(indice, '8544.42.00');
    assert.match(descricaoCompleta(e), /›/);
  });
  test('NCM inexistente não é achada', () => {
    assert.equal(acharNcm(indice, '1234.56.78'), null);
  });
});

describe('utilitários', () => {
  test('normalizar e formatar', () => {
    assert.equal(normalizarTexto('Câmeras  de TV!'), 'cameras de tv');
    assert.equal(formatarCodigo('90148010'), '9014.80.10');
  });
  test('compactar recusa arquivo sem "Nomenclaturas"', () => {
    assert.throws(() => compactar({}), /Nomenclaturas/);
    const r = compactar({ Data_Ultima_Atualizacao_NCM: 'Vigente', Ato: 'X', Nomenclaturas: [{ Codigo: '0101.21.00', Descricao: '-- Reprodutores', Data_Fim: '31/12/9999' }] }, '2026-11-21');
    assert.deepEqual(r.itens, [['01012100', '-- Reprodutores']]);
  });
});
