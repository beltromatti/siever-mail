#!/usr/bin/env node
/**
 * Local release builder for SIEVER Mail.
 *
 * Usage:
 *   node build.mjs <version>                       # mac-arm64 + win-x64 (default)
 *   node build.mjs <version> --all                 # full matrix incl. mac-x64 and Linux x64/arm64
 *   node build.mjs <version> --target=<target-id>  # single target only
 *
 * Available --target ids:
 *   macos-arm64, macos-x64, windows-x64,
 *   linux-x64 (Docker), linux-arm64 (Docker)
 *
 * The script never permanently mutates package.json: it rewrites the
 * `version` field for the duration of the build and restores the original
 * content in a finally block, even on crash or interrupt.
 *
 * The companion gitignored `build-siever.mjs` reuses the helpers exported at
 * the bottom of this file (after running `node build.mjs --help` it is also
 * loadable as a library) to produce the SIEVER-extension build by setting
 * `LOAD_EXTENSION=1` before delegating to `runBuild()`.
 */
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const projectRoot = __dirname
const packageJsonPath = join(projectRoot, 'package.json')

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const dockerCommand = 'docker'
const hostPlatform = process.platform
const hostArch = process.arch
const hostCacheRoot =
  process.platform === 'darwin'
    ? join(process.env.HOME || projectRoot, 'Library', 'Caches')
    : join(process.env.HOME || projectRoot, '.cache')
const electronCacheDir = join(hostCacheRoot, 'electron')
const electronBuilderCacheDir = join(hostCacheRoot, 'electron-builder')

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

const ALL_LOCAL_TARGET_IDS = ['macos-arm64', 'macos-x64', 'windows-x64']
const ALL_LINUX_TARGET_IDS = ['linux-x64', 'linux-arm64']
const DEFAULT_LOCAL_TARGET_IDS = ['macos-arm64', 'windows-x64']

function parseArgs(argv) {
  const positional = []
  const flags = new Set()
  const options = {}

  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const body = arg.slice(2)
      const eqIndex = body.indexOf('=')
      if (eqIndex >= 0) {
        const key = body.slice(0, eqIndex)
        const value = body.slice(eqIndex + 1)
        options[key] = value
      } else {
        flags.add(body)
      }
      continue
    }
    positional.push(arg)
  }

  return { positional, flags, options }
}

export function normalizeVersionInput(rawVersion) {
  if (!rawVersion || typeof rawVersion !== 'string') {
    throw new Error(
      'A release version is required. Usage: node build.mjs <version> [--all] [--target=<id>]\n' +
        'Examples: node build.mjs 2.0.0   |   node build.mjs 2.0   |   node build.mjs 2'
    )
  }

  const trimmed = rawVersion.trim().replace(/^v/, '')
  const padded =
    trimmed.split('.').length === 3
      ? trimmed
      : trimmed.split('.').length === 2
        ? `${trimmed}.0`
        : `${trimmed}.0.0`

  if (!SEMVER_RE.test(padded)) {
    throw new Error(`Invalid version "${rawVersion}". Must be semver-compatible (e.g. 2.0.0).`)
  }

  return padded
}

