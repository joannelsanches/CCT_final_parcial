import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { iniciarAmbiente } from '../scripts/support/ambiente.js';
let a, f;
before(async () => {
  a = await iniciarAmbiente();
});
after(async () => {
  if (a) await a.encerrar();
});
beforeEach(async () => {
  f = await a.semear();
});
const pdf = () =>
  new Blob(['%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF'], { type: 'application/pdf' });
async function convenio(extra = {}) {
  return a.modelos.Convenio.create({
    empresa: f.empresas[0]._id,
    status: 'RASCUNHO',
    numero: 'BG-001',
    dataInicial: '2026-01-01',
    dataFinal: '2030-12-31',
    ...extra
  });
}

test('CSRF rejeita POST sem token e sessões sobrevivem em MongoDB', async () => {
  const c = await a.cliente('empresa', f);
  const r = await c.post(`/empresa/vagas/${f.vaga._id}/excluir`, { _csrf: '' });
  assert.equal(r.status, 403);
  assert.ok(await a.modelos.Vaga.exists({ _id: f.vaga._id }));
  assert.ok((await a.mongoose.connection.collection('sessoes').countDocuments()) > 0);
});
test('empresa não exclui vaga de outra empresa; coordenador não tem permissão de exclusão', async () => {
  const outra = await a.cliente('outraEmpresa', f),
    coord = await a.cliente('coordenador', f);
  assert.equal((await outra.post(`/empresa/vagas/${f.vaga._id}/excluir`)).status, 403);
  assert.equal((await coord.post(`/admin/vagas/${f.vaga._id}/excluir`)).status, 403);
  assert.ok(await a.modelos.Vaga.exists({ _id: f.vaga._id }));
});
test('vaga publicada sem dependências é excluída definitivamente', async () => {
  const c = await a.cliente('empresa', f);
  assert.equal((await c.post(`/empresa/vagas/${f.vaga._id}/excluir`)).status, 302);
  assert.equal(await a.modelos.Vaga.findById(f.vaga._id), null);
});
test('vaga com candidatura é arquivada, preserva processo, sai da busca e bloqueia novas candidaturas', async () => {
  const candidatura = await a.modelos.Candidatura.create({
    vaga: f.vaga._id,
    estudante: f.estudante._id
  });
  const c = await a.cliente('empresa', f);
  assert.equal((await c.post(`/empresa/vagas/${f.vaga._id}/excluir`)).status, 302);
  assert.equal((await a.modelos.Vaga.findById(f.vaga._id)).status, 'ARQUIVADA');
  assert.ok(await a.modelos.Candidatura.exists({ _id: candidatura._id }));
  const publico = await a.cliente(null, f);
  assert.doesNotMatch((await publico.requisitar('/vagas')).html, /Estágio em desenvolvimento web/);
  assert.equal((await publico.requisitar(`/vagas/${f.vaga._id}`)).status, 404);
  const aluno = await a.cliente('estudante', f);
  const detalhe = await aluno.requisitar(`/vagas/${f.vaga._id}`);
  assert.equal(detalhe.status, 200);
  assert.match(detalhe.html, /Oferta indisponível para novas candidaturas/);
  assert.doesNotMatch(detalhe.html, />Candidatar-se</);
  assert.equal((await c.requisitar(`/vagas/${f.vaga._id}`)).status, 200);
  await aluno.post(`/candidaturas/${f.vaga._id}`);
  assert.equal(await a.modelos.Candidatura.countDocuments({ vaga: f.vaga._id }), 1);
  const edicao = await c.post(`/empresa/vagas/${f.vaga._id}/imagem/remover`);
  assert.notEqual(edicao.status, 500);
});
test('admin exclui convênio sem vínculos; convênio com documento assinado é arquivado', async () => {
  const c = await a.cliente('admin', f);
  const rascunho = await convenio();
  await c.post(`/admin/convenios/${rascunho._id}/excluir`);
  assert.equal(await a.modelos.Convenio.findById(rascunho._id), null);
  const assinado = await convenio({
    pdfAssinado: {
      caminho: 'gridfs:documentos:012345678901234567890123',
      nomeOriginal: 'assinado.pdf'
    }
  });
  await c.post(`/admin/convenios/${assinado._id}/excluir`);
  const atual = await a.modelos.Convenio.findById(assinado._id);
  assert.equal(atual.status, 'ARQUIVADO');
  assert.equal(atual.revisoes.length, 1);
  assert.ok(atual.pdfAssinado.caminho);
  assert.equal(
    (await c.post(`/admin/convenios/${assinado._id}/status`, { status: 'ATIVO' })).status,
    409
  );
  assert.equal(
    await (await import('../services/convenios.js')).existeConvenioVigente(f.empresas[0]._id),
    false
  );
});
test('edição de convênio valida número duplicado e datas sem modificar o original', async () => {
  const c = await a.cliente('admin', f),
    v = await convenio();
  await convenio({ numero: 'BG-002' });
  for (const dados of [
    { numero: 'BG-002', dataInicial: '2026-01-01', dataFinal: '2030-12-31' },
    { numero: 'BG-001', dataInicial: '2030-01-01', dataFinal: '2026-01-01' },
    { numero: 'BG-001', dataInicial: '2026-02-31', dataFinal: '2030-01-01' },
    { numero: 'BG-001', dataInicial: 'data-invalida', dataFinal: '2030-01-01' }
  ]) {
    const r = await c.post(`/admin/convenios/${v._id}/editar`, {
      empresa: f.empresas[0]._id,
      status: 'RASCUNHO',
      ...dados
    });
    assert.equal(r.status, 422);
  }
  assert.equal((await a.modelos.Convenio.findById(v._id)).numero, 'BG-001');
});
test('GridFS preserva preparado e assinado anteriores ao editar; downloads respeitam propriedade', async () => {
  const c = await a.cliente('admin', f);
  const form = new FormData();
  form.set('_csrf', c.csrf);
  form.set('empresa', String(f.empresas[0]._id));
  form.set('status', 'RASCUNHO');
  form.set('numero', 'BG-001');
  form.set('documentoParaAssinatura', pdf(), 'preparado.pdf');
  const r = await c.post('/admin/convenios', {}, { form });
  assert.equal(r.status, 302);
  let v = await a.modelos.Convenio.findOne({ numero: 'BG-001' });
  assert.match(v.documentoParaAssinatura.caminho, /^gridfs:documentos:/);
  const arquivo = v.documentoParaAssinatura.toObject();
  v.pdfAssinado = arquivo;
  v.status = 'ATIVO';
  v.dataInicial = new Date('2026-01-01');
  v.dataFinal = new Date('2030-12-31');
  v.assinaturas = [
    {
      papel: 'EMPRESA',
      nome: 'Empresa',
      funcao: 'Diretora',
      dataAssinatura: new Date('2026-01-01')
    },
    {
      papel: 'INSTITUICAO',
      nome: 'IFSul',
      funcao: 'Representante',
      dataAssinatura: new Date('2026-01-01')
    }
  ];
  await v.save();
  const mudar = new FormData();
  for (const [k, val] of Object.entries({
    _csrf: c.csrf,
    empresa: String(f.empresas[0]._id),
    status: 'ATIVO',
    numero: 'BG-001',
    dataInicial: '2026-01-01',
    dataFinal: '2031-12-31'
  }))
    mudar.set(k, val);
  mudar.set('documentoParaAssinatura', pdf(), 'nova-versao.pdf');
  assert.equal((await c.post(`/admin/convenios/${v._id}/editar`, {}, { form: mudar })).status, 302);
  v = await a.modelos.Convenio.findById(v._id);
  assert.equal(v.status, 'AGUARDANDO_ASSINATURAS');
  assert.equal(v.pdfAssinado?.caminho, undefined);
  assert.equal(v.assinaturas.length, 0);
  assert.ok(v.revisoes[0].dados.pdfAssinado.caminho);
  const link = `/convenios/${v._id}/revisoes/${v.revisoes[0]._id}/assinado`;
  assert.match((await c.requisitar(link)).html, /%PDF/);
  const propria = await a.cliente('empresa', f),
    outra = await a.cliente('outraEmpresa', f);
  assert.equal((await propria.requisitar(link)).status, 200);
  assert.equal((await outra.requisitar(link)).status, 403);
});
test('upload sem CSRF é removido do GridFS sem criar convênio', async () => {
  const c = await a.cliente('admin', f),
    form = new FormData();
  form.set('empresa', String(f.empresas[0]._id));
  form.set('documentoParaAssinatura', pdf(), 'fake.pdf');
  assert.equal((await c.post('/admin/convenios', {}, { form })).status, 403);
  assert.equal(await a.mongoose.connection.collection('arquivosStartif.files').countDocuments(), 0);
  assert.equal(await a.modelos.Convenio.countDocuments(), 0);
});
test('gestão de campus removida, inclusive rotas genéricas; cursos e áreas mantidos', async () => {
  const c = await a.cliente('admin', f);
  for (const p of ['/admin/campi', `/admin/campi/${f.campus._id}/editar`])
    assert.equal((await c.requisitar(p)).status, 404);
  for (const p of [
    '/admin/campi',
    `/admin/cadastros/campus/${f.campus._id}/alternar`,
    `/admin/cadastros/campus/${f.campus._id}/excluir`
  ])
    assert.equal((await c.post(p, { nome: 'Outro campus' })).status, 404);
  assert.equal((await c.requisitar('/admin/cursos')).status, 200);
  assert.equal((await c.requisitar('/admin/areas')).status, 200);
  assert.equal(
    (await c.post('/admin/cursos', { nome: 'Fora de Bagé', campus: '111111111111111111111111' }))
      .status,
    422
  );
});
test('migração simula sem gravar, remapeia Bagé, preserva outros processos e é idempotente', async () => {
  const { migrarBage } = await import('../services/migracaoBage.js');
  const antigo = new a.mongoose.Types.ObjectId(),
    outro = new a.mongoose.Types.ObjectId();
  const db = a.mongoose.connection;
  await db.collection('campus').insertMany([
    { _id: antigo, nome: 'Campus Bagé', cidade: 'Bagé', ativo: true },
    { _id: outro, nome: 'Pelotas', cidade: 'Pelotas', ativo: true }
  ]);
  await db
    .collection('estudantes')
    .updateOne({ _id: f.estudante._id }, { $set: { campus: antigo } });
  const outraVaga = await a.modelos.Vaga.create({ ...f.dadosVaga, campus: outro });
  await migrarBage({ simular: true });
  assert.equal(
    String((await a.modelos.Estudante.findById(f.estudante._id)).campus),
    String(antigo)
  );
  await migrarBage({ simular: false });
  assert.equal(
    String((await a.modelos.Estudante.findById(f.estudante._id)).campus),
    String(f.campus._id)
  );
  assert.equal((await a.modelos.Vaga.findById(outraVaga._id)).status, 'ARQUIVADA');
  const antes = await db.collection('estudantes').findOne({ _id: f.estudante._id });
  await migrarBage({ simular: false });
  assert.deepEqual(await db.collection('estudantes').findOne({ _id: f.estudante._id }), antes);
  assert.ok(await db.collection('campus').findOne({ _id: antigo }));
});
test('outbox evita duplicatas concorrentes por destinatário e preserva notificação interna na falha', async () => {
  const { criarNotificacao } = await import('../services/notificacoes.js'),
    { processarFila } = await import('../services/filaNotificacoes.js');
  const d = {
    destinatario: f.usuarios.estudante._id,
    titulo: 'Decisão',
    mensagem: 'Confira seu termo.',
    tipoEvento: 'TERMO_APROVADO',
    chaveUnica: 'evento-1'
  };
  await Promise.all(Array.from({ length: 10 }, () => criarNotificacao(d)));
  await criarNotificacao({ ...d, destinatario: f.usuarios.empresa._id });
  assert.equal(await a.modelos.Notificacao.countDocuments(), 2);
  await processarFila({
    emailSender: async () => ({ erro: 'Falha SMTP', retentavel: true })
  });
  const n = await a.modelos.Notificacao.findOne({ destinatario: f.usuarios.estudante._id });
  assert.equal(n.email.status, 'FALHA_RETRY');
  assert.equal(n.lida, false);
});
test('workers concorrentes enviam uma vez e usam e-mail de Usuario', async () => {
  const { criarNotificacao } = await import('../services/notificacoes.js'),
    { processarFila } = await import('../services/filaNotificacoes.js');
  await criarNotificacao({
    destinatario: f.usuarios.empresa._id,
    titulo: 'Aviso',
    mensagem: 'Mensagem',
    chaveUnica: 'unico'
  });
  const emails = [];
  const sender = async (d) => {
    emails.push(d.para);
    return { aceito: true, messageId: 'smtp-ficticio' };
  };
  await Promise.all([
    processarFila({ emailSender: sender }),
    processarFila({ emailSender: sender })
  ]);
  assert.deepEqual(emails, [f.usuarios.empresa.email]);
  assert.notEqual(emails[0], f.empresas[0].emailContato);
});
test('retentativas são limitadas; lease vencida não reenvia resultado incerto', async () => {
  const { criarNotificacao } = await import('../services/notificacoes.js'),
    { processarFila } = await import('../services/filaNotificacoes.js');
  await criarNotificacao({
    destinatario: f.usuarios.estudante._id,
    titulo: 'Aviso',
    mensagem: 'Mensagem',
    chaveUnica: 'retry'
  });
  let envios = 0;
  for (let i = 0; i < 4; i++)
    await processarFila({
      agora: new Date(Date.now() + i * 86400000),
      emailSender: async () => {
        envios++;
        return { retentavel: true, erro: '503 fictício' };
      }
    });
  assert.equal(envios, 3);
  assert.equal((await a.modelos.Notificacao.findOne()).email.status, 'FALHA');
  await a.modelos.Notificacao.updateOne(
    {},
    { $set: { 'email.status': 'PROCESSANDO', 'email.bloqueadoAte': new Date(0) } }
  );
  await processarFila({
    emailSender: async () => {
      envios++;
    }
  });
  assert.equal(envios, 3);
  assert.equal((await a.modelos.Notificacao.findOne()).email.status, 'INCERTO');
});
test('preferência revogada cancela canal, oferta retirada cancela publicação pendente', async () => {
  const { criarNotificacao } = await import('../services/notificacoes.js'),
    { processarFila } = await import('../services/filaNotificacoes.js');
  await criarNotificacao({
    destinatario: f.usuarios.estudante._id,
    titulo: 'Vaga',
    mensagem: 'Oferta',
    referencia: f.vaga._id,
    tipoEvento: 'VAGA_APROVADA',
    chaveUnica: 'vaga'
  });
  await a.modelos.Vaga.updateOne(
    { _id: f.vaga._id },
    { $set: { status: 'ARQUIVADA', arquivada: true } }
  );
  let envios = 0;
  await processarFila({
    emailSender: async () => {
      envios++;
    }
  });
  assert.equal(envios, 0);
  assert.equal((await a.modelos.Notificacao.findOne()).email.status, 'CANCELADO');
  const c = await a.cliente('estudante', f);
  assert.equal(
    (
      await c.post('/preferencias/notificacoes', {
        receberEmail: 'on'
      })
    ).status,
    302
  );
  await c.post('/preferencias/notificacoes', {});
  assert.equal(
    (await a.modelos.Usuario.findById(f.usuarios.estudante._id)).preferenciasNotificacao.email,
    false
  );
});

