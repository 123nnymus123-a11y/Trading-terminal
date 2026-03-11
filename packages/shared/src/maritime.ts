import { z } from "zod";

/**
 * AIS (Automatic Identification System) data for oil tankers
 * Data typically comes from AIS receivers tracking vessels
 */
export const OilTankerSchema = z.object({
  mmsi: z.string().describe("Maritime Mobile Service Identity"),
  imo: z.string().optional().describe("International Maritime Organization number"),
  name: z.string().describe("Vessel name"),
  callSign: z.string().optional(),
  shipType: z.string().describe("Type of ship (e.g., Oil Tanker, Chemical Tanker)"),
  
  // Position data
  latitude: z.number().describe("Current latitude"),
  longitude: z.number().describe("Current longitude"),
  heading: z.number().min(0).max(360).describe("Course over ground in degrees"),
  speed: z.number().min(0).describe("Speed over ground in knots"),
  
  // Dimensions
  length: z.number().optional().describe("Length overall in meters"),
  beam: z.number().optional().describe("Beam (width) in meters"),
  draft: z.number().optional().describe("Draft in meters"),
  
  // Status
  status: z.enum(["underway", "anchored", "moored", "docked", "unknown"]),
  destination: z.string().optional(),
  eta: z.number().optional().describe("Estimated time of arrival (unix timestamp)"),
  
  // Cargo info
  cargoType: z.string().optional().describe("Type of cargo (crude oil, refined products, etc)"),
  cargoTonnage: z.number().optional().describe("Estimated cargo tonnage"),
  
  // Tracking
  lastUpdate: z.number().describe("Last update timestamp (unix)"),
  positionAccuracy: z.number().optional().describe("Accuracy in meters"),
});

export type OilTanker = z.infer<typeof OilTankerSchema>;

/**
 * Flight tracking data for cargo aircraft
 * Data typically comes from ADS-B or MLAT receivers
 */
export const CargoFlightSchema = z.object({
  icao24: z.string().describe("ICAO address (hex)"),
  callSign: z.string().describe("Flight callsign"),
  registration: z.string().optional().describe("Aircraft registration"),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  
  // Position data
  latitude: z.number().describe("Current latitude"),
  longitude: z.number().describe("Current longitude"),
  altitude: z.number().describe("Altitude in feet"),
  heading: z.number().min(0).max(360).describe("Heading in degrees"),
  speed: z.number().min(0).describe("Ground speed in knots"),
  verticalRate: z.number().optional().describe("Vertical rate in feet per minute"),
  
  // Flight info
  origin: z.string().optional().describe("IATA code of origin airport"),
  destination: z.string().optional().describe("IATA code of destination airport"),
  airline: z.string().optional(),
  cargoType: z.string().optional().describe("Type of cargo being transported"),
  
  // Status
  status: z.enum(["climbing", "cruise", "descending", "ground", "unknown"]),
  onGround: z.boolean(),
  squawk: z.string().optional().describe("Transponder code"),
  
  // Tracking
  lastUpdate: z.number().describe("Last update timestamp (unix)"),
  positionAccuracy: z.number().optional(),
});

export type CargoFlight = z.infer<typeof CargoFlightSchema>;

/**
 * Map state for filtering and display
 */
export const MapFilterSchema = z.object({
  searchQuery: z.string().optional(),
  minSpeed: z.number().optional(),
  maxSpeed: z.number().optional(),
  status: z.string().optional(),
  cargoType: z.string().optional(),
  selected: z.string().optional().describe("MMSI for tanker or ICAO24 for flight"),
});

export type MapFilter = z.infer<typeof MapFilterSchema>;

/**
 * GeoJSON Feature for map rendering
 */
export const MapFeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.object({
    type: z.enum(["Point", "LineString"]),
    coordinates: z.array(z.number()).or(z.array(z.array(z.number()))),
  }),
  properties: z.record(z.any()),
});

export type MapFeature = z.infer<typeof MapFeatureSchema>;