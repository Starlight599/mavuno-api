const { Pool } = require("pg");

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
    require: true
  }
});

async function run() {
  try {
    await pgPool.query(`
      ALTER TABLE payments
      ADD CONSTRAINT payments_order_id_key UNIQUE (order_id);
    `);
    console.log("✅ UNIQUE constraint added");
  } catch (err) {
    console.error("❌ DB fix error:", err.message);
  } finally {
    await pgPool.end();
  }
}

run();
