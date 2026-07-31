'use strict'

// Drives the shipped entry points as real child processes. The GitHub API is stood up on
// loopback and pointed at with GITHUB_API_URL, so nothing here reaches the network.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { execFile } = require('node:child_process')
const { wellFormed } = require('../src/gridmap/svg.js')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

const ROOT = path.join(__dirname, '..')
const FIXTURES = path.join(__dirname, 'fixtures')

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gridmap-e2e-'))
  const outputFile = path.join(dir, 'github_output')
  fs.writeFileSync(outputFile, '')
  return {
    dir,
    outputFile,
    outputs() {
      const parsed = {}
      const lines = fs.readFileSync(outputFile, 'utf8').split('\n')
      for (let i = 0; i < lines.length; i++) {
        const simple = /^([A-Za-z0-9_-]+)=(.*)$/.exec(lines[i])
        if (simple) parsed[simple[1]] = simple[2]
      }
      return parsed
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

// Must not block the event loop: the fake API below runs in this very process, so a
// synchronous child would deadlock waiting for a server that cannot accept the connection.
async function run(script, env, dir) {
  // A developer machine may sit behind a corporate proxy. A GitHub runner does not, and a
  // request to loopback must never be proxied, so the child starts without those variables.
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/_proxy$/i.test(k)),
  )

  const { stdout } = await execFileAsync(process.execPath, [path.join(ROOT, 'src', script)], {
    env: {
      ...clean,
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
      GITHUB_OUTPUT: path.join(dir, 'github_output'),
      ...env,
    },
    encoding: 'utf8',
    timeout: 30000,
  })
  return stdout
}

/** A stand-in GitHub API on loopback. Records what it was asked to do. */
async function fakeApi(routes) {
  const requests = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body })
      const route = routes.find((r) => r.method === req.method && r.match.test(req.url))
      if (!route) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end('{"message":"no route"}')
        return
      }
      res.writeHead(route.status || 200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(route.body))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    requests,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

test('rendering writes a well-formed SVG and reports the totals as step outputs', async () => {
  const ws = workspace()
  try {
    const svgPath = path.join(ws.dir, 'grid-map.svg')
    const log = await run(
      'render-gridmap.js',
      { BREAKDOWN_PATH: path.join(FIXTURES, 'sample-breakdown.txt'), OUTPUT_PATH: svgPath },
      ws.dir,
    )

    const svg = fs.readFileSync(svgPath, 'utf8')
    assert.ok(svg.startsWith('<svg '), svg.slice(0, 40))
    assert.ok(svg.endsWith('</svg>'))
    assert.match(svg, /viewBox="0 0 830 499"/)
    assert.deepStrictEqual(wellFormed(svg), { ok: true })

    assert.deepStrictEqual(ws.outputs(), {
      'total-coverage': '76.8',
      'total-statements': '989',
      'covered-statements': '760',
      'package-count': '18',
      'grid-map-path': svgPath,
    })
    assert.match(log, /^::notice::Grid Map rendered: 18 packages/)
  } finally {
    ws.cleanup()
  }
})

// Fonts resolve on the reader's machine, so there is no glyph set to fall outside of and no
// character worth warning about.
test('an unusual package path renders without complaint', async () => {
  const ws = workspace()
  try {
    const breakdown = path.join(ws.dir, 'breakdown.txt')
    fs.writeFileSync(breakdown, 'my_pkg/a.go;10;5\nOtherPkg/b.go;10;9\n')
    const svgPath = path.join(ws.dir, 'g.svg')
    const log = await run('render-gridmap.js', { BREAKDOWN_PATH: breakdown, OUTPUT_PATH: svgPath }, ws.dir)

    assert.ok(!log.includes('::warning::'), log)
    assert.strictEqual(ws.outputs()['package-count'], '2')

    const svg = fs.readFileSync(svgPath, 'utf8')
    assert.ok(svg.includes('my_pkg'), 'the underscore survives')
    assert.ok(svg.includes('OtherPkg'), 'case is no longer flattened')
  } finally {
    ws.cleanup()
  }
})

