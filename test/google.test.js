import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { iniciarAmbiente } from '../scripts/support/ambiente.js';
import { clienteGoogleTeste, tokenGoogleTeste } from '../scripts/support/googleTeste.js';
import {
  prepararAutenticacaoGoogle,
  conferirRetornoGoogle,
  validarIdentidadeGoogle
} from '../services/googleAuth.js';

let ambiente, dados, app, claims, nonce, clienteGoogle;
before(async () => {
  ambiente = await iniciarAmbiente();
  app = (await import('../app.js')).default;
});
beforeEach(async () => {
  dados = await ambiente.semear();
  process.env.GOOGLE_CLIENT_ID = 'cliente-simulado.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'segredo-ficticio-de-teste';
  process.env.GOOGLE_CALLBACK_URL = ambiente.base + '/auth/google/callback';
  claims = {};
  clienteGoogle = clienteGoogleTeste();
  clienteGoogle.getToken = async ({ code, codeVerifier }) => {
    assert.equal(code, 'codigo-simulado');
    assert.ok(codeVerifier.length >= 43);
    return { tokens: { id_token: tokenGoogleTeste({ nonce, ...claims }) } };
  };
  app.locals.googleClientFactory = () => clienteGoogle;
});
after(async () => {
  delete app.locals.googleClientFactory;
  await ambiente?.encerrar();
});

async function iniciar(cliente, vincular = false) {
  const resposta = vincular
    ? await cliente.post('/conta/google/vincular', { senha: dados.senha })
    : await cliente.requisitar('/auth/google');
  assert.equal(resposta.status, 302);
  const url = new URL(resposta.location);
  nonce = url.searchParams.get('nonce');
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.deepEqual(url.searchParams.get('scope').split(' ').sort(), ['email', 'openid', 'profile']);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  return url.searchParams.get('state');
}

test('autorização usa PKCE, state e nonce; recusa estado adulterado ou expirado', async () => {
  const { transacao, url } = await prepararAutenticacaoGoogle({ cliente: clienteGoogle });
  assert.ok(new URL(url).searchParams.get('code_challenge'));
  assert.throws(() => conferirRetornoGoogle({ state: 'outro', code: 'codigo' }, transacao));
  assert.throws(() =>
    conferirRetornoGoogle(
      { state: transacao.state, code: 'codigo' },
      { ...transacao, criadaEm: Date.now() - 700000 }
    )
  );
});

test('biblioteca oficial verifica assinatura, emissor, audiência, expiração, nonce e e-mail', async () => {
  const transacao = { nonce: 'nonce-valido', codeVerifier: 'verificador' };
  const c = clienteGoogleTeste();
  const verificar = async (alteracoes) => {
    c.getToken = async () => ({
      tokens: { id_token: tokenGoogleTeste({ nonce: transacao.nonce, ...alteracoes }) }
    });
    return validarIdentidadeGoogle('codigo', transacao, { cliente: c });
  };
  assert.equal((await verificar({})).sub, 'google-ficticio-001');
  for (const alteracao of [
    { iss: 'https://outro.example.test' },
    { aud: 'outro-cliente' },
    { exp: Math.floor(Date.now() / 1000) - 1 },
    { nonce: 'errado' },
    { email_verified: false }
  ])
    await assert.rejects(verificar(alteracao));
  const token = tokenGoogleTeste({ nonce: transacao.nonce });
  c.getToken = async () => ({ tokens: { id_token: token.slice(0, -8) + 'INVALIDO' } });
  await assert.rejects(validarIdentidadeGoogle('codigo', transacao, { cliente: c }));
});

test('Google desabilitado não interrompe o login local; cancelamento não cria conta', async () => {
  const anonimo = await ambiente.cliente(null, dados);
  process.env.GOOGLE_CLIENT_ID = '';
  assert.equal((await anonimo.requisitar('/auth/google')).status, 503);
  assert.equal(
    (await anonimo.post('/login', { email: dados.usuarios.estudante.email, senha: dados.senha }))
      .status,
    302
  );
  process.env.GOOGLE_CLIENT_ID = 'cliente-simulado.apps.googleusercontent.com';
  const novo = await ambiente.cliente(null, dados),
    state = await iniciar(novo);
  const antes = await ambiente.modelos.Usuario.countDocuments();
  const cancelado = await novo.requisitar(
    '/auth/google/callback?state=' + state + '&error=access_denied'
  );
  assert.equal(cancelado.status, 400);
  assert.match(cancelado.html, /cancelado/);
  assert.equal(await ambiente.modelos.Usuario.countDocuments(), antes);
});