async function criarTermo(extra = {}) {
  const candidatura = await a.modelos.Candidatura.create({
    vaga: f.vaga._id,
    estudante: f.estudante._id,
    status: 'SELECIONADO'
  });
  return a.modelos.TermoCompromisso.create({
    candidatura: candidatura._id,
    estudante: f.estudante._id,
    empresa: f.empresas[0]._id,
    curso: f.curso._id,
    estudanteDataNascimento: '2005-01-01',
    planoAtividades: f.vaga.atividades,
    periodo: { inicio: f.vaga.periodoInicio, fim: f.vaga.periodoFim },
    jornada: {
      cargaDiaria: 6,
      cargaSemanal: 30,
      diasSemana: f.vaga.diasSemana,
      horarioInicio: '08:00',
      horarioFim: '14:00'
    },
    seguro: {
      responsavel: 'CONCEDENTE',
      seguradora: 'Seguro Exemplo',
      numeroApolice: 'FICTICIA',
      coberturaMorteAcidental: 15000,
      coberturaInvalidez: 15000,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: '2029-12-31'
    },
    professorOrientador: { nome: 'Orientadora Exemplo', email: 'orientadora@example.test' },
    modalidade: 'NAO_OBRIGATORIO',
    bolsa: 1000,
    auxilioTransporte: 100,
    ...extra
  });
}
test('convênio com termo explicitamente vinculado preserva histórico mesmo após alteração de vigência', async () => {
  const v = await convenio({ dataInicial: '2040-01-01', dataFinal: '2041-01-01' });
  const t = await criarTermo({ convenio: v._id });
  const c = await a.cliente('admin', f);
  await c.post(`/admin/convenios/${v._id}/excluir`);
  assert.equal((await a.modelos.Convenio.findById(v._id)).status, 'ARQUIVADO');
  assert.ok(await a.modelos.TermoCompromisso.findById(t._id));
});
test('correção do rascunho invalida assinaturas e mantém TCE anterior no histórico', async () => {
  const t = await criarTermo({
    tceAssinado: { caminho: 'gridfs:documentos:012345678901234567890123', nomeOriginal: 'tce.pdf' },
    assinaturas: [{ papel: 'ESTUDANTE', nome: 'Ana', dataAssinatura: '2026-10-01' }]
  });
  const c = await a.cliente('estudante', f);
  const r = await c.post(`/termos/${t._id}/corrigir`, {
    orientadorNome: 'Nova Orientadora',
    orientadorEmail: 'nova@example.test',
    seguroResponsavel: 'CONCEDENTE',
    seguradora: 'Seguro Exemplo',
    numeroApolice: 'FICTICIA',
    coberturaMorteAcidental: 15000,
    coberturaInvalidez: 15000,
    seguroVigenciaInicio: '2026-01-01',
    seguroVigenciaFim: '2029-12-31'
  });
  assert.equal(r.status, 302);
  const atual = await a.modelos.TermoCompromisso.findById(t._id);
  assert.equal(atual.assinaturas.length, 0);
  assert.equal(atual.tceAssinado?.caminho, undefined);
  assert.equal(atual.documentos[0].tipo, 'OUTRO');
  assert.equal(atual.professorOrientador.nome, 'Nova Orientadora');
});
test('aditivo assinado preserva condições anteriores e exige setor/admin; estudante não registra', async () => {
  const t = await criarTermo({ status: 'APROVADO' });
  const c = await a.cliente('admin', f);
  const { inicioDoDiaInstitucional } = await import('../utils/datas.js');
  const hoje = inicioDoDiaInstitucional().toISOString().slice(0, 10);
  const assinatura = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const form = new FormData();
  const dados = {
    _csrf: c.csrf,
    dataEfeito: hoje,
    periodoFim: new Date(Date.now() + 220 * 86400000).toISOString().slice(0, 10),
    cargaDiaria: '5',
    cargaSemanal: '25',
    horarioInicio: '08:00',
    horarioFim: '13:00',
    bolsa: '1100',
    auxilioTransporte: '100',
    seguroVigenciaFim: '2029-12-31',
    planoAtividades: 'Desenvolvimento de sistemas e testes.',
    justificativa: 'Atualização de atividades e jornada.',
    compatibilidadeCursoPpc: 'on',
    jornadaHorarioEscolar: 'on',
    recessoPrevisto: 'on',
    frequenciaRendimento: 'on'
  };
  for (const [k, v] of Object.entries(dados)) form.set(k, v);
  for (const chave of ['Estudante', 'Empresa', 'Instituicao']) {
    form.set(`assinatura${chave}Nome`, chave);
    form.set(`assinatura${chave}Funcao`, 'Representante');
    form.set(`assinatura${chave}Data`, assinatura);
  }
  form.set('aditivo', pdf(), 'aditivo.pdf');
  const aluno = await a.cliente('estudante', f);
  assert.equal((await aluno.post(`/termos/${t._id}/aditivos`, {})).status, 403);
  const r = await c.post(`/termos/${t._id}/aditivos`, {}, { form });
  assert.equal(r.status, 302);
  const atual = await a.modelos.TermoCompromisso.findById(t._id);
  assert.equal(atual.aditivos.length, 1);
  assert.equal(atual.aditivos[0].dadosAnteriores.bolsa, 1000);
  assert.equal(atual.bolsa, 1100);
  assert.equal(atual.documentos[0].tipo, 'TERMO_ADITIVO');
});
test('migração de arquivos simula, mantém original, grava GridFS e pode repetir sem duplicar', async () => {
  const { mkdir, writeFile, unlink } = await import('node:fs/promises'),
    { resolve } = await import('node:path'),
    { execFile } = await import('node:child_process'),
    { promisify } = await import('node:util');
  const executar = promisify(execFile);
  const caminho = resolve('uploads/curriculos/migracao-ficticia.pdf');
  await mkdir(resolve('uploads/curriculos'), { recursive: true });
  await writeFile(caminho, '%PDF-1.4 exemplo fictício');
  try {
    await a.modelos.Estudante.updateOne(
      { _id: f.estudante._id },
      {
        $set: { curriculo: { caminho, nomeOriginal: 'curriculo.pdf', mimetype: 'application/pdf' } }
      }
    );
    await executar(process.execPath, ['scripts/migrar-arquivos.js', '--simular'], {
      cwd: process.cwd(),
      env: process.env
    });
    assert.equal((await a.modelos.Estudante.findById(f.estudante._id)).curriculo.caminho, caminho);
    assert.equal(
      await a.mongoose.connection.collection('arquivosStartif.files').countDocuments(),
      0
    );
    await executar(process.execPath, ['scripts/migrar-arquivos.js'], {
      cwd: process.cwd(),
      env: process.env
    });
    const referencia = (await a.modelos.Estudante.findById(f.estudante._id)).curriculo.caminho;
    assert.match(referencia, /^gridfs:curriculos:/);
    await executar(process.execPath, ['scripts/migrar-arquivos.js'], {
      cwd: process.cwd(),
      env: process.env
    });
    assert.equal(
      await a.mongoose.connection.collection('arquivosStartif.files').countDocuments(),
      1
    );
    assert.equal(
      (await a.modelos.Estudante.findById(f.estudante._id)).curriculo.caminho,
      referencia
    );
  } finally {
    await unlink(caminho);
  }
});
test('candidatura nova a vaga arquivada é bloqueada no handler, inclusive com currículo', async () => {
  await a.modelos.Estudante.updateOne(
    { _id: f.estudante._id },
    { $set: { 'curriculo.caminho': 'gridfs:curriculos:012345678901234567890123' } }
  );
  await a.modelos.Vaga.updateOne(
    { _id: f.vaga._id },
    { $set: { arquivada: true, status: 'ARQUIVADA' } }
  );
  const c = await a.cliente('estudante', f);
  const r = await c.post(`/candidaturas/${f.vaga._id}`);
  assert.equal(r.status, 302);
  assert.equal(await a.modelos.Candidatura.countDocuments(), 0);
});
test('migração confere PPC conhecido: Informática integrado não aceita obrigatório', async () => {
  const { migrarBage } = await import('../services/migracaoBage.js');
  await migrarBage({ simular: false });
  const curso = await a.modelos.Curso.findById(f.curso._id);
  assert.equal(curso.regrasEstagio.permiteEstagioObrigatorio, false);
  assert.equal(curso.regrasEstagio.exigeConvenio, false);
  assert.match(curso.regrasEstagio.fontePpc, /489$/);
  const { validarRegrasTermo } = await import('../utils/regrasTermo.js');
  const t = await criarTermo({ modalidade: 'OBRIGATORIO' });
  assert.match(
    validarRegrasTermo(t, { curso, estudante: f.estudante, empresa: f.empresas[0] }),
    /modalidade/
  );
});

