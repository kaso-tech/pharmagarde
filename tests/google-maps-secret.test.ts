import { describe, expect, it } from "vitest";

const googleMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
const describeWithGoogleMapsKey = googleMapsKey.trim() ? describe : describe.skip;

describeWithGoogleMapsKey("google maps api key", () => {
  it("charge l’endpoint JavaScript Google Maps sans erreur de clé", async () => {
    const url = new URL("https://maps.googleapis.com/maps/api/js");
    url.searchParams.set("key", googleMapsKey);
    url.searchParams.set("v", "weekly");
    url.searchParams.set("loading", "async");

    const response = await fetch(url.toString());
    const body = await response.text();

    expect(response.ok).toBe(true);
    expect(body).not.toContain("InvalidKeyMapError");
    expect(body).not.toContain("ApiNotActivatedMapError");
    expect(body).not.toContain("RefererNotAllowedMapError");
    expect(body).toContain("google.maps");
  }, 15000);
});
