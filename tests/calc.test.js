import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { calcular, taxaSiscomex, validarEntrada, gerarAlertas, ErroEntrada } from '../assets/js/calc.js';
import { REGRAS_2026 } from '../data/regras-2026.js';
import { NCMS } from '../data/ncm.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(DIR, 'fixtures');

// Tolerâncias da SPEC (seção 11): R$ 0,01 para valores em reais; 0,0001 para fator, markup e margem.
const TOL_BRL = 0.01;
const TOL_RAZAO = 0.0001;
const CAMPOS_RAZAO = new Set(['fatorBRLporUSD', 'markup', 'margemLiquida', 'margemMedia']);
const EPS = 1e-9;

function compararCampos(calculado, esperado, caminho, tolBRL) {
  for (const [campo, valorEsperado] of Object.entries(esperado)) {
    const onde = `${caminho}.${campo}`;
    const valor = calculado[campo];
    if (typeof valorEsperado === 'number') {
      assert.equal(typeof valor, 'number', `${onde}: campo ausente na saída`);
      assert.ok(Number.isFinite(valor), `${onde}: valor não finito (${valor})`);
      const tol = campo === 'adicoes' ? 0 : CAMPOS_RAZAO.has(campo) ? TOL_RAZAO : tolBRL;
      const diff = Math.abs(valor - valorEsperado);
      assert.ok(diff <= tol + EPS, `${onde}: esperado ${valorEsperado}, calculado ${valor} (diferença ${diff.toFixed(6)} > ${tol})`);
    } else {
      assert.deepEqual(valor, valorEsperado, `${onde}`);
    }
  }
}

describe('fixtures (a verdade: conferidos no Excel em 20/11/2026)', () => {
  const arquivos = readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort();

  test('os dois fixtures da SPEC existem', () => {
    assert.ok(arquivos.includes('courier-8-itens-valor-pago.json'));
    assert.ok(arquivos.includes('courier-8-itens-cambio.json'));
  });

  for (const arquivo of arquivos) {
    const fixture = JSON.parse(readFileSync(join(FIXTURES, arquivo), 'utf8'));
    const tolBRL = fixture.toleranciaBRL ?? TOL_BRL;

    describe(arquivo, () => {
      const saida = calcular(fixture.entrada);

      test('totais', () => {
        compararCampos(saida.totais, fixture.esperado.totais, 'totais', tolBRL);
      });

      fixture.esperado.itens.forEach((itemEsperado, i) => {
        test(`item ${i + 1} (${itemEsperado.codigo})`, () => {
          assert.ok(saida.itens[i], `item ${i + 1} ausente na saída`);
          compararCampos(saida.itens[i], itemEsperado, `itens[${i}]`, tolBRL);
        });
      });

      test('mesmo número de itens', () => {
        assert.equal(saida.itens.length, fixture.esperado.itens.length);
      });
    });
  }
});

describe('totais da tabela de aceite (SPEC, seção 11)', () => {
  const casos = [
    ['courier-8-itens-valor-pago.json', 34843.36, 15526.03, 54576.88],
    ['courier-8-itens-cambio.json', 36742.26, 15735.80, 57565.15]
  ];
  for (const [arquivo, custo, tributos, faturamento] of casos) {
    test(arquivo, () => {
      const { entrada } = JSON.parse(readFileSync(join(FIXTURES, arquivo), 'utf8'));
      const { totais } = calcular(entrada);
      assert.ok(Math.abs(totais.custoTotal - custo) <= TOL_BRL + EPS, `custo ${totais.custoTotal}`);
      assert.ok(Math.abs(totais.tributos - tributos) <= TOL_BRL + EPS, `tributos ${totais.tributos}`);
      assert.ok(Math.abs(totais.faturamento - faturamento) <= TOL_BRL + EPS, `faturamento ${totais.faturamento}`);
    });
  }
});

describe('taxaSiscomex', () => {
  test('1 adição = 154,23', () => {
    assert.ok(Math.abs(taxaSiscomex(1) - 154.23) < EPS);
  });
  test('5 adições = 285,34', () => {
    assert.ok(Math.abs(taxaSiscomex(5) - 285.34) < EPS);
  });
  test('0 adições = 0', () => {
    assert.equal(taxaSiscomex(0), 0);
  });
  test('faixas seguem a tabela de regras-2026.js', () => {
    const t = REGRAS_2026.siscomex;
    // 6 adições = declaração + 2×(1ª faixa) + 3×(2ª) + 1×(3ª)
    const esperado6 = t.porDeclaracao + 2 * t.faixas[0].valor + 3 * t.faixas[1].valor + 1 * t.faixas[2].valor;
    assert.ok(Math.abs(taxaSiscomex(6) - esperado6) < EPS);
    // 51 adições usa a última faixa (sem teto)
    const esperado51 = t.porDeclaracao + 2 * 38.56 + 3 * 30.85 + 5 * 23.14 + 10 * 15.42 + 30 * 7.71 + 1 * 3.86;
    assert.ok(Math.abs(taxaSiscomex(51) - esperado51) < 1e-6);
  });
  test('faixas não confirmadas estão marcadas', () => {
    const naoConfirmadas = REGRAS_2026.siscomex.faixas.filter((f) => !f.confirmado);
    assert.ok(naoConfirmadas.every((f) => f.de >= 6));
    assert.match(REGRAS_2026.siscomex.observacao, /a confirmar na Portaria ME 4\.131\/2021/);
  });
});

