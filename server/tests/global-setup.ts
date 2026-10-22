import { createPool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://localhost/kyc_test';

export default async function setup() {
  process.env.TEST_DATABASE_URL = TEST_DB_URL;
  const db = createPool(TEST_DB_URL);
  try {
    await migrate(db);
  } catch (e) {
    throw new Error(
      `Test database unavailable at ${TEST_DB_URL}. Create it with "createdb kyc_test" or set TEST_DATABASE_URL.\n${(e as Error).message}`,
      { cause: e },
    );
  } finally {
    await db.end();
  }
}
