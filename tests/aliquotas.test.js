import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { resolverII, resolverIPI } from '../assets/js/aliquotas.js';
import { NCMS } from '../data/ncm.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const dados = JSON.parse(readFileSync(join(DIR, '..', 'data', 'aliquotas-oficiais.json'), 'utf8'));
const fixture = JSON.parse(readFileSync(join(DIR, 'fixtures', 'courier-8-itens-valor-pago.json'), 'utf8'));
const HOJE = '2026-11-21';
const perto = (a, b) => Math.abs(a - b) < 1e-12;

describe('dados oficiais (data/aliquotas-oficiais.json)', () => {
  test('têm fonte, arquivo, data e sha256 da TEC e da TIPI', () => {
    for (const k of ['tec', 'tipi']) {
      assert.match(dados[k].pagina, /^https:\/\/www\.gov\.br\//);
      assert.match(dados[k].arquivo, /^https:\/\/www\.gov\.br\/.*\.xlsx$/);
      assert.match(dados[k].atualizadaEm, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(dados[k].sha256, /^[0-9a-f]{64}$/);
    }
    assert.ok(Object.keys(dados.ncm).length > 9000);
  });
});

describe('II e IPI das 8 NCMs da SPEC batem com a tabela atual (exceto onde há exceção menor)', () => {
  for (const n of NCMS) {
    test(n.ncm, () => {
      const ii = resolverII(dados, n.ncm, HOJE);
      const ipi = resolverIPI(dados, n.ncm);
      assert.ok(perto(ii.aliquota, n.ii), `II oficial ${ii.aliquota} x tabela ${n.ii}`);
      assert.ok(perto(ipi.aliquota, n.ipi), `IPI oficial ${ipi.aliquota} x tabela ${n.ipi}`);
    });
  }
  test('as alíquotas do fixture conferem com as oficiais sugeridas', () => {
    for (const it of fixture.entrada.itens) {
      assert.ok(perto(resolverII(dados, it.ncm, HOJE).aliquota, it.ii), `II ${it.ncm}`);
      assert.ok(perto(resolverIPI(dados, it.ncm).aliquota, it.ipi), `IPI ${it.ncm}`);
    }
  });
});

describe('regra conservadora do II', () => {
  test('9014.80.10: LEBIT/BK 20% (Res. Gecex 852) prevalece sobre a TEC 12,6%', () => {
    const r = resolverII(dados, '9014.80.10', HOJE);
    assert.ok(perto(r.aliquota, 0.2));
    assert.equal(r.origem.anexo, 'VI');
    assert.match(r.origem.ato, /852/);
    assert.equal(r.menores.length, 1);
  });
  test('8544.42.00: sugere 16% (Anexo II) e aponta a LETEC de 8% como menor, sem aplicar', () => {
    const r = resolverII(dados, '8544.42.00', HOJE);
    assert.ok(perto(r.aliquota, 0.16));
    assert.equal(r.origem.anexo, 'II');
    assert.equal(r.menores.length, 1);
    assert.equal(r.menores[0].anexo, 'V');
    assert.ok(perto(r.menores[0].aliquota, 0.08));
    assert.match(r.menores[0].ato, /318/);
  });
  test('8517.62.59: LEBIT 20% para a NCM inteira; o Ex 1 a 12,6% vira alerta', () => {
    const r = resolverII(dados, '8517.62.59', HOJE);
    assert.ok(perto(r.aliquota, 0.2));
    assert.equal(r.exs.length, 1);
    assert.equal(r.exs[0].ex, '1');
    assert.ok(perto(r.exs[0].aliquota, 0.126));
    assert.match(r.exs[0].descricao, /HPNA/);
  });
  test('8525.89.29: Ex 15/16 (desabastecimento, com quota) não é aplicado', () => {
    const r = resolverII(dados, '8525.89.29', HOJE);
    assert.ok(perto(r.aliquota, 0.2));
    assert.ok(r.exs.every((x) => x.quota));
  });
  test('vigência: exceção ainda não iniciada não vale e aparece como futura', () => {
    const r = resolverII(dados, '9014.80.10', '2026-01-15'); // LEBIT 852 começa em 2026-02-06
    assert.ok(perto(r.aliquota, 0.126));
    assert.equal(r.futuras.length, 1);
  });
  test('NCM inexistente devolve null', () => {
    assert.equal(resolverII(dados, '1234.56.78', HOJE), null);
    assert.equal(resolverIPI(dados, '1234.56.78'), null);
  });
});

describe('IPI', () => {
  test('8517.62.99: 13% e destaque Ex 01 a 9,75% só como alerta', () => {
    const r = resolverIPI(dados, '8517.62.99');
    assert.ok(perto(r.aliquota, 0.13));
    assert.equal(r.exs[0].ex, '1');
    assert.ok(perto(r.exs[0].aliquota, 0.0975));
  });
  test('NT vira 0 e é sinalizado', () => {
    const nt = Object.entries(dados.ncm).find(([, l]) => l[4] === 'NT');
    assert.ok(nt, 'a TIPI tem NCMs NT');
    const r = resolverIPI(dados, nt[0]);
    assert.equal(r.aliquota, 0);
    assert.equal(r.nt, true);
  });
});
