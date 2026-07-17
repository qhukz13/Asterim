# Security Rule

All security implementations must adhere to the boundaries defined in `blueprint/ARCHITECTURE.md`.

- Adapters must remain isolated from Core.
- Never trust input from the Client blindly.
- Do not bypass the defined authentication mechanisms.
