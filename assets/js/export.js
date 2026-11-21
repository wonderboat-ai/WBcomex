// Exportação: CSV (separador ";" e decimal com vírgula, abre direto no Excel pt-BR) e download.

import { csvNumero } from './format.js';

const colunas = (m) => [
  ['Item', (it, i) => String(i + 1)],
  ['Descrição', (it) => it.descricao],
  ['Código', (it) => it.codigo],
  ['NCM', (it) => it.ncm],
  ['Qtd', (it) => csvNumero(it.qtd, 2)],
  [`FOB un ${m}`, (it) => csvNumero(it.fobUnitUSD)],
  [`FOB ${m}`, (it) => csvNumero(it.fobUSD)],
  [`Frete+seguro rateado ${m}`, (it) => csvNumero(it.freteSeguroRateadoUSD)],
  [`Valor aduaneiro ${m}`, (it) => csvNumero(it.valorAduaneiroUSD)],
  ['Valor aduaneiro R$', (it) => csvNumero(it.valorAduaneiroBRL)],
  ['II %', (it) => csvNumero(it.aliquotaII * 100, 4)],
  ['II R$', (it) => csvNumero(it.ii)],
  ['IPI %', (it) => csvNumero(it.aliquotaIPI * 100, 4)],
  ['IPI R$', (it) => csvNumero(it.ipi)],
  ['PIS R$', (it) => csvNumero(it.pis)],
  ['COFINS R$', (it) => csvNumero(it.cofins)],
  ['Siscomex R$', (it) => csvNumero(it.siscomex)],
  ['Base ICMS R$', (it) => csvNumero(it.baseIcms)],
  ['ICMS R$', (it) => csvNumero(it.icms)],
  ['Tributos R$', (it) => csvNumero(it.tributos)],
  ['Pagamento R$', (it) => csvNumero(it.pagamentoBRL)],
  ['Despesas R$', (it) => csvNumero(it.despesasBRL)],
  ['Custo total R$', (it) => csvNumero(it.custoTotal)],
  ['Custo un R$', (it) => csvNumero(it.custoUnit)],
  [`Fator R$/${m} FOB`, (it) => csvNumero(it.fatorBRLporUSD, 4)],
  ['Markup', (it) => csvNumero(it.markup, 4)],
  ['Preço un R$', (it) => csvNumero(it.precoUnit)],
  ['Preço total R$', (it) => csvNumero(it.precoTotal)],
  ['Deduções un R$', (it) => csvNumero(it.deducoesUnit)],
  ['Lucro un R$', (it) => csvNumero(it.lucroUnit)],
  ['Lucro total R$', (it) => csvNumero(it.lucroTotal)],
  ['Margem %', (it) => csvNumero(it.margemLiquida * 100, 2)]
];

function celula(valor) {
  const s = String(valor ?? '');
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV com uma linha por item e todas as colunas do resultado. Começa com BOM para o Excel ler UTF-8.
 *  Os cabeçalhos usam o símbolo da moeda da operação (US$ ou €). */
export function gerarCSV(saida) {
  const COLUNAS = colunas(saida.totais?.moeda === 'EUR' ? '€' : 'US$');
  const linhas = [COLUNAS.map(([titulo]) => celula(titulo)).join(';')];
  saida.itens.forEach((it, i) => {
    linhas.push(COLUNAS.map(([, valor]) => celula(valor(it, i))).join(';'));
  });
  return `\uFEFF${linhas.join('\r\n')}\r\n`;
}

/** Dispara o download de um arquivo gerado no navegador. */
export function baixarArquivo(nome, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Nome de arquivo seguro a partir da referência e da data. */
export function nomeArquivo(referencia, data, extensao) {
  const base = [referencia, data].filter(Boolean).join('-')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `importacao-${base || 'simulacao'}.${extensao}`;
}

export function imprimir() {
  window.print();
}