test('multipart sem CSRF não contorna exclusão de vagas, convênios ou ações genéricas', async () => {
  const empresa = await a.cliente('empresa', f),
    admin = await a.cliente('admin', f),
    v = await convenio();
  for (const [cliente, path] of [
    [empresa, `/empresa/vagas/${f.vaga._id}/excluir`],
    [empresa, `/empresa/vagas/${f.vaga._id}/rascunho/excluir`],
    [admin, `/admin/convenios/${v._id}/excluir`],
    [admin, `/admin/cadastros/curso/${f.curso._id}/alternar`]
  ]) {
    const form = new FormData();
    form.set('confirmacao', 'sim');
    assert.equal((await cliente.post(path, {}, { form })).status, 403, path);
  }
  assert.equal((await a.modelos.Vaga.findById(f.vaga._id)).status, 'ABERTA');
  assert.ok(await a.modelos.Convenio.exists({ _id: v._id }));
  assert.equal((await a.modelos.Curso.findById(f.curso._id)).ativo, true);
});

test('empresa substitui assinado e conserva PDF anterior no download da revisão', async () => {
  const admin = await a.cliente('admin', f),
    form = new FormData();
  for (const [k, v] of Object.entries({
    _csrf: admin.csrf,
    empresa: String(f.empresas[0]._id),
    numero: 'BG-001',
    dataInicial: '2026-01-01',
    dataFinal: '2030-12-31',
    acao: 'aguardar_assinaturas'
  }))
    form.set(k, v);
  form.set('documentoParaAssinatura', pdf(), 'preparado.pdf');
  assert.equal((await admin.post('/admin/convenios', {}, { form })).status, 302);
  let v = await a.modelos.Convenio.findOne({ numero: 'BG-001' });
  const empresa = await a.cliente('empresa', f);
  async function devolver(nome) {
    const assinado = new FormData();
    for (const [k, val] of Object.entries({
      _csrf: empresa.csrf,
      signatarioEmpresaNome: 'Supervisora',
      signatarioEmpresaFuncao: 'Diretora',
      signatarioEmpresaData: '2026-01-01'
    }))
      assinado.set(k, val);
    assinado.set('pdfAssinado', pdf(), nome);
    assert.equal(
      (await empresa.post(`/empresa/convenios/${v._id}/documento-assinado`, {}, { form: assinado }))
        .status,
      302
    );
  }
  await devolver('assinado-1.pdf');
  v = await a.modelos.Convenio.findById(v._id);
  const original = v.pdfAssinado.caminho;
  await devolver('assinado-2.pdf');
  v = await a.modelos.Convenio.findById(v._id);
  const revisao = v.revisoes.find((r) => r.dados.pdfAssinado?.caminho === original);
  assert.ok(revisao);
  assert.notEqual(v.pdfAssinado.caminho, original);
  assert.notEqual(v.documentoParaAssinatura.caminho, v.pdfAssinado.caminho);
  assert.equal(
    (await empresa.requisitar(`/convenios/${v._id}/revisoes/${revisao._id}/assinado`)).status,
    200
  );
});