test('the baseline lookup reports the newest successful run on the base branch', async () => {
  const ws = workspace()
  const api = await fakeApi([
    { method: 'GET', match: /\/actions\/workflows\/ci\.yml\/runs\?/, body: { workflow_runs: [{ id: 777 }] } },
  ])
  try {
    await run(
      'find-baseline.js',
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_API_URL: api.url,
        GITHUB_WORKFLOW_REF: 'acme/parcel/.github/workflows/ci.yml@refs/heads/main',
        BASE_BRANCH: 'main',
      },
      ws.dir,
    )
    assert.strictEqual(ws.outputs()['run-id'], '777')
    assert.match(api.requests[0].url, /branch=main&status=success/)
    assert.strictEqual(api.requests[0].headers.authorization, 'Bearer tok')
  } finally {
    await api.close()
    ws.cleanup()
  }
})

test('a repository with no successful base-branch run yields an empty run id and a warning', async () => {
  const ws = workspace()
  const api = await fakeApi([{ method: 'GET', match: /\/runs\?/, body: { workflow_runs: [] } }])
  try {
    const log = await run(
      'find-baseline.js',
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_API_URL: api.url,
        GITHUB_WORKFLOW_REF: 'acme/parcel/.github/workflows/ci.yml@refs/heads/main',
        BASE_BRANCH: 'main',
      },
      ws.dir,
    )
    assert.strictEqual(ws.outputs()['run-id'], '')
    assert.match(log, /::warning::No successful "ci\.yml" run found on main/)
  } finally {
    await api.close()
    ws.cleanup()
  }
})

test('an API failure during the baseline lookup degrades to no baseline', async () => {
  const ws = workspace()
  const api = await fakeApi([{ method: 'GET', match: /\/runs\?/, status: 403, body: { message: 'nope' } }])
  try {
    const log = await run(
      'find-baseline.js',
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_API_URL: api.url,
        GITHUB_WORKFLOW_REF: 'acme/parcel/.github/workflows/ci.yml@refs/heads/main',
        BASE_BRANCH: 'main',
      },
      ws.dir,
    )
    assert.strictEqual(ws.outputs()['run-id'], '')
    assert.match(log, /::warning::Baseline lookup failed/)
  } finally {
    await api.close()
    ws.cleanup()
  }
})

function eventFile(dir, payload) {
  const file = path.join(dir, 'event.json')
  fs.writeFileSync(file, JSON.stringify(payload))
  return file
}

test('the comment is created on a pull request, carrying the published grid map', async () => {
  const ws = workspace()
  const api = await fakeApi([
    { method: 'GET', match: /\/issues\/31\/comments/, body: [] },
    { method: 'POST', match: /\/issues\/31\/comments/, body: { id: 4001 } },
  ])
  try {
    const log = await run(
      'post-comment.js',
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_API_URL: api.url,
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventFile(ws.dir, { pull_request: { number: 31 } }),
        COVERAGE_OUTCOME: 'success',
        HAS_BASELINE: 'false',
        DIFF_THRESHOLD: '-1',
        BASE_BRANCH: 'main',
        CURRENT_BREAKDOWN_PATH: path.join(FIXTURES, 'sample-breakdown.txt'),
        BASE_BREAKDOWN_PATH: path.join(ws.dir, 'missing.txt'),
        IMAGE_URL: 'https://litter.catbox.moe/zzz999.svg',
      },
      ws.dir,
    )

    const posted = JSON.parse(api.requests[1].body).body
    assert.match(posted, /^<!-- go-covergrid:grid-map -->/)
    assert.match(posted, /✅ \*\*Coverage gate passed\*\*/)
    assert.match(posted, /\*\*Total coverage:\*\* .* 76\.8%/)
    assert.match(posted, /!\[Coverage Grid Map\]\(https:\/\/litter\.catbox\.moe\/zzz999\.svg\)/)
    assert.ok(!posted.includes('Coverage Diff'), 'no baseline means no diff summary')

    assert.strictEqual(ws.outputs()['comment-id'], '4001')
    assert.match(log, /::notice::Coverage comment created: #4001\./)
  } finally {
    await api.close()
    ws.cleanup()
  }
})

