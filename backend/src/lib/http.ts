import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (m: string, details?: unknown) => new HttpError(400, m, 'bad_request', details);
export const unauthorized = (m = 'Authentication required') => new HttpError(401, m, 'unauthorized');
export const forbidden = (m = 'You do not have permission to do that') => new HttpError(403, m, 'forbidden');
export const notFound = (m = 'Not found') => new HttpError(404, m, 'not_found');
export const conflict = (m: string) => new HttpError(409, m, 'conflict');

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown;

/** Wrap async route handlers so rejected promises reach the error middleware. */
export const wrap =
  (fn: Handler) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

/** Validate and strip unknown keys. Throws a 400 with field errors. */
export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest('Invalid input', formatZod(r.error));
  return r.data;
}

function formatZod(e: ZodError) {
  return e.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Invalid input', details: formatZod(err) } });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: { code: 'file_too_large', message: 'File is larger than the allowed limit' } });
  }
  if (err && typeof err === 'object' && ('type' in err && (err as any).type === 'entity.too.large' || 'status' in err && (err as any).status === 413)) {
    return res.status(413).json({ error: { code: 'payload_too_large', message: 'Selected profile image is too large. Please select a smaller photo or take a new one.' } });
  }
  if (err instanceof Error && err.message.includes('CORS')) {
    return res.status(403).json({ error: { code: 'cors', message: 'Origin not allowed' } });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: { code: 'bad_json', message: 'Malformed JSON' } });
  }
  console.error('[unhandled]', req.method, req.path, err);
  return res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } });
}