test('novo estudante Google conclui matrícula e curso sem senha e não recebe perfil administrativo', async () => {
  const c = await ambiente.cliente(null, dados);
  claims = { email: 'estudante.google@academico.ifsul.edu.br' };
  const state = await iniciar(c);
  assert.equal(
    (await c.requisitar('/auth/google/callback?state=' + state + '&code=codigo-simulado')).location,
    '/auth/google/completar'
  );
  const form = await c.requisitar('/auth/google/completar?tipo=ESTUDANTE');
  assert.equal(form.status, 200);
  assert.doesNotMatch(form.html, /name="senha"/);
  assert.equal((await c.post('/auth/google/completar', { tipo: 'ADMIN' })).status, 422);
  const r = await c.post('/auth/google/completar', {
    tipo: 'ESTUDANTE',
    cpf: '52998224725',
    matricula: 'GOOGLE-001',
    curso: String(dados.curso._id),
    email: 'forjado@example.test',
    receberEmail: 'on'
  });
  assert.equal(r.status, 302);
  assert.equal(r.location, '/estudante/perfil');
  const u = await ambiente.modelos.Usuario.findOne({ 'google.sub': 'google-ficticio-001' }).select(
    '+senhaHash'
  );
  assert.equal(u.email, claims.email);
  assert.equal(u.tipo, 'ESTUDANTE');
  assert.equal(u.senhaHash, undefined);
  assert.equal(
    (await ambiente.modelos.Estudante.findOne({ usuario: u._id })).matriculaRegular,
    false
  );
  assert.equal((await c.requisitar('/estudante')).status, 200);
  assert.equal((await c.requisitar('/admin')).status, 403);
  assert.equal(
    (await c.requisitar('/auth/google/callback?state=' + state + '&code=codigo-simulado')).status,
    400
  );
});

test('Google preserva a restrição institucional e cadastra empresa com seus dados obrigatórios', async () => {
  const c = await ambiente.cliente(null, dados);
  claims = { email: 'empresa.google@example.test', sub: 'google-empresa-001' };
  const state = await iniciar(c);
  await c.requisitar('/auth/google/callback?state=' + state + '&code=codigo-simulado');
  await c.requisitar('/auth/google/completar?tipo=ESTUDANTE');
  assert.equal(
    (
      await c.post('/auth/google/completar', {
        tipo: 'ESTUDANTE',
        cpf: '52998224725',
        matricula: 'GOOGLE-002',
        curso: String(dados.curso._id)
      })
    ).status,
    422
  );
  assert.equal(await ambiente.modelos.Usuario.countDocuments({ 'google.sub': claims.sub }), 0);
  await c.requisitar('/auth/google/completar?tipo=EMPRESA');
  const r = await c.post('/auth/google/completar', {
    tipo: 'EMPRESA',
    cnpj: '11222333000181',
    razaoSocial: 'Empresa Google Fictícia Ltda.',
    nomeFantasia: 'Empresa Google Fictícia',
    telefone: '(53) 3000-0000',
    responsavelNome: 'Pessoa Exemplo',
    responsavelCargo: 'Diretora',
    enderecoLogradouro: 'Rua Exemplo',
    enderecoNumero: '100',
    enderecoBairro: 'Centro',
    enderecoCidade: 'Bagé',
    enderecoEstado: 'RS',
    enderecoCep: '96400000'
  });
  assert.equal(r.status, 302);
  assert.equal(r.location, '/empresa/perfil');
  const u = await ambiente.modelos.Usuario.findOne({ 'google.sub': claims.sub });
  const empresa = await ambiente.modelos.Empresa.findOne({ usuario: u._id });
  assert.equal(u.tipo, 'EMPRESA');
  assert.equal(empresa.statusCadastro, 'PENDENTE');
});

test('e-mail existente não vincula sozinho; associação exige sessão, senha e mantém permissões', async () => {
  const c = await ambiente.cliente(null, dados);
  claims = { email: dados.usuarios.estudante.email };
  const state = await iniciar(c);
  const r = await c.requisitar('/auth/google/callback?state=' + state + '&code=codigo-simulado');
  assert.equal(r.status, 400);
  assert.match(r.html, /Já existe um cadastro/);
  assert.equal(
    (await ambiente.modelos.Usuario.findById(dados.usuarios.estudante._id)).google?.sub,
    undefined
  );
  const local = await ambiente.cliente('estudante', dados);
  assert.equal((await local.post('/conta/google/vincular', { senha: 'errada' })).status, 422);
  const vinculo = await iniciar(local, true);
  assert.equal(
    (await local.requisitar('/auth/google/callback?state=' + vinculo + '&code=codigo-simulado'))
      .location,
    '/conta/acesso'
  );
  const u = await ambiente.modelos.Usuario.findById(dados.usuarios.estudante._id);
  assert.equal(u.google.sub, 'google-ficticio-001');
  assert.equal(u.tipo, 'ESTUDANTE');
  assert.equal(u.funcaoAdministrativa, undefined);
  const anonimo = await ambiente.cliente(null, dados),
    login = await iniciar(anonimo);
  assert.equal(
    (await anonimo.requisitar('/auth/google/callback?state=' + login + '&code=codigo-simulado'))
      .location,
    '/estudante'
  );
});

test('vinculação recusa e-mail diferente e sessões deixam de funcionar após desativação', async () => {
  const c = await ambiente.cliente('estudante', dados),
    state = await iniciar(c, true);
  claims = { email: 'outra.conta@example.test' };
  await c.requisitar('/auth/google/callback?state=' + state + '&code=codigo-simulado');
  assert.equal(
    (await ambiente.modelos.Usuario.findById(dados.usuarios.estudante._id)).google?.sub,
    undefined
  );
  const admin = await ambiente.cliente('admin', dados);
  await admin.post('/admin/usuarios/' + dados.usuarios.estudante._id + '/alternar');
  assert.equal((await c.requisitar('/estudante')).location, '/login');
});
