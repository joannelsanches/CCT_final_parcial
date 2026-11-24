import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { conectarBanco, mensagemFalhaMongo } from '../config/conexao.js';

async function comUri(uri, executar) {
  const anterior = process.env.MONGODB_URI;
  if (uri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = uri;
  try {
    return await executar();
  } finally {
    if (anterior === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = anterior;
    await mongoose.disconnect();
  }
}

test('conexão exige URI válida e limite finito sem mostrar credenciais', async () => {
  await comUri(undefined, () => assert.rejects(conectarBanco(), /Configure MONGODB_URI/));
  await comUri('https://pessoa:segredo-confidencial@servidor.test/banco', async () => {
    await assert.rejects(
      conectarBanco(),
      (erro) =>
        /MONGODB_URI inválida/.test(erro.message) && !erro.message.includes('segredo-confidencial')
    );
  });
  await comUri('mongodb://localhost/startif_testes', () =>
    assert.rejects(conectarBanco({ tempoLimiteMs: NaN }), /MONGODB_TIMEOUT_MS/)
  );
});

test('diagnóstico diferencia falhas e protege detalhes retornados pelo driver', () => {
  const segredo = 'mongodb+srv://pessoa:segredo-confidencial@cluster.exemplo.test/base';
  for (const [erro, esperado] of [
    [
      {
        message: segredo,
        reason: { servers: new Map([['servidor', { error: { cause: { code: 'ECONNREFUSED' } } }]]) }
      },
      /recusada/
    ],
    [{ code: 18, message: segredo }, /autenticação/],
    [{ code: 'ENOTFOUND', message: segredo }, /localizar/],
    [{ code: 13, message: segredo }, /permissões/],
    [{ code: 'CERT_HAS_EXPIRED', message: segredo }, /TLS/],
    [{ name: 'MongoServerSelectionError', message: segredo }, /limite/],
    [{ message: segredo }, /omitidos/]
  ]) {
    const mensagem = mensagemFalhaMongo(erro);
    assert.match(mensagem, esperado);
    assert.doesNotMatch(mensagem, /segredo-confidencial|cluster\.exemplo/);
  }
});

test('conexão recusada de verdade retorna orientação legível', async () => {
  const servidor = createServer();
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const porta = servidor.address().port;
  await new Promise((resolve) => servidor.close(resolve));
  await comUri(`mongodb://127.0.0.1:${porta}/startif_testes`, () =>
    assert.rejects(
      conectarBanco({ tempoLimiteMs: 1000 }),
      (erro) => erro.code === 'MONGODB_CONEXAO' && /conexão.*recusada/.test(erro.message)
    )
  );
});

test('servidor standalone é identificado antes de disponibilizar processos com transações', async () => {
  const banco = await MongoMemoryServer.create({
    binary: { version: '7.0.24' },
    instance: { args: ['--nounixsocket'] }
  });
  try {
    await comUri(banco.getUri('startif_testes'), () =>
      assert.rejects(conectarBanco(), /modo standalone/)
    );
  } finally {
    await banco.stop();
  }
});
