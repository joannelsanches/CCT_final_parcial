import { generateKeyPairSync, sign } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

const chaves = generateKeyPairSync('rsa', { modulusLength: 2048 });

export function tokenGoogleTeste(campos = {}, chave = chaves.privateKey) {
  const agora = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'chave-simulada' })).toString(
    'base64url'
  );
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: process.env.GOOGLE_CLIENT_ID,
      sub: 'google-ficticio-001',
      iat: agora - 5,
      exp: agora + 300,
      email_verified: true,
      email: 'google@example.test',
      name: 'Pessoa de Teste',
      ...campos
    })
  ).toString('base64url');
  const conteudo = header + '.' + payload;
  return conteudo + '.' + sign('RSA-SHA256', Buffer.from(conteudo), chave).toString('base64url');
}

export function clienteGoogleTeste() {
  const cliente = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );
  cliente.getFederatedSignonCertsAsync = async () => ({
    certs: { 'chave-simulada': chaves.publicKey.export({ type: 'spki', format: 'pem' }) }
  });
  return cliente;
}
