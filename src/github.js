'use strict'

// The slice of the GitHub REST API this action needs, over the global `fetch` that ships
// with Node. `@actions/github` and Octokit are npm packages, and there are no runtime
// dependencies (ADR-0003).
//
// `fetchImpl` is injectable so every request this builds can be asserted offline.

const API_VERSION = '2022-11-28'

/**
 * @param {object} options
 * @param {string} options.token
 * @param {string} options.repository `owner/repo`
 * @param {string} [options.apiUrl]
 * @param {typeof fetch} [options.fetchImpl]
 */
function createClient({ token, repository, apiUrl = 'https://api.github.com', fetchImpl = fetch }) {
  const [owner, repo] = repository.split('/')
  if (!owner || !repo) throw new Error(`expected owner/repo, got "${repository}"`)

  const base = apiUrl.replace(/\/+$/, '')

  async function request(method, pathOrUrl, body) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${base}${pathOrUrl}`

    const headers = {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': API_VERSION,
      'user-agent': 'go-covergrid',
    }
    const init = { method, headers }
    if (body !== undefined) {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    }

    const response = await fetchImpl(url, init)
    const text = await response.text()
    if (!response.ok) {
      const err = new Error(`GitHub API ${method} ${url} failed with ${response.status}: ${text.slice(0, 500)}`)
      // Callers key off this: a 403 is almost always a missing `permissions:` key, and earns
      // a better message than a stack trace.
      err.status = response.status
      throw err
    }

    return { data: text === '' ? null : JSON.parse(text), headers: response.headers }
  }

  /** Follows `Link: rel="next"` until exhausted, concatenating array pages. */
  async function paginate(path) {
    const separator = path.includes('?') ? '&' : '?'
    let url = `${path}${separator}per_page=100`
    const all = []

    while (url) {
      const { data, headers } = await request('GET', url)
      all.push(...data)
      const link = headers.get ? headers.get('link') : undefined
      const next = link && /<([^>]+)>;\s*rel="next"/.exec(link)
      url = next ? next[1] : null
    }

    return all
  }

  /**
   * Posts the comment, or edits the existing one carrying the marker. One comment per pull
   * request, updated in place, so a busy PR does not accumulate a wall of coverage reports.
   */
  async function upsertComment({ prNumber, marker, body }) {
    const comments = await paginate(`/repos/${owner}/${repo}/issues/${prNumber}/comments`)
    const existing = comments.find((c) => c.body && c.body.includes(marker))

    if (existing) {
      await request('PATCH', `/repos/${owner}/${repo}/issues/comments/${existing.id}`, { body })
      return { id: existing.id, action: 'updated' }
    }

    const { data } = await request('POST', `/repos/${owner}/${repo}/issues/${prNumber}/comments`, { body })
    return { id: data.id, action: 'created' }
  }

  /**
   * The run whose artifacts hold the Baseline. Null on a repository's first run, which
   * every comparison has to degrade gracefully without.
   */
  async function latestSuccessfulRunId({ workflow, branch }) {
    const query = new URLSearchParams({ branch, status: 'success', per_page: '1' })
    const path = `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?${query}`
    const { data } = await request('GET', path)
    return data.workflow_runs.length > 0 ? data.workflow_runs[0].id : null
  }

  return { owner, repo, request, paginate, upsertComment, latestSuccessfulRunId }
}

module.exports = { createClient, API_VERSION }
