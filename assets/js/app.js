// Interface: estado, eventos e renderização. O cálculo fica em calc.js.

import { calcular, gerarAlertas, validarEntrada, chaveNcm, mesmaAliquota, taxaSiscomex } from './calc.js';
import * as F from './format.js';
import * as S from './storage.js';
import { gerarCSV, baixarArquivo, nomeArquivo, imprimir } from './export.js';
import { PTAX_DISPONIVEL, LINK_COTACOES_BCB, buscarPtax } from './fx.js';
import { REGRAS_2026 as REGRAS, UFS } from '../../data/regras-2026.js';
import { NCMS } from '../../data/ncm.js';

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PLACEHOLDERS_DESPESA = ['Desembaraço do courier', 'Despachante', 'Armazenagem', 'Frete interno'];

// ── Estado ────────────────────────────────────────────────
let estado = S.carregarRascunho(REGRAS) ?? S.novaEntrada(REGRAS);
let personalizadas = S.carregarNcmsPersonalizadas();
let ncmAplicada = estado.itens.map((it) => chaveNcm(it.ncm)); // NCM cujas alíquotas já foram aplicadas na linha
let ultimoResultado = null;
let mostrarTodosErros = false;
let siscomexEditando = estado.operacao.siscomexManualBRL != null;
const memoriaAberta = new Set();

const tabelaNcm = () => [...NCMS, ...personalizadas];
const mapaNcm = () => new Map(tabelaNcm().map((n) => [chaveNcm(n.ncm), n]));

