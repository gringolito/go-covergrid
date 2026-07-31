'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { createClient } = require('../src/github.js')

function stub(responses) {
  const calls = []
  const queue = [...responses]
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    const next = queue.shift()
    if (!next) throw new Error(`unexpected request to ${url}`)
    return {
      ok: next.status === undefined || next.status < 400,
      status: next.status ?? 200,
      headers: new Map(Object.entries(next.headers || {})),
      async text() {
        return typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? {})
      },
    }
  }
  return { calls, fetchImpl }
}

function client(responses, options = {}) {
  const { calls, fetchImpl } = stub(responses)
  return {
    calls,
    api: createClient({ token: 't0ken', repository: 'o/r', fetchImpl, apiUrl: 'https://api.github.com', ...options }),
  }
}

// A 403 is the one status the callers treat specially — it means a missing `permissions:` key
// rather than a bug — so the status has to survive on the error and not only inside its message.
test('a failed request carries the status code on the error', async () => {
  const { api } = client([{ status: 403, body: { message: 'Resource not accessible by integration' } }])

  await assert.rejects(
    () => api.upsertComment({ prNumber: 7, marker: '<!--m-->', body: 'x' }),
    (err) => {
      assert.strictEqual(err.status, 403)
      assert.match(err.message, /403/)
      return true
    },
  )
})

test('requests carry the bearer token, the API version and a JSON accept header', async () => {
  const { calls, api } = client([{ body: { id: 1 } }])
  await api.request('GET', '/repos/o/r/issues/7/comments')

  assert.strictEqual(calls[0].url, 'https://api.github.com/repos/o/r/issues/7/comments')
  assert.strictEqual(calls[0].init.method, 'GET')
  assert.strictEqual(calls[0].init.headers.authorization, 'Bearer t0ken')
  assert.strictEqual(calls[0].init.headers.accept, 'application/vnd.github+json')
  assert.strictEqual(calls[0].init.headers['x-github-api-version'], '2022-11-28')
})

test('the API base URL comes from the environment so GitHub Enterprise works', async () => {
  const { calls, api } = client([{ body: {} }], { apiUrl: 'https://ghe.example.com/api/v3' })
  await api.request('GET', '/rate_limit')
  assert.strictEqual(calls[0].url, 'https://ghe.example.com/api/v3/rate_limit')
})

test('a body is sent as JSON with a content type', async () => {
  const { calls, api } = client([{ body: {} }])
  await api.request('POST', '/x', { body: 'hello' })
  assert.strictEqual(calls[0].init.body, '{"body":"hello"}')
  assert.strictEqual(calls[0].init.headers['content-type'], 'application/json')
})

test('an error response throws with the status and the response text', async () => {
  const { api } = client([{ status: 403, body: 'Resource not accessible by integration' }])
  await assert.rejects(() => api.request('GET', '/x'), /403.*not accessible/s)
})

test('paginate follows the rel=next link and concatenates the pages', async () => {
  const { calls, api } = client([
    { body: [{ id: 1 }], headers: { link: '<https://api.github.com/next-page>; rel="next"' } },
    { body: [{ id: 2 }] },
  ])
  const all = await api.paginate('/repos/o/r/issues/7/comments')

  assert.deepStrictEqual(all, [{ id: 1 }, { id: 2 }])
  assert.strictEqual(calls[1].url, 'https://api.github.com/next-page')
})

test('paginate asks for the largest page size so one page usually suffices', async () => {
  const { calls, api } = client([{ body: [] }])
  await api.paginate('/repos/o/r/issues/7/comments')
  assert.match(calls[0].url, /[?&]per_page=100(&|$)/)
})

test('a comment carrying the marker is updated rather than duplicated', async () => {
  const { calls, api } = client([
    { body: [{ id: 5, body: 'unrelated' }, { id: 9, body: 'MARK\nold' }] },
    { body: { id: 9 } },
  ])
  const result = await api.upsertComment({ prNumber: 7, marker: 'MARK', body: 'MARK\nnew' })

  assert.deepStrictEqual(result, { id: 9, action: 'updated' })
  assert.strictEqual(calls[1].init.method, 'PATCH')
  assert.strictEqual(calls[1].url, 'https://api.github.com/repos/o/r/issues/comments/9')
})

test('with no marked comment present a new one is created', async () => {
  const { calls, api } = client([{ body: [{ id: 5, body: 'unrelated' }] }, { body: { id: 12 } }])
  const result = await api.upsertComment({ prNumber: 7, marker: 'MARK', body: 'MARK\nnew' })

  assert.deepStrictEqual(result, { id: 12, action: 'created' })
  assert.strictEqual(calls[1].init.method, 'POST')
  assert.strictEqual(calls[1].url, 'https://api.github.com/repos/o/r/issues/7/comments')
})

test('the latest successful run on the base branch is found', async () => {
  const { calls, api } = client([{ body: { workflow_runs: [{ id: 4242 }] } }])
  const id = await api.latestSuccessfulRunId({ workflow: 'ci.yml', branch: 'main' })

  assert.strictEqual(id, 4242)
  assert.match(calls[0].url, /\/repos\/o\/r\/actions\/workflows\/ci\.yml\/runs\?/)
  assert.match(calls[0].url, /branch=main/)
  assert.match(calls[0].url, /status=success/)
  assert.match(calls[0].url, /per_page=1/)
})

test('no successful run yet yields null rather than an error', async () => {
  const { api } = client([{ body: { workflow_runs: [] } }])
  assert.strictEqual(await api.latestSuccessfulRunId({ workflow: 'ci.yml', branch: 'main' }), null)
})

test('a workflow filename is URL-encoded so a path cannot be injected', async () => {
  const { calls, api } = client([{ body: { workflow_runs: [] } }])
  await api.latestSuccessfulRunId({ workflow: '../../evil.yml', branch: 'main' })
  assert.ok(!calls[0].url.includes('../'), calls[0].url)
})
