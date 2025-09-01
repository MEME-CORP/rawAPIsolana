import { clusterApiUrl } from '@solana/web3.js';

export const RPC_CONFIGS = {
  PUBLIC: {
    name: 'Public Mainnet-Beta',
    confirmTimeoutMs: 20000,
  },
  PREMIUM: {
    name: 'Premium RPC Provider',
    confirmTimeoutMs: 10000,
  },
};

/**
 * Pick RPC profile based on URL.
 */
export function getRpcProfile() {
  const url = process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta');
  if (url.includes('api.mainnet-beta.solana.com')) return RPC_CONFIGS.PUBLIC;
  return RPC_CONFIGS.PREMIUM;
}

/**
 * Confirm a signature using WebSocket with a timeout and a final status check.
 * Returns true on confirmed/finalized, false on timeout or failure.
 * @param {import('@solana/web3.js').Connection} connection
 * @param {string} signature
 * @param {import('@solana/web3.js').Commitment} [commitment='confirmed']
 */
export async function confirmSignature(connection, signature, commitment = 'confirmed') {
  const { confirmTimeoutMs } = getRpcProfile();

  try {
    const wsResult = await new Promise((resolve, reject) => {
      let subId = null;
      let done = false;
      const finish = async (val) => {
        if (done) return;
        done = true;
        if (subId !== null) {
          try { await connection.removeSignatureListener(subId); } catch (_) {}
        }
        resolve(val);
      };
      const timer = setTimeout(() => finish({ timeout: true }), confirmTimeoutMs);

      try {
        subId = connection.onSignatureWithOptions(
          signature,
          (notification) => {
            clearTimeout(timer);
            finish({ value: notification });
          },
          { commitment }
        );
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });

    if (wsResult && wsResult.value && !wsResult.value.err) return true;
    if (wsResult && wsResult.timeout) {
      // Final quick status check
      const statuses = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = statuses && statuses.value ? statuses.value[0] : null;
      if (status && !status.err) {
        const cs = status.confirmationStatus;
        if (cs === 'confirmed' || cs === 'finalized') return true;
      }
      return false;
    }
    // Explicit error case
    return false;
  } catch (_) {
    return false;
  }
}

