import { Connection, clusterApiUrl } from '@solana/web3.js';

let connection;

/**
 * Get a singleton Solana connection.
 * Uses SOLANA_RPC_URL or defaults to mainnet-beta.
 */
export function getConnection() {
  if (!connection) {
    const url = process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta');
    connection = new Connection(url, 'confirmed');
  }
  return connection;
}
