import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';

export const server = {
  hello: defineAction({
    input: z.object({ name: z.string() }),
    handler: async ({ name }) => `hello ${name}`,
  }),
};