function ler(obj, caminho) {
  return caminho.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function gravar(obj, caminho, valor) {
  const partes = caminho.split('.');
  const ultimo = partes.pop();
  const alvo = partes.reduce((o, k) => o[k], obj);
  alvo[ultimo] = valor;
}

function converter(tipo, texto) {
  if (tipo === 'numero') return F.parseNumero(texto);
  if (tipo === 'pct') return F.parsePercentual(texto);
  return texto;
}

function textoCampo(tipo, valor, casasMax) {
  if (tipo === 'numero') return F.paraCampo(valor, casasMax === 0 ? 0 : 2, casasMax ?? 2);
  if (tipo === 'pct') return F.paraCampoPct(valor);
  return valor ?? '';
}

// ── Status ────────────────────────────────────────────────
let timerStatus;
function mostrarStatus(mensagem, erro = false) {
  const el = $('#status');
  el.textContent = mensagem;
  el.classList.toggle('erro', erro);
  clearTimeout(timerStatus);
  timerStatus = setTimeout(() => { el.textContent = ''; }, 7000);
}

// ── Campos gerais (data-bind) ─────────────────────────────
function preencherCampos() {
  for (const el of $$('[data-bind]')) {
    const caminho = el.dataset.bind;
    const tipo = el.dataset.tipo;
    const valor = ler(estado, caminho);
    if (tipo === 'radio') el.checked = el.value === valor;
    else if (tipo === 'uf') el.value = valor || 'SC';
    else el.value = textoCampo(tipo, valor, el.dataset.casas ? Number(el.dataset.casas) : undefined);
  }
  sincronizarSlider();
  mostrarModoPagamento();
  siscomexEditando = estado.operacao.siscomexManualBRL != null;
  $('#siscomex-manual').hidden = !siscomexEditando;
}

function aoDigitarCampo(ev) {
  const el = ev.target.closest('[data-bind]');
  if (!el) return;
  const { bind: caminho, tipo } = el.dataset;
  if (tipo === 'radio') {
    if (!el.checked) return;
    gravar(estado, caminho, el.value);
    mostrarModoPagamento();
  } else if (tipo === 'uf') {
    estado.operacao.uf = el.value;
    estado.operacao.icms = REGRAS.icmsPadrao[el.value] ?? null;
    const icms = $('[data-bind="operacao.icms"]');
    icms.value = textoCampo('pct', estado.operacao.icms);
  } else {
    gravar(estado, caminho, converter(tipo, el.value));
  }
  if (caminho === 'precificacao.markupGlobal') {
    sincronizarSlider();
    atualizarPlaceholdersMarkup();
  }
  atualizar();
}

function aoSairDoCampo(ev) {
  const el = ev.target.closest('[data-bind]');
  if (!el) return;
  el.dataset.tocado = '1';
  const { tipo, bind } = el.dataset;
  if (tipo === 'numero' || tipo === 'pct') {
    const v = ler(estado, bind);
    if (typeof v === 'number' && Number.isFinite(v)) el.value = textoCampo(tipo, v, el.dataset.casas ? Number(el.dataset.casas) : undefined);
  }
  atualizar({ salvar: true });
}

function mostrarModoPagamento() {
  const modo = estado.operacao.pagamento.modo;
  for (const bloco of $$('[data-modo]')) bloco.hidden = bloco.dataset.modo !== modo;
}

function sincronizarSlider() {
  const slider = $('#slider-markup');
  const v = estado.precificacao.markupGlobal;
  if (typeof v === 'number' && Number.isFinite(v)) slider.value = String(Math.min(4, Math.max(1, v)));
}

function atualizarPlaceholdersMarkup() {
  const v = estado.precificacao.markupGlobal;
  const texto = typeof v === 'number' && Number.isFinite(v) ? F.num(v, 2) : '';
  for (const el of $$('#itens-corpo input[data-campo="markup"]')) el.placeholder = texto;
}

// ── Itens ─────────────────────────────────────────────────
function htmlLinhaItem(item, i) {
  const campo = (nome, tipo, extra = '') => {
    const casas = nome === 'qtd' ? 3 : nome === 'markup' ? 2 : 2;
    const valor = tipo === 'texto' ? item[nome] ?? '' : tipo === 'pct' ? F.paraCampoPct(item[nome]) : F.paraCampo(item[nome], nome === 'qtd' ? 0 : 2, casas);
    const num = tipo !== 'texto' ? ' num-in' : '';
    const modo = tipo !== 'texto' ? ' inputmode="decimal"' : '';
    return `<input type="text" class="${num}" data-campo="${nome}" data-tipo="${tipo}" value="${esc(valor)}"${modo} autocomplete="off" ${extra}>`;
  };
  const rotulo = (txt) => `aria-label="${esc(`${txt} do item ${i + 1}`)}"`;
  return `
    <tr class="linha-item" data-i="${i}">
      <td class="celula-n">${i + 1}</td>
      <td>${campo('descricao', 'texto', `${rotulo('Descrição')} placeholder="Descrição"`)}</td>
      <td>${campo('codigo', 'texto', `${rotulo('Código')} placeholder="Código"`)}</td>
      <td>${campo('ncm', 'texto', `${rotulo('NCM')} list="lista-ncm" placeholder="0000.00.00" inputmode="numeric"`)}</td>
      <td>${campo('qtd', 'numero', rotulo('Quantidade'))}</td>
      <td>${campo('fobUnitUSD', 'numero', `${rotulo('Preço FOB unitário em US$')} placeholder="0,00"`)}</td>
      <td class="aliq" data-aliq="ii">${campo('ii', 'pct', `${rotulo('II %')} placeholder="—"`)}<button type="button" class="restaurar" data-acao="restaurar" data-alvo="ii" aria-label="Restaurar II da tabela">↺</button></td>
      <td class="aliq" data-aliq="ipi">${campo('ipi', 'pct', `${rotulo('IPI %')} placeholder="—"`)}<button type="button" class="restaurar" data-acao="restaurar" data-alvo="ipi" aria-label="Restaurar IPI da tabela">↺</button></td>
      <td>${campo('markup', 'numero', `${rotulo('Markup')} title="Vazio = usa o markup global"`)}</td>
      <td><div class="acoes">
        <button type="button" class="btn btn--icone" data-acao="duplicar" aria-label="Duplicar item ${i + 1}" title="Duplicar">⧉</button>
        <button type="button" class="btn btn--icone perigo" data-acao="remover" aria-label="Remover item ${i + 1}" title="Remover">✕</button>
      </div></td>
    </tr>
    <tr class="linha-info" data-info="${i}"><td colspan="10"></td></tr>`;
}

function renderItens() {
  $('#itens-corpo').innerHTML = estado.itens.map(htmlLinhaItem).join('');
  atualizarPlaceholdersMarkup();
}

function renderListaNcm() {
  $('#lista-ncm').innerHTML = tabelaNcm()
    .map((n) => `<option value="${esc(n.ncm)}" label="${esc(`${n.descricao} · II ${F.pct(n.ii, 2)} · IPI ${F.pct(n.ipi, 2)}${n.personalizada ? ' · personalizada' : ''}`)}"></option>`)
    .join('');
}

/** Aplica as alíquotas da tabela quando a NCM da linha muda. NCM fora da tabela deixa II e IPI em branco. */
function aplicarNcm(i, { soSeEncontrar = false } = {}) {
  const item = estado.itens[i];
  const chave = chaveNcm(item.ncm);
  if (chave === ncmAplicada[i]) return false;
  const ref = mapaNcm().get(chave);
  if (!ref && soSeEncontrar) return false;
  item.ii = ref ? ref.ii : null;
  item.ipi = ref ? ref.ipi : null;
  ncmAplicada[i] = chave;
  const tr = $(`#itens-corpo tr[data-i="${i}"]`);
  if (tr) {
    $('input[data-campo="ii"]', tr).value = F.paraCampoPct(item.ii);
    $('input[data-campo="ipi"]', tr).value = F.paraCampoPct(item.ipi);
  }
  return true;
}

function aoDigitarItem(ev) {
  const el = ev.target.closest('input[data-campo]');
  if (!el) return;
  const i = Number(el.closest('tr').dataset.i);
  const { campo, tipo } = el.dataset;
  estado.itens[i][campo] = converter(tipo, el.value);
  if (campo === 'ncm') aplicarNcm(i, { soSeEncontrar: true });
  atualizar();
}

function aoSairDoItem(ev) {
  const el = ev.target.closest('input[data-campo]');
  if (!el) return;
  el.dataset.tocado = '1';
  const i = Number(el.closest('tr').dataset.i);
  const { campo, tipo } = el.dataset;
  const item = estado.itens[i];
  if (campo === 'ncm') {
    const formatada = F.formatarNcm(el.value);
    if (formatada !== el.value) el.value = formatada;
    item.ncm = formatada;
    aplicarNcm(i);
  } else if (tipo !== 'texto') {
    const v = item[campo];
    if (typeof v === 'number' && Number.isFinite(v)) {
      el.value = tipo === 'pct' ? F.paraCampoPct(v) : F.paraCampo(v, campo === 'qtd' ? 0 : 2, campo === 'qtd' ? 3 : 2);
    }
  }
  atualizar();
}

function aoClicarItem(ev) {
  const btn = ev.target.closest('button[data-acao]');
  if (!btn) return;
  const i = Number(btn.closest('tr').dataset.i);
  const acao = btn.dataset.acao;
  if (acao === 'restaurar') {
    const ref = mapaNcm().get(chaveNcm(estado.itens[i].ncm));
    if (!ref) return;
    const alvo = btn.dataset.alvo;
    estado.itens[i][alvo] = ref[alvo];
    btn.parentElement.querySelector('input').value = F.paraCampoPct(ref[alvo]);
    atualizar();
    return;
  }
  if (acao === 'duplicar') {
    estado.itens.splice(i + 1, 0, structuredClone(estado.itens[i]));
    ncmAplicada.splice(i + 1, 0, ncmAplicada[i]);
  } else if (acao === 'remover') {
    estado.itens.splice(i, 1);
    ncmAplicada.splice(i, 1);
    if (!estado.itens.length) {
      estado.itens.push(S.itemVazio());
      ncmAplicada = [''];
    }
  }
  renderItens();
  atualizar();
  const foco = acao === 'duplicar' ? i + 1 : Math.min(i, estado.itens.length - 1);
  $(`#itens-corpo tr[data-i="${foco}"] input[data-campo="descricao"]`)?.focus();
}

function adicionarItem() {
  estado.itens.push(S.itemVazio());
  ncmAplicada.push('');
  renderItens();
  atualizar();
  $(`#itens-corpo tr[data-i="${estado.itens.length - 1}"] input[data-campo="descricao"]`)?.focus();
}

/** Marca bordas (sobrescrito, em branco, inválido) e escreve a linha de informação da NCM. */
function atualizarLinhas(errosPorCampo) {
  const mapa = mapaNcm();
  estado.itens.forEach((item, i) => {
    const tr = $(`#itens-corpo tr[data-i="${i}"]`);
    const info = $(`#itens-corpo tr[data-info="${i}"] td`);
    if (!tr || !info) return;
    const chave = chaveNcm(item.ncm);
    const ref = mapa.get(chave);

    for (const alvo of ['ii', 'ipi']) {
      const td = $(`td[data-aliq="${alvo}"]`, tr);
      const input = $('input', td);
      const v = item[alvo];
      const emBranco = v === null || v === undefined;
      const sobrescrito = Boolean(ref) && typeof v === 'number' && Number.isFinite(v) && !mesmaAliquota(v, ref[alvo]);
      input.classList.toggle('vazio-obrig', emBranco);
      input.classList.toggle('sobrescrito', sobrescrito);
      input.classList.toggle('invalido', !emBranco && errosPorCampo.has(`itens.${i}.${alvo}`));
      td.classList.toggle('tem-restaurar', sobrescrito);
      const btn = $('.restaurar', td);
      if (ref) btn.title = `Restaurar ${F.pct(ref[alvo], 2)} da tabela`;
    }
    for (const campo of ['descricao', 'codigo', 'ncm', 'qtd', 'fobUnitUSD', 'markup']) {
      const input = $(`input[data-campo="${campo}"]`, tr);
      const errado = errosPorCampo.has(`itens.${i}.${campo}`);
      const visivel = errado && (mostrarTodosErros || input.dataset.tocado === '1' || input.value.trim() !== '');
      input.classList.toggle('invalido', visivel);
      input.setAttribute('aria-invalid', String(errado));
    }

    let html;
    if (!chave) {
      html = '<span>Escolha a NCM na lista ou digite os 8 dígitos.</span>';
    } else if (ref) {
      const partes = [
        `<strong>${esc(ref.ncm)}</strong> ${esc(ref.descricao)}`,
        `II: ${esc(ref.baseLegalII || '—')}`,
        `${esc(ref.fonte)}, lida em ${esc(F.data(ref.lidoEm))}`
      ];
      if (ref.observacao) partes.push(esc(ref.observacao));
      let extra = '';
      if (ref.personalizada) extra += ' <span class="tag tag--aviso">personalizada</span>';
      if (ref.alerta) extra += ` <span class="aviso">⚠ ${esc(ref.alerta)}</span>`;
      html = partes.join(' · ') + extra;
    } else if (chave.length !== 8) {
      html = '<span class="falta">NCM incompleta: a NCM tem 8 dígitos.</span> II e IPI ficam em branco até alguém preencher.';
    } else {
      html = '<span class="falta">NCM fora da tabela.</span> II e IPI ficam em branco até alguém preencher com alíquota confirmada. <button type="button" class="btn btn--link" data-acao-ncm="abrir">Adicionar à tabela</button>';
    }
    if (info.innerHTML !== html) info.innerHTML = html;
  });
}

// ── Despesas ──────────────────────────────────────────────
function renderDespesas() {
  $('#despesas').innerHTML = estado.operacao.despesas.map((d, i) => `
    <div class="despesa" data-d="${i}">
      <input type="text" data-dcampo="nome" value="${esc(d.nome)}" placeholder="${esc(PLACEHOLDERS_DESPESA[i % PLACEHOLDERS_DESPESA.length])}" aria-label="Nome da despesa ${i + 1}" autocomplete="off">
      <input type="text" class="num-in" data-dcampo="valorBRL" value="${esc(F.paraCampo(d.valorBRL))}" placeholder="R$ 0,00" inputmode="decimal" aria-label="Valor em R$ da despesa ${i + 1}" autocomplete="off">
      <label class="despesa__base"><input type="checkbox" data-dcampo="baseICMS" ${d.baseICMS ? 'checked' : ''}> entra na base do ICMS</label>
      <button type="button" class="btn btn--icone perigo" data-dacao="remover" aria-label="Remover despesa ${i + 1}" title="Remover">✕</button>
    </div>`).join('');
}

function aoMudarDespesa(ev) {
  const el = ev.target.closest('[data-dcampo]');
  if (!el) return;
  const i = Number(el.closest('[data-d]').dataset.d);
  const d = estado.operacao.despesas[i];
  const campo = el.dataset.dcampo;
  if (campo === 'baseICMS') d.baseICMS = el.checked;
  else if (campo === 'valorBRL') d.valorBRL = F.parseNumero(el.value);
  else d.nome = el.value;
  if (ev.type === 'change' && campo === 'valorBRL' && Number.isFinite(d.valorBRL)) el.value = F.paraCampo(d.valorBRL);
  atualizar();
}

// ── Siscomex e deduções ───────────────────────────────────
function adicoesAtuais() {
  return new Set(estado.itens.map((it) => chaveNcm(it.ncm)).filter(Boolean)).size;
}

function renderSiscomex() {
  const n = adicoesAtuais();
  const auto = taxaSiscomex(n);
  const manual = estado.operacao.siscomexManualBRL;
  const usandoManual = manual !== null && manual !== undefined;
  const plural = n === 1 ? 'adição' : 'adições';
  $('#siscomex-auto').innerHTML = usandoManual
    ? `Valor digitado <span class="tag tag--aviso">manual</span><br><small>Automático seria ${esc(F.brl(auto))} (${n} ${plural})</small>`
    : `Automático: ${esc(F.brl(auto))} <small>(${n} ${plural} = NCMs distintas)</small>`;
  $('#btn-siscomex').textContent = siscomexEditando ? 'Usar automático' : 'Editar';
  const t = REGRAS.siscomex;
  $('#siscomex-obs').textContent = `Portaria ME 4.131/2021: ${F.brl(t.porDeclaracao)} por declaração + valor por adição, por faixa. Rateado pelo valor aduaneiro. ${n >= 6 ? t.observacao : 'Faixas a partir da 6ª adição: a confirmar.'}`;
}

function alternarSiscomex() {
  const op = estado.operacao;
  if (!siscomexEditando) {
    siscomexEditando = true;
    op.siscomexManualBRL = taxaSiscomex(adicoesAtuais());
    $('#siscomex-manual').hidden = false;
    const inp = $('#inp-siscomex');
    inp.value = F.paraCampo(op.siscomexManualBRL);
    inp.focus();
    inp.select();
  } else {
    siscomexEditando = false;
    op.siscomexManualBRL = null;
    $('#siscomex-manual').hidden = true;
    $('#inp-siscomex').value = '';
  }
  atualizar();
}

function renderDeducoes() {
  const p = estado.precificacao;
  const partes = [p.impostosVenda, p.taxaCartao, p.comissao, p.outrasDeducoes].map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0));
  const soma = partes.reduce((a, b) => a + b, 0);
  $('#deducoes-soma').textContent = `Soma das deduções: ${F.pct(soma)} do preço de venda.`;
}

