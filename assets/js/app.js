// Interface: estado, eventos e renderização. O cálculo fica em calc.js.

import { calcular, gerarAlertas, validarEntrada, chaveNcm, mesmaAliquota, taxaSiscomex } from './calc.js';
import { montarIndice, buscarNcm, acharNcm, descricaoCompleta, formatarCodigo } from './ncm-busca.js';
import { resolverII, resolverIPI, REGRA_II, rotuloFontes } from './aliquotas.js';
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

const moedaAtual = () => (estado.operacao.moeda === 'EUR' ? 'EUR' : 'USD');
const simb = () => F.simboloMoeda(moedaAtual());

const tabelaNcm = () => [...NCMS, ...personalizadas];

// ── Dados oficiais de NCM (nomenclatura Siscomex + II/IPI do MDIC e da Receita) ──
let nomenclatura = null;
let oficiais = null;
let indiceNcm = null;
let dadosNcmEstado = 'ocioso'; // ocioso | carregando | ok | erro
let promessaDadosNcm = null;

const dataVigencia = () => (/^\d{4}-\d{2}-\d{2}$/.test(estado.operacao.data || '') ? estado.operacao.data : F.hojeISO());

function reconstruirIndice() {
  if (!nomenclatura) return;
  const notas = tabelaNcm().map((n) => ({ ncm: n.ncm, texto: `${n.descricao || ''} ${n.observacao || ''}` }));
  indiceNcm = montarIndice(nomenclatura, notas);
}

async function buscarJSON(caminho) {
  const r = await fetch(caminho, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${caminho}: ${r.status}`);
  return r.json();
}

/** Carrega (uma vez) os arquivos oficiais. A página funciona sem eles, só com a tabela do app. */
function carregarDadosNcm() {
  if (promessaDadosNcm) return promessaDadosNcm;
  dadosNcmEstado = 'carregando';
  promessaDadosNcm = Promise.all([buscarJSON('./data/ncm-nomenclatura.json'), buscarJSON('./data/aliquotas-oficiais.json')])
    .then(([nom, ali]) => {
      nomenclatura = nom;
      oficiais = ali;
      reconstruirIndice();
      dadosNcmEstado = 'ok';
      preencherAliquotasPendentes();
      atualizar({ salvar: false });
      if ($('#dlg-ncm')?.open) { renderDialogoNcm(); executarBuscaNcm(); }
    })
    .catch(() => {
      dadosNcmEstado = 'erro';
      promessaDadosNcm = null;
      if ($('#dlg-ncm')?.open) executarBuscaNcm();
    });
  return promessaDadosNcm;
}

/**
 * Referência de alíquota de uma NCM, em ordem de prioridade:
 * 1) NCM personalizada pelo usuário; 2) dados oficiais (MDIC/Receita); 3) tabela do app (data/ncm.js).
 */
function referencia(ncm) {
  const c = chaveNcm(ncm);
  if (c.length !== 8) return null;
  const pers = personalizadas.find((n) => chaveNcm(n.ncm) === c);
  const curada = NCMS.find((n) => chaveNcm(n.ncm) === c);
  if (pers) return { ...pers, tipo: 'personalizada', curada };
  if (oficiais) {
    const resII = resolverII(oficiais, c, dataVigencia());
    const resIPI = resolverIPI(oficiais, c);
    if (resII && resII.aliquota !== null && resIPI) {
      const nom = indiceNcm ? acharNcm(indiceNcm, c) : null;
      return {
        ncm: formatarCodigo(c),
        descricao: nom ? nom.descricao : curada?.descricao || '',
        ii: resII.aliquota,
        ipi: resIPI.aliquota,
        tipo: 'oficial',
        resII,
        resIPI,
        curada,
        observacao: curada?.observacao || '',
        alerta: curada?.alerta,
        fonte: 'MDIC/Camex e Receita Federal',
        lidoEm: oficiais.geradoEm
      };
    }
  }
  if (curada) return { ...curada, tipo: 'tabela' };
  return null;
}

/** Depois que os dados oficiais chegam, completa II/IPI que estavam em branco (nunca troca valor digitado). */
function preencherAliquotasPendentes() {
  estado.itens.forEach((item, i) => {
    const ref = referencia(item.ncm);
    if (!ref) return;
    const tr = $(`#itens-corpo tr[data-i="${i}"]`);
    for (const alvo of ['ii', 'ipi']) {
      if (item[alvo] === null || item[alvo] === undefined) {
        item[alvo] = ref[alvo];
        if (tr) $(`input[data-campo="${alvo}"]`, tr).value = F.paraCampoPct(ref[alvo]);
      }
    }
    ncmAplicada[i] = chaveNcm(item.ncm);
  });
}

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
  renderMoeda();
  siscomexEditando = estado.operacao.siscomexManualBRL != null;
  $('#siscomex-manual').hidden = !siscomexEditando;
}

