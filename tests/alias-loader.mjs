// Lets `node --test` load project files that import "@/lib/..." (the Next.js path alias).
import { register } from "node:module";
register(new URL("./alias-hooks.mjs", import.meta.url));
