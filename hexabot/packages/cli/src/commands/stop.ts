/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import * as path from 'path';

import chalk from 'chalk';
import { Command } from 'commander';

import { loadProjectConfig } from '../core/config.js';
import {
  dockerCompose,
  generateComposeFiles,
  resolveComposeEnvFile,
  resolveComposeFile,
} from '../core/docker.js';
import { checkDocker } from '../core/prerequisites.js';
import { assertHexabotProject, ensureDockerFolder } from '../core/project.js';
import { parseServices } from '../utils/services.js';

export interface StopOptions {
  docker?: boolean;
  services?: string;
  volumes?: boolean;
  removeOrphans?: boolean;
  cwd?: string;
}

export const registerStopCommand = (program: Command) => {
  program
    .command('stop')
    .description('Stop the Docker stack started with `dev`/`start`')
    .option('--docker', 'Stop the Docker services (required)')
    .option('--services <list>', 'Comma-separated services/profiles to stop')
    .option('-v, --volumes', 'Remove named volumes declared by the stack')
    .option('--remove-orphans', 'Remove containers not defined in the stack')
    .action(async (options: StopOptions) => {
      await runStop(options);
    });
};

export const runStop = async (options: StopOptions = {}) => {
  const projectRoot = path.resolve(options.cwd || process.cwd());
  assertHexabotProject(projectRoot);

  if (!options.docker) {
    console.error(chalk.red('`hexabot stop` only manages the Docker stack.'));
    console.log(
      chalk.yellow(
        'Run `hexabot stop --docker`. Local `dev`/`start` runs in the foreground—press Ctrl+C to stop it.',
      ),
    );
    process.exit(1);
  }

  const config = loadProjectConfig(projectRoot);
  await runDockerStop(projectRoot, options, config);
};

const runDockerStop = async (
  projectRoot: string,
  options: StopOptions,
  config: ReturnType<typeof loadProjectConfig>,
) => {
  checkDocker({ silent: true });
  ensureDockerFolder(projectRoot);
  const servicesInput = parseServices(options.services || '');
  const services = servicesInput.length
    ? servicesInput
    : config.docker.defaultServices;
  const composeFile = resolveComposeFile(
    projectRoot,
    config.docker.composeFile,
  );
  const envFile = resolveComposeEnvFile(projectRoot, config.env.docker);
  const composeArgs = generateComposeFiles(composeFile, services);
  const downArgs = ['down'];
  if (options.volumes) {
    downArgs.push('--volumes');
  }
  if (options.removeOrphans) {
    downArgs.push('--remove-orphans');
  }

  const composeCommand = `${composeArgs} ${downArgs.join(' ')}`.trim();
  console.log(
    chalk.blue(
      `Stopping Docker services${
        services.length ? ` (${services.join(', ')})` : ''
      }`,
    ),
  );
  dockerCompose(composeCommand, { envFile });
};
