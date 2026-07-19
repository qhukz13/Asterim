# Security Policy

## Supported Versions

We currently only provide security updates for the latest major version.

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Security Model

Asterim is designed as a **local-first** control plane. It runs locally on your workstation and communicates with your web browser or mobile devices over the local network (LAN) or a secure end-to-end encrypted cloud relay.

### Authentication & Authorization

- **Console pairing PIN**: On the first start or fresh installation, the server outputs a random 6-digit PIN in the terminal and generates a pairing QR code. You must enter this PIN in the UI or scan the QR code to pair your device.
- **Token-based authorization**: Once paired, the client receives an HMAC-SHA256 signed session token (valid for 30 days). This token is required in the `Authorization: Bearer <token>` header for all REST endpoints and WebSocket handshakes.
- **E2E Encryption (Relay Mode)**: In remote relay mode, connections are proxied via a cloud relay, but all communications are encrypted end-to-end using Diffie-Hellman key exchanges (ECDH) and AES-GCM. The relay server cannot read your traffic.

## Local Network & Public Deployment Warnings

> [!WARNING]
> **Do NOT expose your local Asterim server directly to the public internet** (e.g., via DMZ or open port forwarding) without additional security layers (such as a reverse proxy with TLS/HTTPS and Basic Auth/OAuth).
> While the pairing system protects endpoints, running Fastify directly exposed to the internet increases your attack surface.

- **Same-Origin Protection (CORS)**: Server CORS configurations strictly restrict access to loopback (`localhost`, `127.0.0.1`, `[::1]`) and private local networks (`192.168.x.x`, `10.x.x.x`, `172.16.x.x-172.31.x.x`, `169.254.x.x`) to prevent cross-origin site hijacking.
- **Secure Relays**: Use the default, secure cloud relay or host your own in a private VPC.

## Known Limitations

- **Plaintext HTTP on LAN**: By default, the local Fastify server serves over plaintext HTTP. If you are on an untrusted shared network (such as public coffee shop WiFi), someone could sniff the network traffic and capture your session token or pairing PIN. When using untrusted networks, we recommend connecting via the cloud relay (which uses TLS) or setting up a local reverse proxy with self-signed SSL certificates.

## Reporting a Vulnerability

If you discover a security vulnerability in Asterim, please report it privately. Do **NOT** create a public issue on GitHub.

Email your reports to: **security@asterim.dev** (or contact the lead engineer directly).

We aim to acknowledge receipt of your report within 24 hours and provide a detailed response and plan for resolution within 3 days.
