import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import mongoose from '../config/conexao.js';
import Convenio from '../models/Convenio.js';
import {
  convenioPodeAguardarAssinatura,
  convenioPodeSerAtivado,
  filtroGrupoConvenios,
  motivoBloqueioExclusaoConvenio,
  rotuloStatusConvenio,
  transicaoConvenioPermitida
} from '../services/convenios.js';

const oid = () => new mongoose.Types.ObjectId();
const fonte = (arquivo) => readFileSync(join(process.cwd(), arquivo), 'utf8');
const assinatura = (papel) => ({
  papel,
  nome: 'Pessoa Responsável',
  funcao: 'Representante',
  dataAssinatura: new Date('2026-02-01T12:00:00Z')
});

test('convênio mantém separados o documento preparado e o PDF devolvido', () => {
  for (const caminho of [
    'documentoParaAssinatura.caminho',
    'documentoParaAssinatura.enviadoPor',
    'pdfAssinado.caminho',
    'pdfAssinado.dataRecebimento',
    'pdfAssinado.enviadoPor',
    'pdfAssinado.nomeSignatario',
    'pdfAssinado.funcaoSignatario',
    'pdfAssinado.dataAssinatura'
  ])
    assert.ok(Convenio.schema.path(caminho), caminho);
});

test('rascunho é aceito e vigência invertida é recusada pelo model', async () => {
  await assert.doesNotReject(() => new Convenio({ empresa: oid(), status: 'RASCUNHO' }).validate());
  await assert.rejects(
    () =>
      new Convenio({
        empresa: oid(),
        numero: 'CONV-1',
        status: 'PENDENTE',
        dataInicial: new Date('2027-01-01T12:00:00Z'),
        dataFinal: new Date('2026-01-01T12:00:00Z')
      }).validate(),
    /posterior/u
  );
});

test('aguardar assinaturas exige o documento preparado', () => {
  const dados = {
    numero: 'CONV-1',
    dataInicial: new Date('2026-01-01'),
    dataFinal: new Date('2027-01-01')
  };
  assert.match(convenioPodeAguardarAssinatura(dados), /documento preparado/u);
  assert.equal(
    convenioPodeAguardarAssinatura({
      ...dados,
      documentoParaAssinatura: { caminho: '/uploads/documentos/preparado.pdf' }
    }),
    ''
  );
});

test('ativação exige PDF final e dois signatários completos', () => {
  const base = {
    dataInicial: new Date('2026-01-01'),
    dataFinal: new Date('2027-01-01'),
    pdfAssinado: { caminho: '/uploads/documentos/assinado.pdf' },
    assinaturas: [assinatura('EMPRESA')]
  };
  assert.match(convenioPodeSerAtivado(base), /assinaturas/u);
  assert.equal(
    convenioPodeSerAtivado({
      ...base,
      assinaturas: [...base.assinaturas, assinatura('INSTITUICAO')]
    }),
    ''
  );
});

test('transições de convênio rejeitam estados adulterados', () => {
  assert.equal(transicaoConvenioPermitida('RASCUNHO', 'AGUARDANDO_ASSINATURAS'), true);
  assert.equal(transicaoConvenioPermitida('AGUARDANDO_ASSINATURAS', 'PENDENTE'), true);
  assert.equal(transicaoConvenioPermitida('PENDENTE', 'ATIVO'), true);
  assert.equal(transicaoConvenioPermitida('ATIVO', 'RASCUNHO'), false);
  assert.equal(transicaoConvenioPermitida('VENCIDO', 'ATIVO'), false);
});

test('exclusão bloqueia convênio ativo e convênio relacionado', () => {
  assert.match(motivoBloqueioExclusaoConvenio({ status: 'ATIVO' }), /não podem ser excluídos/u);
  assert.match(motivoBloqueioExclusaoConvenio({ status: 'RASCUNHO' }, 2), /2 processo/u);
  assert.equal(motivoBloqueioExclusaoConvenio({ status: 'RASCUNHO' }, 0), '');
});

test('grupos distinguem andamento, ativos e inativos', () => {
  assert.ok(filtroGrupoConvenios('andamento').$or);
  assert.equal(filtroGrupoConvenios('ativos').status, 'ATIVO');
  assert.deepEqual(filtroGrupoConvenios('ativos')['pdfAssinado.caminho'], {
    $exists: true,
    $ne: ''
  });
  assert.deepEqual(filtroGrupoConvenios('inativos').status.$in, [
    'INATIVO',
    'VENCIDO',
    'ARQUIVADO'
  ]);
  assert.deepEqual(filtroGrupoConvenios('todos'), {});
  assert.equal(rotuloStatusConvenio('AGUARDANDO_ASSINATURAS'), 'Aguardando assinatura da empresa');
});