test('a second run edits the existing comment instead of adding another', async () => {
  const ws = workspace()
  const api = await fakeApi([
    {
      method: 'GET',
      match: /\/issues\/31\/comments/,
      body: [{ id: 88, body: '<!-- go-covergrid:grid-map -->\nstale' }],
    },
    { method: 'PATCH', match: /\/issues\/comments\/88/, body: { id: 88 } },
  ])
  try {
    await run(
      'post-comment.js',
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_API_URL: api.url,
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventFile(ws.dir, { pull_request: { number: 31 } }),
        COVERAGE_OUTCOME: 'success',
        HAS_BASELINE: 'false',
        DIFF_THRESHOLD: '-1',
        CURRENT_BREAKDOWN_PATH: path.join(FIXTURES, 'sample-breakdown.txt'),
        IMAGE_URL: '',
      },
      ws.dir,
    )
    assert.strictEqual(api.requests.length, 2)
    assert.strictEqual(api.requests[1].method, 'PATCH')
    assert.match(JSON.parse(api.requests[1].body).body, /Grid map not published for this run/)
  } finally {
    await api.close()
    ws.cleanup()
  }
})

test('a missing breakdown file still gets a comment, saying coverage could not be read', async () => {
  const ws = workspace()
  const api = await fakeApi([
    { method: 'GET', match: /\/issues\/5\/comments/, body: [] },
    { method: 'POST', match: /\/issues\/5\/comments/, body: { id: 1 } },
  ])
  try {
    const log = await run(
      'post-comment.js',
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_API_URL: api.url,
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventFile(ws.dir, { pull_request: { number: 5 } }),
        COVERAGE_OUTCOME: 'failure',
        HAS_BASELINE: 'false',
        DIFF_THRESHOLD: '-1',
        CURRENT_BREAKDOWN_PATH: path.join(ws.dir, 'nope.txt'),
        IMAGE_URL: '',
      },
      ws.dir,
    )
    assert.match(log, /::warning::No breakdown file at/)
    assert.match(JSON.parse(api.requests[1].body).body, /could not be read/)
  } finally {
    await api.close()
    ws.cleanup()
  }
})

test('a push build posts nothing and touches no API', async () => {
  const ws = workspace()
  const api = await fakeApi([])
  try {
    const log = await run(
      'post-comment.js',
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_API_URL: api.url,
        GITHUB_EVENT_NAME: 'push',
        GITHUB_EVENT_PATH: eventFile(ws.dir, {}),
        CURRENT_BREAKDOWN_PATH: path.join(FIXTURES, 'sample-breakdown.txt'),
      },
      ws.dir,
    )
    assert.strictEqual(api.requests.length, 0)
    assert.match(log, /skipping the coverage comment/)
  } finally {
    await api.close()
    ws.cleanup()
  }
})

test('the full comparison path renders a diff summary from two breakdown files', async () => {
  const ws = workspace()
  const baseline = path.join(ws.dir, 'baseline.txt')
  const stats = fs.readFileSync(path.join(FIXTURES, 'sample-breakdown.txt'), 'utf8')
  // A baseline where one file was less covered, so the diff has something to report.
  fs.writeFileSync(baseline, stats.replace('/internal/rest/service.go;68;47', '/internal/rest/service.go;68;30'))

  const api = await fakeApi([
    { method: 'GET', match: /\/issues\/9\/comments/, body: [] },
    { method: 'POST', match: /\/issues\/9\/comments/, body: { id: 2 } },
  ])
  try {
    await run(
      'post-comment.js',
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_API_URL: api.url,
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventFile(ws.dir, { pull_request: { number: 9 } }),
        COVERAGE_OUTCOME: 'success',
        HAS_BASELINE: 'true',
        DIFF_THRESHOLD: '-1',
        BASE_BRANCH: 'main',
        CURRENT_BREAKDOWN_PATH: path.join(FIXTURES, 'sample-breakdown.txt'),
        BASE_BREAKDOWN_PATH: baseline,
        IMAGE_URL: 'https://litter.catbox.moe/a.svg',
      },
      ws.dir,
    )
    const posted = JSON.parse(api.requests[1].body).body
    assert.match(posted, /Coverage Diff/)
    assert.match(posted, /\+ Hits\s+743\s+760\s+\+17/)
    assert.match(posted, /### Impacted packages/)
    assert.match(posted, /🟢 \| `example\.com\/acme\/parcel\/internal\/rest`/)
  } finally {
    await api.close()
    ws.cleanup()
  }
})
