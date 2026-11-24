import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { iniciarAmbiente } from '../scripts/support/ambiente.js';
import { gerarRelatorioPdf } from '../services/relatoriosPdf.js';

let ambiente, dados;
before(async () => {
  ambiente = await iniciarAmbiente();
});
beforeEach(async () => {
  dados = await ambiente.semear();
});
after(async () => {
  await ambiente?.encerrar();
});
const paginas = (bytes) => (bytes.toString('latin1').match(/\/Type \/Page\b/g) || []).length;

test('PDF vazio é válido e o relatório extenso possui fontes incorporadas e várias páginas', async () => {
  const vazio = await gerarRelatorioPdf([]);
  assert.equal(vazio.subarray(0, 5).toString(), '%PDF-');
  assert.equal(paginas(vazio), 1);
  const registros = Array.from({ length: 120 }, (_, i) => ({
    estudante: {
      usuario: { nome: `João Gonçalves ${i}` },
      curso: { nome: 'Análise e Desenvolvimento de Sistemas' }
    },
    vaga: {
      empresa: { nomeFantasia: 'Empresa de demonstração' },
      titulo:
        i === 0
          ? 'Atividades e descrição muito longa '.repeat(160)
          : 'Desenvolvimento de aplicações acessíveis'
    },
    status: 'AGUARDANDO_DOCUMENTOS',
    dataCandidatura: new Date()
  }));
  const pdf = await gerarRelatorioPdf(registros, {
    filtros: ['Curso: Análise e Desenvolvimento de Sistemas']
  });
  assert.ok(paginas(pdf) >= 5);
  assert.match(pdf.toString('latin1'), /\/FontFile2/);
  assert.match(pdf.subarray(-20).toString(), /%%EOF/);
});

test('relatório PDF respeita autenticação, perfil, filtros e cabeçalhos HTTP', async () => {
  const { Candidatura } = ambiente.modelos;
  await Candidatura.create({
    estudante: dados.estudante._id,
    vaga: dados.vaga._id,
    status: 'ENTREVISTA'
  });
  const anonimo = await ambiente.cliente(null, dados);
  assert.equal((await anonimo.requisitar('/admin/relatorios?formato=pdf')).location, '/login');
  const estudante = await ambiente.cliente('estudante', dados);
  assert.equal((await estudante.requisitar('/admin/relatorios?formato=pdf')).status, 403);
  const admin = await ambiente.cliente('admin', dados);
  const r = await admin.requisitar(
    '/admin/relatorios?formato=pdf&status=ENTREVISTA&curso=' +
      dados.curso._id +
      '&empresa=' +
      dados.empresas[0]._id
  );
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/pdf/);
  assert.match(r.headers.get('content-disposition'), /relatorio-startif\.pdf/);
  assert.equal(r.bytes.subarray(0, 5).toString(), '%PDF-');
  const html = await admin.requisitar('/admin/relatorios?status=SELECIONADO');
  assert.match(html.html, /Nenhum registro/);
  assert.match(html.html, /Baixar PDF/);
  assert.doesNotMatch(html.html, /Baixar CSV/);
  await Candidatura.updateOne(
    { estudante: dados.estudante._id },
    { $set: { dataCandidatura: new Date('2026-11-01T23:59:59.999Z') } }
  );
  const ultimoInstante = await admin.requisitar(
    '/admin/relatorios?inicio=2026-11-01&fim=2026-11-01'
  );
  assert.match(ultimoInstante.html, /1 registro\(s\)/);
  const diaSeguinte = await admin.requisitar('/admin/relatorios?inicio=2026-11-02&fim=2026-11-02');
  assert.match(diaSeguinte.html, /0 registro\(s\)/);
  for (const q of [
    'empresa=invalida',
    'status=invalido',
    'inicio=2026-02-31',
    'inicio=2026-12-01&fim=2026-01-01'
  ])
    assert.equal((await admin.requisitar('/admin/relatorios?' + q)).status, 302);
});