test('rotas administrativas incluem detalhes, edição, envio e exclusão', () => {
  const rotas = fonte('routes/ConvenioRoutes.js');
  assert.match(rotas, /get\(\s*'\/admin\/convenios\/:id\/editar'/u);
  assert.match(rotas, /post\(\s*'\/admin\/convenios\/:id\/editar'/u);
  assert.match(rotas, /post\(\s*'\/admin\/convenios\/:id\/enviar-assinatura'/u);
  assert.match(rotas, /post\(\s*'\/admin\/convenios\/:id\/excluir'/u);
  assert.match(rotas, /get\(\s*'\/admin\/convenios\/:id'/u);
});

test('área da empresa limita a consulta ao próprio convênio', () => {
  const controller = fonte('controllers/ConvenioController.js');
  const rotas = fonte('routes/ConvenioRoutes.js');
  assert.match(controller, /Convenio\.findOne\(\{ _id: id, empresa: empresa\._id \}\)/u);
  assert.match(rotas, /get\(\s*'\/empresa\/convenios'/u);
  assert.match(rotas, /get\(\s*'\/empresa\/convenios\/:id'/u);
  assert.match(rotas, /post\(\s*'\/empresa\/convenios\/:id\/documento-assinado'/u);
});

test('downloads passam por autenticação, propriedade e confinamento de caminho', () => {
  const controller = fonte('controllers/ConvenioController.js');
  const rotas = fonte('routes/ConvenioRoutes.js');
  assert.match(controller, /req\.session\.usuario\.tipo === 'ADMIN'/u);
  assert.match(controller, /String\(empresa\?\._id\) === String\(convenio\.empresa\?\._id\)/u);
  assert.match(controller, /arquivoSeguroExiste\(arquivo\.caminho, 'documentos'\)/u);
  assert.match(rotas, /get\(\s*'\/convenios\/:id\/documento-assinatura',\s*autenticado/u);
  assert.match(rotas, /get\(\s*'\/convenios\/:id\/pdf-assinado',\s*autenticado/u);
});

test('retorno assinado muda para pendente e notifica administradores', () => {
  const controller = fonte('controllers/ConvenioController.js');
  assert.match(controller, /convenio\.status = 'PENDENTE'/u);
  assert.match(controller, /CONVENIO_DOCUMENTO_ASSINADO_ENVIADO/u);
  assert.match(controller, /notificarAdministradores/u);
  assert.match(controller, /\/admin\/convenios\/\$\{convenio\._id\}/u);
});

test('edição preserva documentos em revisões e exclusão limpa apenas sem vínculos', () => {
  const controller = fonte('controllers/ConvenioController.js');
  const edicao = controller.slice(
    controller.indexOf('static async editar(req'),
    controller.indexOf('static async enviarAssinatura')
  );
  assert.match(edicao, /registrarRevisaoConvenio/);
  assert.doesNotMatch(edicao, /removerArquivoSeguro\(documentosAnteriores/);
  assert.match(controller, /motivoBloqueioExclusaoConvenio/);
  assert.match(controller, /convenio\.arquivado = true/);
});

test('notificações do convênio usam links e chaves únicas', () => {
  const controller = fonte('controllers/ConvenioController.js');
  const rotina = fonte('services/rotinasAutomaticas.js');
  assert.match(controller, /chaveUnica:/u);
  assert.match(controller, /CONVENIO_ENVIADO_ASSINATURA/u);
  assert.match(controller, /CONVENIO_\$\{novoStatus\}/u);
  assert.match(rotina, /CONVENIO_PROXIMO_VENCIMENTO/u);
  assert.match(rotina, /CONVENIO_VENCIDO/u);
  assert.match(rotina, /empresa\/convenios\/\$\{convenio\._id\}/u);
});

test('CEP aparece antes do logradouro e a consulta cancela requisições antigas', () => {
  const parcial = fonte('views/partials/campos-endereco.ejs');
  const javascript = fonte('public/js/app.js');
  assert.ok(
    parcial.indexOf("erroCampoEndereco('Cep')") < parcial.indexOf("erroCampoEndereco('Logradouro')")
  );
  assert.match(javascript, /AbortController/u);
  assert.match(javascript, /controlador\?\.abort/u);
  assert.match(javascript, /consultaAnterior\?\.cep === cep/u);
  assert.match(javascript, /somenteSeVazio/u);
});

test('apenas áreas e cursos possuem gestão; campus fixo não possui rotas', () => {
  const rotas = fonte('routes/AdminRoutes.js');
  for (const recurso of ['areas', 'cursos']) {
    assert.match(rotas, new RegExp(`get\\('\\/admin\\/${recurso}'`, 'u'));
    assert.match(rotas, new RegExp(`get\\('\\/admin\\/${recurso}\\/:id\\/editar'`, 'u'));
    assert.match(rotas, new RegExp(`post\\('\\/admin\\/${recurso}\\/:id\\/editar'`, 'u'));
  }
  assert.doesNotMatch(rotas, /\/admin\/campi/);
  assert.doesNotMatch(fonte('views/admin/cadastros-index.ejs'), /\/admin\/campi/u);
  assert.match(fonte('views/admin/cursos.ejs'), /data-checkbox-search/u);
});

test('migração preserva o PDF legado e só regulariza convênios incompletos', () => {
  const migracao = fonte('scripts/migrar-dados.js');
  assert.match(migracao, /conveniosPdfLegadoSemRecebimento/u);
  assert.match(migracao, /pdfAssinado\.dataRecebimento/u);
  assert.match(migracao, /conveniosAtivosIncompletos/u);
  assert.match(migracao, /if \(!simular\)/u);
  assert.doesNotMatch(migracao, /unset[^\n]*pdfAssinado/iu);
});

test('CSS mantém componentes essenciais e responsividade institucional', () => {
  const css = fonte('public/css/style.css');
  for (const classe of [
    'agreement-list',
    'history-list',
    'institutional-grid',
    'internship-timeline',
    'document-checklist',
    'profile-progress',
    'rating-options',
    'jobs-grid'
  ]) {
    assert.match(css, new RegExp(`\\.${classe}`, 'u'));
  }
  assert.match(css, /prefers-reduced-motion/u);
  assert.doesNotMatch(fonte('views/admin/painel.ejs'), /style=/u);
});
