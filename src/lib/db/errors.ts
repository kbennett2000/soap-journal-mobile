/**
 * Structured errors for the data layer.
 *
 * Ported from the server's `core/errors.py` ErrorCode and matched to the web
 * app's `lib/apiError.ts` shape, so repositories throw exactly what the ported
 * UI's error handling and ErrorBoundary already know how to display.
 *
 * Scope: single-user app. The server's auth/admin codes (USERNAME_TAKEN,
 * REGISTRATION_CLOSED, INVALID_CREDENTIALS, NOT_AUTHENTICATED, ADMIN_REQUIRED,
 * USER_NOT_FOUND, LAST_ADMIN) are intentionally omitted — there is no auth here
 * (see CLAUDE.md "Out of Scope"), so they can never be raised. The codes below
 * are the ones this app can actually produce.
 */

export enum ErrorCode {
  INVALID_REFERENCE = 'INVALID_REFERENCE',
  TRANSLATION_NOT_FOUND = 'TRANSLATION_NOT_FOUND',
  BOOK_NOT_FOUND = 'BOOK_NOT_FOUND',
  CHAPTER_NOT_FOUND = 'CHAPTER_NOT_FOUND',
  REFERENCE_OUT_OF_RANGE = 'REFERENCE_OUT_OF_RANGE',
  ENTRY_NOT_FOUND = 'ENTRY_NOT_FOUND',
  INVALID_BOOK = 'INVALID_BOOK',
  INVALID_DATE_RANGE = 'INVALID_DATE_RANGE',
}

/**
 * Single error type for the data layer, shape-identical to the web app's
 * `ApiError`. `status` is the HTTP-equivalent status the server would have
 * returned (repositories supply it per the cross-cutting status→code map),
 * `code` is the structured error code, and `message` is the human-readable
 * detail. Catch blocks branch on `code` and fall back to `message` for display.
 */
export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}