// ── Resumo, alertas, resultados ───────────────────────────
function alertasDaTela(saida) {
  const lista = gerarAlertas(estado, saida, { tetoRtsUSD: REGRAS.tetoRtsUSD, ncms: tabelaNcm() });
  const op = estado.operacao;
  if (!mesmaAliquota(op.pis, REGRAS.pis) || !mesmaAliquota(op.cofins, REGRAS.cofins)) {
    lista.push({ nivel: 'aviso', texto: `PIS/COFINS desta simulação (${F.pct(op.pis)} / ${F.pct(op.cofins)}) diferem das ${REGRAS.rotulo.toLowerCase()} (${F.pct(REGRAS.pis)} / ${F.pct(REGRAS.cofins)}).` });
  }
  if (saida?.totais.siscomexManual) {
    lista.push({ nivel: 'info', texto: `Siscomex digitado manualmente: ${F.brl(saida.totais.siscomex)} (automático seria ${F.brl(saida.totais.siscomexAutomatico)}).` });
  }
  if (saida && saida.totais.adicoes >= 6) {
    lista.push({ nivel: 'aviso', texto: `Siscomex com ${saida.totais.adicoes} adições: faixas a partir da 6ª a confirmar na Portaria ME 4.131/2021.` });
  }
  const ordem = { erro: 0, aviso: 1, info: 2 };
  return lista.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);
}

