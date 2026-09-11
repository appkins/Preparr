import { describe, expect, test } from 'bun:test'
import { logger } from './logger'

test('logger exports all methods', () => {
  expect(typeof logger.debug).toBe('function')
  expect(typeof logger.info).toBe('function')
  expect(typeof logger.warn).toBe('function')
  expect(typeof logger.error).toBe('function')
})

test('logger handles metadata correctly', () => {
  const originalLog = console.log
  const originalWarn = console.warn
  const originalError = console.error

  const logs: string[] = []
  console.log = (msg: string) => logs.push(msg)
  console.warn = (msg: string) => logs.push(msg)
  console.error = (msg: string) => logs.push(msg)

  logger.info('test message', { key: 'value' })

  expect(logs).toHaveLength(1)
  expect(logs[0]).toContain('test message')
  expect(logs[0]).toContain('key')
  expect(logs[0]).toContain('value')

  console.log = originalLog
  console.warn = originalWarn
  console.error = originalError
})

describe('logger error serialization', () => {
  test('an Error in metadata keeps its message instead of becoming {}', () => {
    // JSON.stringify drops Error fields -- they are non-enumerable -- so a
    // plain `logger.error(msg, { error })` used to emit "error":{}, which says
    // nothing about what went wrong.
    const lines: string[] = []
    const original = console.error
    console.error = (line: string) => lines.push(line)

    try {
      logger.error('something failed', { error: new Error('the actual reason') })
    } finally {
      console.error = original
    }

    expect(lines.join('\n')).toContain('the actual reason')
  })

  test('keeps a nested Error inside metadata', () => {
    const lines: string[] = []
    const original = console.error
    console.error = (line: string) => lines.push(line)

    try {
      logger.error('step failed', { details: { cause: new Error('nested reason') } })
    } finally {
      console.error = original
    }

    expect(lines.join('\n')).toContain('nested reason')
  })
})
