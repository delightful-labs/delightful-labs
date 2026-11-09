import { error } from "@sveltejs/kit";
import { publicationReader } from "../leaflet/service";

export async function readPublication() {
  try {
    return await publicationReader().read();
  } catch {
    error(503, "Writing is temporarily unavailable. Please try again.");
  }
}
