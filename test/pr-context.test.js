'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { prNumberFrom } = require('../src/pr-context.js')

test('a pull_request event payload carries the number', () => {
  assert.strictEqual(prNumberFrom({ eventName: 'pull_request', payload: { pull_request: { number: 31 } } }), 31)
})

test('a pull_request_target event is treated the same way', () => {
  assert.strictEqual(
    prNumberFrom({ eventName: 'pull_request_target', payload: { pull_request: { number: 8 } } }),
    8,
  )
})

test('an issue_comment on a pull request resolves to that pull request', () => {
  assert.strictEqual(
    prNumberFrom({ eventName: 'issue_comment', payload: { issue: { number: 12, pull_request: {} } } }),
    12,
  )
})

test('an issue_comment on a plain issue resolves to nothing', () => {
  assert.strictEqual(prNumberFrom({ eventName: 'issue_comment', payload: { issue: { number: 12 } } }), null)
})

test('a push event resolves to nothing, so the comment step can skip', () => {
  assert.strictEqual(prNumberFrom({ eventName: 'push', payload: {} }), null)
})

test('a missing payload resolves to nothing rather than throwing', () => {
  assert.strictEqual(prNumberFrom({ eventName: 'pull_request', payload: null }), null)
  assert.strictEqual(prNumberFrom({}), null)
})
