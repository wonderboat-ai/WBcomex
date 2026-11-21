#!/usr/bin/env node
// Baixa a tabela NCM vigente do Portal Único Siscomex e grava data/ncm-nomenclatura.json
// (só código e descrição, para a pesquisa de NCM na página). Sem dependências.
//
// Uso: node scripts/atualizar-ncm.mjs [arquivo-json-ja-baixado]
// A nomenclatura NÃO traz alíquotas: II e IPI vêm de data/aliquotas-oficiais.json (scripts/gerar-aliquotas.py);
// data/ncm.js fica como reserva. Prioridade no app: personalizada > oficial > data/ncm.js.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const URL_NCM = 'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json?perfil=PUBLICO';
const DESTINO = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'ncm-nomenclatura.json');

const hojeISO = () => new Date().toISOString().slice(0, 10);

export function compactar(bruto, baixadoEm = hojeISO()) {
  if (!bruto || !Array.isArray(bruto.Nomenclaturas)) throw new Error('Arquivo do Siscomex sem a lista "Nomenclaturas".');
  const itens = bruto.Nomenclaturas
    .filter((n) => n && n.Codigo && n.Descricao && (!n.Data_Fim || n.Data_Fim === '31/12/9999'))
    .map((n) => [String(n.Codigo).replace(/\D/g, ''), String(n.Descricao).trim()])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return {
    fonte: 'Portal Único Siscomex · Tabela NCM vigente (download público em JSON)',
    url: URL_NCM,
    vigencia: bruto.Data_Ultima_Atualizacao_NCM || '',
    ato: bruto.Ato || '',
    baixadoEm,
    observacao: 'Só código e descrição. Não contém alíquotas.',
    itens
  };
}

async function main() {
  const arquivo = process.argv[2];
  const bruto = arquivo
    ? JSON.parse(await readFile(arquivo, 'utf8'))
    : await (await fetch(URL_NCM, { headers: { Accept: 'application/json' } })).json();
  const saida = compactar(bruto);
  const oito = saida.itens.filter(([c]) => c.length === 8).length;
  if (oito < 9000) throw new Error(`Só ${oito} NCMs de 8 dígitos: download incompleto?`);
  await writeFile(DESTINO, `${JSON.stringify(saida)}\n`, 'utf8');
  console.log(`${saida.vigencia} · ${saida.ato} · ${saida.itens.length} códigos (${oito} NCMs de 8 dígitos) → data/ncm-nomenclatura.json`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
