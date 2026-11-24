import assert from 'node:assert/strict';
import { test } from 'node:test';
import ejs from 'ejs';

test('erros do login mantêm associação acessível entre mensagem, rótulo e campo', async () => {
  const html = await ejs.renderFile('views/auth/login.ejs', {
    usuarioLogado: null,
    mensagem: null,
    notificacoesNaoLidas: 0,
    csrfToken: 'token-isolado',
    valores: {},
    erros: { email: 'Informe o e-mail.', senha: 'Informe a senha.' }
  });
  for (const campo of ['email', 'senha']) {
    assert.match(html, new RegExp(`aria-describedby="erro-${campo}"`));
    assert.match(html, new RegExp(`id="erro-${campo}"`));
    assert.match(html, new RegExp(`<label for="${campo}">`));
    assert.doesNotMatch(html, new RegExp(`aria-describedby=&#34;erro-${campo}`));
  }
});