describe('conta de mão (SPEC, seção 5)', () => {
  // 1 item, NCM 8544.42.00, II 16%, IPI 5%; FOB US$ 500, frete US$ 50, câmbio 5,00, IOF 0, ICMS 17%.
  const entrada = {
    operacao: {
      regimeAduaneiro: 'comum', regimeTributario: 'simples', uf: 'SC',
      cambioFiscal: 5.0, icms: 0.17, pis: 0.021, cofins: 0.0965,
      freteUSD: 50, seguroUSD: 0, rateio: 'fob', despesas: [],
      pagamento: { modo: 'cambio', cambioPagamento: 5.0, iof: 0 },
      siscomexManualBRL: null
    },
    itens: [{ descricao: 'Cabo', codigo: 'X', ncm: '8544.42.00', qtd: 1, fobUnitUSD: 500, ii: 0.16, ipi: 0.05 }],
    precificacao: { markupGlobal: 1.8, impostosVenda: 0.06, taxaCartao: 0.03, comissao: null, outrasDeducoes: null }
  };
  const { itens: [it], totais } = calcular(entrada);
  const perto = (a, b, tol = TOL_BRL) => assert.ok(Math.abs(a - b) <= tol + EPS, `esperado ${b}, calculado ${a}`);

  test('tributos', () => {
    perto(it.valorAduaneiroBRL, 2750.00);
    perto(it.ii, 440.00);
    perto(it.ipi, 159.50);
    perto(it.pis, 57.75);
    perto(it.cofins, 265.38);
    perto(it.siscomex, 154.23);
  });
  test('ICMS por dentro', () => {
    perto(it.baseIcms, 4610.67);
    perto(it.icms, 783.81);
  });
  test('custo e fator', () => {
    perto(it.custoTotal, 4610.67);
    perto(it.fatorBRLporUSD, 9.22, 0.005);
    assert.equal(totais.adicoes, 1);
  });
  test('venda', () => {
    perto(it.precoUnit, 8299.20);
    perto(it.lucroUnit, 2941.61);
    perto(it.margemLiquida, 0.3544, 0.00005);
  });
});

describe('markup', () => {
  const base = () => JSON.parse(readFileSync(join(FIXTURES, 'courier-8-itens-valor-pago.json'), 'utf8')).entrada;

  test('markup do item vazio usa o global', () => {
    const e = base();
    e.precificacao.markupGlobal = 2.5;
    const s = calcular(e);
    assert.equal(s.itens[0].markup, 2.5);
    assert.equal(s.itens[2].markup, 1.4); // câmera tem markup próprio
  });
  test('markup null no item usa o global', () => {
    const e = base();
    e.itens[0].markup = null;
    assert.equal(calcular(e).itens[0].markup, 1.8);
  });
  test('markup 1,00 dá preço = custo', () => {
    const e = base();
    e.precificacao.markupGlobal = 1;
    e.itens.forEach((it) => delete it.markup);
    const s = calcular(e);
    s.itens.forEach((it) => assert.ok(Math.abs(it.precoUnit - it.custoUnit) < EPS));
  });
  test('deduções em branco contam como zero', () => {
    const e = base();
    e.precificacao.impostosVenda = null;
    e.precificacao.taxaCartao = undefined;
    const s = calcular(e);
    s.itens.forEach((it) => assert.equal(it.deducoesUnit, 0));
  });
});

describe('Siscomex manual e despesas na base do ICMS', () => {
  const base = () => JSON.parse(readFileSync(join(FIXTURES, 'courier-8-itens-valor-pago.json'), 'utf8')).entrada;

  test('siscomexManualBRL substitui o automático e é rateado pelo VA', () => {
    const e = base();
    e.operacao.siscomexManualBRL = 500;
    const s = calcular(e);
    assert.equal(s.totais.siscomex, 500);
    assert.ok(Math.abs(s.itens.reduce((a, it) => a + it.siscomex, 0) - 500) < 1e-9);
  });
  test('despesa com baseICMS entra na base, rateada pelo FOB', () => {
    const e = base();
    const sem = calcular(e);
    e.operacao.despesas[0].baseICMS = true;
    const com = calcular(e);
    const it = com.itens[0];
    const esperadoBase = sem.itens[0].baseIcms + (1000 * it.participacao) / (1 - 0.17);
    assert.ok(Math.abs(it.baseIcms - esperadoBase) < 1e-9);
    assert.ok(com.totais.icms > sem.totais.icms);
  });
});

