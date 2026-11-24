import 'dotenv/config';
import mongoose, { conectarBanco } from '../config/conexao.js';

try {
  await conectarBanco({ somenteLeitura: true });
  const servidor = await mongoose.connection.db.command({ hello: 1 });
  if (!servidor.setName && servidor.msg !== 'isdbgrid') {
    throw new Error(
      'O servidor está em modo standalone. Configure um replica set ou utilize Atlas para executar todos os processos. Consulte docs/BANCO.md.'
    );
  }
  console.log('Conexão e suporte a transações disponíveis. Nenhum cadastro foi alterado.');
} catch (erro) {
  console.error(erro.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