test('rascunho incompleto com evidência assinada pode ser arquivado preservando seus dados', async () => {
  const v = await a.modelos.Convenio.create({
    empresa: f.empresas[0]._id,
    status: 'RASCUNHO',
    pdfAssinado: { caminho: 'gridfs:documentos:012345678901234567890123' }
  });
  const c = await a.cliente('admin', f);
  assert.equal((await c.post(`/admin/convenios/${v._id}/excluir`)).status, 302);
  const atual = await a.modelos.Convenio.findById(v._id);
  assert.equal(atual.status, 'ARQUIVADO');
  assert.ok(atual.pdfAssinado.caminho);
  assert.equal(atual.numero, undefined);
});

test('fila não anuncia vaga expirada, de outro campus ou incompatível com o destinatário atual', async () => {
  const { criarNotificacao } = await import('../services/notificacoes.js'),
    { processarFila } = await import('../services/filaNotificacoes.js');
  const expirada = await a.modelos.Vaga.create({ ...f.dadosVaga, prazo: new Date('2020-01-01') });
  const fora = await a.modelos.Vaga.create({
    ...f.dadosVaga,
    campus: new a.mongoose.Types.ObjectId()
  });
  const incompativel = await a.modelos.Vaga.create({
    ...f.dadosVaga,
    cursosCompativeis: [new a.mongoose.Types.ObjectId()]
  });
  for (const v of [expirada, fora, incompativel])
    await criarNotificacao({
      destinatario: f.usuarios.estudante._id,
      titulo: 'Vaga',
      mensagem: 'Oferta',
      tipoEvento: 'VAGA_APROVADA',
      referencia: v._id,
      chaveUnica: 'vaga-' + v._id
    });
  let envios = 0;
  await processarFila({
    emailSender: async () => {
      envios++;
      return { aceito: true };
    }
  });
  assert.equal(envios, 0);
  assert.equal(await a.modelos.Notificacao.countDocuments({ 'email.status': 'CANCELADO' }), 3);
  assert.equal(await a.modelos.Notificacao.countDocuments(), 3);
});