describe('entrada inválida devolve erro legível, sem NaN', () => {
  const base = () => JSON.parse(readFileSync(join(FIXTURES, 'courier-8-itens-valor-pago.json'), 'utf8')).entrada;

  const casos = [
    ['qtd 0', (e) => { e.itens[1].qtd = 0; }, /quantidade deve ser maior que zero/],
    ['FOB negativo', (e) => { e.itens[0].fobUnitUSD = -10; }, /preço FOB deve ser maior que zero/],
    ['câmbio vazio', (e) => { e.operacao.cambioFiscal = null; }, /Informe o câmbio fiscal/],
    ['câmbio NaN', (e) => { e.operacao.cambioFiscal = NaN; }, /Câmbio fiscal deve ser um número/],
    ['II em branco (NCM fora da tabela)', (e) => { e.itens[0].ii = null; }, /alíquota de II em branco/],
    ['sem itens', (e) => { e.itens = []; }, /pelo menos um item/],
    ['ICMS em branco', (e) => { e.operacao.icms = null; }, /alíquota de ICMS/],
    ['IOF em branco no modo câmbio', (e) => { e.operacao.pagamento = { modo: 'cambio', cambioPagamento: 5.8, iof: null }; }, /IOF/]
  ];

  for (const [nome, mudar, mensagem] of casos) {
    test(nome, () => {
      const e = base();
      mudar(e);
      assert.throws(() => calcular(e), (err) => {
        assert.ok(err instanceof ErroEntrada);
        assert.match(err.message, mensagem);
        assert.ok(err.erros.length >= 1);
        assert.ok(!/NaN|undefined/.test(err.message), `mensagem com NaN/undefined: ${err.message}`);
        return true;
      });
    });
  }

  test('validarEntrada aponta o item pelo código', () => {
    const e = base();
    e.itens[1].qtd = 0;
    const erros = validarEntrada(e);
    assert.equal(erros.length, 1);
    assert.equal(erros[0].campo, 'itens.1.qtd');
    assert.match(erros[0].mensagem, /Item 2 \(A80475\)/);
  });

  test('entrada válida não tem erros', () => {
    assert.deepEqual(validarEntrada(base()), []);
  });
});

describe('alertas', () => {
  const base = () => JSON.parse(readFileSync(join(FIXTURES, 'courier-8-itens-valor-pago.json'), 'utf8')).entrada;
  const ctx = { tetoRtsUSD: REGRAS_2026.tetoRtsUSD, ncms: NCMS };

  test('fixture: acima do teto do RTS e ANATEL no gateway Wi-Fi', () => {
    const e = base();
    const textos = gerarAlertas(e, calcular(e), ctx).map((a) => a.texto);
    assert.ok(textos.includes('Acima do teto do regime simplificado: regime comum.'));
    assert.ok(textos.some((t) => /YDWG-02.*ANATEL/.test(t)));
    assert.ok(!textos.some((t) => /sobrescrito|fora da tabela/.test(t)));
  });
  test('até US$ 3.000 avisa sobre o RTS', () => {
    const e = base();
    e.itens = e.itens.slice(0, 2);
    const textos = gerarAlertas(e, calcular(e), ctx).map((a) => a.texto);
    assert.ok(textos.includes('Pode caber no regime simplificado (RTS). O v1 calcula só o regime comum.'));
  });
  test('alíquota sobrescrita e NCM fora da tabela', () => {
    const e = base();
    e.itens[0].ii = 0.14;
    e.itens[1].ncm = '1234.56.78';
    const alertas = gerarAlertas(e, calcular(e), ctx);
    assert.ok(alertas.some((a) => a.item === 0 && /II sobrescrito/.test(a.texto)));
    assert.ok(alertas.some((a) => a.item === 1 && /fora da tabela/.test(a.texto)));
  });
  test('margem negativa e deduções ≥ 100%', () => {
    const e = base();
    e.precificacao.impostosVenda = 0.7;
    e.precificacao.taxaCartao = 0.3;
    const alertas = gerarAlertas(e, calcular(e), ctx);
    assert.ok(alertas.some((a) => a.nivel === 'erro' && /deduções da venda ≥ 100%/.test(a.texto)));
    assert.ok(alertas.some((a) => a.nivel === 'erro' && /margem negativa/.test(a.texto)));
  });
});

describe('dados', () => {
  test('ncm.js: só as 8 NCMs da SPEC, todas com fonte e data', () => {
    assert.equal(NCMS.length, 8);
    for (const n of NCMS) {
      for (const campo of ['ncm', 'descricao', 'ii', 'ipi', 'baseLegalII', 'fonte', 'lidoEm']) {
        assert.ok(n[campo] !== undefined && n[campo] !== '', `${n.ncm}: ${campo}`);
      }
      assert.equal(n.fonte, 'buscadorncm.com.br (não oficial)');
      assert.equal(n.lidoEm, '2026-11-20');
    }
  });
  test('regras-2026.js: campos obrigatórios', () => {
    assert.equal(REGRAS_2026.pis, 0.021);
    assert.equal(REGRAS_2026.cofins, 0.0965);
    assert.equal(REGRAS_2026.tetoRtsUSD, 3000);
    assert.equal(REGRAS_2026.icmsPadrao.SC, 0.17);
    assert.ok(REGRAS_2026.vigenteDesde);
    assert.ok(REGRAS_2026.fontes.pis && REGRAS_2026.fontes.cofins && REGRAS_2026.fontes.siscomex);
  });
});