function run(command, args, label, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: projectRoot,
    shell: process.platform === 'win32',
    ...options
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`)
  }
}

function ensureCleanDirectory(directoryPath) {
  rmSync(directoryPath, { recursive: true, force: true })
  mkdirSync(directoryPath, { recursive: true })
}

function ensureDirectory(directoryPath) {
  mkdirSync(directoryPath, { recursive: true })
}

function copyArtifact(outputDir, releaseRoot, artifactFileName) {
  const sourcePath = join(outputDir, artifactFileName)
  if (!existsSync(sourcePath)) {
    throw new Error(`Expected artifact not found: ${sourcePath}`)
  }
  const destinationPath = join(releaseRoot, artifactFileName)
  copyFileSync(sourcePath, destinationPath)
  return destinationPath
}

function recoverArtifact(outputDir, releaseRoot, artifactFileName, legacyArtifactFileNames = []) {
  const releaseArtifactPath = join(releaseRoot, artifactFileName)

  if (existsSync(releaseArtifactPath)) {
    return releaseArtifactPath
  }

  if (existsSync(join(outputDir, artifactFileName))) {
    return copyArtifact(outputDir, releaseRoot, artifactFileName)
  }

  for (const legacyArtifactFileName of legacyArtifactFileNames) {
    const legacyOutputArtifactPath = join(outputDir, legacyArtifactFileName)
    if (existsSync(legacyOutputArtifactPath)) {
      renameSync(legacyOutputArtifactPath, join(outputDir, artifactFileName))
      return copyArtifact(outputDir, releaseRoot, artifactFileName)
    }
  }

  return null
}

function installNativeDependencies(platform, arch) {
  run(
    npxCommand,
    ['electron-builder', 'install-app-deps', `--platform=${platform}`, `--arch=${arch}`],
    `install native dependencies for ${platform}/${arch}`
  )
}

function buildLocalTarget(target, releaseRoot) {
  const recoveredArtifactPath = recoverArtifact(
    target.outputDir,
    releaseRoot,
    target.artifactFileName,
    target.legacyArtifactFileNames
  )

  if (recoveredArtifactPath) {
    console.log(`\n==> Skipping ${target.label}, artifact already present`)
    return recoveredArtifactPath
  }

  console.log(`\n==> Building ${target.label}`)
  ensureCleanDirectory(target.outputDir)
  installNativeDependencies(target.depPlatform, target.depArch)

  run(
    npxCommand,
    [
      'electron-builder',
      ...target.builderArgs,
      '--publish',
      'never',
      `--config.directories.output=${target.outputDir}`,
      `--config.${target.artifactOverrideKey}=${target.artifactFileName}`,
      ...target.extraConfigArgs
    ],
    `build ${target.label}`
  )

  return copyArtifact(target.outputDir, releaseRoot, target.artifactFileName)
}

function ensureDockerDaemon() {
  run(
    dockerCommand,
    ['info', '--format', '{{.OSType}}/{{.Architecture}} {{.ServerVersion}}'],
    'check Docker daemon'
  )
}

function buildLinuxTarget(target, releaseRoot, packageName, envInjections) {
  const recoveredArtifactPath = recoverArtifact(
    target.outputDir,
    releaseRoot,
    target.artifactFileName
  )

  if (recoveredArtifactPath) {
    console.log(`\n==> Skipping ${target.label}, artifact already present`)
    return recoveredArtifactPath
  }

  console.log(`\n==> Building ${target.label}`)
  ensureCleanDirectory(target.outputDir)

  const relativeOutputDir = relative(projectRoot, target.outputDir).split('\\').join('/')
  const nodeModulesVolume = `${packageName}-${target.id}-node-modules`
  const npmCacheVolume = `${packageName}-${target.id}-npm-cache`
  const containerCommand = [
    'npm install --package-lock=false',
    `npx electron-builder install-app-deps --platform=linux --arch=${target.depArch}`,
    [
      'npx electron-builder',
      '--linux',
      'AppImage',
      target.depArch === 'x64' ? '--x64' : '--arm64',
      '--publish',
      'never',
      `--config.directories.output=${relativeOutputDir}`,
      `--config.appImage.artifactName=${target.artifactFileName}`
    ].join(' ')
  ].join(' && ')

  const dockerEnvArgs = []
  for (const [key, value] of Object.entries(envInjections)) {
    if (value !== undefined && value !== null && value !== '') {
      dockerEnvArgs.push('-e', `${key}=${value}`)
    }
  }

  run(
    dockerCommand,
    [
      'run',
      '--rm',
      '--platform',
      target.dockerPlatform,
      '-e',
      'ELECTRON_CACHE=/root/.cache/electron',
      '-e',
      'ELECTRON_BUILDER_CACHE=/root/.cache/electron-builder',
      ...dockerEnvArgs,
      '-v',
      `${projectRoot}:/project`,
      '-v',
      `${nodeModulesVolume}:/project/node_modules`,
      '-v',
      `${npmCacheVolume}:/root/.npm`,
      '-v',
      `${electronCacheDir}:/root/.cache/electron`,
      '-v',
      `${electronBuilderCacheDir}:/root/.cache/electron-builder`,
      '-w',
      '/project',
      target.dockerImage,
      '/bin/bash',
      '-lc',
      containerCommand
    ],
    `build ${target.label}`
  )

  return copyArtifact(target.outputDir, releaseRoot, target.artifactFileName)
}

function withTransientPackageVersion(version, perform) {
  const original = readFileSync(packageJsonPath, 'utf8')
  const parsed = JSON.parse(original)
  const previousVersion = parsed.version

  if (previousVersion === version) {
    return perform()
  }

  parsed.version = version
  writeFileSync(packageJsonPath, `${JSON.stringify(parsed, null, 2)}\n`)
  console.log(`==> package.json version: ${previousVersion} -> ${version} (transient)`)

  try {
    return perform()
  } finally {
    writeFileSync(packageJsonPath, original)
    console.log(`==> package.json version restored to ${previousVersion}`)
  }
}

function buildLocalTargetsForVersion(targets, releaseRoot) {
  if (targets.length === 0) {
    return
  }

  let hostDependenciesNeedRestore = false
  try {
    for (const target of targets) {
      hostDependenciesNeedRestore = true
      buildLocalTarget(target, releaseRoot)
    }
  } finally {
    if (hostDependenciesNeedRestore) {
      try {
        console.log(`\n==> Restoring host native dependencies for ${hostPlatform}/${hostArch}`)
        installNativeDependencies(hostPlatform, hostArch)
      } catch (restoreError) {
        console.error('Failed to restore host native dependencies after release build.')
        console.error(restoreError)
      }
    }
  }
}

function defineLocalTargets(packageName, releaseTag, tempBuildRoot) {
  return {
    'macos-arm64': {
      id: 'macos-arm64',
      label: 'macOS Apple Silicon',
      depPlatform: 'darwin',
      depArch: 'arm64',
      outputDir: join(tempBuildRoot, 'macos-arm64'),
      artifactFileName: `${packageName}-${releaseTag}-macos-apple-silicon.dmg`,
      legacyArtifactFileNames: [`${packageName}-${releaseTag}-macos-arm64.dmg`],
      artifactOverrideKey: 'dmg.artifactName',
      builderArgs: ['--mac', 'dmg', '--arm64'],
      extraConfigArgs: ['--config.dmg.size=2g']
    },
    'macos-x64': {
      id: 'macos-x64',
      label: 'macOS Intel',
      depPlatform: 'darwin',
      depArch: 'x64',
      outputDir: join(tempBuildRoot, 'macos-x64'),
      artifactFileName: `${packageName}-${releaseTag}-macos-intel.dmg`,
      legacyArtifactFileNames: [`${packageName}-${releaseTag}-macos-x64.dmg`],
      artifactOverrideKey: 'dmg.artifactName',
      builderArgs: ['--mac', 'dmg', '--x64'],
      extraConfigArgs: ['--config.dmg.size=2g']
    },
    'windows-x64': {
      id: 'windows-x64',
      label: 'Windows x64',
      depPlatform: 'win32',
      depArch: 'x64',
      outputDir: join(tempBuildRoot, 'windows-x64'),
      artifactFileName: `${packageName}-${releaseTag}-windows-x64-setup.exe`,
      artifactOverrideKey: 'nsis.artifactName',
      builderArgs: ['--win', 'nsis', '--x64'],
      extraConfigArgs: []
    }
  }
}

function defineLinuxTargets(packageName, releaseTag, tempBuildRoot) {
  return {
    'linux-x64': {
      id: 'linux-x64',
      label: 'Linux x64',
      dockerPlatform: 'linux/amd64',
      depArch: 'x64',
      outputDir: join(tempBuildRoot, 'linux-x64'),
      artifactFileName: `${packageName}-${releaseTag}-linux-x64.AppImage`,
      dockerImage: 'electronuserland/builder:22'
    },
    'linux-arm64': {
      id: 'linux-arm64',
      label: 'Linux arm64',
      dockerPlatform: 'linux/arm64',
      depArch: 'arm64',
      outputDir: join(tempBuildRoot, 'linux-arm64'),
      artifactFileName: `${packageName}-${releaseTag}-linux-arm64.AppImage`,
      dockerImage: 'node:22-bookworm'
    }
  }
}

function resolveTargetSelection(allLocal, allLinux, { explicitTarget, buildAll }) {
  if (explicitTarget) {
    if (allLocal[explicitTarget]) {
      return { localTargets: [allLocal[explicitTarget]], linuxTargets: [] }
    }
    if (allLinux[explicitTarget]) {
      return { localTargets: [], linuxTargets: [allLinux[explicitTarget]] }
    }
    throw new Error(
      `Unknown --target=${explicitTarget}. Allowed: ${[...ALL_LOCAL_TARGET_IDS, ...ALL_LINUX_TARGET_IDS].join(', ')}`
    )
  }

  if (buildAll) {
    return {
      localTargets: ALL_LOCAL_TARGET_IDS.map((id) => allLocal[id]),
      linuxTargets: ALL_LINUX_TARGET_IDS.map((id) => allLinux[id])
    }
  }

  return {
    localTargets: DEFAULT_LOCAL_TARGET_IDS.map((id) => allLocal[id]),
    linuxTargets: []
  }
}

/**
 * Programmatic build entry-point. Reused from `build-siever.mjs`. Returns
 * the absolute paths of the artifacts that ended up in the release folder.
 */
export function runBuild({
  rawVersion,
  buildAll = false,
  explicitTarget = null,
  variant = 'public',
  releaseRootSuffix = ''
} = {}) {
  const version = normalizeVersionInput(rawVersion)
  const releaseTag = `v${version}`
  const distRoot = join(projectRoot, 'dist')
  const releaseRootName = releaseRootSuffix ? `${releaseTag}-${releaseRootSuffix}` : releaseTag
  const releaseRoot = join(projectRoot, 'release', variant, releaseRootName)
  const tempBuildRoot = join(distRoot, '.release-build', variant, releaseRootName)

  ensureDirectory(releaseRoot)
  ensureDirectory(tempBuildRoot)
  ensureDirectory(electronCacheDir)
  ensureDirectory(electronBuilderCacheDir)

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  const packageName = packageJson.name

  const allLocal = defineLocalTargets(packageName, releaseTag, tempBuildRoot)
  const allLinux = defineLinuxTargets(packageName, releaseTag, tempBuildRoot)
  const { localTargets, linuxTargets } = resolveTargetSelection(allLocal, allLinux, {
    explicitTarget,
    buildAll
  })

  console.log(
    `Preparing ${variant} release ${releaseTag} in ${releaseRoot}` +
      `\nTargets: ${[...localTargets, ...linuxTargets].map((t) => t.id).join(', ') || '(none)'}`
  )

  const envInjections = {
    SIEVER_APP_VERSION: version,
    LOAD_EXTENSION: variant === 'siever' ? '1' : ''
  }

  withTransientPackageVersion(version, () => {
    for (const [key, value] of Object.entries(envInjections)) {
      if (value !== undefined && value !== '') {
        process.env[key] = value
      }
    }
    run(npmCommand, ['run', 'build'], 'build application bundles')

    buildLocalTargetsForVersion(localTargets, releaseRoot)

    if (linuxTargets.length > 0) {
      ensureDockerDaemon()
      for (const linuxTarget of linuxTargets) {
        buildLinuxTarget(linuxTarget, releaseRoot, packageName, envInjections)
      }
    }
  })

  const artifactPaths = [...localTargets, ...linuxTargets].map((target) =>
    join(releaseRoot, target.artifactFileName)
  )

  console.log('\nRelease artifacts created:')
  for (const path of artifactPaths) {
    console.log(`- ${path}`)
  }

  return artifactPaths
}

function main() {
  const { positional, flags, options } = parseArgs(process.argv.slice(2))
  runBuild({
    rawVersion: positional[0],
    buildAll: flags.has('all'),
    explicitTarget: options.target ?? null
  })
}

const isInvokedDirectly = process.argv[1] === fileURLToPath(import.meta.url)
if (isInvokedDirectly) {
  try {
    main()
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
