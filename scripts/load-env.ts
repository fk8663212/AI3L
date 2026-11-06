import { loadEnvConfig } from "@next/env";

// Match Next.js variable expansion (including escaped $ in scrypt hashes).
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