test('candidatura concorrente com exclusão nunca deixa processo sem a vaga histórica', async () => {
  await a.modelos.Estudante.updateOne(
    { _id: f.estudante._id },
    { $set: { 'curriculo.caminho': 'gridfs:curriculos:012345678901234567890123' } }
  );
  const empresa = await a.cliente('empresa', f),
    aluno = await a.cliente('estudante', f);
  await Promise.all([
    empresa.post(`/empresa/vagas/${f.vaga._id}/excluir`),
    aluno.post(`/candidaturas/${f.vaga._id}`)
  ]);
  const vaga = await a.modelos.Vaga.findById(f.vaga._id),
    candidaturas = await a.modelos.Candidatura.countDocuments({ vaga: f.vaga._id });
  if (candidaturas) {
    assert.ok(vaga);
    assert.equal(vaga.status, 'ARQUIVADA');
  } else if (vaga) assert.equal(vaga.status, 'ARQUIVADA');
});

test('convênio com termo legado sem FK não permite trocar a empresa', async () => {
  const v = await convenio();
  await criarTermo();
  const c = await a.cliente('admin', f);
  const r = await c.post(`/admin/convenios/${v._id}/editar`, {
    empresa: String(f.empresas[1]._id),
    numero: 'BG-001',
    status: 'RASCUNHO',
    dataInicial: '2026-01-01',
    dataFinal: '2030-12-31'
  });
  assert.equal(r.status, 422);
  assert.match(r.html, /processo vinculado/);
  assert.equal(
    String((await a.modelos.Convenio.findById(v._id)).empresa),
    String(f.empresas[0]._id)
  );
});

