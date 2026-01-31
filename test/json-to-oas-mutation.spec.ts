import { describe, expect, it } from 'vitest'

import { jsonSchemaToOAS_3_0 } from '../src/json-to-oas'

describe('jsonSchemaToOAS_3_0', () => {
  it('does not mutate the input schema (nested properties)', () => {
    const jsonSchema: any = {
      type: 'object',
      $schema: 'https://example.test/root',
      properties: {
        child: {
          type: 'object',
          $schema: 'https://example.test/child',
          unevaluatedProperties: false,
          properties: {
            name: { type: 'string' },
          },
        },
      },
    }

    const originalChild = jsonSchema.properties.child

    const oas = jsonSchemaToOAS_3_0(jsonSchema)

    // the converted schema strips JSON Schema keywords for OAS 3.0
    expect((oas as any).properties.child.$schema).toBeUndefined()
    expect((oas as any).properties.child.unevaluatedProperties).toBeUndefined()

    // but the input schema object must remain intact (it may be cached)
    expect(jsonSchema.properties.child).toBe(originalChild)
    expect(jsonSchema.properties.child.$schema).toBe('https://example.test/child')
    expect(jsonSchema.properties.child.unevaluatedProperties).toBe(false)
  })
})
