import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumero, parsePercentual, brl, usd, pct, num, csvNumero, formatarNcm, data } from '../assets/js/format.js';

describe('parseNumero aceita pt-BR e ponto decimal', () => {
  const casos = [
    ['1.234,56', 1234.56],
    ['1234.56', 1234.56],
    ['1234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['5,79', 5.79],
    ['5.79', 5.79],
    ['1.785', 1785],
    ['0.035', 0.035],
    ['1.234.567,8', 1234567.8],
    ['R$ 18.317,33', 18317.33],
    ['US$ 103', 103],
    ['17%', 17],
    ['  42 ', 42],
    ['-10', -10]
  ];
  for (const [texto, esperado] of casos) {
    test(`"${texto}" → ${esperado}`, () => {
      assert.ok(Math.abs(parseNumero(texto) - esperado) < 1e-12);
    });
  }
  test('branco → null', () => {
    assert.equal(parseNumero(''), null);
    assert.equal(parseNumero('   '), null);
    assert.equal(parseNumero(null), null);
  });
  test('texto inválido → NaN', () => {
    assert.ok(Number.isNaN(parseNumero('abc')));
    assert.ok(Number.isNaN(parseNumero('1,2,3')));
    assert.ok(Number.isNaN(parseNumero('1.2.3')));
  });
});

describe('formatação', () => {
  test('percentual digitado vira fração', () => {
    assert.ok(Math.abs(parsePercentual('3,25') - 0.0325) < 1e-12);
    assert.equal(parsePercentual(''), null);
  });
  test('moeda e percentual pt-BR', () => {
    assert.equal(brl(34843.3612).replace(/\s/g, ' '), 'R$ 34.843,36');
    assert.equal(usd(3190).replace(/\s/g, ' '), 'US$ 3.190,00');
    assert.equal(pct(0.35444), '35,44%');
    assert.equal(num(9.95483, 4), '9,9548');
  });
  test('valor não finito vira traço, nunca NaN', () => {
    assert.equal(brl(NaN), '—');
    assert.equal(pct(undefined), '—');
    assert.equal(num(Infinity), '—');
  });
  test('CSV com vírgula decimal e sem milhar', () => {
    assert.equal(csvNumero(34843.3612), '34843,36');
    assert.equal(csvNumero(0.35444, 4), '0,3544');
  });
  test('NCM e data', () => {
    assert.equal(formatarNcm('85444200'), '8544.42.00');
    assert.equal(formatarNcm('8544.42.00'), '8544.42.00');
    assert.equal(data('2026-11-20'), '20/11/2026');
  });
});