test('indicadores públicos contam estudantes de Bagé e painel não conta ofertas expiradas', async () => {
  await a.mongoose.connection.collection('estudantes').insertOne({
    usuario: new a.mongoose.Types.ObjectId(),
    campus: new a.mongoose.Types.ObjectId(),
    matricula: 'LEGADO-OUTRO-CAMPUS'
  });
  await a.modelos.Vaga.create({ ...f.dadosVaga, prazo: new Date('2020-01-01') });
  const publico = await a.cliente(null, f);
  assert.match((await publico.requisitar('/')).html, /<strong>1<\/strong>\s*<span>estudantes/);
  const empresa = await a.cliente('empresa', f);
  assert.match(
    (await empresa.requisitar('/empresa')).html,
    /<strong>1<\/strong>\s*<span>vagas abertas/
  );
});

test('decisão sobre termo notifica estudante e empresa vinculada usando seus usuários', async () => {
  const termo = await criarTermo({ status: 'PENDENTE' }),
    admin = await a.cliente('admin', f);
  const r = await admin.post(`/termos/${termo._id}/analisar`, {
    decisao: 'reprovar',
    justificativa: 'Plano de atividades precisa de correção.'
  });
  assert.equal(r.status, 302);
  const avisos = await a.modelos.Notificacao.find({ tipoEvento: 'TERMO_REPROVADO' });
  assert.deepEqual(
    avisos.map((n) => String(n.destinatario)).sort(),
    [f.usuarios.estudante._id, f.usuarios.empresa._id].map(String).sort()
  );
  assert.ok(avisos.every((n) => n.link === '/termos' && n.email.status === 'PENDENTE'));
  assert.equal((await a.modelos.TermoCompromisso.findById(termo._id)).status, 'REPROVADO');
});