function renderResumo(saida, erros, alertas) {
  const t = saida?.totais;
  $('#r-fob').textContent = t ? F.usd(t.fobUSD) : '—';
  $('#r-va').textContent = t ? F.usd(t.valorAduaneiroUSD) : '—';
  $('#r-custo').textContent = t ? F.brl(t.custoTotal) : '—';
  $('#r-fator').textContent = t ? F.num(t.fatorBRLporUSD, 2) : '—';
  $('#r-trib').textContent = t ? F.brl(t.tributos) : '—';
  $('#r-trib-pct').textContent = t ? `${F.pct(t.tributos / t.valorAduaneiroBRL, 1)} do valor aduaneiro` : '';
  $('#r-fat').textContent = t ? F.brl(t.faturamento) : '—';
  $('#r-lucro').textContent = t ? F.brl(t.lucro) : '—';
  $('#r-margem').textContent = t ? `margem média ${F.pct(t.margemMedia)}` : '';
  $('#m-custo').textContent = t ? F.brl(t.custoTotal) : '—';
  $('#m-fat').textContent = t ? F.brl(t.faturamento) : '—';

  const caixa = $('#r-erros');
  caixa.hidden = erros.length === 0;
  const unicos = [...new Set(erros.map((e) => e.mensagem))];
  const mostrar = unicos.slice(0, 8);
  $('#r-erros-lista').innerHTML = mostrar.map((m) => `<li>${esc(m)}</li>`).join('')
    + (unicos.length > mostrar.length ? `<li>e mais ${unicos.length - mostrar.length}.</li>` : '');

  $('#r-alertas').innerHTML = alertas.map((a) => `<li class="alerta alerta--${a.nivel}">${esc(a.texto)}</li>`).join('');
}

const n2 = (v) => F.num(v, 2);

function nomeItem(it) {
  return `<td class="item-nome">${esc(it.descricao || '—')}${it.codigo ? `<span class="cod">${esc(it.codigo)}</span>` : ''}</td>`;
}

function nomeItemCurto(it) {
  return `<td class="item-nome" title="${esc(it.descricao)}"><span class="item-curto">${esc(it.codigo || it.descricao || '—')}</span><span class="cod item-curto">NCM ${esc(it.ncm)}</span></td>`;
}

function renderResultados(saida) {
  const vazio = !saida;
  $('#res-vazio').hidden = !vazio;
  for (const id of ['#tabela-preco', '#tabela-custo']) $(id).closest('.rolagem').hidden = vazio;
  $('#sub-custo').hidden = vazio;
  if (vazio) return;
  const t = saida.totais;
  const qtdTotal = saida.itens.reduce((s, it) => s + it.qtd, 0);

  $('#preco-corpo').innerHTML = saida.itens.map((it, i) => `
    <tr class="${it.margemLiquida < 0 ? 'negativa' : ''}">
      <td>${i + 1}</td>${nomeItem(it)}<td>${esc(it.ncm)}</td>
      <td class="num">${F.num(it.qtd, 0, 3)}</td>
      <td class="num">${n2(it.custoUnit)}</td>
      <td class="num">${n2(it.fatorBRLporUSD)}</td>
      <td class="num ${it.markupDoItem ? 'mk-item' : ''}" ${it.markupDoItem ? 'title="Markup do item"' : ''}>${n2(it.markup)}</td>
      <td class="num valor-venda">${n2(it.precoUnit)}</td>
      <td class="num">${n2(it.precoTotal)}</td>
      <td class="num">${n2(it.lucroUnit)}</td>
      <td class="num">${F.pct(it.margemLiquida)}</td>
    </tr>`).join('');
  $('#preco-rodape').innerHTML = `
    <tr>
      <th scope="row" colspan="3">Total</th>
      <td class="num">${F.num(qtdTotal, 0, 3)}</td>
      <td class="num"><small>custo</small> ${n2(t.custoTotal)}</td>
      <td class="num">${n2(t.fatorBRLporUSD)}</td>
      <td class="num"></td>
      <td class="num"></td>
      <td class="num valor-venda">${n2(t.faturamento)}</td>
      <td class="num"><small>lucro</small> ${n2(t.lucro)}</td>
      <td class="num">${F.pct(t.margemMedia)}</td>
    </tr>`;

  $('#custo-corpo').innerHTML = saida.itens.map((it, i) => `
    <tr>
      <td>${i + 1}</td>${nomeItemCurto(it)}
      <td class="num">${n2(it.fobUSD)}</td>
      <td class="num">${n2(it.freteSeguroRateadoUSD)}</td>
      <td class="num">${n2(it.valorAduaneiroUSD)}</td>
      <td class="num">${n2(it.valorAduaneiroBRL)}</td>
      <td class="num">${n2(it.ii)}</td>
      <td class="num">${n2(it.ipi)}</td>
      <td class="num">${n2(it.pis)}</td>
      <td class="num">${n2(it.cofins)}</td>
      <td class="num">${n2(it.siscomex)}</td>
      <td class="num">${n2(it.icms)}</td>
      <td class="num">${n2(it.tributos)}</td>
      <td class="num">${n2(it.pagamentoBRL)}</td>
      <td class="num">${n2(it.despesasBRL)}</td>
      <td class="num valor-venda">${n2(it.custoTotal)}</td>
    </tr>`).join('');
  $('#custo-rodape').innerHTML = `
    <tr>
      <th scope="row" colspan="2">Total</th>
      <td class="num">${n2(t.fobUSD)}</td>
      <td class="num">${n2(t.freteSeguroUSD)}</td>
      <td class="num">${n2(t.valorAduaneiroUSD)}</td>
      <td class="num">${n2(t.valorAduaneiroBRL)}</td>
      <td class="num">${n2(t.ii)}</td>
      <td class="num">${n2(t.ipi)}</td>
      <td class="num">${n2(t.pis)}</td>
      <td class="num">${n2(t.cofins)}</td>
      <td class="num">${n2(t.siscomex)}</td>
      <td class="num">${n2(t.icms)}</td>
      <td class="num">${n2(t.tributos)}</td>
      <td class="num">${n2(t.pagamentoBRL)}</td>
      <td class="num">${n2(t.despesasBRL)}</td>
      <td class="num valor-venda">${n2(t.custoTotal)}</td>
    </tr>`;
}

