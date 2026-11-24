# Autenticação Google

## Configurar o projeto Google

1. No Google Cloud Console, crie ou selecione o projeto. Em **Google Auth Platform**, configure Branding, Audience e Data Access. Informe nome StartIF, contato e domínio público autorizado quando aplicável.
2. Solicite somente `openid`, `email` e `profile`. Se o aplicativo estiver em teste, inclua em Audience os endereços Google que poderão entrar. Se o público for interno, confirme que os usuários pertencem à organização autorizada. Publicação e eventual verificação são realizadas pelo proprietário no Console.
3. Em Clients, crie um cliente OAuth do tipo **Web application**. Cadastre as URLs completas em **Authorized redirect URIs**, respeitando protocolo, porta e caminho:

| Ambiente | URI de retorno |
|---|---|
| Local padrão | `http://localhost:3001/auth/google/callback` |
| Implantação | `https://seu-dominio.example/auth/google/callback` (substitua pelo domínio real) |

O fluxo usa redirecionamento do servidor. Não usa One Tap nem precisa carregar SDK Google no navegador. A URL de uma implantação temporária precisa estar explicitamente autorizada caso seja usada.

4. Preencha as variáveis sem incluí-las no Git:

```dotenv
GOOGLE_CLIENT_ID=identificador-do-cliente.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=segredo-fornecido-pelo-console
GOOGLE_CALLBACK_URL=http://localhost:3001/auth/google/callback
URL_BASE=http://localhost:3001
```

Na implantação, configure o callback HTTPS real e a mesma origem em `URL_BASE`. Reinicie ou reimplante a aplicação após alterar o ambiente. Nenhum segredo deve ser exposto nas views, URLs de acesso ou JavaScript público.

## Fluxos e proteção

“Entrar com Google” inicia Authorization Code com PKCE S256, `state` e `nonce` aleatórios, armazenados na sessão, com validade de dez minutos e uso único. O callback troca o código no servidor. `google-auth-library` verifica a assinatura com os certificados Google; o serviço também exige emissor, audiência, expiração, `email_verified`, `sub` e `nonce` corretos. Não são persistidos tokens Google.

A conta é identificada pelo `sub`, não pelo e-mail. Mudança no e-mail retornado pelo Google não altera automaticamente o e-mail cadastrado do destinatário nem o papel local. Contas inativas são impedidas de entrar, e a sessão é renovada após autenticação.

Quando ainda não existe conta com aquele e-mail, o usuário escolhe **Estudante** ou **Empresa** e completa o cadastro normal. Estudantes precisam de CPF, matrícula, curso de Bagé e e-mail institucional permitido. Os demais dados acadêmicos e documentos continuam sujeitos às mesmas validações de perfil, candidatura e termo. Empresas informam CNPJ, responsável e endereço e continuam dependendo da validação administrativa. Uma conta Google não recebe senha inventada nem perfil administrativo.

Se já existe conta local com o e-mail, o callback não a associa sozinho. Entre com e-mail e senha, abra **Conta e acesso**, confirme a senha local e vincule uma identidade Google verificada com o mesmo e-mail. A associação preserva o papel e não aceita um `sub` de outra conta. Uma conta administrativa existente pode ser vinculada por seu titular com essa confirmação.

Cancelamento, configuração ausente, expiração, conta duplicada ou divergência de identidade retornam uma mensagem de erro e preservam o acesso local.

## Validar com o provedor

Depois de configurar o Console, use uma conta Google de teste autorizada e verifique: consentimento, retorno, cadastro inicial permitido, saída e novo acesso, recusa da duplicidade e vinculação com confirmação de senha. Faça isso em localhost e no domínio definitivo. Os testes automatizados usam troca de código simulada e JWTs assinados, incluindo assinatura inválida, emissor/audiência, expiração, `state`, `nonce`, e-mail não verificado e permissões. Eles não comprovam autorização de um cliente no Console nem um login real no provedor.

Referências: [OpenID Connect do Google](https://developers.google.com/identity/openid-connect/openid-connect), [OAuth para aplicações web](https://developers.google.com/identity/protocols/oauth2/web-server), [biblioteca oficial para Node.js](https://github.com/googleapis/google-cloud-node/tree/main/core/packages/google-auth-library-nodejs).
