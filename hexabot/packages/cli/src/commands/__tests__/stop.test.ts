/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { jest } from '@jest/globals';

const loadProjectConfig = jest.fn();
const dockerCompose = jest.fn();
const generateComposeFiles = jest.fn();
const resolveComposeEnvFile = jest.fn();
const resolveComposeFile = jest.fn();
const checkDocker = jest.fn();
const assertHexabotProject = jest.fn();
const ensureDockerFolder = jest.fn();

jest.unstable_mockModule('../../core/config.js', () => ({
  loadProjectConfig,
}));

jest.unstable_mockModule('../../core/docker.js', () => ({
  dockerCompose,
  generateComposeFiles,
  resolveComposeEnvFile,
  resolveComposeFile,
}));

jest.unstable_mockModule('../../core/prerequisites.js', () => ({
  checkDocker,
}));

jest.unstable_mockModule('../../core/project.js', () => ({
  assertHexabotProject,
  ensureDockerFolder,
}));

jest.unstable_mockModule('../../utils/services.js', () => ({
  parseServices: (value: string) => value.split(',').filter(Boolean),
}));

let runStop: (options?: any) => Promise<void>;

beforeAll(async () => {
  ({ runStop } = await import('../stop.js'));
});

beforeEach(() => {
  jest.resetAllMocks();
});

describe('runStop', () => {
  const baseConfig = {
    docker: {
      composeFile: 'docker/docker-compose.yml',
      defaultServices: ['api'],
    },
    env: {
      docker: '.env.docker',
      dockerExample: '.env.docker.example',
    },
  };

  it('runs docker compose down for the configured services', async () => {
    loadProjectConfig.mockReturnValue(baseConfig);
    resolveComposeFile.mockReturnValue('/tmp/docker/docker-compose.yml');
    resolveComposeEnvFile.mockReturnValue('/tmp/.env.docker');
    generateComposeFiles.mockReturnValue('-f docker-compose.yml');

    await runStop({ docker: true });

    expect(assertHexabotProject).toHaveBeenCalled();
    expect(checkDocker).toHaveBeenCalled();
    expect(ensureDockerFolder).toHaveBeenCalled();
    expect(generateComposeFiles).toHaveBeenCalledWith(
      '/tmp/docker/docker-compose.yml',
      ['api'],
    );
    expect(resolveComposeEnvFile).toHaveBeenCalledWith(
      expect.any(String),
      baseConfig.env.docker,
    );
    expect(dockerCompose).toHaveBeenCalledWith('-f docker-compose.yml down', {
      envFile: '/tmp/.env.docker',
    });
  });

  it('forwards the requested services, volumes and orphan cleanup', async () => {
    loadProjectConfig.mockReturnValue(baseConfig);
    resolveComposeFile.mockReturnValue('/tmp/docker/docker-compose.yml');
    resolveComposeEnvFile.mockReturnValue(undefined);
    generateComposeFiles.mockReturnValue('-f docker-compose.yml');

    await runStop({
      docker: true,
      services: 'api,postgres',
      volumes: true,
      removeOrphans: true,
    });

    expect(generateComposeFiles).toHaveBeenCalledWith(
      '/tmp/docker/docker-compose.yml',
      ['api', 'postgres'],
    );
    expect(dockerCompose).toHaveBeenCalledWith(
      '-f docker-compose.yml down --volumes --remove-orphans',
      { envFile: undefined },
    );
  });

  it('exits when --docker is missing', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit:1');
    }) as () => never);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    loadProjectConfig.mockReturnValue(baseConfig);

    await expect(runStop()).rejects.toThrow('exit:1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
    expect(checkDocker).not.toHaveBeenCalled();
    expect(dockerCompose).not.toHaveBeenCalled();

    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });
});