function aoDigitarCampo(ev) {
  const el = ev.target.closest('[data-bind]');
  if (!el) return;
  const { bind: caminho, tipo } = el.dataset;
  if (tipo === 'radio') {
    if (!el.checked) return;
    if (caminho === 'operacao.moeda') {
      trocarMoeda(el.value);
      return;
    }
    gravar(estado, caminho, el.value);
    mostrarModoPagamento();
  } else if (tipo === 'uf') {
    estado.operacao.uf = el.value;
    estado.operacao.icms = REGRAS.icmsPadrao[el.value] ?? null;
    const icms = $('[data-bind="operacao.icms"]');
    icms.value = textoCampo('pct', estado.operacao.icms);
  } else {
    gravar(estado, caminho, converter(tipo, el.value));
    if (caminho === 'operacao.cambioFiscal') {
      estado.operacao.origemCambioFiscal = 'manual';
      renderFx();
    } else if (caminho === 'operacao.pagamento.cambioPagamento') {
      estado.operacao.pagamento.origemCambioPagamento = 'manual';
    }
  }
  if (caminho === 'operacao.data' && oficiais) renderDialogoNcm();
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
      <td class="ncm-cel">${campo('ncm', 'texto', `${rotulo('NCM')} list="lista-ncm" placeholder="0000.00.00"`)}<button type="button" class="buscar-ncm" data-acao="buscar-ncm" aria-label="Pesquisar NCM do item ${i + 1}" title="Pesquisar NCM"><svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 13l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></td>
      <td>${campo('qtd', 'numero', rotulo('Quantidade'))}</td>
      <td>${campo('fobUnitUSD', 'numero', `${rotulo(`Preço FOB unitário em ${simb()}`)} placeholder="0,00"`)}</td>
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
  const ref = referencia(chave);
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
  if (acao === 'buscar-ncm') {
    const it = estado.itens[i];
    abrirDialogoNcm({ alvo: i, consulta: chaveNcm(it.ncm).length >= 4 && !it.descricao ? it.ncm : (it.descricao || it.ncm || '') });
    return;
  }
  if (acao === 'restaurar') {
    const ref = referencia(estado.itens[i].ncm);
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
  estado.itens.forEach((item, i) => {
    const tr = $(`#itens-corpo tr[data-i="${i}"]`);
    const info = $(`#itens-corpo tr[data-info="${i}"] td`);
    if (!tr || !info) return;
    const chave = chaveNcm(item.ncm);
    const ref = referencia(chave);

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
      if (ref) btn.title = `Restaurar ${F.pct(ref[alvo], 2)} (${ref.tipo === 'oficial' ? 'oficial' : 'tabela'})`;
    }
    for (const campo of ['descricao', 'codigo', 'ncm', 'qtd', 'fobUnitUSD', 'markup']) {
      const input = $(`input[data-campo="${campo}"]`, tr);
      const errado = errosPorCampo.has(`itens.${i}.${campo}`);
      const visivel = errado && (mostrarTodosErros || input.dataset.tocado === '1' || input.value.trim() !== '');
      input.classList.toggle('invalido', visivel);
      input.setAttribute('aria-invalid', String(errado));
    }

    const html = htmlInfoNcm(chave, ref);
    if (info.innerHTML !== html) info.innerHTML = html;
  });
}

const p2 = (v) => F.pct(v, 2).replace(',00%', '%');