const SERIES = [
  ['serie-merc', 'Mercadoria + frete (pagamento)', (x) => x.pagamentoBRL],
  ['serie-fed', 'Tributos federais (II, IPI, PIS, COFINS, Siscomex)', (x) => x.tributosFederais],
  ['serie-icms', 'ICMS', (x) => x.icms],
  ['serie-desp', 'Despesas', (x) => x.despesasBRL]
];

function barra(x, total, mini = false) {
  return `<div class="barra${mini ? ' barra--mini' : ''}" role="img" aria-label="${esc(SERIES.map(([, nome, f]) => `${nome}: ${F.pct(f(x) / total, 1)}`).join('; '))}">`
    + SERIES.map(([classe, nome, f]) => `<span class="${classe}" style="width:${Math.max(0, (f(x) / total) * 100).toFixed(3)}%" title="${esc(`${nome}: ${F.brl(f(x))}`)}"></span>`).join('')
    + '</div>';
}

function renderComposicao(saida) {
  const alvo = $('#composicao');
  if (!saida) {
    alvo.innerHTML = '<p class="vazio-msg">Complete os dados para ver a composição.</p>';
    return;
  }
  const t = saida.totais;
  alvo.innerHTML = barra(t, t.custoTotal)
    + `<ul class="legenda">${SERIES.map(([classe, nome, f]) => `
        <li><i class="${classe}"></i><b>${esc(nome)}</b><span class="pct">${F.pct(f(t) / t.custoTotal, 1)}</span><span class="valor">${F.brl(f(t))}</span></li>`).join('')}
      </ul>`
    + `<div class="comp-itens">${saida.itens.map((it, i) => `
        <div class="comp-item">
          <span class="comp-item__nome" title="${esc(it.descricao)}">${i + 1}. ${esc(it.codigo || it.descricao)}</span>
          ${barra(it, it.custoTotal, true)}
          <span class="comp-item__valor">${F.brl(it.custoTotal)}</span>
        </div>`).join('')}
      </div>`;
}

function linhasMemoria(it, saida) {
  const t = saida.totais;
  const op = estado.operacao;
  const p4 = (v) => F.pct(v, 4);
  const L = [
    ['FOB', `${F.num(it.qtd, 0, 3)} × US$ ${n2(it.fobUnitUSD)}`, F.usd(it.fobUSD)],
    ['Participação no FOB', `US$ ${n2(it.fobUSD)} ÷ US$ ${n2(t.fobUSD)}`, p4(it.participacao)],
    ['Frete + seguro rateado', `${p4(it.participacao)} × US$ ${n2(t.freteSeguroUSD)}`, F.usd(it.freteSeguroRateadoUSD)],
    ['Valor aduaneiro US$', 'FOB + frete + seguro rateados', F.usd(it.valorAduaneiroUSD)],
    ['Valor aduaneiro R$', `US$ ${n2(it.valorAduaneiroUSD)} × ${F.num(op.cambioFiscal, 2, 4)} (câmbio fiscal)`, F.brl(it.valorAduaneiroBRL), true],
    ['II', `VA × ${F.pct(it.aliquotaII)}`, F.brl(it.ii)],
    ['IPI', `(VA + II) × ${F.pct(it.aliquotaIPI)}`, F.brl(it.ipi)],
    ['PIS', `VA × ${F.pct(op.pis)}`, F.brl(it.pis)],
    ['COFINS', `VA × ${F.pct(op.cofins)}`, F.brl(it.cofins)],
    ['Siscomex', `${F.brl(t.siscomex)} × ${p4(it.participacaoVA)} do VA total`, F.brl(it.siscomex)]
  ];
  if (t.despesasBaseIcmsBRL > 0) {
    L.push(['Despesas na base do ICMS', `${F.brl(t.despesasBaseIcmsBRL)} × ${p4(it.participacao)}`, F.brl(it.despesasBaseIcmsBRL)]);
  }
  L.push(
    ['Base do ICMS', `(VA + II + IPI + PIS + COFINS + Siscomex${t.despesasBaseIcmsBRL > 0 ? ' + despesas na base' : ''}) ÷ (1 − ${F.pct(op.icms)})`, F.brl(it.baseIcms)],
    ['ICMS (por dentro)', `base × ${F.pct(op.icms)}`, F.brl(it.icms)],
    ['Tributos', 'II + IPI + PIS + COFINS + Siscomex + ICMS', F.brl(it.tributos), true],
    ['Pagamento', op.pagamento.modo === 'cambio'
      ? `US$ ${n2(it.valorAduaneiroUSD)} × ${F.num(op.pagamento.cambioPagamento, 2, 4)} × (1 + ${F.pct(op.pagamento.iof)} IOF)`
      : `${F.brl(op.pagamento.valorPagoBRL)} pago × ${p4(it.participacao)}`, F.brl(it.pagamentoBRL)],
    ['Despesas', `${F.brl(t.despesasBRL)} × ${p4(it.participacao)}`, F.brl(it.despesasBRL)],
    ['Custo total', 'pagamento + tributos + despesas', F.brl(it.custoTotal), true],
    ['Custo unitário', `custo total ÷ ${F.num(it.qtd, 0, 3)}`, F.brl(it.custoUnit)],
    ['Fator', `${F.brl(it.custoTotal)} ÷ US$ ${n2(it.fobUSD)} FOB`, F.num(it.fatorBRLporUSD, 4)],
    ['Markup', it.markupDoItem ? 'do item' : 'global', F.num(it.markup, 2)],
    ['Preço unitário', `custo unitário × ${F.num(it.markup, 2)}`, F.brl(it.precoUnit), true],
    ['Deduções da venda', `preço × ${F.pct(saida.totais.deducoesPct)}`, F.brl(it.deducoesUnit)],
    ['Lucro unitário', 'preço − custo − deduções', F.brl(it.lucroUnit)],
    ['Margem líquida', 'lucro ÷ preço', F.pct(it.margemLiquida), true]
  );
  return L;
}

