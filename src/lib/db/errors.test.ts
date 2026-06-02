import { describe, expect, it } from 'vitest'

import { ApiError, ErrorCode } from './errors'

describe('errors', () => {
  it('ApiError carries status, code, and message and is an Error', () => {
    const err = new ApiError(404, ErrorCode.ENTRY_NOT_FOUND, 'no such entry')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ApiError')
    expect(err.status).toBe(404)
    expect(err.code).toBe('ENTRY_NOT_FOUND')
    expect(err.message).toBe('no such entry')
  })

  it('ErrorCode values equal their names (string enum)', () => {
    expect(ErrorCode.INVALID_REFERENCE).toBe('INVALID_REFERENCE')
    expect(ErrorCode.INVALID_DATE_RANGE).toBe('INVALID_DATE_RANGE')
  })

  it('exposes exactly the single-user subset (no auth codes)', () => {
    expect(Object.values(ErrorCode).sort()).toEqual(
      [
        'BOOK_NOT_FOUND',
        'CHAPTER_NOT_FOUND',
        'ENTRY_NOT_FOUND',
        'INVALID_BOOK',
        'INVALID_DATE_RANGE',
        'INVALID_REFERENCE',
        'REFERENCE_OUT_OF_RANGE',
        'TRANSLATION_NOT_FOUND',
      ].sort(),
    )
  })
})