test('migração preserva Bagé legado com nome igual ao canônico sem colisão de índice', async () => {
  const { migrarBage } = await import('../services/migracaoBage.js'),
    antigo = new a.mongoose.Types.ObjectId(),
    db = a.mongoose.connection;
  await a.modelos.Campus.deleteOne({ _id: f.campus._id });
  await db
    .collection('campus')
    .insertOne({ _id: antigo, nome: 'IFSul — Campus Bagé', cidade: 'Bagé', ativo: true });
  await db.collection('cursos').updateOne({ _id: f.curso._id }, { $set: { campus: antigo } });
  const simulacao = await migrarBage({ simular: true });
  assert.equal(simulacao.campiHistoricosRenomeados.length, 1);
  assert.equal(await a.modelos.Campus.exists({ _id: f.campus._id }), null);
  assert.equal(
    (await db.collection('campus').findOne({ _id: antigo })).nome,
    'IFSul — Campus Bagé'
  );
  await migrarBage({ simular: false });
  const legado = await db.collection('campus').findOne({ _id: antigo });
  assert.equal(legado.nomeOrigem, 'IFSul — Campus Bagé');
  assert.equal(legado.ativo, false);
  assert.match(legado.nome, /histórico/);
  assert.equal(String((await a.modelos.Curso.findById(f.curso._id)).campus), String(f.campus._id));
  assert.equal((await a.modelos.Campus.findById(f.campus._id)).nome, 'IFSul — Campus Bagé');
  const repeticao = await migrarBage({ simular: false });
  assert.equal(repeticao.campiHistoricosRenomeados.length, 0);
});

