import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrate: {
    path: 'prisma/migrations'
  },
  datasource: {
    url: 'file:./prisma/dev.db'
  }
})
