import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const pastaVerificacao = fileURLToPath(new URL('../../artifacts/qa/', import.meta.url));

export async function gravarResultado(nome, dados) {
  await mkdir(pastaVerificacao, { recursive: true });
  await writeFile(resolve(pastaVerificacao, nome), JSON.stringify(dados, null, 2) + '\n');
}

export function paginasVerificacao(vaga, convenio) {
  return [
    [
      'publico',
      [
        '/',
        '/login',
        '/cadastro',
        '/cadastro/estudante',
        '/cadastro/empresa',
        '/vagas',
        `/vagas/${vaga._id}`
      ]
    ],
    [
      'estudante',
      [
        '/',
        '/vagas',
        `/vagas/${vaga._id}`,
        '/estudante',
        '/estudante/perfil',
        '/conta/acesso',
        '/estudante/candidaturas',
        '/estudante/historico',
        '/avaliacoes',
        '/termos',
        '/notificacoes',
        '/preferencias/notificacoes'
      ]
    ],
    [
      'empresa',
      [
        '/empresa',
        '/empresa/perfil',
        '/conta/acesso',
        '/empresa/vagas',
        '/empresa/vagas/nova',
        `/empresa/candidatos/${vaga._id}`,
        '/avaliacoes',
        '/notificacoes',
        '/preferencias/notificacoes',
        '/empresa/convenios',
        `/empresa/convenios/${convenio._id}`
      ]
    ],
    [
      'admin',
      [
        '/admin',
        '/admin/vagas',
        '/admin/empresas',
        '/admin/relatorios',
        '/conta/acesso',
        '/admin/cadastros',
        '/avaliacoes',
        '/notificacoes',
        '/admin/convenios',
        `/admin/convenios/${convenio._id}`,
        `/admin/convenios/${convenio._id}/editar`,
        '/admin/cursos',
        '/admin/areas',
        '/admin/notificacoes',
        '/admin/usuarios',
        '/termos'
      ]
    ],
    ...['coordenador', 'setor'].map((perfil) => [
      perfil,
      [
        '/admin',
        '/admin/vagas',
        '/admin/empresas',
        '/admin/relatorios',
        '/admin/convenios',
        '/termos',
        '/avaliacoes',
        '/conta/acesso'
      ]
    ])
  ];
}
