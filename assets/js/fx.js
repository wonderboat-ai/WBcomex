// Busca de câmbio (opcional). O campo de câmbio fiscal é sempre digitável e é o caminho principal.
//
// Teste de CORS (SPEC, seção 7), feito no Chromium em 21/11/2026:
// - API PTAX do BCB (olinda.bcb.gov.br): responde 200 com access-control-allow-origin igual à
//   origem da página (testado com origem *.github.io e localhost). Botão "Buscar PTAX" ativo.
// - AwesomeAPI: respondeu 429 (cota excedida) sem cabeçalho CORS. Não usada.
// Se o BCB mudar a política, troque para false: a página volta a mostrar só o campo manual
// e o link para as cotações do BCB. Não usar proxy.

export const PTAX_DISPONIVEL = true;

export const LINK_COTACOES_BCB = 'https://www.bcb.gov.br/estabilidadefinanceira/historicocotacoes';

const BASE_PTAX = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/';

const pad = (n) => String(n).padStart(2, '0');
const mdY = (d) => `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()}`;

/** URL da API PTAX do BCB para os últimos `dias` dias até `ate`. */
export function urlPtax(ate = new Date(), dias = 10) {
  const ini = new Date(ate);
  ini.setDate(ini.getDate() - dias);
  return `${BASE_PTAX}CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)`
    + `?@dataInicial=%27${mdY(ini)}%27&@dataFinalCotacao=%27${mdY(ate)}%27`
    + '&$top=100&$format=json&$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao';
}

/**
 * Última PTAX de venda publicada pelo BCB.
 * @returns {Promise<{ venda: number, data: string, fonte: string }>}
 */
export async function buscarPtax(ate = new Date(), fetchFn = globalThis.fetch) {
  const resposta = await fetchFn(urlPtax(ate), { headers: { Accept: 'application/json' } });
  if (!resposta.ok) throw new Error(`BCB respondeu ${resposta.status}.`);
  const json = await resposta.json();
  const lista = Array.isArray(json?.value) ? json.value : [];
  const ultima = lista[lista.length - 1];
  if (!ultima || !Number.isFinite(ultima.cotacaoVenda)) throw new Error('BCB não retornou cotação no período.');
  return { venda: ultima.cotacaoVenda, data: String(ultima.dataHoraCotacao).slice(0, 10), fonte: 'PTAX venda · BCB' };
}
