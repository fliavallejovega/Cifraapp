#!/usr/bin/env node
// El gate del repositorio, corrido de una vez. Falla al primer paso rojo y dice
// cuál, porque «el gate falló» sin nombre obliga a correrlo otra vez a mano.
import { spawnSync } from 'node:child_process';

const steps = ['lint', 'typecheck', 'test'];

for (const step of steps) {
  const run = spawnSync('pnpm', [step], { stdio: 'inherit', env: { ...process.env, SKIP_ENV_VALIDATION: 'true' } });
  if (run.status !== 0) {
    console.error(`\nGATE FAILED — pnpm ${step}`);
    process.exit(1);
  }
}

console.log('\nGATE OK — lint, typecheck y test en verde.');
