import { describe, expect, it } from 'vitest';
import { analyse, discoverFlows, urlMatchesRoute } from '../src';
import { analysable, loadFixture } from './fixture-loader';

async function flowsOf(files: { path: string; content: string }[]) {
  const code = analysable(files);
  const r = await analyse(code, { knownPaths: files.map((f) => f.path) });
  return { result: r, flows: discoverFlows(r.express, r.symbols, r.edges) };
}

const summary = (steps: { kind: string; label: string }[]) => steps.map((s) => `${s.kind}:${s.label}`);

describe('Express adapter and request flows (P3.2)', () => {
  it('discovers POST /auth/login → login → findUserByEmail on the Express fixture', async () => {
    const { result, flows } = await flowsOf(loadFixture('express-cjs'));
    expect(result.express.routers.map((r) => [r.id, r.kind])).toEqual([
      ['src/app.js#app', 'app'],
      ['src/routes/auth.js#router', 'router'],
    ]);
    const login = flows.find((f) => f.name === 'POST /auth/login')!;
    expect(login).toBeDefined();
    expect(summary(login.steps)).toEqual([
      'route:POST /auth/login',
      'middleware:express.json()',
      'handler:login',
      'call:findUserByEmail',
      'call:normalise',
      'unknown:email.trim().toLowerCase',
      'unknown:User.findOne',
      'response:Sends the response (res.status(401).json)',
    ]);
    const [route, mw, handler, call] = login.steps;
    expect(route).toMatchObject({ path: 'src/routes/auth.js', line: 4, provenance: 'pattern' });
    expect(mw).toMatchObject({ provenance: 'pattern', symbolKey: null });
    expect(mw!.reason).toMatch(/express package/);
    expect(handler).toMatchObject({
      path: 'src/controllers/authController.js',
      line: 3,
      provenance: 'pattern',
    });
    // Every verified step is a real call edge of the analysis.
    expect(call).toMatchObject({ provenance: 'verified', depth: 1, path: 'src/services/userService.js' });
    for (const s of login.steps.filter((x) => x.provenance === 'verified'))
      expect(
        result.edges.some(
          (e) =>
            e.type === 'calls' &&
            e.sourceKey === s.edge!.sourceKey &&
            e.targetKey === s.edge!.targetKey &&
            e.line === s.edge!.line,
        ),
      ).toBe(true);
    // Unknown hops are labelled, never presented as relationships.
    for (const s of login.steps.filter((x) => x.kind === 'unknown')) {
      expect(s.provenance).toBe('unknown');
      expect(s.reason).toBeTruthy();
      expect(s.symbolKey).toBeNull();
    }
    const health = flows.find((f) => f.name === 'GET /health')!;
    expect(summary(health.steps)).toEqual([
      'route:GET /health',
      'middleware:express.json()',
      'handler:GET /health',
      'response:Sends the response (res.json)',
    ]);
  });

  it('follows ESM mounts, middleware order and prefixes, route-level middleware and client calls', async () => {
    const files = [
      {
        path: 'server/app.ts',
        content: [
          "import express from 'express';",
          "import cors from 'cors';",
          "import users from './users';",
          "import { requestLog } from './log';",
          'const app = express();',
          'app.use(cors());',
          "app.use('/api', requestLog);",
          "app.use('/api/users', users);",
          "app.use('/admin', (req, res, next) => next());",
          'app.use(lateMiddleware);',
          'function lateMiddleware(req: any, res: any, next: any) { next(); }',
          'export default app;',
        ].join('\n'),
      },
      {
        path: 'server/users.ts',
        content: [
          "import { Router } from 'express';",
          "import { requireRole } from './auth';",
          "import * as svc from './service';",
          'const router = Router();',
          "router.get('/:id', requireRole('admin'), getUser);",
          "router.route('/').post(createUser);",
          'async function getUser(req: any, res: any) { res.json(await svc.load(req.params.id)); }',
          'async function createUser(req: any, res: any) { res.status(201).json(await svc.save(req.body)); }',
          'export default router;',
        ].join('\n'),
      },
      {
        path: 'server/auth.ts',
        content:
          'export function requireRole(role: string) { return (req: any, res: any, next: any) => next(); }',
      },
      {
        path: 'server/log.ts',
        content: 'export function requestLog(req: any, res: any, next: any) { next(); }',
      },
      {
        path: 'server/service.ts',
        content: [
          'export async function load(id: string) { return { id }; }',
          'export async function save(body: unknown) { return body; }',
        ].join('\n'),
      },
      {
        path: 'server/orphan.ts',
        content: [
          "import express from 'express';",
          'const r = express.Router();',
          "r.delete('/thing', (req, res) => res.end());",
          'export default r;',
        ].join('\n'),
      },
      {
        path: 'web/api.ts',
        content: [
          "import axios from 'axios';",
          'export async function fetchUser(id: string) { return fetch(`/api/users/${id}`); }',
          "export async function addUser(u: unknown) { return axios.post('/api/users', u); }",
          'export async function anything(url: string) { return fetch(url); }',
        ].join('\n'),
      },
    ];
    const { result, flows } = await flowsOf(files);
    expect(result.express.clientCalls.map((c) => [c.client, c.method, c.url])).toEqual([
      ['fetch', 'GET', '/api/users/*'],
      ['axios', 'POST', '/api/users'],
      ['fetch', 'GET', null],
    ]);
    const get = flows.find((f) => f.name === 'GET /api/users/:id')!;
    expect(summary(get.steps)).toEqual([
      'client:fetch GET /api/users/*',
      'route:GET /api/users/:id',
      'middleware:cors()',
      'middleware:requestLog',
      "middleware:requireRole('admin') (created by requireRole)",
      'handler:getUser',
      'call:load',
      'response:Sends the response (res.json)',
    ]);
    expect(get.clients).toBe(1);
    expect(get.steps[0]!.symbolKey).toMatch(/fetchUser/);
    const post = flows.find((f) => f.name === 'POST /api/users')!;
    expect(summary(post.steps).slice(0, 2)).toEqual([
      'client:axios POST /api/users',
      'route:POST /api/users',
    ]);
    expect(summary(post.steps)).toContain('call:save');
    // Middleware registered after the mount, or on another prefix, does not apply.
    expect(summary(get.steps).join()).not.toMatch(/lateMiddleware|next\(\)/);
    // A router that is never mounted is still shown, with the unknown mount labelled.
    const orphan = flows.find((f) => f.name === 'DELETE /thing')!;
    expect(orphan.steps[1]).toMatchObject({
      kind: 'unknown',
      label: 'Router mount point',
      provenance: 'unknown',
    });
    expect(orphan.steps[1]!.reason).toMatch(/not mounted/);
  });

  it('labels a non-literal route path and an unresolved handler instead of guessing', async () => {
    const files = [
      {
        path: 'app.js',
        content: [
          "const express = require('express');",
          'const app = express();',
          'const PATH = process.env.P;',
          'app.get(PATH, (req, res) => res.end());',
          "app.post('/x', handlers[0]);",
        ].join('\n'),
      },
    ];
    const { flows } = await flowsOf(files);
    const dyn = flows.find((f) => f.routePath === null)!;
    expect(dyn.steps[0]).toMatchObject({ kind: 'route', provenance: 'unknown' });
    expect(dyn.steps[0]!.reason).toMatch(/not a literal/);
    const x = flows.find((f) => f.name === 'POST /x')!;
    expect(x.steps.at(-1)).toMatchObject({ kind: 'unknown', label: 'handlers[0]', provenance: 'unknown' });
  });

  it('is deterministic and empty for code without Express', async () => {
    const a = await flowsOf(loadFixture('express-cjs'));
    const b = await flowsOf(loadFixture('express-cjs'));
    expect(JSON.stringify(a.flows)).toBe(JSON.stringify(b.flows));
    expect((await flowsOf(loadFixture('react-ts'))).flows).toEqual([]);
  });

  it('matches client URLs to route paths segment by segment', () => {
    expect(urlMatchesRoute('/api/users/*', '/api/users/:id')).toBe(true);
    expect(urlMatchesRoute('http://localhost:8080/auth/login?x=1', '/auth/login')).toBe(true);
    expect(urlMatchesRoute('/api/users', '/api/users/:id')).toBe(false);
    expect(urlMatchesRoute('/api/users/1/posts', '/api/users/:id')).toBe(false);
    expect(urlMatchesRoute('/files/a/b', '/files/*')).toBe(true);
    expect(urlMatchesRoute('users', '/users')).toBe(false);
  });
});
