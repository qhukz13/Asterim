/**
 * The Secret Vault status surface (P9-01).
 *
 * One question, asked by an operator or an enterprise audit: are the
 * credentials on this workstation encrypted at rest, and is anything still
 * lying around in plaintext?
 *
 * The answer is deliberately a shape that cannot carry a secret. No value is
 * read into the response — the counts come from classifying each managed row as
 * encrypted, plaintext or unreadable, and the only strings returned are the
 * algorithm names and the setting keys themselves, which are compiled-in
 * constants rather than anything the vault holds.
 */

import { FastifyInstance } from 'fastify';
import { secretVault } from '../services/security/SecretVaultService';

export default async function securityRoutes(fastify: FastifyInstance) {
  fastify.get('/api/v1/security/vault-status', async (request, reply) => {
    try {
      const status = secretVault.getStatus();
      return {
        vault: status,
        // The vault is healthy when it can derive its key and nothing it owns
        // is still readable on disk.
        healthy: status.ready && status.plaintextKeys === 0 && status.unreadableKeys === 0
      };
    } catch (err) {
      console.error('[SecurityRoute] Could not read vault status:', err);
      reply.status(500).send({ error: 'Failed to read vault status' });
    }
  });
}