function renderMemoria(saida) {
  const alvo = $('#memoria');
  if (!saida) {
    alvo.innerHTML = '<p class="vazio-msg">Complete os dados para ver a memória de cálculo.</p>';
    return;
  }
  alvo.innerHTML = saida.itens.map((it, i) => `
    <details class="memoria" data-m="${i}" ${memoriaAberta.has(i) ? 'open' : ''}>
      <summary>${i + 1}. ${esc(it.codigo || '')}${it.codigo && it.descricao ? ' · ' : ''}${esc(it.descricao)}
        <span>custo ${F.brl(it.custoTotal)} · preço un ${F.brl(it.precoUnit)}</span></summary>
      <div class="memoria-wrap"><table><tbody>
        ${linhasMemoria(it, saida).map(([rotulo, formula, valor, destaque]) => `<tr${destaque ? ' class="destaque"' : ''}><td>${esc(rotulo)}</td><td>${esc(formula)}</td><td>${esc(valor)}</td></tr>`).join('')}
      </tbody></table></div>
    </details>`).join('');
}

function renderImpressaoMeta(saida) {
  const op = estado.operacao;
  const pr = estado.precificacao;
  const pg = op.pagamento;
  const ded = [pr.impostosVenda, pr.taxaCartao, pr.comissao, pr.outrasDeducoes].reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  const itens = [
    ['Referência', op.referencia || '—'],
    ['Data', F.data(op.data)],
    ['UF destino · ICMS', `${op.uf} · ${F.pct(op.icms)}`],
    ['Câmbio fiscal', `${F.num(op.cambioFiscal, 2, 4)}${op.dataCambioFiscal ? ` (${F.data(op.dataCambioFiscal)})` : ''}`],
    ['Pagamento', pg.modo === 'cambio' ? `câmbio ${F.num(pg.cambioPagamento, 2, 4)} + IOF ${F.pct(pg.iof)}` : `valor pago ${F.brl(pg.valorPagoBRL)}`],
    ['Frete · seguro', `${F.usd(op.freteUSD ?? 0)} · ${F.usd(op.seguroUSD ?? 0)}`],
    ['Markup global · deduções', `${F.num(pr.markupGlobal, 2)} · ${F.pct(ded)}`],
    ['Siscomex', saida ? `${F.brl(saida.totais.siscomex)} (${saida.totais.adicoes} adições${saida.totais.siscomexManual ? ', manual' : ''})` : '—']
  ];
  $('#impressao-meta').innerHTML = itens.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
}

function marcarCamposGerais(errosPorCampo) {
  for (const el of $$('[data-bind]')) {
    if (el.type === 'radio') continue;
    const caminho = el.dataset.bind;
    const errado = errosPorCampo.has(caminho);
    const visivel = errado && (mostrarTodosErros || el.dataset.tocado === '1' || el.value.trim() !== '');
    el.classList.toggle('invalido', visivel);
    el.setAttribute('aria-invalid', String(errado));
  }
  const icms = $('[data-bind="operacao.icms"]');
  icms.classList.toggle('vazio-obrig', estado.operacao.icms === null || estado.operacao.icms === undefined);
  estado.operacao.despesas.forEach((d, i) => {
    const el = $(`#despesas [data-d="${i}"] [data-dcampo="valorBRL"]`);
    if (el) el.classList.toggle('invalido', errosPorCampo.has(`operacao.despesas.${i}.valorBRL`));
  });
}

// ── Ciclo principal ───────────────────────────────────────
let timerRascunho;
function atualizar({ salvar = true } = {}) {
  const erros = validarEntrada(estado);
  const saida = erros.length ? null : calcular(estado);
  ultimoResultado = saida;
  const errosPorCampo = new Set(erros.map((e) => e.campo));

  renderResumo(saida, erros, alertasDaTela(saida));
  renderResultados(saida);
  renderComposicao(saida);
  renderMemoria(saida);
  renderSiscomex();
  renderDeducoes();
  renderImpressaoMeta(saida);
  atualizarLinhas(errosPorCampo);
  marcarCamposGerais(errosPorCampo);

  const fobTotal = estado.itens.reduce((s, it) => s + (Number.isFinite(it.qtd) && Number.isFinite(it.fobUnitUSD) ? it.qtd * it.fobUnitUSD : 0), 0);
  $('#itens-fob-total').textContent = F.usd(fobTotal);
  const n = adicoesAtuais();
  $('#itens-adicoes').textContent = `${estado.itens.length} ${estado.itens.length === 1 ? 'item' : 'itens'} · ${n} ${n === 1 ? 'NCM distinta' : 'NCMs distintas'}`;
  $('#info-regras').textContent = `PIS ${F.pct(estado.operacao.pis)} · COFINS ${F.pct(estado.operacao.cofins)} · ${REGRAS.rotulo}. O câmbio fiscal é a base dos tributos.`;

  if (salvar) {
    clearTimeout(timerRascunho);
    timerRascunho = setTimeout(() => S.salvarRascunho(estado), 300);
  }
}

