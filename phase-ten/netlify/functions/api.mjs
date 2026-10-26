import { getStore } from "@netlify/blobs";
import { createHandler } from "../../server/handler.js";

// Open the store on every request: it carries a short-lived access token from
// the invocation, so a store kept across warm invocations starts failing with
// "Token expired" once that token runs out.
export default async (req) => createHandler(getStore({ name: "phase-ten-games", consistency: "strong" }))(req);

export const config = {
  path: "/api/*",
};
