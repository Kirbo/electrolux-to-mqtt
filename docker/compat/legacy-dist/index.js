// Compatibility entry for containers recreated from a pre-2026.11.3 container config.
// Those images ran `node dist/index.js`; update tools that recreate a container from its
// old config (Portainer "recreate", some Watchtower/Unraid setups) keep that command, so
// it must keep working now that Node runs src/index.ts directly. Remove once no install
// runs a container created from such an image.
import { start } from '../src/index.ts'

await start()
