const { Client } = require('pg');
const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd());

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();
  const res = await client.query(`
    SELECT column_name, data_type, udt_name, character_maximum_length 
    FROM information_schema.columns 
    WHERE table_name = 'vector_embeddings' AND column_name LIKE 'embedding_vec%';
  `);
  console.log(res.rows);
  
  // also check vector_dims view if pgvector is installed
  try {
    const dims = await client.query(`
      SELECT a.attname as column_name, t.typname, a.atttypmod 
      FROM pg_attribute a 
      JOIN pg_type t ON a.atttypid = t.oid 
      WHERE t.typname = 'vector' AND a.attrelid = 'vector_embeddings'::regclass;
    `);
    console.log("Vector specific dims:");
    console.log(dims.rows);
  } catch (e) {
    console.error(e.message);
  }

  await client.end();
}
main();
