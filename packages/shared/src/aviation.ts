import { CargoFlightSchema } from "./maritime";

export { CargoFlightSchema };
export type { CargoFlight } from "./maritime";

/**
 * Aviation data sources and APIs
 */
export const AVIATION_DATA_SOURCES = {
  OPENSKY: {
    name: "OpenSky Network",
    url: "https://opensky-network.org/api",
    rateLimit: 4, // requests per second for free tier
  },
  FLIGHTAWARE: {
    name: "FlightAware",
    url: "https://flightaware.com/live/",
    requiresAuth: true,
  },
  ADSB_EXCHANGE: {
    name: "ADS-B Exchange",
    url: "https://adsbexchange.com/api",
    rateLimit: 10,
  },
} as const;

/**
 * Common cargo airline codes
 */
export const CARGO_AIRLINES = [
  "DHL", "FDX", "AAL", "SWR", "KLM", "SWA", "ABX",
  "CPZ", "CPA", "SCA", "ACA", "VIR", "EIN", "LAN",
  "CHH", "CES", "CSN", "RYR", "VLI", "TAP"
] as const;

/**
 * Status descriptions for aviation
 */
export const FLIGHT_STATUS_ICONS: Record<string, string> = {
  "climbing": "📈",
  "cruise": "→",
  "descending": "📉",
  "ground": "🛬",
  "unknown": "❓",
};
