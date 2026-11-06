#!/usr/bin/env node
// check-version-sync.mjs [repo-root] — mise, the Dockerfiles and CI take every version from
// versions.env, exactly pinned and locked, so none of them can drift from it.
//
// Run by scripts/sync-versions.sh (`pnpm sync:versions`, CI job `versions in sync`); exits 1
// with one line per problem. Zero dependencies (the CI job runs it on a bare alpine nodejs).
//
// 1. mise.toml: every [tools] entry is `"{{ env.<KEY> }}"` with an exact X.Y.Z in versions.env
//    (node = NODE_VERSION); [settings] keeps the lock maintained, locked and quarantined.
// 2. mise.lock: each tool locked once, at exactly its versions.env version, with a sha256 +
//    https URL for every `lockfile_platforms` entry; nothing locked that nothing pins.
// 3. Dockerfiles: every FROM resolves to `<image>:${NODE_VERSION}-alpine${ALPINE_VERSION}…@${<digest key>}`.
// 4. CI: every Node job image is `${NODE_CI_IMAGE}`, which `initialise variables` builds from
//    NODE_VERSION + ALPINE_VERSION + NODE_STOCK_DIGEST; git-cliff's image tag is GIT_CLIFF_VERSION.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const EXACT = /^\d+\.\d+\.\d+$/
const SHA256 = /^sha256:[0-9a-f]{64}$/
const REQUIRED_PLATFORMS = ['linux-x64', 'linux-arm64', 'macos-arm64']

const NODE_TAG = `\${NODE_VERSION}-alpine\${ALPINE_VERSION}`
/** The base images each Dockerfile may use — the digest makes the tag documentation only. */
const DOCKERFILES = {
  'docker/Dockerfile': [
    `dhi.io/node:${NODE_TAG}@\${NODE_DHI_DIGEST}`,
    `dhi.io/node:${NODE_TAG}-dev@\${NODE_DHI_DEV_DIGEST}`,
  ],
  'docker/Dockerfile.local': [`node:${NODE_TAG}@\${NODE_STOCK_DIGEST}`],
  'telemetry-backend/Dockerfile': [`node:${NODE_TAG}@\${NODE_STOCK_DIGEST}`],
}
const CI_NODE_IMAGE_LINE = `echo "NODE_CI_IMAGE=node:\${NODE_VERSION:?}-alpine\${ALPINE_VERSION:?}@\${NODE_STOCK_DIGEST:?}" >> variables.env`

/** versions.env → Map(KEY → value). */
function parseVersionsEnv(text) {
  const out = new Map()
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (m) out.set(m[1], m[2])
  }
  return out
}

/** The narrow TOML subset mise.toml uses: `[section]`, `key = "str" | true | false | [ "a", … ]` on one line. */
function parseMiseToml(text) {
  const doc = {}
  let section = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim()
    if (line === '' || line.startsWith('#')) continue
    const sec = line.match(/^\[([\w.-]+)\]$/)
    if (sec) {
      section = sec[1]
      doc[section] ??= {}
      continue
    }
    const kv = line.match(/^(?:"([^"]+)"|([\w.-]+))\s*=\s*(.+)$/)
    if (!kv || section === null) continue
    doc[section][kv[1] ?? kv[2]] = parseValue(kv[3])
  }
  return doc
}

function parseValue(v) {
  if (v === 'true' || v === 'false') return v === 'true'
  const str = v.match(/^"([^"]*)"$/)
  if (str) return str[1]
  const arr = v.match(/^\[(.*)\]$/)
  if (arr) return [...arr[1].matchAll(/"([^"]*)"/g)].map((m) => m[1])
  return v
}

/** mise.lock → Map(tool → [{ version, platforms: Map(platform → { checksum, url }) }]). Throws on an unknown line. */
function parseMiseLock(text) {
  const key = String.raw`(?:"([^"]+)"|([\w.-]+))`
  const toolHeader = new RegExp(String.raw`^\[\[tools\.${key}\]\]$`)
  const platformHeader = new RegExp(String.raw`^\[tools\.${key}\."platforms\.([\w-]+)"\]$`)
  const subHeader = new RegExp(String.raw`^\[tools\.${key}\.[\w.]+\]$`)
  const tools = new Map()
  let target = null
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const tool = line.match(toolHeader)
    if (tool) {
      const name = tool[1] ?? tool[2]
      target = { platforms: new Map() }
      tools.set(name, [...(tools.get(name) ?? []), target])
      continue
    }
    const plat = line.match(platformHeader)
    if (plat) {
      const entries = tools.get(plat[1] ?? plat[2])
      if (!entries) throw new Error(`mise.lock:${i + 1}: platform table before its tool`)
      target = {}
      entries.at(-1).platforms.set(plat[3], target)
      continue
    }
    if (subHeader.test(line)) {
      target = {} // e.g. [tools.x.options] — read, not checked
      continue
    }
    const kv = line.match(/^([\w.-]+)\s*=\s*(.+)$/)
    if (!kv) throw new Error(`mise.lock:${i + 1}: cannot parse \`${line}\``)
    if (target) target[kv[1]] = parseValue(kv[2])
  }
  return tools
}