/** Linha de informação abaixo do item: descrição oficial, alíquotas, origem e alertas. */
function htmlInfoNcm(chave, ref) {
  if (!chave) return '<span>Escolha a NCM na lista, pesquise pela lupa ou digite os 8 dígitos.</span>';
  if (chave.length !== 8) return '<span class="falta">NCM incompleta: a NCM tem 8 dígitos.</span> II e IPI ficam em branco até alguém preencher.';
  const nom = indiceNcm ? acharNcm(indiceNcm, chave) : null;
  if (!ref) {
    if (indiceNcm && !nom) return `<span class="falta">NCM ${esc(formatarCodigo(chave))} não existe na nomenclatura vigente (Siscomex).</span> Confira o código ou use a lupa para pesquisar.`;
    const desc = nom ? `<strong>${esc(formatarCodigo(chave))}</strong> ${esc(nom.descricao)} · ` : '';
    const carregando = dadosNcmEstado === 'carregando' ? ' Carregando alíquotas oficiais…' : '';
    return `${desc}<span class="falta">Sem alíquota de referência.</span> II e IPI ficam em branco até alguém preencher com alíquota confirmada.${carregando} <button type="button" class="btn btn--link" data-acao-ncm="abrir">Adicionar à tabela</button>`;
  }
  const partes = [`<strong>${esc(ref.ncm)}</strong> ${esc(ref.descricao)}`];
  if (ref.tipo === 'oficial') {
    const o = ref.resII.origem;
    partes.push(`II ${esc(p2(ref.ii))}: ${esc(o.nome)}${o.anexo !== 'I' && o.anexo !== 'II' ? ` (Anexo ${esc(o.anexo)})` : ''}, ${esc(o.ato)}`);
    partes.push(`IPI ${esc(ref.resIPI.nt ? 'NT (0%)' : p2(ref.ipi))}: TIPI`);
    const menores = ref.resII.menores.filter((x) => x.anexo !== 'I' && x.anexo !== 'II');
    for (const m of menores) partes.push(`<span class="aviso">⚠ também vigente: ${esc(m.nome)} ${esc(p2(m.aliquota))} (${esc(m.ato)}), confirmar qual prevalece</span>`);
    for (const x of ref.resII.exs) partes.push(`<span class="aviso">Ex ${esc(x.ex)} do II a ${esc(p2(x.aliquota))}${x.quota ? ' com quota' : ''} (${esc(x.ato)}): ${esc(x.descricao.slice(0, 110))}${x.descricao.length > 110 ? '…' : ''}</span>`);
    for (const x of ref.resIPI.exs.slice(0, 2)) partes.push(`Ex ${esc(x.ex)} da TIPI a ${esc(x.nt ? 'NT' : p2(x.aliquota))}: ${esc(x.descricao.slice(0, 80))}${x.descricao.length > 80 ? '…' : ''}`);
    partes.push(`fonte: ${esc(rotuloFontes(oficiais))}`);
    if (ref.curada && (!mesmaAliquota(ref.curada.ii, ref.ii) || !mesmaAliquota(ref.curada.ipi, ref.ipi))) {
      partes.push(`<span class="aviso">tabela anterior do app (não oficial): II ${esc(p2(ref.curada.ii))}, IPI ${esc(p2(ref.curada.ipi))}</span>`);
    }
  } else {
    if (ref.baseLegalII) partes.push(`II: ${esc(ref.baseLegalII)}`);
    partes.push(`${esc(ref.fonte || '—')}, lida em ${esc(F.data(ref.lidoEm))}`);
  }
  if (ref.observacao) partes.push(esc(ref.observacao));
  let extra = '';
  if (ref.tipo === 'personalizada') extra += ' <span class="tag tag--aviso">personalizada</span>';
  if (ref.alerta) extra += ` <span class="aviso">⚠ ${esc(ref.alerta)}</span>`;
  return partes.join(' · ') + extra;
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

function renderRegime() {
  const regime = REGRAS.regimesTributarios[estado.operacao.regimeTributario] || REGRAS.regimesTributarios.simples;
  const extra = [regime.efeito2027, regime.prazo].filter(Boolean).join(' ');
  const html = `${esc(regime.efeito2026)}${extra ? `<details><summary>O que muda em 2027</summary>${esc(extra)}</details>` : ''}`;
  const alvo = $('#regime-ajuda');
  if (alvo.dataset.regime !== estado.operacao.regimeTributario) {
    alvo.innerHTML = html;
    alvo.dataset.regime = estado.operacao.regimeTributario;
  }
  $('#das-ajuda').textContent = REGRAS.dasRevendaImportacao;
}

function renderDeducoes() {
  const p = estado.precificacao;
  const partes = [p.impostosVenda, p.taxaCartao, p.comissao, p.outrasDeducoes].map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0));
  const soma = partes.reduce((a, b) => a + b, 0);
  $('#deducoes-soma').textContent = `Soma das deduções: ${F.pct(soma)} do preço de venda.`;
}

