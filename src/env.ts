import { defineEnvVars } from "@sveltejs/kit/env";

export const variables = defineEnvVars({
  LEAFLET_AUTHOR_DID: {
    schema: (value) => value || "did:plc:226m7t4kp7d7sg2qsdresypm",
  },
  LEAFLET_PUBLICATION_URI: { schema: (value) => value || "" },
  SITE_ORIGIN: { schema: (value) => value || "https://delightfullabs.com" },
});