function miseProblems(env, miseText, lockText) {
  const problems = []
  const doc = parseMiseToml(miseText)
  const settings = doc.settings ?? {}
  if (settings.lockfile !== true)
    problems.push('mise.toml [settings] must set `lockfile = true` — mise.lock would stop being kept current')
  const platforms = Array.isArray(settings.lockfile_platforms) ? settings.lockfile_platforms : []
  for (const p of REQUIRED_PLATFORMS)
    if (!platforms.includes(p)) problems.push(`mise.toml [settings] lockfile_platforms must include ${p}`)
  if (typeof settings.minimum_release_age !== 'string' || /^0[a-z]*$/.test(settings.minimum_release_age))
    problems.push('mise.toml [settings] must set `minimum_release_age` (e.g. "1d") — the release-age quarantine')

  const pins = new Map()
  for (const [name, spec] of Object.entries(doc.tools ?? {})) {
    const tpl = typeof spec === 'string' ? spec.match(/^\{\{\s*env\.([A-Z][A-Z0-9_]*)\s*\}\}$/) : null
    if (!tpl) {
      problems.push(
        `mise.toml pins ${name} as ${JSON.stringify(spec)} — every tool reads versions.env: "{{ env.<KEY> }}"`,
      )
      continue
    }
    const version = env.get(tpl[1])
    if (!EXACT.test(version ?? ''))
      problems.push(`versions.env ${tpl[1]} (mise tool ${name}) is "${version ?? ''}" — every tool is an exact X.Y.Z`)
    pins.set(name, version)
  }
  if (doc.tools?.node !== '{{ env.NODE_VERSION }}') problems.push('mise.toml must pin node = "{{ env.NODE_VERSION }}"')

  let lock
  try {
    lock = parseMiseLock(lockText)
  } catch (e) {
    return [...problems, e.message]
  }
  for (const [name, version] of pins) {
    const entries = lock.get(name) ?? []
    if (entries.length !== 1) {
      problems.push(`mise.lock has ${entries.length} entries for ${name} (pinned ${version}) — run \`mise lock\``)
      continue
    }
    const [entry] = entries
    if (entry.version !== version)
      problems.push(`mise.lock locks ${name} ${entry.version} but versions.env says ${version} — run \`mise lock\``)
    for (const p of platforms) {
      const locked = entry.platforms.get(p)
      if (!locked) problems.push(`mise.lock has no ${p} artifact for ${name} — run \`mise lock\``)
      else if (!SHA256.test(locked.checksum ?? '') || !/^https:\/\//.test(locked.url ?? ''))
        problems.push(`mise.lock's ${name} ${p} entry lacks a sha256 checksum or an https URL — run \`mise lock\``)
    }
  }
  for (const name of lock.keys())
    if (!pins.has(name)) problems.push(`mise.lock locks ${name}, which mise.toml no longer pins — run \`mise lock\``)
  return problems
}

/** Each FROM's image with the global ARG defaults substituted (`${X:?msg}` → `${X}` when X has none). */
function dockerfileBases(text) {
  const args = new Map()
  const bases = []
  const stages = new Set()
  const expand = (s) =>
    s.replace(/\$\{(\w+)(?::\?[^}]*)?\}/g, (_, name) => (args.has(name) ? expand(args.get(name)) : `\${${name}}`))
  let global = true
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const arg = line.match(/^ARG\s+(\w+)(?:=(.*))?$/)
    if (arg && global && arg[2] !== undefined) args.set(arg[1], arg[2])
    const from = line.match(/^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?$/i)
    if (from) {
      global = false
      if (!stages.has(from[1])) bases.push(expand(from[1]))
      if (from[2]) stages.add(from[2])
    }
  }
  return bases
}

function dockerProblems(read) {
  const problems = []
  for (const [file, allowed] of Object.entries(DOCKERFILES)) {
    const bases = dockerfileBases(read(file))
    if (bases.length === 0) problems.push(`${file}: no FROM line found`)
    for (const base of bases)
      if (!allowed.includes(base))
        problems.push(`${file}: FROM ${base} — must be one of ${allowed.join(', ')} (versions.env, pinned by digest)`)
  }
  return problems
}

function ciProblems(read, ciFiles) {
  const problems = []
  let builds = false
  for (const file of ciFiles) {
    const text = read(file)
    if (text.includes(CI_NODE_IMAGE_LINE)) builds = true
    for (const [i, raw] of text.split('\n').entries()) {
      const m = raw.match(/^\s*(?:image|name):\s*["']?([^\s"']+)/)
      if (!m) continue
      const image = m[1]
      if (/^(?:[\w.-]+\/)*node[:@]/.test(image) || image.includes('NODE_IMAGE_TAG'))
        problems.push(
          `${file}:${i + 1}: job image ${image} — Node jobs use \${NODE_CI_IMAGE} (versions.env, digest-pinned)`,
        )
      if (image.startsWith('orhunp/git-cliff:') && image !== `orhunp/git-cliff:\${GIT_CLIFF_VERSION}`)
        problems.push(`${file}:${i + 1}: ${image} — git-cliff's image tag is \${GIT_CLIFF_VERSION} (versions.env)`)
    }
  }
  if (!builds)
    problems.push(`no CI file sets NODE_CI_IMAGE with \`${CI_NODE_IMAGE_LINE}\` (job \`initialise variables\`)`)
  return problems
}

function versionSyncProblems(root) {
  const read = (f) => readFileSync(path.join(root, f), 'utf8')
  const env = parseVersionsEnv(read('versions.env'))
  const ciDir = path.join(root, '.gitlab', 'ci')
  const ciFiles = [
    '.gitlab-ci.yml',
    ...readdirSync(ciDir)
      .filter((f) => /\.ya?ml$/.test(f))
      .sort()
      .map((f) => path.join('.gitlab', 'ci', f)),
  ]
  return [
    ...miseProblems(env, read('mise.toml'), read('mise.lock')),
    ...dockerProblems(read),
    ...ciProblems(read, ciFiles),
  ]
}

const root = process.argv[2] ?? path.resolve(import.meta.dirname, '..')
const problems = versionSyncProblems(root)
if (problems.length > 0) {
  console.error('ERROR: a version has drifted from versions.env:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('  mise.toml + mise.lock, Dockerfiles and CI images agree with versions.env.')
