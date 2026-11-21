// Parse e formatação pt-BR. Sem DOM.

const LOCALE = 'pt-BR';

const fmtBRL = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtUSD = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cacheNum = new Map();

function fmtNumero(min, max) {
  const chave = `${min}-${max}`;
  if (!cacheNum.has(chave)) {
    cacheNum.set(chave, new Intl.NumberFormat(LOCALE, { minimumFractionDigits: min, maximumFractionDigits: max }));
  }
  return cacheNum.get(chave);
}

const ok = (v) => typeof v === 'number' && Number.isFinite(v);
const TRACO = '—';

/**
 * Converte texto digitado em número. Aceita "1.234,56", "1234,56", "1234.56" e "1,234.56".
 * Um único ponto seguido de exatamente 3 dígitos ("1.785") é lido como milhar (convenção pt-BR).
 * Devolve null para campo em branco e NaN para texto inválido.
 */
export function parseNumero(texto) {
  if (texto === null || texto === undefined) return null;
  if (typeof texto === 'number') return Number.isFinite(texto) ? texto : NaN;
  let s = String(texto).trim().replace(/\s|\u00a0/g, '').replace(/^(R\$|US\$|\$|€|EUR)/i, '').replace(/%$/, '');
  if (s === '') return null;
  let negativo = false;
  if (s.startsWith('-')) { negativo = true; s = s.slice(1); }
  if (!/^[\d.,]+$/.test(s)) return NaN;

  const temVirgula = s.includes(',');
  const temPonto = s.includes('.');
  if (temVirgula && temPonto) {
    const decimal = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const milhar = decimal === ',' ? '.' : ',';
    s = s.split(milhar).join('');
    if (s.split(decimal).length > 2) return NaN;
    s = s.replace(decimal, '.');
  } else if (temVirgula) {
    const partes = s.split(',');
    if (partes.length > 2) {
      if (!partes.slice(1).every((p) => p.length === 3)) return NaN;
      s = partes.join('');
    } else {
      s = partes.join('.');
    }
  } else if (temPonto) {
    const partes = s.split('.');
    if (partes.length > 2) {
      if (!partes.slice(1).every((p) => p.length === 3)) return NaN;
      s = partes.join('');
    } else if (/^[1-9]\d{0,2}\.\d{3}$/.test(s)) {
      s = partes.join('');
    }
  }
  if (s === '' || s === '.') return NaN;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return negativo ? -n : n;
}

/** Percentual digitado ("17", "3,25", "17%") para fração (0,17). */
export function parsePercentual(texto) {
  const n = parseNumero(texto);
  if (n === null || Number.isNaN(n)) return n;
  return n / 100;
}

export function brl(v) {
  return ok(v) ? fmtBRL.format(v) : TRACO;
}

export function usd(v) {
  return ok(v) ? fmtUSD.format(v) : TRACO;
}

const fmtMoeda = new Map([['USD', fmtUSD]]);
/** Valor na moeda da operação (USD ou EUR), ex.: "€ 1.234,56". */
export function dinheiro(v, moeda = 'USD') {
  if (!ok(v)) return TRACO;
  if (!fmtMoeda.has(moeda)) {
    fmtMoeda.set(moeda, new Intl.NumberFormat(LOCALE, { style: 'currency', currency: moeda, minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }
  return fmtMoeda.get(moeda).format(v);
}

/** Símbolo da moeda para rótulos ("US$", "€"). */
export function simboloMoeda(moeda = 'USD') {
  return moeda === 'EUR' ? '€' : 'US$';
}

/** Número com casas fixas (padrão 2). */
export function num(v, casas = 2, casasMax = casas) {
  return ok(v) ? fmtNumero(casas, casasMax).format(v) : TRACO;
}

/** Fração para "35,44%". */
export function pct(v, casas = 2) {
  return ok(v) ? `${fmtNumero(casas, casas).format(v * 100)}%` : TRACO;
}

/** Texto para preencher campo numérico (sem símbolo de moeda), ex.: 1785 → "1.785,00". */
export function paraCampo(v, casasMin = 2, casasMax = 4) {
  return ok(v) ? fmtNumero(casasMin, casasMax).format(v) : '';
}

/** Fração para texto de campo percentual, ex.: 0,0325 → "3,25". */
export function paraCampoPct(v) {
  return ok(v) ? fmtNumero(0, 4).format(v * 100) : '';
}

/** Número para CSV: decimal com vírgula, sem separador de milhar. */
export function csvNumero(v, casas = 2) {
  if (!ok(v)) return '';
  return v.toFixed(casas).replace('.', ',');
}

/** "2026-11-20" → "20/11/2026". */
export function data(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || TRACO;
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

/** Formata NCM de 8 dígitos como 0000.00.00; outros textos voltam como vieram. */
export function formatarNcm(texto) {
  const s = String(texto ?? '').trim();
  const d = s.replace(/\D/g, '');
  if (d.length === 8 && /^[\d.\s-]+$/.test(s)) return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`;
  return s;
}

/** Data de hoje em ISO local (AAAA-MM-DD). */
export function hojeISO(agora = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}
