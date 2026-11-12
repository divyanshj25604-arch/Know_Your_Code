import type { Overview } from '@kyc/contracts';

const FRAMEWORKS: Record<string, string> = {
  express: 'express',
  fastify: 'fastify',
  koa: 'koa',
  '@nestjs/core': 'nestjs',
  hapi: 'hapi',
  '@hapi/hapi': 'hapi',
  react: 'react',
  'react-dom': 'react',
  next: 'next.js',
  vue: 'vue',
  svelte: 'svelte',
  '@angular/core': 'angular',
  vite: 'vite',
  webpack: 'webpack',
  mongoose: 'mongoose',
  prisma: 'prisma',
  '@prisma/client': 'prisma',
  sequelize: 'sequelize',
  typeorm: 'typeorm',
  'drizzle-orm': 'drizzle',
  pg: 'postgres (pg)',
  mysql2: 'mysql',
  redux: 'redux',
  '@reduxjs/toolkit': 'redux toolkit',
  'socket.io': 'socket.io',
  jest: 'jest',
  vitest: 'vitest',
  mocha: 'mocha',
  typescript: 'typescript',
  tailwindcss: 'tailwind',
  'react-router-dom': 'react-router',
  axios: 'axios',
  jsonwebtoken: 'jsonwebtoken',
  bcrypt: 'bcrypt',
  bcryptjs: 'bcryptjs',
  graphql: 'graphql',
  electron: 'electron',
  'react-native': 'react-native',
  expo: 'expo',
};

const ENTRY_CANDIDATES = [
  'src/index',
  'src/main',
  'src/app',
  'src/server',
  'index',
  'main',
  'app',
  'server',
  'src/App',
];
const EXTS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'];

export interface OverviewInput {
  files: { path: string; analysable: boolean; language: string | null }[];
  packageJson: string | null;
  counts: { symbols: number; edges: number; unresolved: number };
  top: { name: string; path: string; line: number; uses: number }[];
  skipped: { path: string; reason: string }[];
}

export function buildOverview(i: OverviewInput): Omit<Overview, 'summary'> {
  const languages: Record<string, number> = {};
  for (const f of i.files) if (f.language) languages[f.language] = (languages[f.language] ?? 0) + 1;

  const frameworks = new Set<string>();
  const entryPoints: string[] = [];
  const paths = new Set(i.files.map((f) => f.path));
  const addEntry = (p: string) => {
    const n = p.replace(/^\.\//, '');
    const hit = paths.has(n) ? n : EXTS.map((e) => `${n}.${e}`).find((c) => paths.has(c));
    if (hit && !entryPoints.includes(hit)) entryPoints.push(hit);
  };

  if (i.packageJson) {
    try {
      const pkg = JSON.parse(i.packageJson) as {
        main?: unknown;
        module?: unknown;
        bin?: unknown;
        scripts?: Record<string, unknown>;
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
      };
      for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
        const fw = FRAMEWORKS[dep];
        if (fw) frameworks.add(fw);
      }
      if (typeof pkg.main === 'string') addEntry(pkg.main);
      if (typeof pkg.module === 'string') addEntry(pkg.module);
      if (typeof pkg.bin === 'string') addEntry(pkg.bin);
      for (const key of ['start', 'dev', 'serve']) {
        const script = pkg.scripts?.[key];
        if (typeof script === 'string') {
          const m = /(?:node|tsx|ts-node|nodemon|bun)\s+(?:--?\S+\s+)*([\w./-]+\.(?:m?js|cjs|tsx?))/.exec(
            script,
          );
          if (m?.[1]) addEntry(m[1]);
        }
      }
    } catch {
      // A malformed package.json is not fatal; facts are simply fewer.
    }
  }
  for (const c of ENTRY_CANDIDATES) addEntry(c);

  const startingPoints: Overview['startingPoints'] = [];
  for (const e of entryPoints.slice(0, 3)) {
    startingPoints.push({ label: `Entry point: ${e}`, path: e, line: 1, provenance: 'verified' });
  }
  for (const t of i.top.slice(0, 5)) {
    startingPoints.push({
      label: `Most-used: ${t.name} (${t.uses} uses)`,
      path: t.path,
      line: t.line,
      provenance: 'verified',
    });
  }

  return {
    facts: {
      languages,
      frameworks: [...frameworks].sort(),
      entryPoints: entryPoints.slice(0, 6),
      fileCount: i.files.length,
      analysedCount: i.files.filter((f) => f.analysable).length,
      symbolCount: i.counts.symbols,
      edgeCount: i.counts.edges,
      unresolvedCount: i.counts.unresolved,
    },
    startingPoints,
    skipped: i.skipped.slice(0, 200),
  };
}
