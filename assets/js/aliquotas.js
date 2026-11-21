// Alíquotas oficiais de II e IPI por NCM (data/aliquotas-oficiais.json). Puro, sem DOM.
//
// II: Anexos da Resolução Gecex nº 272/2021 (MDIC/Camex). A regra exata de prevalência entre os
// anexos não pôde ser lida no texto oficial (Diário Oficial inacessível neste ambiente). Por
// segurança, o app sugere a MAIOR alíquota entre as que valem para a NCM inteira na data:
// Anexo II (alíquota aplicada) ou Anexo I (TEC), e as exceções temporárias sem "Ex" e sem quota.
// Exceção menor, "Ex" e quota nunca são aplicados sozinhos: viram alerta para o despachante.
//
// IPI: TIPI (Receita Federal). "NT" (não tributado) vira 0. Destaques "Ex" só geram alerta.

export const REGRA_II = 'Maior alíquota oficial válida para a NCM inteira (regra de prevalência entre anexos não confirmada no texto oficial).';

const chave = (ncm) => String(ncm ?? '').replace(/\D/g, '');
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e8 : null); // 12.6 → 0.126

function vigente(inicio, fim, dataISO) {
  if (!dataISO) return true;
  if (inicio && dataISO < inicio) return false;
  if (fim && dataISO > fim) return false;
  return true;
}

/**
 * Resolve o II de uma NCM.
 * @returns {null | {
 *   aliquota: number|null,           // fração (0,2 = 20%)
 *   origem: { anexo: string, nome: string, ato: string },
 *   candidatas: { anexo: string, nome: string, aliquota: number, ato: string, inicio?: string, fim?: string }[],
 *   menores: object[],               // candidatas válidas com alíquota menor que a sugerida
 *   exs: object[],                   // exceções com "Ex" ou quota, vigentes (não aplicadas)
 *   futuras: object[]                // exceções que ainda vão começar a valer
 * }}
 */
export function resolverII(dados, ncm, dataISO) {
  const c = chave(ncm);
  const linha = dados?.ncm?.[c];
  if (!linha) return null;
  const [tec, bitbk, anexoII, fundII] = linha;
  const nomes = dados.tec?.anexos || {};
  const candidatas = [];
  if (typeof anexoII === 'number') {
    candidatas.push({ anexo: 'II', nome: nomes.II || 'Anexo II', aliquota: pct(anexoII), ato: fundII || 'Res. Gecex nº 272/2021, Anexo II' });
  } else if (typeof tec === 'number') {
    candidatas.push({ anexo: 'I', nome: `TEC${bitbk ? ` (${bitbk})` : ''}`, aliquota: pct(tec), ato: 'Res. Gecex nº 272/2021, Anexo I' });
  }
  const exs = [];
  const futuras = [];
  for (const [anexo, ex, aliquota, inicio, fim, ato, quota, descricao] of dados.excecoes?.[c] || []) {
    const item = { anexo, nome: nomes[anexo] || `Anexo ${anexo}`, ex, aliquota: pct(aliquota), inicio, fim, ato, quota, descricao };
    if (dataISO && inicio && dataISO < inicio) { futuras.push(item); continue; }
    if (!vigente(inicio, fim, dataISO)) continue;
    if (ex === '-' && !quota) candidatas.push(item);
    else exs.push(item);
  }
  if (!candidatas.length) return { aliquota: null, origem: null, candidatas, menores: [], exs, futuras };
  // maior alíquota; no empate, a exceção temporária é citada como origem
  const escolhida = candidatas.reduce((a, b) => (b.aliquota > a.aliquota || (b.aliquota === a.aliquota && a.anexo === 'II' && b.anexo !== 'I') ? b : a));
  return {
    aliquota: escolhida.aliquota,
    origem: { anexo: escolhida.anexo, nome: escolhida.nome, ato: escolhida.ato },
    candidatas,
    menores: candidatas.filter((x) => x.aliquota < escolhida.aliquota),
    exs,
    futuras
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