test('cadastro normal recusa curso inválido e campos vazios sem criar contas parciais', async () => {
  const cliente = await a.cliente(null, f);
  const dados = {
    nome: 'Cadastro de verificação',
    email: 'verificacao@academico.ifsul.edu.br',
    senha: 'Senha-local-2026!',
    confirmarSenha: 'Senha-local-2026!',
    cpf: '52998224725',
    matricula: 'BGA2026001',
    curso: 'curso-invalido'
  };
  const antes = await a.modelos.Usuario.countDocuments();
  const invalido = await cliente.post('/cadastro/estudante', dados);
  assert.equal(invalido.status, 422);
  assert.match(invalido.html, /Selecione um curso ativo do Campus Bagé/);
  const vazio = await cliente.post('/cadastro/estudante', {
    ...dados,
    curso: String(f.curso._id),
    nome: '   '
  });
  assert.equal(vazio.status, 422);
  assert.equal(await a.modelos.Usuario.countDocuments(), antes);
});

test('cadastro de empresa recusa seleção direta de outro campus com erro de formulário', async () => {
  const cliente = await a.cliente(null, f);
  const antes = await a.modelos.Empresa.countDocuments();
  const r = await cliente.post('/cadastro/empresa', { campus: '111111111111111111111111' });
  assert.equal(r.status, 422);
  assert.equal(await a.modelos.Empresa.countDocuments(), antes);
});
