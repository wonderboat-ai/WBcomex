// Câmbio automático: PTAX do Banco Central (API Olinda), dólar e euro.
// O campo de câmbio fiscal continua sempre digitável; a busca só preenche e informa a data.
//
// Regra fiscal (Portaria MF 6/1999 e Portaria SRF 87/1999; Notícia Siscomex Importação 016/2019):
// os tributos usam a taxa de VENDA de fechamento (PTAX) do dia útil ANTERIOR ao registro da
// declaração. A última PTAX publicada é, portanto, a taxa de uma DUIMP registrada no dia útil seguinte.
//
// Teste de CORS (SPEC, seção 7), feito no Chromium em 21/11/2026:
// - API PTAX do BCB (olinda.bcb.gov.br): responde 200 com access-control-allow-origin igual à
//   origem da página (testado com origem *.github.io e localhost), para USD e EUR.
// - AwesomeAPI: respondeu 429 (cota excedida) sem cabeçalho CORS. Não usada.
// Se o BCB mudar a política, troque PTAX_DISPONIVEL para false: a página volta a mostrar só o
// campo manual e o link para as cotações do BCB. Não usar proxy.

export const PTAX_DISPONIVEL = true;

export const LINK_COTACOES_BCB = 'https://www.bcb.gov.br/estabilidadefinanceira/historicocotacoes';

export const MOEDAS = Object.freeze({
  USD: Object.freeze({ codigo: 'USD', simbolo: 'US$', nome: 'Dólar' }),
  EUR: Object.freeze({ codigo: 'EUR', simbolo: '€', nome: 'Euro' })
});

const BASE_PTAX = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/';

const pad = (n) => String(n).padStart(2, '0');

/** Data (ano, mês, dia) no fuso de Brasília, que é o calendário da PTAX. */
function partesSaoPaulo(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return { ano: p.year, mes: p.month, dia: p.day };
}
const mdY = ({ ano, mes, dia }) => `${pad(mes)}-${pad(dia)}-${ano}`; // formato exigido pela API (ISO volta vazio)

/**
 * URL da API PTAX (CotacaoMoedaPeriodo) para os últimos `dias` dias até `ate` (calendário de
 * Brasília), só com o boletim de fechamento (a PTAX do dia), do mais recente para o mais antigo.
 */
export function urlPtax(moeda = 'USD', ate = new Date(), dias = 15) {
  if (!MOEDAS[moeda]) throw new Error(`Moeda não suportada: ${moeda}`);
  const fim = partesSaoPaulo(ate);
  const iniData = new Date(Date.UTC(fim.ano, fim.mes - 1, fim.dia - dias));
  const ini = { ano: iniData.getUTCFullYear(), mes: iniData.getUTCMonth() + 1, dia: iniData.getUTCDate() };
  return `${BASE_PTAX}CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)`
    + `?@moeda=%27${moeda}%27&@dataInicial=%27${mdY(ini)}%27&@dataFinalCotacao=%27${mdY(fim)}%27`
    + "&$format=json&$filter=startswith(tipoBoletim,%27Fechamento%27)&$orderby=dataHoraCotacao%20desc&$top=5"
    + '&$select=paridadeCompra,paridadeVenda,cotacaoCompra,cotacaoVenda,dataHoraCotacao,tipoBoletim';
}

/**
 * Última PTAX (boletim de fechamento) publicada pelo BCB para a moeda.
 * paridadeUSD = quantos US$ vale 1 unidade da moeda (1 para o dólar), usada no teto do RTS.
 * @returns {Promise<{ moeda: string, venda: number, compra: number, paridadeUSD: number, data: string, fonte: string }>}
 */
export async function buscarPtax(moeda = 'USD', ate = new Date(), fetchFn = globalThis.fetch, tempoLimiteMs = 8000) {
  const controle = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controle ? setTimeout(() => controle.abort(), tempoLimiteMs) : null;
  let json;
  try {
    let resposta;
    try {
      resposta = await fetchFn(urlPtax(moeda, ate), { headers: { Accept: 'application/json' }, signal: controle?.signal });
    } catch (e) {
      throw new Error(e?.name === 'AbortError' ? 'BCB não respondeu a tempo.' : 'Sem conexão com o BCB.');
    }
    if (!resposta.ok) throw new Error(`BCB respondeu ${resposta.status}.`);
    try {
      json = await resposta.json(); // o erro 500 da API vem como '/*{...}*/', que não é JSON
    } catch (e) {
      throw new Error(e?.name === 'AbortError' || controle?.signal?.aborted ? 'BCB não respondeu a tempo.' : 'Resposta do BCB em formato inesperado.');
    }
  } finally {
    if (timer) clearTimeout(timer); // o tempo limite cobre também a leitura do corpo
  }
  const lista = (Array.isArray(json?.value) ? json.value : [])
    .filter((c) => /^Fechamento( PTAX)?$/.test(c.tipoBoletim ?? 'Fechamento') && Number.isFinite(c.cotacaoVenda)) // não 'Fechamento Interbancário'
    .sort((a, b) => String(a.dataHoraCotacao).localeCompare(String(b.dataHoraCotacao)));
  const ultima = lista[lista.length - 1];
  if (!ultima) throw new Error('BCB não retornou cotação no período.');
  const paridadeUSD = moeda === 'USD' ? 1 : ultima.paridadeVenda;
  return {
    moeda,
    venda: ultima.cotacaoVenda,
    compra: ultima.cotacaoCompra,
    paridadeUSD: Number.isFinite(paridadeUSD) ? paridadeUSD : null,
    data: String(ultima.dataHoraCotacao).slice(0, 10),
    fonte: `PTAX venda ${moeda} · BCB`
  };
}
