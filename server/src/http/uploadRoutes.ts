import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ImportResponse } from '@kyc/contracts';
import { KycError } from '@kyc/core';
import { parse } from './validate';
import { createUploadSnapshot, UPLOAD_OWNER, upsertRepository } from '../index/snapshots';
import { extractLimits } from '../jobs/importJob';
import { hasZipSignature, readZipDirectory } from '../ingestion/zip';
import type { Services } from '../services';

/** Content types a browser or desktop client may send a .zip as. Nothing CORS-safelisted (text/plain, forms). */
const ZIP_TYPES = ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'];

const UploadQuery = z.object({ name: z.string().max(1024).optional() });

/**
 * A safe display name from an uploaded file name: no directories, no ".zip", only [A-Za-z0-9._-] (anything else
 * becomes "-"), no leading dots or dashes, 1–100 characters; "project" when nothing usable is left.
 */
export function uploadDisplayName(raw: string | undefined): string {
  if (!raw) return 'project';
  const base = raw.split(/[/\\]/).pop() ?? '';
  const name = base
    .replace(/\.zip$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/-+$/, '')
    .slice(0, 100)
    .replace(/[.-]+$/, '');
  return name.length > 0 ? name : 'project';
}

/**
 * POST /api/v1/uploads?name=<file name> with the raw ZIP bytes as the body: the same import job as a GitHub import
 * (same stages, limits, redaction and analysis), reading the archive from the database instead of GitHub.
 */
export function registerUploadRoutes(app: FastifyInstance, svc: Services) {
  const { db, config, limiter, runner, identity } = svc;
  const maxBytes = config.MAX_TARBALL_BYTES;
  const ip = (req: FastifyRequest) => req.ip;

  // Encapsulated: the binary body parser exists only for this route; every other route stays JSON-only.
  void app.register(async (scope) => {
    scope.addContentTypeParser(ZIP_TYPES, (req, payload, done) => {
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        payload.resume();
        return done(new KycError('REPO_TOO_LARGE', 'The ZIP file is larger than the upload limit.'));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let finished = false;
      const finish = (err: Error | null, body?: Buffer) => {
        if (finished) return;
        finished = true;
        if (err) done(err);
        else done(null, body);
      };
      payload.on('data', (c: Buffer) => {
        if (finished) return;
        size += c.length;
        if (size > maxBytes) {
          chunks.length = 0;
          return finish(new KycError('REPO_TOO_LARGE', 'The ZIP file is larger than the upload limit.'));
        }
        chunks.push(c);
      });
      payload.on('end', () => finish(null, Buffer.concat(chunks)));
      payload.on('error', () => finish(new KycError('INVALID_REQUEST', 'The upload did not complete.')));
    });

    scope.post('/api/v1/uploads', { bodyLimit: maxBytes }, async (req, reply): Promise<ImportResponse> => {
      const { name: rawName } = parse(UploadQuery, req.query);
      const { userId: ownerId } = await identity.require(req, reply);
      // The same budget as GitHub imports: one shared bucket per user and per IP.
      limiter.check('import:owner', ownerId, config.RATE_IMPORTS_PER_HOUR, 3600_000);
      limiter.check('import:ip', ip(req), config.RATE_IMPORTS_PER_HOUR * 4, 3600_000);

      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0)
        throw new KycError('INVALID_ARCHIVE', 'The upload was empty. Choose a .zip file.');
      if (!hasZipSignature(body)) throw new KycError('INVALID_ARCHIVE');
      // Fail fast on corrupt, encrypted, ZIP64 or oversized archives before queueing any work (no decompression).
      readZipDirectory(body, extractLimits(config));

      const name = uploadDisplayName(rawName);
      const repositoryId = await upsertRepository(db, ownerId, UPLOAD_OWNER, name, 'upload');
      const snapshotId = await createUploadSnapshot(db, repositoryId, body, name, config.RETENTION_DAYS);
      req.log.info({ snapshotId, bytes: body.length }, 'upload accepted');
      runner.enqueue(snapshotId);
      reply.status(202);
      return { repositoryId, snapshotId, status: 'queued', reused: false };
    });
  });
}
