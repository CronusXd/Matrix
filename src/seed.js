/**
 * Database Seed Script
 *
 * Creates an initial admin user and API key for testing.
 * Usage: node src/seed.js
 */

const { initDb, getDb, closeDb } = require('./db/database');
const { createUser } = require('./db/users');
const apiKeyManager = require('./auth/api-key-manager');
const logger = require('./utils/logger');

async function seed() {
  logger.info('Seeding database...');

  await initDb();

  // Create admin user if not exists
  let user;
  try {
    user = createUser({ email: 'admin@matrix.local', name: 'Matrix Admin' });
    logger.info({ msg: 'Admin user created', userId: user.id });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      logger.info('Admin user already exists, skipping...');
      // Try to find existing user
      const { getUserByEmail } = require('./db/users');
      user = getUserByEmail('admin@matrix.local');
    } else {
      throw err;
    }
  }

  // Generate API key
  const { rawKey } = apiKeyManager.generateKey({
    userId: user.id,
    name: 'Default Admin Key',
    expiresInDays: null  // Never expires
  });

  console.log('\n========================================');
  console.log('  Matrix API Key (save this!):');
  console.log(`  ${rawKey}`);
  console.log('========================================\n');
  console.log('Use this key in the Authorization header:');
  console.log(`  Authorization: Bearer ${rawKey}`);
  console.log('\nDashboard: http://127.0.0.1:3000/dashboard\n');

  closeDb();
}

seed().catch(err => {
  logger.errorObj(err, { context: 'seed' });
  closeDb();
  process.exit(1);
});
