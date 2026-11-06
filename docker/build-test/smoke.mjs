// Smoke-run harness for scripts/docker-build-test.sh (`pnpm docker:test`).
//
// Runs INSIDE the image under test, as one `RUN --network=none` step of
// docker/build-test/smoke.Dockerfile, so the checks need no Docker engine — only a
// BuildKit builder (Docker Desktop's, or CI's remote one). It replaces the old
// `docker run --rm --network none <image> <cmd>` calls: same filesystem, user, working
// directory and image environment, no network.
//
// The image may have no shell (the hardened dhi.io base), so this is plain Node.
//
// Input (build args, which BuildKit exposes to the RUN step as environment variables):
//   SMOKE_SPEC    one check per line, fields separated by TAB:
//                   <name> TAB <env> TAB <command> [TAB <arg>...]
//                 <env> is `-` or comma-separated KEY=VALUE pairs added to the image's
//                 environment (like `docker run -e`).
//   SMOKE_RUN_ID  a per-run value; written to <out>/run-id AFTER every check has run.
// Output, in the directory given as the only argument:
//   <name>.log     stdout + stderr of the check, interleaved (like `docker run … 2>&1`)
//   <name>.status  the exit code, `signal <SIG>`, `timeout`, or `error <message>`
//   run-id         SMOKE_RUN_ID — the script rejects a result without this run's id, so
//                  a cached RUN step can never pass for a fresh one.
//
// A failing CHECK is data, not an error: the harness records it and exits 0, and the
// script asserts on the files. Only a broken spec fails the build here.
import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// A check that neither exits nor fails is a hung entry point; kill it rather than hang the build.
const CHECK_TIMEOUT_MS = 120_000
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

const { SMOKE_SPEC: spec = '', SMOKE_RUN_ID: runId = '', ...imageEnv } = process.env
const outDir = process.argv[2]

if (!outDir || !runId || !spec.trim()) {
  console.error('smoke: usage: SMOKE_SPEC=… SMOKE_RUN_ID=… node smoke.mjs <out-dir>')
  process.exit(2)
}

function parseEnv(field) {
  if (field === '-') return {}
  const env = {}
  for (const pair of field.split(',')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) throw new Error(`bad env entry "${pair}"`)
    env[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  return env
}

function parseSpec(text) {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [name = '', envField = '', ...argv] = line.split('\t')
      if (!NAME_PATTERN.test(name)) throw new Error(`bad check name "${name}"`)
      if (argv.length === 0) throw new Error(`check "${name}" has no command`)
      return { name, env: parseEnv(envField), argv }
    })
}

function statusOf(result) {
  if (result.error?.code === 'ETIMEDOUT') return 'timeout'
  if (result.error) return `error ${result.error.message}`
  if (result.signal) return `signal ${result.signal}`
  return String(result.status)
}

function runCheck({ name, env, argv }) {
  const [command = '', ...args] = argv
  const fd = openSync(join(outDir, `${name}.log`), 'w')
  try {
    const result = spawnSync(command, args, {
      env: { ...imageEnv, ...env },
      stdio: ['ignore', fd, fd],
      timeout: CHECK_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    })
    writeFileSync(join(outDir, `${name}.status`), `${statusOf(result)}\n`)
  } finally {
    closeSync(fd)
  }
}

let checks
try {
  checks = parseSpec(spec)
} catch (error) {
  console.error(`smoke: invalid SMOKE_SPEC: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}

mkdirSync(outDir, { recursive: true })
for (const check of checks) runCheck(check)
writeFileSync(join(outDir, 'run-id'), `${runId}\n`)
console.log(`smoke: ran ${checks.length} check(s)`)