function renderTudo() {
  preencherCampos();
  renderItens();
  renderDespesas();
  atualizar();
}

// ── Tabela de NCMs (diálogo) ──────────────────────────────
function renderDialogoNcm() {
  $('#ncm-fonte').textContent = `Alíquotas oficiais do app: ${NCMS[0]?.fonte ?? '—'}, lidas em ${F.data(REGRAS.aliquotasNcmLidasEm)}, sem confirmação em fonte oficial (TEC, TIPI ou Siscomex). Confirmar com o despachante.`;
  $('#ncm-corpo').innerHTML = tabelaNcm().map((n) => `
    <tr>
      <td><strong>${esc(n.ncm)}</strong>${n.personalizada ? ' <span class="tag tag--aviso">personalizada</span>' : ''}</td>
      <td>${esc(n.descricao)}</td>
      <td class="num">${F.pct(n.ii, 2)}</td>
      <td class="num">${F.pct(n.ipi, 2)}</td>
      <td>${esc([n.baseLegalII, n.fonte, `lida em ${F.data(n.lidoEm)}`].filter(Boolean).join(' · '))}</td>
      <td>${esc(n.observacao || '')}${n.alerta ? ` <span class="aviso">⚠ ${esc(n.alerta)}</span>` : ''}</td>
      <td>${n.personalizada ? `<button type="button" class="btn btn--icone perigo" data-remover-ncm="${esc(n.ncm)}" aria-label="Remover NCM ${esc(n.ncm)}" title="Remover">✕</button>` : ''}</td>
    </tr>`).join('');
}

function abrirDialogoNcm(ncmSugerida = '') {
  renderDialogoNcm();
  const form = $('#form-ncm');
  form.reset();
  form.elements.lidoEm.value = F.hojeISO();
  if (ncmSugerida) form.elements.ncm.value = ncmSugerida;
  $('#ncm-erro').textContent = '';
  const dlg = $('#dlg-ncm');
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
}

function adicionarNcmPersonalizada(ev) {
  ev.preventDefault();
  const f = ev.target.elements;
  const ncm = F.formatarNcm(f.ncm.value);
  const chave = chaveNcm(ncm);
  const ii = F.parsePercentual(f.ii.value);
  const ipi = F.parsePercentual(f.ipi.value);
  const erro = (m) => { $('#ncm-erro').textContent = m; };
  if (chave.length !== 8) return erro('A NCM precisa ter 8 dígitos.');
  if (NCMS.some((n) => chaveNcm(n.ncm) === chave)) return erro('Essa NCM já está na tabela do app.');
  if (!f.descricao.value.trim()) return erro('Informe a descrição.');
  if (!Number.isFinite(ii) || ii < 0) return erro('II inválido.');
  if (!Number.isFinite(ipi) || ipi < 0) return erro('IPI inválido.');
  if (!f.fonte.value.trim()) return erro('Informe a fonte da alíquota.');
  if (!f.lidoEm.value) return erro('Informe a data de leitura.');

  personalizadas = personalizadas.filter((n) => chaveNcm(n.ncm) !== chave);
  personalizadas.push({
    ncm, descricao: f.descricao.value.trim(), ii, ipi,
    baseLegalII: '', fonte: f.fonte.value.trim(), lidoEm: f.lidoEm.value,
    observacao: f.observacao.value.trim(), personalizada: true
  });
  S.salvarNcmsPersonalizadas(personalizadas);

  // Linhas com essa NCM e alíquotas em branco recebem os valores agora.
  estado.itens.forEach((it, i) => {
    if (chaveNcm(it.ncm) === chave && (it.ii == null || it.ipi == null)) {
      ncmAplicada[i] = '';
      aplicarNcm(i);
    }
  });
  renderListaNcm();
  renderDialogoNcm();
  ev.target.reset();
  f.lidoEm.value = F.hojeISO();
  erro('');
  atualizar();
  mostrarStatus(`NCM ${ncm} adicionada como personalizada.`);
}

function removerNcmPersonalizada(ncm) {
  personalizadas = personalizadas.filter((n) => n.ncm !== ncm);
  S.salvarNcmsPersonalizadas(personalizadas);
  renderListaNcm();
  renderDialogoNcm();
  atualizar();
}

// ── Câmbio ────────────────────────────────────────────────
function renderFx() {
  const alvo = $('#fx-conteudo');
  if (!PTAX_DISPONIVEL) {
    alvo.innerHTML = `<a href="${esc(LINK_COTACOES_BCB)}" target="_blank" rel="noopener">Cotações do BCB ↗</a><span>digite a taxa fiscal do dia do registro</span>`;
    return;
  }
  alvo.innerHTML = `<button type="button" class="btn btn--sec" id="btn-ptax">Buscar PTAX</button><span id="fx-status">ou digite a taxa</span>`;
  $('#btn-ptax').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const st = $('#fx-status');
    btn.disabled = true;
    st.textContent = 'Buscando…';
    try {
      const r = await buscarPtax();
      estado.operacao.cambioFiscal = r.venda;
      estado.operacao.dataCambioFiscal = r.data;
      preencherCampos();
      atualizar();
      st.textContent = `${r.fonte} de ${F.data(r.data)}. Confirme a taxa fiscal do dia do registro.`;
    } catch {
      st.innerHTML = `Não foi possível buscar agora. Digite a taxa ou veja as <a href="${esc(LINK_COTACOES_BCB)}" target="_blank" rel="noopener">cotações do BCB ↗</a>.`;
    } finally {
      btn.disabled = false;
    }
  });
}

// ── Ações do topo ─────────────────────────────────────────
function exigirResultado() {
  if (ultimoResultado) return true;
  mostrarTodosErros = true;
  atualizar({ salvar: false });
  mostrarStatus('Complete os dados destacados antes de exportar.', true);
  return false;
}

