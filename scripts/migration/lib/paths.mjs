import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..') // new-platform/
export const WORKSPACE = path.resolve(ROOT, '..') // D:\mostqel\ahmadza-web-store
export const OUT_DIR = path.join(ROOT, 'migration-output') // git-ignored reports
export const QUARANTINE = process.env.AAWRAQ_QUARANTINE ?? 'D:\\mostqel\\aawraq-quarantine' // OUTSIDE the project, never served
export const ARCHIVES = [
  { name: 'aawraq-source.tar.gz', file: path.join(WORKSPACE, 'aawraq-source.tar.gz'), gz: true },
  { name: 'aawraq-user-files.tar', file: path.join(WORKSPACE, 'aawraq-user-files.tar'), gz: false },
]
export const USER_FILES_TAR = ARCHIVES[1].file
