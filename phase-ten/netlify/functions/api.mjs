import { getStore } from "@netlify/blobs";
import { createHandler } from "../../server/handler.js";

let handle;

export default async (req) => {
  handle ||= createHandler(getStore({ name: "phase-ten-games", consistency: "strong" }));
  return handle(req);
};

export const config = {
  path: "/api/*",
};
