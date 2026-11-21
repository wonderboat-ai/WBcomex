#!/usr/bin/env python3
"""Gera data/aliquotas-oficiais.json a partir das planilhas oficiais:

- II: MDIC/Camex, "Tarifas vigentes" — Anexos da Resolução Gecex nº 272/2021 (.xlsx).
- IPI: Receita Federal — TIPI (Decreto nº 11.158/2022 e alterações) (.xlsx).

Uso:
    pip install openpyxl
    python3 scripts/gerar-aliquotas.py --tec ANEXOS.xlsx --tipi TIPI.xlsx \
        --tec-url URL_DO_XLSX --tec-atualizada-em AAAA-MM-DD \
        --tipi-url URL_DO_XLSX --tipi-arquivo "NOME DO ARQUIVO" --tipi-atualizada-em AAAA-MM-DD

O script só copia o que está nas planilhas, com fonte, arquivo, data e sha256.
Não decide qual exceção prevalece: isso fica no app (assets/js/aliquotas.js), que mostra
todas as alíquotas candidatas com anexo e ato.
"""

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path

try:
    import openpyxl
except ImportError:  # pragma: no cover
    sys.exit('Instale o openpyxl: pip install openpyxl')

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / 'data' / 'aliquotas-oficiais.json'

PAGINA_TEC = 'https://www.gov.br/mdic/pt-br/assuntos/camex/se-camex/strat/tarifas/vigentes'
PAGINA_TIPI = 'https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/legislacao/documentos-e-arquivos/tipi.xlsx/view'

# Anexos de exceção temporária (Res. Gecex 272/2021). O Anexo III (setor aeronáutico) tem regra
# própria e não entra no cálculo automático.
ANEXOS_EXCECAO = {
    'IV': 'Desabastecimento',
    'V': 'LETEC',
    'VI': 'LEBIT/BK',
    'VIII': 'Concessões OMC',
    'IX': 'DCC',
    'X': 'Automotivos ACE-14',
    'XI': 'LETEC+',
}


def sha256(caminho):
    h = hashlib.sha256()
    with open(caminho, 'rb') as f:
        for bloco in iter(lambda: f.read(1 << 20), b''):
            h.update(bloco)
    return h.hexdigest()


def txt(v):
    return '' if v is None else str(v).strip()


def norm(s):
    s = txt(s).lower()
    for a, b in (('á', 'a'), ('à', 'a'), ('â', 'a'), ('ã', 'a'), ('é', 'e'), ('ê', 'e'), ('í', 'i'), ('ó', 'o'), ('ô', 'o'), ('õ', 'o'), ('ú', 'u'), ('ç', 'c'), ('º', 'o'), ('°', 'o')):
        s = s.replace(a, b)
    return re.sub(r'\s+', ' ', s)


def chave_ncm(v):
    d = re.sub(r'\D', '', txt(v))
    return d if len(d) == 8 else None


def numero(v):
    """'12,6' / '12.6' / 12.6 -> 12.6 ; vazio/'-' -> None."""
    s = txt(v).replace('%', '').strip()
    if s in ('', '-', '–'):
        return None
    s = s.replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return None


def data_iso(v):
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime('%Y-%m-%d')
    s = txt(v)
    if s in ('', '-', '–'):
        return None
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', s)
    if m:
        return f'{m.group(1)}-{m.group(2)}-{m.group(3)}'
    m = re.match(r'^(\d{2})/(\d{2})/(\d{4})', s)
    if m:
        return f'{m.group(3)}-{m.group(2)}-{m.group(1)}'
    return None


def linhas(ws):
    for row in ws.iter_rows(values_only=True):
        yield list(row)


def nota_atualizacao(ws):
    """Linha '*Atualizado até a Resolução Gecex nº ...' do topo da aba."""
    for i, row in enumerate(linhas(ws)):
        if i > 5:
            break
        t = ' '.join(txt(c) for c in row if c is not None)
        if 'atualizad' in t.lower():
            return t.lstrip('* ').strip()
    return ''


def ler_tec(caminho):
    wb = openpyxl.load_workbook(caminho, read_only=True, data_only=True)
    abas = {ws.title: ws for ws in wb.worksheets}

    def aba(prefixo):
        for nome, ws in abas.items():
            if norm(nome).startswith(norm(prefixo)):
                return ws
        return None

    ncm = {}
    atualizacoes = {}

    # Anexo I: TEC. A coluna traz '12,6BK', '16BIT', '20' etc.
    ws = aba('Anexo I -')
    if ws is None:
        raise SystemExit('Aba "Anexo I" não encontrada na planilha da TEC.')
    atualizacoes['I'] = nota_atualizacao(ws)
    for row in linhas(ws):
        c = chave_ncm(row[0] if row else None)
        if not c or len(row) < 3:
            continue
        bruto = txt(row[2]).upper().replace(' ', '')
        m = re.match(r'^([\d.,]+)(BK|BIT)?$', bruto)
        if not m:
            continue
        ncm.setdefault(c, {})['tec'] = numero(m.group(1))
        if m.group(2):
            ncm[c]['bitbk'] = m.group(2)
    if len(ncm) < 9000:
        raise SystemExit(f'Anexo I com só {len(ncm)} NCMs: planilha mudou de formato?')

    # Anexo II: tarifas brasileiras diferentes da TEC, com "Alíquota aplicada".
    ws = aba('Anexo II')
    atualizacoes['II'] = nota_atualizacao(ws)
    cab = None
    for row in linhas(ws):
        if cab is None:
            if norm(row[0] if row else '') == 'ncm':
                cab = [norm(x) for x in row]
            continue
        c = chave_ncm(row[0])
        if not c:
            continue
        reg = dict(zip(cab, row))
        aplicada = numero(next((v for k, v in reg.items() if k.startswith('aliquota aplicada')), None))
        if aplicada is None:
            continue
        item = ncm.setdefault(c, {})
        item['anexoII'] = aplicada
        fund = txt(next((v for k, v in reg.items() if k.startswith('fundamentacao')), ''))
        if fund:
            item['fundII'] = fund

    # Anexos de exceção.
    excecoes = {}
    for romano, nome in ANEXOS_EXCECAO.items():
        ws = aba(f'Anexo {romano} -')
        if ws is None:
            continue
        atualizacoes[romano] = nota_atualizacao(ws)
        cab = None
        for row in linhas(ws):
            if cab is None:
                if norm(row[0] if row else '') == 'ncm':
                    cab = [norm(x) for x in row]
                continue
            c = chave_ncm(row[0])
            if not c:
                continue
            reg = dict(zip(cab, row))

            def campo(*prefixos):
                for k, v in reg.items():
                    if any(k.startswith(p) for p in prefixos):
                        return v
                return None

            aliquota = numero(campo('aliquota'))
            if aliquota is None:
                continue
            ex = txt(campo('no ex', 'n ex', 'nº ex')) or '-'
            quota = txt(campo('quota'))
            quota = '' if quota in ('-', '–') else quota
            descricao = txt(campo('descricao'))
            excecoes.setdefault(c, []).append([
                romano,
                ex if ex not in ('–',) else '-',
                aliquota,
                data_iso(campo('inicio')),
                data_iso(campo('termino')),
                txt(campo('ato de inclusao')),
                quota,
                descricao[:220] if ex != '-' else '',
            ])
    return ncm, excecoes, atualizacoes


