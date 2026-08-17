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
import { environmentSecretService } from '../services/security/EnvironmentSecretService';

export default async function securityRoutes(fastify: FastifyInstance) {
  fastify.get('/api/v1/security/vault-status', async (request, reply) => {
    try {
      const status = secretVault.getStatus();
      // Workspace credentials are counted alongside the machine-level ones
      // (P9-02): the audit question is whether *anything* on this workstation is
      // readable on disk, and answering it for only half the credential store
      // would report healthy while an environment's tokens sat in cleartext.
      const environmentSecrets = environmentSecretService.getStatus();
      return {
        vault: { ...status, environmentSecrets },
        // The vault is healthy when it can derive its key and nothing it owns
        // is still readable on disk.
        healthy:
          status.ready &&
          status.plaintextKeys === 0 &&
          status.unreadableKeys === 0 &&
          environmentSecrets.plaintext === 0 &&
          environmentSecrets.unreadable === 0
      };
    } catch (err) {
      console.error('[SecurityRoute] Could not read vault status:', err);
      reply.status(500).send({ error: 'Failed to read vault status' });
    }
  });
}
