#!/usr/bin/env node
// El gate del repositorio, corrido de una vez. Falla al primer paso rojo y dice
// cuál, porque «el gate falló» sin nombre obliga a correrlo otra vez a mano.
import { spawnSync } from 'node:child_process';

// El build entra: un componente de servidor que cruza mal a cliente compila y
// pasa las pruebas, y sólo el build de producción lo mira.
const steps = ['lint', 'typecheck', 'test', 'build'];

for (const step of steps) {
  const run = spawnSync('pnpm', [step], { stdio: 'inherit', env: { ...process.env, SKIP_ENV_VALIDATION: 'true' } });
  if (run.status !== 0) {
    console.error(`\nGATE FAILED — pnpm ${step}`);
    process.exit(1);
  }
}

console.log('\nFULL GATE OK');
