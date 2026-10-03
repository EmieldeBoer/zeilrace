import { defineApp } from "convex/server";
import { v } from "convex/values";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";

const app = defineApp({
  env: {
    // Wachtwoord van de wedstrijdleiding: bunx convex env set WL_WACHTWOORD ...
    WL_WACHTWOORD: v.optional(v.string()),
  },
});
app.use(rateLimiter);

export default app;