def ler_tipi(caminho):
    wb = openpyxl.load_workbook(caminho, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    ipi = {}
    ipi_ex = {}
    cab_visto = False
    for row in linhas(ws):
        if not cab_visto:
            if norm(row[0] if row else '') == 'ncm':
                cab_visto = True
            continue
        c = chave_ncm(row[0])
        if not c or len(row) < 4:
            continue
        ex = txt(row[1])
        bruto = txt(row[3]).upper()
        valor = 'NT' if bruto == 'NT' else numero(bruto)
        if valor is None:
            continue
        if ex:
            ipi_ex.setdefault(c, []).append([ex, valor, txt(row[2])[:220]])
        else:
            ipi[c] = valor
    if len(ipi) < 9000:
        raise SystemExit(f'TIPI com só {len(ipi)} NCMs: planilha mudou de formato?')
    return ipi, ipi_ex


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--tec', required=True)
    ap.add_argument('--tipi', required=True)
    ap.add_argument('--tec-url', required=True)
    ap.add_argument('--tec-atualizada-em', required=True, help='data "atualizada em" da página do MDIC (AAAA-MM-DD)')
    ap.add_argument('--tipi-url', required=True)
    ap.add_argument('--tipi-arquivo', required=True, help='nome do arquivo mostrado na página da Receita')
    ap.add_argument('--tipi-atualizada-em', required=True, help='data "atualizado em" da página da Receita (AAAA-MM-DD)')
    ap.add_argument('--baixado-em', default=dt.date.today().isoformat())
    a = ap.parse_args()

    tec, excecoes, atualizacoes = ler_tec(a.tec)
    ipi, ipi_ex = ler_tipi(a.tipi)

    # Tabela compacta: ncm -> [tec, bitbk, anexoII, fundII, ipi]
    todas = sorted(set(tec) | set(ipi))
    tabela = {}
    for c in todas:
        t = tec.get(c, {})
        tabela[c] = [t.get('tec'), t.get('bitbk', ''), t.get('anexoII'), t.get('fundII', ''), ipi.get(c)]

    saida = {
        'geradoEm': a.baixado_em,
        'formato': {
            'ncm': '[tecAnexoI, "BK"|"BIT"|"", aliquotaAplicadaAnexoII|null, fundamentacaoAnexoII, ipi|"NT"|null] em %',
            'excecoes': '[anexo, nºEx ("-" = NCM inteira), aliquota %, inicioVigencia, terminoVigencia|null, atoDeInclusao, quota ("" = sem quota), descricaoDoEx]',
            'ipiEx': '[nºEx, aliquota %|"NT", descricao]',
        },
        'tec': {
            'fonte': 'MDIC/Camex · Tarifas vigentes · Anexos da Resolução Gecex nº 272/2021',
            'pagina': PAGINA_TEC,
            'arquivo': a.tec_url,
            'atualizadaEm': a.tec_atualizada_em,
            'atualizacoes': atualizacoes,
            'anexos': {'I': 'TEC', 'II': 'Tarifas brasileiras diferentes da TEC', **ANEXOS_EXCECAO},
            'sha256': sha256(a.tec),
            'baixadoEm': a.baixado_em,
        },
        'tipi': {
            'fonte': 'Receita Federal · TIPI (Decreto nº 11.158/2022 e alterações)',
            'pagina': PAGINA_TIPI,
            'arquivo': a.tipi_url,
            'nomeArquivo': a.tipi_arquivo,
            'atualizadaEm': a.tipi_atualizada_em,
            'sha256': sha256(a.tipi),
            'baixadoEm': a.baixado_em,
        },
        'ncm': tabela,
        'excecoes': excecoes,
        'ipiEx': ipi_ex,
    }
    DESTINO.write_text(json.dumps(saida, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'{len(tabela)} NCMs · {sum(len(v) for v in excecoes.values())} exceções de II em {len(excecoes)} NCMs · '
          f'{sum(len(v) for v in ipi_ex.values())} Ex de IPI → {DESTINO.relative_to(RAIZ)}')


if __name__ == '__main__':
    main()
