import { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Validates and parses a request body/query with a shared contracts schema. ZodErrors become 422 VALIDATION_FAILED. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
