import { spawn } from 'node:child_process';
import { MongoBinary } from 'mongodb-memory-server';

try {
  const binario = await MongoBinary.getPath({ version: '7.0.24' });
  const testes = spawn(process.execPath, ['--test', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, MONGOMS_SYSTEM_BINARY: binario }
  });
  testes.on('error', () => {
    console.error('Não foi possível iniciar os testes JavaScript.');
    process.exitCode = 1;
  });
  testes.on('exit', (codigo) => {
    process.exitCode = codigo ?? 1;
  });
  process.on('SIGINT', () => testes.kill('SIGINT'));
  process.on('SIGTERM', () => testes.kill('SIGTERM'));
} catch {
  console.error(
    'Não foi possível preparar o MongoDB temporário dos testes. Confira a rede e a disponibilidade do binário MongoDB 7.0.24.'
  );
  process.exitCode = 1;
}