async function abrirArquivo(ev) {
  const arquivo = ev.target.files?.[0];
  ev.target.value = '';
  if (!arquivo) return;
  try {
    const bruto = await S.lerArquivoJSON(arquivo);
    estado = S.normalizarEntrada(bruto, REGRAS);
    ncmAplicada = estado.itens.map((it) => chaveNcm(it.ncm));
    memoriaAberta.clear();
    mostrarTodosErros = true;
    renderTudo();
    mostrarStatus(`Arquivo "${arquivo.name}" aberto.`);
  } catch (e) {
    mostrarStatus(`Não foi possível abrir "${arquivo.name}": ${e.message}`, true);
  }
}

function ligarEventos() {
  document.addEventListener('input', (ev) => {
    if (ev.target.closest('#itens-corpo')) aoDigitarItem(ev);
    else if (ev.target.closest('#despesas')) aoMudarDespesa(ev);
    else if (ev.target.closest('#form-ncm')) return;
    else if (ev.target.id === 'slider-markup') {
      estado.precificacao.markupGlobal = Number(ev.target.value);
      $('#inp-markup').value = F.paraCampo(estado.precificacao.markupGlobal, 2, 2);
      atualizarPlaceholdersMarkup();
      atualizar();
    } else aoDigitarCampo(ev);
  });
  document.addEventListener('change', (ev) => {
    if (ev.target.closest('#itens-corpo')) aoSairDoItem(ev);
    else if (ev.target.closest('#despesas')) aoMudarDespesa(ev);
    else if (ev.target.closest('#form-ncm') || ev.target.id === 'slider-markup' || ev.target.id === 'arquivo-abrir') return;
    else if (ev.target.matches('[data-bind]')) {
      if (ev.target.dataset.tipo === 'radio' || ev.target.dataset.tipo === 'uf') aoDigitarCampo(ev);
      else aoSairDoCampo(ev);
    }
  });
  document.addEventListener('focusout', (ev) => {
    const el = ev.target;
    if (el.matches?.('[data-bind], #itens-corpo input')) el.dataset.tocado = '1';
  });

  $('#itens-corpo').addEventListener('click', (ev) => {
    if (ev.target.closest('[data-acao-ncm="abrir"]')) {
      const i = Number(ev.target.closest('tr').dataset.info);
      abrirDialogoNcm(estado.itens[i]?.ncm || '');
      return;
    }
    aoClicarItem(ev);
  });
  $('#btn-add-item').addEventListener('click', adicionarItem);
  $('#btn-ncms').addEventListener('click', () => abrirDialogoNcm());
  $('#form-ncm').addEventListener('submit', adicionarNcmPersonalizada);
  $('#ncm-corpo').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-remover-ncm]');
    if (btn) removerNcmPersonalizada(btn.dataset.removerNcm);
  });

  $('#btn-add-despesa').addEventListener('click', () => {
    estado.operacao.despesas.push({ nome: '', valorBRL: null, baseICMS: false });
    renderDespesas();
    atualizar();
    $(`#despesas [data-d="${estado.operacao.despesas.length - 1}"] [data-dcampo="nome"]`)?.focus();
  });
  $('#despesas').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-dacao="remover"]');
    if (!btn) return;
    estado.operacao.despesas.splice(Number(btn.closest('[data-d]').dataset.d), 1);
    renderDespesas();
    atualizar();
  });
  $('#btn-siscomex').addEventListener('click', alternarSiscomex);

  $('#memoria').addEventListener('toggle', (ev) => {
    const d = ev.target.closest('details[data-m]');
    if (!d) return;
    const i = Number(d.dataset.m);
    if (d.open) memoriaAberta.add(i); else memoriaAberta.delete(i);
  }, true);

  $('#btn-nova').addEventListener('click', () => {
    if (!window.confirm('Começar uma simulação nova? O rascunho atual será substituído.')) return;
    estado = S.novaEntrada(REGRAS);
    ncmAplicada = [''];
    memoriaAberta.clear();
    mostrarTodosErros = false;
    for (const el of $$('[data-tocado]')) delete el.dataset.tocado;
    renderTudo();
    mostrarStatus('Simulação nova.');
  });
  $('#btn-abrir').addEventListener('click', () => $('#arquivo-abrir').click());
  $('#arquivo-abrir').addEventListener('change', abrirArquivo);
  $('#btn-salvar').addEventListener('click', () => {
    const json = JSON.stringify(S.exportarEntrada(estado), null, 2);
    baixarArquivo(nomeArquivo(estado.operacao.referencia, estado.operacao.data, 'json'), `${json}\n`, 'application/json');
    mostrarStatus('Simulação salva em JSON.');
  });
  $('#btn-csv').addEventListener('click', () => {
    if (!exigirResultado()) return;
    baixarArquivo(nomeArquivo(estado.operacao.referencia, estado.operacao.data, 'csv'), gerarCSV(ultimoResultado), 'text/csv;charset=utf-8');
    mostrarStatus('CSV gerado (separador ";" e vírgula decimal).');
  });
  $('#btn-imprimir').addEventListener('click', imprimir);

  // Na impressão, a memória de cálculo sai aberta.
  let abertasAntes = [];
  window.addEventListener('beforeprint', () => {
    abertasAntes = $$('#memoria details').map((d) => d.open);
    for (const d of $$('#memoria details')) d.open = true;
  });
  window.addEventListener('afterprint', () => {
    $$('#memoria details').forEach((d, i) => { d.open = Boolean(abertasAntes[i]); });
  });
}

function carregarLogos() {
  for (const img of $$('img[data-logo]')) {
    const slot = img.closest('.logo-slot');
    const ok = () => { img.hidden = false; slot.classList.add('tem-logo'); };
    if (img.complete && img.naturalWidth > 0) ok();
    else img.addEventListener('load', ok, { once: true });
  }
}

function iniciar() {
  $('#sel-uf').innerHTML = UFS.map((uf) => `<option value="${uf}">${uf}</option>`).join('');
  const regrasTexto = `${REGRAS.rotulo} · alíquotas lidas em ${F.data(REGRAS.aliquotasNcmLidasEm)} · estimativa, confirmar com o despachante`;
  $('#rodape-regras').textContent = regrasTexto;
  $('#impressao-aviso').textContent = `Estimativa. ${regrasTexto.replace(' · estimativa, confirmar', ' · confirmar')}.`;
  carregarLogos();
  renderFx();
  renderListaNcm();
  ligarEventos();
  renderTudo();
}

iniciar();
