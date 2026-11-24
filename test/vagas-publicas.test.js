import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { inicioDoDiaInstitucional, prazoAindaValido } from '../utils/datas.js';
import { filtroGrupoConvenios } from '../services/convenios.js';

const fonte = (arquivo) => readFileSync(join(process.cwd(), arquivo), 'utf8');

test('prazo permanece válido durante todo o dia civil de Bagé', () => {
  const referencia = new Date('2026-09-25T01:30:00.000Z');
  const hoje = inicioDoDiaInstitucional(referencia, 'America/Sao_Paulo');
  assert.equal(hoje.toISOString(), '2026-09-24T00:00:00.000Z');
  assert.equal(prazoAindaValido('2026-09-24T00:00:00.000Z', referencia), true);
  assert.equal(prazoAindaValido('2026-09-23T00:00:00.000Z', referencia), false);
});

test('consultas públicas não comparam prazo com a hora exata', () => {
  const arquivos = [
    'controllers/PublicController.js',
    'controllers/VagaController.js',
    'controllers/EstudanteController.js',
    'controllers/CandidaturaController.js'
  ];
  for (const arquivo of arquivos) {
    const codigo = fonte(arquivo);
    assert.match(codigo, /inicioDoDiaInstitucional/u, arquivo);
    assert.doesNotMatch(codigo, /prazo:\s*\{\s*\$gte:\s*new Date\(\)/u, arquivo);
  }
});

test('vigência do convênio também inclui o dia final', () => {
  const referencia = new Date('2026-09-25T01:30:00.000Z');
  const filtro = filtroGrupoConvenios('ativos', referencia);
  assert.equal(filtro.dataFinal.$gte.toISOString(), '2026-09-24T00:00:00.000Z');
  assert.equal(filtro.dataInicial.$lte.toISOString(), '2026-09-24T00:00:00.000Z');
});

test('empresa recebe explicação sobre validação antes da publicação', () => {
  const controller = fonte('controllers/VagaController.js');
  const view = fonte('views/empresa/vagas.ejs');
  assert.match(controller, /ficará pública depois da aprovação administrativa/u);
  assert.match(view, /ainda não aparecem na página inicial nem na\s+lista pública/u);
  assert.match(view, /Aberta e publicada/u);
});
