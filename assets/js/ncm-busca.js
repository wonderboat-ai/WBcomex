// Pesquisa de NCM na nomenclatura oficial (data/ncm-nomenclatura.json). Puro, sem DOM.
// A nomenclatura traz só código e descrição: nunca alíquota.

/** Remove acentos, caixa e pontuação para comparar textos. */
export function normalizarTexto(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "85415100" → "8541.51.00" (outros comprimentos ficam como vieram). */
export function formatarCodigo(c) {
  const d = String(c ?? '').replace(/\D/g, '');
  if (d.length === 8) return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`;
  if (d.length === 6) return `${d.slice(0, 4)}.${d.slice(4)}`;
  if (d.length === 5) return `${d.slice(0, 4)}.${d.slice(4)}`;
  if (d.length === 7) return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`;
  return d;
}

const limparDescricao = (s) => String(s).replace(/<[^>]+>/g, '').replace(/^[\s\-–—]+/, '').replace(/[:;.]\s*$/, '').trim();

// Palavras muito comuns que não ajudam a achar a NCM.
const IGNORAR = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'ou', 'para', 'com', 'em', 'a', 'o', 'as', 'os', 'por', 'um', 'uma', 'kit', 'mm', 'cm', 'm']);

/**
 * Monta o índice de pesquisa: para cada NCM de 8 dígitos, a descrição própria e a cadeia
 * de descrições dos níveis acima (capítulo, posição, subposição, item).
 * @param {{ itens: [string, string][] }} nomenclatura
 * @param {{ ncm: string, texto: string }[]} [notas] textos extras por NCM (ex.: observações da
 *        tabela de alíquotas do app), usados só para achar a NCM na busca.
 */
export function montarIndice(nomenclatura, notas = []) {
  const mapa = new Map(nomenclatura.itens.map(([c, d]) => [c, d]));
  const notasPorCodigo = new Map();
  for (const n of notas) {
    const c = String(n.ncm ?? '').replace(/\D/g, '');
    if (c.length === 8 && n.texto) notasPorCodigo.set(c, `${notasPorCodigo.get(c) || ''} ${n.texto}`);
  }
  const entradas = [];
  for (const [codigo, descricao] of nomenclatura.itens) {
    if (codigo.length !== 8) continue;
    const caminho = [];
    for (const n of [2, 4, 5, 6, 7]) {
      const pai = mapa.get(codigo.slice(0, n));
      if (pai) caminho.push(limparDescricao(pai));
    }
    const propria = limparDescricao(descricao);
    entradas.push({
      codigo,
      descricao: propria,
      caminho,
      textoProprio: normalizarTexto(propria),
      // do nível mais próximo para o mais distante
      textosNiveis: caminho.slice().reverse().map(normalizarTexto),
      textoNotas: normalizarTexto(notasPorCodigo.get(codigo) || '')
    });
  }
  return { entradas, porCodigo: new Map(entradas.map((e) => [e.codigo, e])), meta: { vigencia: nomenclatura.vigencia, ato: nomenclatura.ato, fonte: nomenclatura.fonte, baixadoEm: nomenclatura.baixadoEm } };
}

/** Descrição completa de uma NCM ("Instrumentos de navegação › Outros aparelhos › Sondas acústicas…"). */
export function descricaoCompleta(entrada) {
  return [...entrada.caminho.slice(1), entrada.descricao].join(' › ');
}

/** Procura uma NCM de 8 dígitos no índice. */
export function acharNcm(indice, ncm) {
  return indice.porCodigo.get(String(ncm ?? '').replace(/\D/g, '')) || null;
}

// Peso de cada nível acima da NCM, do mais próximo (item/subposição) ao mais distante (capítulo).
const PESO_NIVEL = [3, 2, 1.5, 1, 0.5];

/**
 * Pesquisa por código (prefixo) ou por texto. No texto, cada palavra soma pontos conforme onde
 * aparece: na descrição da própria NCM, nas notas da tabela do app ou nos níveis acima (quanto
 * mais perto, mais vale). Ordena por quantidade de palavras encontradas e depois por pontos.
 * @returns {{ codigo: string, ncm: string, descricao: string, caminho: string[], pontos: number, termos: number }[]}
 */
export function buscarNcm(indice, consulta, limite = 30) {
  const q = String(consulta ?? '').trim();
  if (!q) return [];
  const digitos = q.replace(/[\s.]/g, '');
  let achados;
  if (/^\d{2,8}$/.test(digitos)) {
    achados = indice.entradas
      .filter((e) => e.codigo.startsWith(digitos))
      .map((e) => ({ e, pontos: 100 - (e.codigo.length - digitos.length), termos: 1 }));
  } else {
    const termos = [...new Set(normalizarTexto(q).split(' ').filter((t) => t.length > 1 && !IGNORAR.has(t)))];
    if (!termos.length) return [];
    const frase = termos.join(' ');
    achados = [];
    for (const e of indice.entradas) {
      let pontos = 0;
      let encontrados = 0;
      for (const t of termos) {
        let melhor = palavraNoTexto(e.textoProprio, t) * 4;
        melhor = Math.max(melhor, palavraNoTexto(e.textoNotas, t) * 3);
        e.textosNiveis.forEach((txt, i) => { melhor = Math.max(melhor, palavraNoTexto(txt, t) * PESO_NIVEL[i]); });
        if (melhor > 0) { encontrados += 1; pontos += melhor; }
      }
      if (!encontrados) continue;
      if (termos.length > 1) {
        if (e.textoProprio.includes(frase) || e.textoNotas.includes(frase)) pontos += 6;
        // todas as palavras numa mesma descrição (própria, notas ou um nível acima): bônus pela proximidade
        const todasEm = (txt) => termos.every((t) => palavraNoTexto(txt, t) > 0);
        let bonus = todasEm(e.textoProprio) ? 8 : todasEm(e.textoNotas) ? 6 : 0;
        e.textosNiveis.forEach((txt, i) => { if (todasEm(txt)) bonus = Math.max(bonus, 2 * PESO_NIVEL[i]); });
        pontos += bonus;
      }
      if (/^outr[oa]s?$/.test(e.textoProprio)) pontos -= 0.5; // "Outros" genérico vem depois
      achados.push({ e, pontos, termos: encontrados });
    }
  }
  // Com 2 ou 3 palavras, mostra só quem achou o máximo de palavras (evita ruído de uma palavra solta);
  // com 4 ou mais, aceita uma a menos.
  const maxTermos = achados.reduce((m, x) => Math.max(m, x.termos), 0);
  const nTermos = /^\d/.test(digitos) ? 1 : normalizarTexto(q).split(' ').filter((t) => t.length > 1 && !IGNORAR.has(t)).length;
  const minimo = maxTermos >= 2 ? maxTermos - (nTermos >= 4 ? 1 : 0) : 1;
  return achados
    .filter((x) => x.termos >= minimo)
    .sort((a, b) => b.termos - a.termos || b.pontos - a.pontos || a.e.codigo.localeCompare(b.e.codigo))
    .slice(0, limite)
    .map(({ e, pontos, termos }) => ({ codigo: e.codigo, ncm: formatarCodigo(e.codigo), descricao: e.descricao, caminho: e.caminho, pontos, termos }));
}

/** 2 = palavra inteira, 1 = começo de palavra (ex.: "transdut" acha "transdutores"), 0 = não achou. */
function palavraNoTexto(texto, termo) {
  if (!texto) return 0;
  const re = new RegExp(`(^| )${termo}`);
  if (!re.test(texto)) return 0;
  return new RegExp(`(^| )${termo}( |$)`).test(texto) ? 2 : 1;
}
