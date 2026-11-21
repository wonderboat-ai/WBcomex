// Alíquotas oficiais de II e IPI por NCM (data/aliquotas-oficiais.json). Puro, sem DOM.
//
// II: Anexos da Resolução Gecex nº 272/2021 (MDIC/Camex). Regra de prevalência, conforme a nota
// oficial na própria planilha (aba do Anexo X, gravada em dados.tec.prevalencia): "as alterações
// temporárias do Imposto de Importação que constam dos Anexos IV, V, VI, VIII, IX e X têm
// prevalência sobre as constantes dos Anexos I e II, enquanto durar a alteração tarifária".
//  - Exceção desses anexos, vigente na data, sem "Ex" e sem quota → prevalece sobre o Anexo I/II.
//  - Mais de uma dessas exceções na mesma NCM → usa a maior e avisa (a nota não trata desse caso).
//  - Anexo XI (LETEC+) não está na nota → só é usado se for maior (conservador); se for menor, avisa.
//  - "Ex" e quota nunca são aplicados sozinhos: viram alerta para o despachante.
//
// IPI: TIPI (Receita Federal). "NT" (não tributado) vira 0. Destaques "Ex" só geram alerta.

export const ANEXOS_QUE_PREVALECEM = Object.freeze(['IV', 'V', 'VI', 'VIII', 'IX', 'X']);

export const REGRA_II = 'Exceções temporárias dos Anexos IV, V, VI, VIII, IX e X prevalecem sobre os Anexos I e II enquanto vigentes (nota oficial da planilha do MDIC). Ex-tarifário e quota não são aplicados sozinhos.';

const chave = (ncm) => String(ncm ?? '').replace(/\D/g, '');
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e8 : null); // 12.6 → 0.126
const maior = (lista) => lista.reduce((a, b) => (b.aliquota > a.aliquota ? b : a));

function vigente(inicio, fim, dataISO) {
  if (!dataISO) return true;
  if (inicio && dataISO < inicio) return false;
  if (fim && dataISO > fim) return false;
  return true;
}

/**
 * Resolve o II de uma NCM na data.
 * @returns {null | {
 *   aliquota: number|null,       // fração (0,2 = 20%)
 *   origem: { anexo, nome, ato },
 *   base: object|null,           // Anexo II (aplicada) ou Anexo I (TEC)
 *   prevaleceu: boolean,         // uma exceção temporária substituiu a base
 *   candidatas: object[],        // base + exceções válidas para a NCM inteira
 *   menores: object[],           // exceções válidas não aplicadas, com alíquota menor que a sugerida
 *   exs: object[],               // exceções com "Ex" ou quota, vigentes (não aplicadas)
 *   futuras: object[],           // exceções que ainda vão começar a valer
 *   avisos: string[]
 * }}
 */
export function resolverII(dados, ncm, dataISO) {
  const c = chave(ncm);
  const linha = dados?.ncm?.[c];
  if (!linha) return null;
  const [tec, bitbk, anexoII, fundII] = linha;
  const nomes = dados.tec?.anexos || {};
  let base = null;
  if (typeof anexoII === 'number') {
    base = { anexo: 'II', nome: nomes.II || 'Anexo II', aliquota: pct(anexoII), ato: fundII || 'Res. Gecex nº 272/2021, Anexo II' };
  } else if (typeof tec === 'number') {
    base = { anexo: 'I', nome: `TEC${bitbk ? ` (${bitbk})` : ''}`, aliquota: pct(tec), ato: 'Res. Gecex nº 272/2021, Anexo I' };
  }
  const temporarias = [];
  const outras = [];
  const exs = [];
  const futuras = [];
  for (const [anexo, ex, aliquota, inicio, fim, ato, quota, descricao] of dados.excecoes?.[c] || []) {
    const item = { anexo, nome: nomes[anexo] || `Anexo ${anexo}`, ex, aliquota: pct(aliquota), inicio, fim, ato, quota, descricao };
    if (dataISO && inicio && dataISO < inicio) { futuras.push(item); continue; }
    if (!vigente(inicio, fim, dataISO)) continue;
    if (ex !== '-' || quota) { exs.push(item); continue; }
    (ANEXOS_QUE_PREVALECEM.includes(anexo) ? temporarias : outras).push(item);
  }
  const avisos = [];
  const candidatas = [...(base ? [base] : []), ...temporarias, ...outras];
  let escolhida = base;
  let prevaleceu = false;
  if (temporarias.length) {
    escolhida = maior(temporarias);
    prevaleceu = true;
    if (new Set(temporarias.map((t) => t.aliquota)).size > 1) {
      avisos.push('Mais de uma exceção temporária vigente para a NCM: usada a maior. Confirmar com o despachante.');
    }
  }
  for (const o of outras) {
    // Anexo XI (LETEC+) não está na nota de prevalência: só substitui se for maior.
    if (!escolhida || o.aliquota > escolhida.aliquota) {
      escolhida = o;
      avisos.push(`${o.nome} (Anexo ${o.anexo}) usado por ser maior; a nota oficial de prevalência não cita este anexo.`);
    }
  }
  if (!escolhida) return { aliquota: null, origem: null, base, prevaleceu, candidatas, menores: [], exs, futuras, avisos };
  const naoAplicadas = [...temporarias, ...outras].filter((x) => x !== escolhida);
  return {
    aliquota: escolhida.aliquota,
    origem: { anexo: escolhida.anexo, nome: escolhida.nome, ato: escolhida.ato },
    base,
    prevaleceu: prevaleceu && escolhida !== base,
    candidatas,
    menores: naoAplicadas.filter((x) => x.aliquota < escolhida.aliquota),
    exs,
    futuras,
    avisos
  };
}

/**
 * Resolve o IPI de uma NCM pela TIPI.
 * @returns {null | { aliquota: number, nt: boolean, exs: { ex: string, aliquota: number|null, nt: boolean, descricao: string }[] }}
 */
export function resolverIPI(dados, ncm) {
  const c = chave(ncm);
  const linha = dados?.ncm?.[c];
  if (!linha) return null;
  const ipi = linha[4];
  if (ipi === null || ipi === undefined) return null;
  const nt = ipi === 'NT';
  return {
    aliquota: nt ? 0 : pct(ipi),
    nt,
    exs: (dados.ipiEx?.[c] || []).map(([ex, aliquota, descricao]) => ({ ex, aliquota: aliquota === 'NT' ? 0 : pct(aliquota), nt: aliquota === 'NT', descricao }))
  };
}

/** Texto curto da fonte, ex.: "MDIC/Camex (11/11/2026) · TIPI (13/02/2026)". */
export function rotuloFontes(dados) {
  const br = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
  return `II: MDIC/Camex, planilha atualizada em ${br(dados?.tec?.atualizadaEm)} · IPI: TIPI da Receita, atualizada em ${br(dados?.tipi?.atualizadaEm)}`;
}
