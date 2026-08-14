#!/usr/bin/env node

import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

await Promise.all([
  rm(join(root, 'lib'), { recursive: true, force: true }),
  rm(join(root, '.client-build'), { recursive: true, force: true }),
])
