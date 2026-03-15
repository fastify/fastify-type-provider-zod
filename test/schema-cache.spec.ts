import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'

vi.mock('../src/zod-to-json', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/zod-to-json')>()

  return {
    ...actual,
    zodSchemaToJson: vi.fn(actual.zodSchemaToJson),
  }
})

describe('schema cache', () => {
  beforeEach(async () => {
    const { zodSchemaToJson } = await import('../src/zod-to-json')
    vi.mocked(zodSchemaToJson).mockClear()
  })
  it('caches input conversions for the same schema instance', async () => {
    const { createJsonSchemaTransform } = await import('../src/core')
    const { zodSchemaToJson } = await import('../src/zod-to-json')

    const transform = createJsonSchemaTransform({})
    const BODY = z.object({ name: z.string() })

    const base = {
      openapiObject: { openapi: '3.0.3' },
      schema: { body: BODY },
    }

    transform({ ...base, url: '/a' } as any)
    transform({ ...base, url: '/b' } as any)

    expect(vi.mocked(zodSchemaToJson)).toHaveBeenCalledTimes(1)
  })

  it('caches input/output separately', async () => {
    const { createJsonSchemaTransform } = await import('../src/core')
    const { zodSchemaToJson } = await import('../src/zod-to-json')

    const transform = createJsonSchemaTransform({})
    const SCHEMA = z.object({ name: z.string() })

    const base = {
      openapiObject: { openapi: '3.0.3' },
      url: '/a',
      schema: {
        body: SCHEMA,
        response: { 200: SCHEMA },
      },
    }

    transform(base as any)
    transform(base as any)

    // once for input, once for output
    expect(vi.mocked(zodSchemaToJson)).toHaveBeenCalledTimes(2)
  })
})