// ── Resumo, alertas, resultados ───────────────────────────
function alertasDaTela(saida) {
  const lista = gerarAlertas(estado, saida, { tetoRtsUSD: REGRAS.tetoRtsUSD, referencia });
  // Alertas das fontes oficiais, agrupados por NCM (não repetem item a item).
  const porNcm = new Map();
  estado.itens.forEach((it, i) => {
    const c = chaveNcm(it.ncm);
    if (c.length !== 8) return;
    if (!porNcm.has(c)) porNcm.set(c, []);
    porNcm.get(c).push(i + 1);
  });
  for (const [c, itens] of porNcm) {
    const quem = `${itens.length > 1 ? 'Itens' : 'Item'} ${itens.join(', ')} (NCM ${formatarCodigo(c)})`;
    if (indiceNcm && !acharNcm(indiceNcm, c)) {
      lista.push({ nivel: 'aviso', texto: `${quem}: código não existe na nomenclatura NCM vigente (Siscomex, ${nomenclatura.vigencia.toLowerCase()}).` });
      continue;
    }
    const ref = referencia(c);
    if (!ref || ref.tipo !== 'oficial') continue;
    const sugerido = ref.ii;
    const menores = ref.resII.menores.filter((x) => x.anexo !== 'I' && x.anexo !== 'II');
    if (menores.length) {
      const m = menores.map((x) => `${x.nome} ${F.pct(x.aliquota, 1)} (${x.ato})`).join('; ');
      lista.push({ nivel: 'aviso', texto: `${quem}: II sugerido ${F.pct(sugerido, 1)} (${ref.resII.origem.nome}), mas também vale para a NCM ${m}. Se a exceção menor prevalecer, o custo cai. Confirmar com o despachante.` });
    }
    const exsMenores = ref.resII.exs.filter((x) => !x.quota && x.aliquota < sugerido);
    if (exsMenores.length) {
      const m = exsMenores.map((x) => `Ex ${x.ex} a ${F.pct(x.aliquota, 1)} (${x.ato}): "${x.descricao.slice(0, 120)}${x.descricao.length > 120 ? '…' : ''}"`).join('; ');
      lista.push({ nivel: 'aviso', texto: `${quem}: há Ex do II com alíquota menor, não aplicado: ${m}. Confirmar se o produto se enquadra.` });
    }
  }
  if (estado.operacao.regimeTributario === 'simples-hibrido') {
    lista.push({ nivel: 'info', texto: 'Simples híbrido (IBS/CBS fora do DAS): em 2026 o custo da importação é igual ao do Simples puro. A diferença começa em 01/01/2027, quando a CBS e o IBS da importação viram crédito.' });
  }
  if (/^\d{4}/.test(estado.operacao.data || '') && estado.operacao.data >= '2027-01-01') {
    lista.push({ nivel: 'erro', texto: 'Data da operação em 2027: a calculadora usa as regras de 2026 (PIS/COFINS, IPI pela TIPI). A partir de 01/01/2027 entram a CBS e o IBS e o IPI muda (LC 214/2025). O resultado não vale para desembaraço em 2027.' });
  }
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
  const m = moedaAtual();
  $('#r-fob').textContent = t ? F.dinheiro(t.fobUSD, m) : '—';
  $('#r-va').textContent = t ? F.dinheiro(t.valorAduaneiroUSD, m) + (m === 'EUR' && t.valorAduaneiroUSDTeto != null ? ` (${F.usd(t.valorAduaneiroUSDTeto)})` : '') : '—';
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
  const mo = t.moeda || 'USD';
  const sm = F.simboloMoeda(mo);
  const L = [
    ['FOB', `${F.num(it.qtd, 0, 3)} × ${sm} ${n2(it.fobUnitUSD)}`, F.dinheiro(it.fobUSD, mo)],
    ['Participação no FOB', `${sm} ${n2(it.fobUSD)} ÷ ${sm} ${n2(t.fobUSD)}`, p4(it.participacao)],
    ['Frete + seguro rateado', `${p4(it.participacao)} × ${sm} ${n2(t.freteSeguroUSD)}`, F.dinheiro(it.freteSeguroRateadoUSD, mo)],
    [`Valor aduaneiro ${sm}`, 'FOB + frete + seguro rateados', F.dinheiro(it.valorAduaneiroUSD, mo)],
    ['Valor aduaneiro R$', `${sm} ${n2(it.valorAduaneiroUSD)} × ${F.num(op.cambioFiscal, 2, 4)} (câmbio fiscal)`, F.brl(it.valorAduaneiroBRL), true],
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
      ? `${sm} ${n2(it.valorAduaneiroUSD)} × ${F.num(op.pagamento.cambioPagamento, 2, 4)} × (1 + ${F.pct(op.pagamento.iof)} IOF)`
      : `${F.brl(op.pagamento.valorPagoBRL)} pago × ${p4(it.participacao)}`, F.brl(it.pagamentoBRL)],
    ['Despesas', `${F.brl(t.despesasBRL)} × ${p4(it.participacao)}`, F.brl(it.despesasBRL)],
    ['Custo total', 'pagamento + tributos + despesas', F.brl(it.custoTotal), true],
    ['Custo unitário', `custo total ÷ ${F.num(it.qtd, 0, 3)}`, F.brl(it.custoUnit)],
    ['Fator', `${F.brl(it.custoTotal)} ÷ ${sm} ${n2(it.fobUSD)} FOB`, F.num(it.fatorBRLporUSD, 4)],
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
    ['Regime', (REGRAS.regimesTributarios[op.regimeTributario] || REGRAS.regimesTributarios.simples).rotulo],
    ['Câmbio fiscal', `R$/${simb()} ${F.num(op.cambioFiscal, 2, 4)}${op.dataCambioFiscal ? ` (${F.data(op.dataCambioFiscal)}${op.origemCambioFiscal === 'ptax' ? ', PTAX' : ''})` : ''}`],
    ['Pagamento', pg.modo === 'cambio' ? `câmbio ${F.num(pg.cambioPagamento, 2, 4)} + IOF ${F.pct(pg.iof)}` : `valor pago ${F.brl(pg.valorPagoBRL)}`],
    ['Frete · seguro', `${F.dinheiro(op.freteUSD ?? 0, moedaAtual())} · ${F.dinheiro(op.seguroUSD ?? 0, moedaAtual())}`],
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
  renderRegime();
  renderImpressaoMeta(saida);
  renderFx();
  atualizarLinhas(errosPorCampo);
  marcarCamposGerais(errosPorCampo);

  const fobTotal = estado.itens.reduce((s, it) => s + (Number.isFinite(it.qtd) && Number.isFinite(it.fobUnitUSD) ? it.qtd * it.fobUnitUSD : 0), 0);
  $('#itens-fob-total').textContent = F.dinheiro(fobTotal, moedaAtual());
  renderOrigemPagamento();
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

// ── NCM: pesquisa e tabela (diálogo) ──────────────────────
let alvoBuscaNcm = null; // índice do item que receberá a NCM escolhida
let timerBuscaNcm;

function renderDialogoNcm() {
  const fontes = $('#ncm-fontes');
  if (oficiais && nomenclatura) {
    fontes.innerHTML = `Nomenclatura: <a href="${esc(nomenclatura.url)}" target="_blank" rel="noopener">Siscomex</a> (${esc(nomenclatura.vigencia.toLowerCase())}, ${esc(nomenclatura.ato)}). `
      + `II: <a href="${esc(oficiais.tec.pagina)}" target="_blank" rel="noopener">MDIC/Camex</a>, planilha atualizada em ${esc(F.data(oficiais.tec.atualizadaEm))}. `
      + `IPI: <a href="${esc(oficiais.tipi.pagina)}" target="_blank" rel="noopener">TIPI da Receita</a>, atualizada em ${esc(F.data(oficiais.tipi.atualizadaEm))}. `
      + `${esc(REGRA_II)} Ex-tarifário e quota não são aplicados sozinhos.`;
  } else {
    fontes.textContent = dadosNcmEstado === 'erro'
      ? 'Não foi possível carregar a nomenclatura e as alíquotas oficiais. A tabela do app abaixo continua valendo.'
      : 'Carregando a nomenclatura e as alíquotas oficiais…';
  }
  $('#ncm-fonte').textContent = `Tabela do app (SPEC v1): ${NCMS[0]?.fonte ?? '—'}, lidas em ${F.data(REGRAS.aliquotasNcmLidasEm)}. Quando há dado oficial, ele prevalece sobre esta tabela; NCM personalizada prevalece sobre os dois.`;
  $('#ncm-corpo').innerHTML = tabelaNcm().map((n) => {
    const of = oficiais ? referencia(n.ncm) : null;
    const difere = of && of.tipo === 'oficial' && (!mesmaAliquota(of.ii, n.ii) || !mesmaAliquota(of.ipi, n.ipi));
    return `
    <tr>
      <td><strong>${esc(n.ncm)}</strong>${n.personalizada ? ' <span class="tag tag--aviso">personalizada</span>' : ''}</td>
      <td>${esc(n.descricao)}</td>
      <td class="num">${F.pct(n.ii, 2)}</td>
      <td class="num">${F.pct(n.ipi, 2)}</td>
      <td>${esc([n.baseLegalII, n.fonte, `lida em ${F.data(n.lidoEm)}`].filter(Boolean).join(' · '))}${difere ? ` <span class="aviso">oficial: II ${esc(F.pct(of.ii, 2))}, IPI ${esc(F.pct(of.ipi, 2))}</span>` : ''}</td>
      <td>${esc(n.observacao || '')}${n.alerta ? ` <span class="aviso">⚠ ${esc(n.alerta)}</span>` : ''}</td>
      <td>${n.personalizada ? `<button type="button" class="btn btn--icone perigo" data-remover-ncm="${esc(n.ncm)}" aria-label="Remover NCM ${esc(n.ncm)}" title="Remover">✕</button>` : ''}</td>
    </tr>`;
  }).join('');
}

function executarBuscaNcm() {
  const alvo = $('#busca-resultados');
  const q = $('#busca-ncm').value;
  if (!indiceNcm) {
    alvo.innerHTML = `<li class="busca__vazio">${dadosNcmEstado === 'erro' ? 'Pesquisa indisponível: não foi possível carregar a nomenclatura oficial.' : 'Carregando a nomenclatura oficial (Siscomex)…'}</li>`;
    if (dadosNcmEstado !== 'erro') carregarDadosNcm();
    return;
  }
  if (!q.trim()) {
    alvo.innerHTML = '<li class="busca__vazio">Digite parte da descrição (ex.: "sonda sonar", "câmeras", "condutores conexão") ou o começo do código (ex.: 8517.62).</li>';
    return;
  }
  const resultados = buscarNcm(indiceNcm, q, 40);
  if (!resultados.length) {
    alvo.innerHTML = '<li class="busca__vazio">Nada encontrado. Tente outras palavras da descrição oficial ou o começo do código.</li>';
    return;
  }
  const destino = alvoBuscaNcm !== null && estado.itens[alvoBuscaNcm] ? alvoBuscaNcm : null;
  alvo.innerHTML = resultados.map((r) => {
    const ref = referencia(r.codigo);
    const aliq = ref
      ? `II ${esc(p2(ref.ii))} · IPI ${esc(ref.resIPI?.nt ? 'NT' : p2(ref.ipi))}${ref.tipo === 'oficial' ? '' : ` <span class="tag tag--aviso">${ref.tipo === 'personalizada' ? 'personalizada' : 'tabela do app'}</span>`}${ref.tipo === 'oficial' && (ref.resII.exs.length || ref.resII.menores.some((x) => x.anexo !== 'I' && x.anexo !== 'II')) ? ' <span class="tag tag--aviso">ver exceções</span>' : ''}`
      : '<span class="falta">sem alíquota</span>';
    const caminho = r.caminho.slice(1).slice(-3).join(' › ');
    return `
      <li class="busca__item">
        <div class="busca__texto">
          <strong>${esc(r.ncm)}</strong> ${esc(r.descricao)}
          <small>${esc(caminho)}</small>
        </div>
        <div class="busca__aliq">${aliq}</div>
        <div class="busca__acoes">
          ${destino !== null ? `<button type="button" class="btn btn--pri btn--mini" data-usar-ncm="${r.codigo}">Usar no item ${destino + 1}</button>` : ''}
          <button type="button" class="btn btn--link" data-personalizar-ncm="${r.codigo}">Personalizar</button>
        </div>
      </li>`;
  }).join('');
}

function abrirDialogoNcm({ alvo = null, consulta = '', ncmSugerida = '' } = {}) {
  alvoBuscaNcm = alvo;
  renderDialogoNcm();
  const form = $('#form-ncm');
  form.reset();
  form.elements.lidoEm.value = F.hojeISO();
  if (ncmSugerida) form.elements.ncm.value = ncmSugerida;
  $('#ncm-erro').textContent = '';
  $('#busca-alvo').textContent = alvo !== null && estado.itens[alvo]
    ? `Escolha a NCM do item ${alvo + 1}${estado.itens[alvo].descricao ? ` (${estado.itens[alvo].descricao.slice(0, 60)})` : ''}.`
    : 'Pesquise para consultar descrição e alíquotas.';
  $('#busca-ncm').value = consulta;
  executarBuscaNcm();
  const dlg = $('#dlg-ncm');
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  $('#busca-ncm').focus();
  $('#busca-ncm').select();
}

function usarNcmNoItem(codigo) {
  const i = alvoBuscaNcm;
  if (i === null || !estado.itens[i]) return;
  const ncm = formatarCodigo(codigo);
  estado.itens[i].ncm = ncm;
  const tr = $(`#itens-corpo tr[data-i="${i}"]`);
  if (tr) $('input[data-campo="ncm"]', tr).value = ncm;
  ncmAplicada[i] = null; // força aplicar as alíquotas da nova NCM
  aplicarNcm(i);
  atualizar();
  $('#dlg-ncm').close?.();
  mostrarStatus(`NCM ${ncm} aplicada no item ${i + 1}.`);
  const vazio = tr && [...tr.querySelectorAll('input[data-campo="ii"], input[data-campo="ipi"]')].find((x) => !x.value);
  (vazio || (tr && $('input[data-campo="fobUnitUSD"]', tr)))?.focus();
}

function personalizarNcm(codigo) {
  const form = $('#form-ncm');
  const ncm = formatarCodigo(codigo);
  form.elements.ncm.value = ncm;
  const e = indiceNcm ? acharNcm(indiceNcm, codigo) : null;
  form.elements.descricao.value = e ? descricaoCompleta(e).slice(0, 200) : '';
  const ref = referencia(codigo);
  if (ref) {
    form.elements.ii.value = F.paraCampoPct(ref.ii);
    form.elements.ipi.value = F.paraCampoPct(ref.ipi);
  }
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  form.elements.ii.focus();
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
  if (indiceNcm && !acharNcm(indiceNcm, chave)) return erro('Essa NCM não existe na nomenclatura vigente (Siscomex).');
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
  reconstruirIndice();

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
  reconstruirIndice();
  renderListaNcm();
  renderDialogoNcm();
  atualizar();
}

// ── Câmbio automático (PTAX do BCB, dólar e euro) ─────────
let ptaxUltima = null; // { moeda, venda, compra, paridadeUSD, data, fonte }
let ptaxEstado = 'ocioso'; // ocioso | buscando | ok | erro
let ptaxSeq = 0;

const mesmaTaxa = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9;

function renderMoeda() {
  const m = moedaAtual();
  for (const el of $$('[data-simbolo]')) el.textContent = F.simboloMoeda(m);
  for (const el of $$('[data-so-eur]')) el.hidden = m !== 'EUR';
}

function renderOrigemPagamento() {
  const el = $('#pag-origem');
  if (!el) return;
  const pg = estado.operacao.pagamento;
  el.textContent = pg.origemCambioPagamento === 'ptax'
    ? 'Preenchido com a PTAX de venda. O cartão ou o banco aplica a própria taxa: ajuste se souber a taxa do pagamento.'
    : '';
}

function renderFx() {
  const alvo = $('#fx-conteudo');
  if (!alvo) return;
  const op = estado.operacao;
  const m = moedaAtual();
  const link = `<a href="${esc(LINK_COTACOES_BCB)}" target="_blank" rel="noopener">cotações do BCB ↗</a>`;
  if (!PTAX_DISPONIVEL) {
    alvo.innerHTML = `<span>Digite a taxa fiscal do dia do registro. Consulte as ${link}.</span>`;
    return;
  }
  let msg;
  const p = ptaxUltima && ptaxUltima.moeda === m ? ptaxUltima : null;
  if (ptaxEstado === 'buscando') {
    msg = `Buscando a PTAX do ${m === 'EUR' ? 'euro' : 'dólar'} no Banco Central…`;
  } else if (ptaxEstado === 'erro') {
    msg = `<span class="fx-erro">Não foi possível buscar a PTAX agora.</span> Digite a taxa ou consulte as ${link}.`;
  } else if (p && op.origemCambioFiscal === 'ptax' && mesmaTaxa(op.cambioFiscal, p.venda)) {
    msg = `<strong>PTAX venda ${m} de ${esc(F.data(p.data))}: ${esc(F.num(p.venda, 4))}</strong> · preenchida automaticamente${m === 'EUR' && p.paridadeUSD ? ` · paridade US$ ${esc(F.num(p.paridadeUSD, 4))}/€` : ''}`;
  } else if (p) {
    msg = `Taxa digitada. PTAX venda ${m} de ${esc(F.data(p.data))}: ${esc(F.num(p.venda, 4))}.`;
  } else if (Number.isFinite(op.cambioFiscal)) {
    msg = 'Taxa informada manualmente.';
  } else {
    msg = 'Digite a taxa ou busque a PTAX.';
  }
  const automatica = p && op.origemCambioFiscal === 'ptax' && mesmaTaxa(op.cambioFiscal, p.venda);
  alvo.innerHTML = `<button type="button" class="btn btn--sec" id="btn-ptax" ${ptaxEstado === 'buscando' ? 'disabled' : ''}>${automatica ? 'Atualizar' : 'Usar PTAX'}</button><span id="fx-status">${msg}</span>`;
}

/** Preenche o câmbio com a PTAX, sem sobrescrever taxa digitada (a menos que forcar = true). */
function aplicarPtax(r, { forcar = false } = {}) {
  const op = estado.operacao;
  const pg = op.pagamento;
  let mudou = false;
  if (forcar || op.cambioFiscal === null || op.cambioFiscal === undefined || op.origemCambioFiscal === 'ptax') {
    op.cambioFiscal = r.venda;
    op.dataCambioFiscal = r.data;
    op.origemCambioFiscal = 'ptax';
    mudou = true;
  }
  if (op.moeda === 'EUR' && r.paridadeUSD && (forcar || op.paridadeUSD == null || op.origemCambioFiscal === 'ptax')) {
    op.paridadeUSD = r.paridadeUSD;
    mudou = true;
  }
  if (pg.cambioPagamento === null || pg.cambioPagamento === undefined || pg.origemCambioPagamento === 'ptax') {
    pg.cambioPagamento = r.venda;
    pg.origemCambioPagamento = 'ptax';
    mudou = true;
  }
  if (mudou) {
    preencherCampos();
    atualizar();
  }
}

async function atualizarPtax({ forcar = false } = {}) {
  if (!PTAX_DISPONIVEL) return;
  const moeda = moedaAtual();
  const seq = ++ptaxSeq;
  ptaxEstado = 'buscando';
  renderFx();
  try {
    const r = await buscarPtax(moeda);
    if (seq !== ptaxSeq || moeda !== moedaAtual()) return; // resposta antiga
    ptaxUltima = r;
    ptaxEstado = 'ok';
    aplicarPtax(r, { forcar });
  } catch {
    if (seq !== ptaxSeq) return;
    ptaxEstado = 'erro';
  }
  renderFx();
}

/** Troca a moeda da invoice: as taxas antigas eram da outra moeda, então são buscadas de novo. */
function trocarMoeda(nova) {
  const op = estado.operacao;
  const moeda = nova === 'EUR' ? 'EUR' : 'USD';
  if (op.moeda === moeda) return;
  op.moeda = moeda;
  op.cambioFiscal = null;
  op.dataCambioFiscal = '';
  op.origemCambioFiscal = '';
  op.paridadeUSD = null;
  op.pagamento.cambioPagamento = null;
  op.pagamento.origemCambioPagamento = '';
  ptaxUltima = null;
  renderItens();
  preencherCampos();
  atualizar();
  mostrarStatus(`Moeda da invoice: ${moeda === 'EUR' ? 'euro (€)' : 'dólar (US$)'}. Preços FOB, frete e seguro passam a ser lidos nessa moeda.`);
  atualizarPtax();
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
    if (estado.operacao.origemCambioFiscal === 'ptax') estado.operacao.origemCambioFiscal = 'manual';
    if (estado.operacao.pagamento.origemCambioPagamento === 'ptax') estado.operacao.pagamento.origemCambioPagamento = 'manual';
    ncmAplicada = estado.itens.map((it) => chaveNcm(it.ncm));
    memoriaAberta.clear();
    mostrarTodosErros = true;
    ptaxUltima = null;
    renderTudo();
    mostrarStatus(`Arquivo "${arquivo.name}" aberto.`);
    atualizarPtax(); // só referência: a taxa do arquivo não é trocada (origem = manual)
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
      if (ev.target.dataset.tipo === 'radio' || ev.target.dataset.tipo === 'uf' || ev.target.tagName === 'SELECT') aoDigitarCampo(ev);
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
      abrirDialogoNcm({ alvo: i, consulta: estado.itens[i]?.ncm || '', ncmSugerida: estado.itens[i]?.ncm || '' });
      return;
    }
    aoClicarItem(ev);
  });
  $('#btn-add-item').addEventListener('click', adicionarItem);
  $('#btn-ncms').addEventListener('click', () => abrirDialogoNcm());
  $('#busca-ncm').addEventListener('input', () => { clearTimeout(timerBuscaNcm); timerBuscaNcm = setTimeout(executarBuscaNcm, 150); });
  $('#form-busca-ncm').addEventListener('submit', (ev) => { ev.preventDefault(); executarBuscaNcm(); });
  $('#busca-resultados').addEventListener('click', (ev) => {
    const usar = ev.target.closest('[data-usar-ncm]');
    if (usar) { usarNcmNoItem(usar.dataset.usarNcm); return; }
    const pers = ev.target.closest('[data-personalizar-ncm]');
    if (pers) personalizarNcm(pers.dataset.personalizarNcm);
  });
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
    ptaxUltima = null;
    renderTudo();
    mostrarStatus('Simulação nova.');
    atualizarPtax();
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
  $('#fx-conteudo').addEventListener('click', (ev) => {
    if (ev.target.closest('#btn-ptax')) atualizarPtax({ forcar: true });
  });

  // Grava o rascunho na hora ao sair da página (o salvamento normal espera 300 ms).
  const gravarAgora = () => { clearTimeout(timerRascunho); S.salvarRascunho(estado); };
  window.addEventListener('pagehide', gravarAgora);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') gravarAgora(); });

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
  setTimeout(carregarDadosNcm, 0);
  // Cotação do dia: busca ao abrir se o câmbio está vazio ou veio da PTAX (nunca sobrescreve taxa digitada).
  const op = estado.operacao;
  if (op.cambioFiscal == null || op.origemCambioFiscal === 'ptax' || op.pagamento.cambioPagamento == null
    || op.pagamento.origemCambioPagamento === 'ptax' || (op.moeda === 'EUR' && op.paridadeUSD == null)) {
    atualizarPtax();
  }
}

iniciar();
