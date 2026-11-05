import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { zodRegistryToJson, zodSchemaToJson } from '../src/zod-to-json'

describe('zod-to-json', () => {
  it('composes custom overrides with built-in output normalization for inline schemas', () => {
    const CREATED_AT = z.date()

    const jsonSchema = zodSchemaToJson(
      z.object({
        createdAt: CREATED_AT,
      }),
      z.registry(),
      'output',
      {
        target: 'openapi-3.0',
        override: (ctx) => {
          if (ctx.zodSchema === CREATED_AT) {
            ctx.jsonSchema.description = 'custom override'
          }
        },
      },
    )

    expect(jsonSchema).toMatchObject({
      properties: {
        createdAt: {
          description: 'custom override',
          format: 'date-time',
          type: 'string',
        },
      },
    })
  })

  it('composes custom overrides with built-in output normalization for registered schemas', () => {
    const CREATED_AT = z.date()
    const USER_SCHEMA = z.object({
      createdAt: CREATED_AT,
    })
    const registry = z.registry<{ id: string }>()

    registry.add(USER_SCHEMA, { id: 'User' })

    const jsonSchemas = zodRegistryToJson(registry, 'output', {
      target: 'openapi-3.0',
      override: (ctx) => {
        if (ctx.zodSchema === CREATED_AT) {
          ctx.jsonSchema.description = 'custom override'
        }
      },
    })

    expect(jsonSchemas.User).toMatchObject({
      properties: {
        createdAt: {
          description: 'custom override',
          format: 'date-time',
          type: 'string',
        },
      },
    })
  })

  it('uses the encoded wire schema for codecs and transforms in output mode', () => {
    const stringToNumber = z.codec(z.string().regex(/^\d+$/), z.number(), {
      decode: (str) => Number.parseInt(str, 10),
      encode: (num) => num.toString(),
    })

    const jsonSchema = zodSchemaToJson(
      z.object({
        encodedId: stringToNumber,
        transformedTag: z.string().transform((val) => val.length),
        createdAt: z.date(),
      }),
      z.registry(),
      'output',
      { target: 'openapi-3.0' },
    )

    expect(jsonSchema).toEqual({
      type: 'object',
      properties: {
        encodedId: {
          type: 'string',
          pattern: '^\\d+$',
        },
        transformedTag: {
          type: 'string',
        },
        createdAt: {
          type: 'string',
          format: 'date-time',
        },
      },
      required: ['encodedId', 'transformedTag', 'createdAt'],
      additionalProperties: false,
    })
  })

  it('preserves registered codec schemas and nested component refs in output mode', () => {
    const RAW_ID_SCHEMA = z.string().regex(/^\d+$/)
    const CODEC_SCHEMA = z.codec(RAW_ID_SCHEMA, z.number(), {
      decode: (str) => Number.parseInt(str, 10),
      encode: (num) => num.toString(),
    })

    const registry = z.registry<{ id?: string; description?: string }>()
    registry.add(RAW_ID_SCHEMA, { id: 'RawId' })
    registry.add(CODEC_SCHEMA, { id: 'EncodedNumber', description: 'Number encoded as digits' })

    const jsonSchemas = zodRegistryToJson(registry, 'output', {
      target: 'openapi-3.0',
    })

    expect(jsonSchemas.RawId).toEqual({
      type: 'string',
      pattern: '^\\d+$',
    })
    expect(jsonSchemas.EncodedNumber).toEqual({
      $ref: '#/components/schemas/RawId',
      description: 'Number encoded as digits',
    })
  })
})
