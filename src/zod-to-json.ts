import type {
  $ZodCodec,
  $ZodDate,
  $ZodUndefined,
  $ZodUnion,
  JSONSchema,
  RegistryToJSONSchemaParams,
} from 'zod/v4/core'
import { $ZodRegistry, $ZodType, toJSONSchema, $ZodCodec as ZodCodec } from 'zod/v4/core'
import type { SchemaRegistryMeta } from './registry.ts'
import { getReferenceUri } from './utils.ts'

const SCHEMA_REGISTRY_ID_PLACEHOLDER = '__SCHEMA__ID__PLACEHOLDER__'
const SCHEMA_URI_PLACEHOLDER = '__SCHEMA__PLACEHOLDER__'

function isZodDate(entity: unknown): entity is $ZodDate {
  return entity instanceof $ZodType && entity._zod.def.type === 'date'
}

function isZodUnion(entity: unknown): entity is $ZodUnion {
  return entity instanceof $ZodType && entity._zod.def.type === 'union'
}

function isZodUndefined(entity: unknown): entity is $ZodUndefined {
  return entity instanceof $ZodType && entity._zod.def.type === 'undefined'
}

function isZodCodec(entity: unknown): entity is $ZodCodec {
  return entity instanceof ZodCodec
}

type ZodToJsonIO = 'input' | 'output' | 'response'

const getOverride = (
  ctx: {
    zodSchema: $ZodType
    jsonSchema: JSONSchema.BaseSchema
  },
  io: ZodToJsonIO,
  registry: $ZodRegistry<SchemaRegistryMeta>,
  config: ZodToJsonConfig,
): boolean => {
  if (io === 'response' && isZodCodec(ctx.zodSchema)) {
    const encodedSchema = zodSchemaToJsonInline(ctx.zodSchema, registry, 'input', config)

    for (const key in ctx.jsonSchema) {
      delete ctx.jsonSchema[key]
    }
    Object.assign(ctx.jsonSchema, encodedSchema)

    return true
  }

  if (isZodUnion(ctx.zodSchema)) {
    // Filter unrepresentable types in unions
    // TODO: Should be fixed upstream and not merged in this plugin.
    // Remove when passed: https://github.com/colinhacks/zod/pull/5013
    ctx.jsonSchema.anyOf = ctx.jsonSchema.anyOf?.filter((schema) => Object.keys(schema).length > 0)
  }

  if (isZodDate(ctx.zodSchema)) {
    // Allow dates to be represented as strings in output schemas
    if (io !== 'input') {
      ctx.jsonSchema.type = 'string'
      ctx.jsonSchema.format = 'date-time'
    }
  }

  if (isZodUndefined(ctx.zodSchema)) {
    // Allow undefined to be represented as null in output schemas
    if (io !== 'input') {
      ctx.jsonSchema.type = 'null'
    }
  }

  return false
}

export type ZodToJsonConfig = {} & Omit<
  RegistryToJSONSchemaParams,
  'io' | 'metadata' | 'cycles' | 'reused' | 'uri'
>

const composeOverride = (
  io: ZodToJsonIO,
  registry: $ZodRegistry<SchemaRegistryMeta>,
  config: ZodToJsonConfig,
): RegistryToJSONSchemaParams['override'] => {
  return (ctx) => {
    const codecSchemaReplaced = getOverride(ctx, io, registry, config)
    if (!codecSchemaReplaced) {
      config.override?.(ctx)
    }
  }
}

const deleteInvalidProperties: (
  schema: JSONSchema.BaseSchema,
) => Omit<JSONSchema.BaseSchema, 'id' | '$schema'> = (schema) => {
  const object = { ...schema }

  delete object.id
  delete object.$schema

  // ToDo added in newer zod
  delete object.$id

  return object
}

const zodSchemaToJsonInline: (
  zodSchema: $ZodType,
  registry: $ZodRegistry<SchemaRegistryMeta>,
  io: ZodToJsonIO,
  config: ZodToJsonConfig,
) => ReturnType<typeof deleteInvalidProperties> = (zodSchema, registry, io, config) => {
  /**
   * Unfortunately, at the time of writing, there is no way to generate a schema with `$ref`
   * using `toJSONSchema` and a zod schema.
   *
   * As a workaround, we create a zod registry containing only the specific schema we want to convert.
   *
   * @see https://github.com/colinhacks/zod/issues/4281
   */
  const tempRegistry = new $ZodRegistry<SchemaRegistryMeta>()
  tempRegistry.add(zodSchema, { id: SCHEMA_REGISTRY_ID_PLACEHOLDER })

  const {
    schemas: { [SCHEMA_REGISTRY_ID_PLACEHOLDER]: result },
  } = toJSONSchema(tempRegistry, {
    ...config,
    io: io === 'response' ? 'output' : io,
    target: config.target,
    metadata: registry,
    unrepresentable: config.unrepresentable ?? 'any',
    cycles: 'ref',
    reused: 'inline',
    /**
     * The uri option only allows customizing the base path of the `$ref`, and it automatically appends a path to it.
     * As a workaround, we set a placeholder that looks something like this.
     * @see jsonSchemaReplaceRef
     * @see https://github.com/colinhacks/zod/issues/4750
     */
    uri: () => SCHEMA_URI_PLACEHOLDER,
    override: composeOverride(io, registry, config),
  })

  const jsonSchema = deleteInvalidProperties(result)

  /**
   * Replace the previous generated placeholders with the final `$ref` value
   */
  return JSON.parse(JSON.stringify(jsonSchema), (__key, value) => {
    if (typeof value === 'string' && value.startsWith(SCHEMA_URI_PLACEHOLDER)) {
      return getReferenceUri(value.slice(SCHEMA_URI_PLACEHOLDER.length))
    }
    return value
  }) as typeof result
}

export const zodSchemaToJson: (
  zodSchema: $ZodType,
  registry: $ZodRegistry<SchemaRegistryMeta>,
  io: ZodToJsonIO,
  config: ZodToJsonConfig,
) => ReturnType<typeof deleteInvalidProperties> = (zodSchema, registry, io, config) => {
  /**
   * Checks whether the provided schema is registered in the given registry.
   * If it is present and has an `id`, it can be referenced as component.
   *
   * @see https://github.com/turkerdev/fastify-type-provider-zod/issues/173
   */
  const schemaRegistryEntry = registry.get(zodSchema)
  if (schemaRegistryEntry?.id) {
    return { $ref: getReferenceUri(schemaRegistryEntry.id) }
  }

  return zodSchemaToJsonInline(zodSchema, registry, io, config)
}

export const zodRegistryToJson: (
  registry: $ZodRegistry<SchemaRegistryMeta>,
  io: ZodToJsonIO,
  config: ZodToJsonConfig,
) => Record<string, JSONSchema.BaseSchema> = (registry, io, config) => {
  const result = toJSONSchema(registry, {
    ...config,
    io: io === 'response' ? 'output' : io,
    target: config.target,
    metadata: registry,
    unrepresentable: config.unrepresentable ?? 'any',
    cycles: 'ref',
    reused: 'inline',
    uri: (id) => getReferenceUri(id),
    override: composeOverride(io, registry, config),
  }).schemas

  const jsonSchemas: Record<string, JSONSchema.BaseSchema> = {}
  for (const id in result) {
    jsonSchemas[id] = deleteInvalidProperties(result[id])
  }

  return jsonSchemas
}
