/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as beheer from "../beheer.js";
import type * as boot from "../boot.js";
import type * as groepen from "../groepen.js";
import type * as host from "../host.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_db from "../lib/db.js";
import type * as lib_spel from "../lib/spel.js";
import type * as lib_validators from "../lib/validators.js";
import type * as race from "../race.js";
import type * as spel from "../spel.js";
import type * as uitslagen from "../uitslagen.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  beheer: typeof beheer;
  boot: typeof boot;
  groepen: typeof groepen;
  host: typeof host;
  "lib/config": typeof lib_config;
  "lib/db": typeof lib_db;
  "lib/spel": typeof lib_spel;
  "lib/validators": typeof lib_validators;
  race: typeof race;
  spel: typeof spel;
  uitslagen: typeof uitslagen;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
