import { OilTanker, CargoFlight } from "@tc/shared";

/**
 * Fetch real oil tanker data from AISStream API
 * Filters for oil tankers (ship types 30, 31, 32)
 */
export async function fetchOilTankers(): Promise<OilTanker[]> {
  try {
    const apiKey = import.meta.env.REACT_APP_AISSTREAM_API_KEY;
    if (!apiKey) {
      console.error("❌ AISStream API key not found. Check .env.local for REACT_APP_AISSTREAM_API_KEY");
      return [];
    }

    console.log("🚢 Fetching oil tanker data from AISStream API...");
    
    const response = await fetch("https://api.aisstream.io/v0/station/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ApiKey: apiKey,
        BoundingBoxes: [
          {
            NorthWest: { Latitude: 90, Longitude: -180 },
            SouthEast: { Latitude: -90, Longitude: 180 },
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error(
        "❌ AISStream API error:",
        response.status,
        response.statusText
      );
      return [];
    }

    const data = await response.json();
    if (!data.data || !Array.isArray(data.data)) {
      console.warn("⚠️  Unexpected AISStream response format. Returned empty array.");
      return [];
    }

    // Filter for oil tankers (ship types 30, 31, 32)
    interface AISMessage {
      Message: {
        MMSI: number;
        IMO?: number;
        Name?: string;
        CallSign?: string;
        ShipType: number;
        Latitude: number;
        Longitude: number;
        Heading: number;
        Speed: number;
        Length: number;
        Beam: number;
        Draft: number;
        NavigationalStatus: number;
        Destination?: string;
      };
    }
    const tankers: OilTanker[] = data.data
      .filter(
        (msg: AISMessage) =>
          msg.Message &&
          msg.Message.ShipType &&
          [30, 31, 32].includes(msg.Message.ShipType)
      )
      .map((msg: AISMessage) => {
        const shipData = msg.Message;
        return {
          mmsi: String(shipData.MMSI),
          imo: shipData.IMO ? String(shipData.IMO) : undefined,
          name: shipData.Name || "Unknown",
          callSign: shipData.CallSign || undefined,
          shipType: "Oil Tanker",
          latitude: shipData.Latitude || 0,
          longitude: shipData.Longitude || 0,
          heading: shipData.Heading || 0,
          speed: (shipData.Speed || 0) * 1.944, // Convert knots to m/s
          length: shipData.Length || 0,
          beam: shipData.Beam || 0,
          draft: shipData.Draft || 0,
          status: shipData.NavigationalStatus === 0 ? "underway" : "moored",
          destination: shipData.Destination || undefined,
          cargoType: "Oil/Gas",
          cargoTonnage: 0,
          lastUpdate: Date.now(),
        };
      });

    console.log("✅ Oil tankers fetched successfully:", tankers.length, "vessels");
    return tankers;
  } catch (error) {
    console.error("❌ Error fetching oil tankers from AISStream:", error);
    return [];
  }
}

/**
 * Mock oil tanker data - BACKUP (not used with real API)
 */
function _getMockOilTankers(): OilTanker[] {
  const mockTankers: OilTanker[] = [
    {
      mmsi: "636091000",
      imo: "9634000",
      name: "ABQAIQ",
      callSign: "9V2B",
      shipType: "Oil Tanker",
      latitude: 26.1252,
      longitude: 50.1884,
      heading: 245,
      speed: 13.5,
      length: 247,
      beam: 44,
      draft: 14.8,
      status: "underway",
      destination: "Shanghai Port",
      cargoType: "Crude Oil",
      cargoTonnage: 136500,
      lastUpdate: Date.now(),
    },
    {
      mmsi: "636092000",
      imo: "9634001",
      name: "SAFANIYAH",
      callSign: "A6H",
      shipType: "Oil Tanker",
      latitude: 51.4934,
      longitude: 0.0098,
      heading: 180,
      speed: 14.2,
      length: 330,
      beam: 58,
      draft: 15.5,
      status: "underway",
      destination: "Rotterdam Port",
      cargoType: "Crude Oil",
      cargoTonnage: 157000,
      lastUpdate: Date.now(),
    },
    {
      mmsi: "636093000",
      imo: "9634002",
      name: "MARE NOSTRUM",
      callSign: "VRNA",
      shipType: "Oil Tanker",
      latitude: -33.8688,
      longitude: 18.4241,
      heading: 45,
      speed: 15.1,
      length: 228,
      beam: 32,
      draft: 11.5,
      status: "underway",
      destination: "Singapore Port",
      cargoType: "Refined Products",
      cargoTonnage: 50000,
      lastUpdate: Date.now(),
    },
    {
      mmsi: "636094000",
      imo: "9634003",
      name: "PACIFIC EXPLORER",
      callSign: "PHKC",
      shipType: "Oil Tanker",
      latitude: 35.6762,
      longitude: 139.6503,
      heading: 270,
      speed: 12.8,
      length: 254,
      beam: 44,
      draft: 14.2,
      status: "underway",
      destination: "Los Angeles Port",
      cargoType: "Crude Oil",
      cargoTonnage: 125000,
      lastUpdate: Date.now(),
    },
    {
      mmsi: "636095000",
      imo: "9634004",
      name: "ATLANTIC DAWN",
      callSign: "EIHG",
      shipType: "Oil Tanker",
      latitude: 40.7128,
      longitude: -74.0060,
      heading: 90,
      speed: 0,
      length: 185,
      beam: 32,
      draft: 12.0,
      status: "moored",
      destination: undefined,
      cargoType: "Refined Products",
      cargoTonnage: 75000,
      lastUpdate: Date.now(),
    },
    {
      mmsi: "636096000",
      imo: "9634005",
      name: "NORDIC STAR",
      callSign: "OWHZ",
      shipType: "Oil Tanker",
      latitude: 59.9139,
      longitude: 10.7522,
      heading: 180,
      speed: 13.2,
      length: 240,
      beam: 42,
      draft: 13.8,
      status: "anchored",
      destination: "Hamburg Port",
      cargoType: "Refined Products",
      cargoTonnage: 60000,
      lastUpdate: Date.now(),
    },
    {
      mmsi: "636097000",
      imo: "9634006",
      name: "GULF GRACE",
      callSign: "A43VG",
      shipType: "Oil Tanker",
      latitude: 29.3759,
      longitude: 47.9774,
      heading: 225,
      speed: 14.5,
      length: 228,
      beam: 32,
      draft: 11.5,
      status: "underway",
      destination: "Suez Canal",
      cargoType: "Crude Oil",
      cargoTonnage: 50000,
      lastUpdate: Date.now(),
    },
  ];

  return mockTankers;
}

/**
 * Fetch real cargo flight data from OpenSky Network API
 * Filters for cargo airlines only
 */
export async function fetchCargoFlights(): Promise<CargoFlight[]> {
  const CARGO_AIRLINES = [
    "AAL",
    "ABX",
    "ACA",
    "ACE",
    "ADR",
    "AEE",
    "AIJ",
    "AZA",
    "BAW",
    "CAL",
    "CES",
    "CPA",
    "CVA",
    "DAL",
    "DHL",
    "EZY",
    "FDX",
    "FDX",
    "GTI",
    "ICE",
    "KLM",
    "LOT",
    "LYM",
    "MAS",
    "MSN",
    "NKS",
    "NZV",
    "POE",
    "SAS",
    "SWR",
    "TAP",
    "THY",
    "TLA",
    "UPS",
    "UPS",
    "VIR",
  ];

  try {
    const username = import.meta.env.REACT_APP_OPENSKY_USERNAME;
    const password = import.meta.env.REACT_APP_OPENSKY_PASSWORD;

    if (!username || !password) {
      console.error("❌ OpenSky Network credentials not found. Check .env.local for REACT_APP_OPENSKY_USERNAME and REACT_APP_OPENSKY_PASSWORD");
      return [];
    }

    console.log("✈️  Fetching cargo flight data from OpenSky Network...");

    const auth = btoa(`${username}:${password}`);
    const response = await fetch(
      "https://opensky-network.org/api/states/all?lamin=0&lomin=-180&lamax=90&lomax=180",
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );

    if (!response.ok) {
      console.error(
        "❌ OpenSky API error:",
        response.status,
        response.statusText
      );
      return [];
    }

    const data = await response.json();
    if (!data.states || !Array.isArray(data.states)) {
      console.warn("⚠️  Unexpected OpenSky response format. Returned empty array.");
      return [];
    }

    // Filter for cargo flights
    const flights: CargoFlight[] = data.states
      .filter((state: (string | number | null | boolean | undefined)[]) => {
        const callsign = String(state[1] || "")
          .trim()
          .substring(0, 3)
          .toUpperCase();
        return (
          CARGO_AIRLINES.includes(callsign) &&
          state[9] !== null &&
          (state[13] !== null || state[7] !== null)
        );
      })
      .map((state: (string | number | null | boolean | undefined)[]) => {
        const callsign = String(state[1] || "").trim();
        const longitude = Number(state[5]) || 0;
        const latitude = Number(state[6]) || 0;
        const baroAlt = Number(state[7]) || 0;
        const geoAlt = Number(state[13]) || 0;
        const altitude = geoAlt || baroAlt || 0;
        const onGround = Boolean(state[8]);
        return {
          icao24: String(state[0]),
          callSign: callsign,
          registration: undefined,
          manufacturer: "Aircraft",
          model: "Unknown",
          latitude,
          longitude,
          altitude,
          heading: Number(state[10]) || 0,
          speed: Number(state[9]) || 0,
          verticalRate: Number(state[11]) || 0,
          origin: "Unknown",
          destination: "Unknown",
          airline: "Cargo",
          cargoType: "General Cargo",
          status: onGround ? "landed" : "airborne",
          onGround,
          lastUpdate: Date.now(),
        };
      });

    console.log("✅ Cargo flights fetched successfully:", flights.length, "aircraft");
    return flights;
  } catch (error) {
    console.error("❌ Error fetching cargo flights from OpenSky:", error);
    return [];
  }
}

/**
 * Mock cargo flight data - BACKUP (not used with real API)
 */
function _getMockCargoFlights(): CargoFlight[] {
  const mockFlights: CargoFlight[] = [
    {
      icao24: "a34d66",
      callSign: "DHL5UP",
      registration: "N418UP",
      manufacturer: "Boeing",
      model: "757-200F",
      latitude: 37.7749,
      longitude: -122.4194,
      altitude: 32000,
      heading: 45,
      speed: 450,
      verticalRate: 0,
      origin: "SFO",
      destination: "LAX",
      airline: "UPS Airlines",
      cargoType: "General Cargo",
      status: "cruise",
      onGround: false,
      lastUpdate: Date.now(),
    },
    {
      icao24: "a34d67",
      callSign: "FDX4789",
      registration: "N688UP",
      manufacturer: "Airbus",
      model: "A300-600F",
      latitude: 33.9425,
      longitude: -118.4081,
      altitude: 28000,
      heading: 270,
      speed: 460,
      verticalRate: -200,
      origin: "MEM",
      destination: "LAX",
      airline: "FedEx Express",
      cargoType: "Time Sensitive Documents",
      status: "descending",
      onGround: false,
      lastUpdate: Date.now(),
    },
    {
      icao24: "a34d68",
      callSign: "AAL8642",
      registration: "N726DE",
      manufacturer: "Boeing",
      model: "767-300F",
      latitude: 41.9028,
      longitude: 12.4964,
      altitude: 35000,
      heading: 90,
      speed: 480,
      verticalRate: 0,
      origin: "JFK",
      destination: "FCO",
      airline: "American Airlines Cargo",
      cargoType: "Palletized Cargo",
      status: "cruise",
      onGround: false,
      lastUpdate: Date.now(),
    },
    {
      icao24: "a34d69",
      callSign: "SWR64E",
      registration: "HB-JCA",
      manufacturer: "Airbus",
      model: "A330-343P",
      latitude: 48.8566,
      longitude: 2.3522,
      altitude: 38000,
      heading: 0,
      speed: 470,
      verticalRate: 0,
      origin: "CDG",
      destination: "JFK",
      airline: "SWISS",
      cargoType: "Fresh Produce",
      status: "cruise",
      onGround: false,
      lastUpdate: Date.now(),
    },
    {
      icao24: "a34d6a",
      callSign: "DHL8UX",
      registration: "N415UP",
      manufacturer: "Boeing",
      model: "757-200F",
      latitude: 31.4454,
      longitude: 74.3571,
      altitude: 24000,
      heading: 135,
      speed: 420,
      verticalRate: 500,
      origin: "LHR",
      destination: "DEL",
      airline: "DHL Express",
      cargoType: "Pharmaceuticals",
      status: "climbing",
      onGround: false,
      lastUpdate: Date.now(),
    },
    {
      icao24: "a34d6b",
      callSign: "CHH4050",
      registration: "N763CX",
      manufacturer: "Boeing",
      model: "747-8F",
      latitude: 1.3521,
      longitude: 103.8198,
      altitude: 5000,
      heading: 270,
      speed: 180,
      verticalRate: -800,
      origin: "SGP",
      destination: "HKG",
      airline: "Cathay Pacific Cargo",
      cargoType: "Electronics",
      status: "descending",
      onGround: false,
      lastUpdate: Date.now(),
    },
    {
      icao24: "a34d6c",
      callSign: "FDX100",
      registration: "N696UP",
      manufacturer: "Airbus",
      model: "A300-600F",
      latitude: 35.0896,
      longitude: 139.3846,
      altitude: 1200,
      heading: 180,
      speed: 120,
      verticalRate: -500,
      origin: "NRT",
      destination: "ICN",
      airline: "FedEx Express",
      cargoType: "Auto Parts",
      status: "descending",
      onGround: false,
      lastUpdate: Date.now(),
    },
  ];

  return mockFlights;
}

/**
 * Subscribe to real-time tanker updates
 * In production, this would use WebSocket connections
 */
export function subscribeToTankerUpdates(
  onUpdate: (tankers: OilTanker[]) => void,
  interval = 5000
): () => void {
  const pollInterval = setInterval(async () => {
    try {
      const tankers = await fetchOilTankers();
      onUpdate(tankers);
    } catch (error) {
      console.error("Error fetching tanker updates:", error);
    }
  }, interval);

  return () => clearInterval(pollInterval);
}

/**
 * Subscribe to real-time flight updates
 * In production, this would use WebSocket connections
 */
export function subscribeToFlightUpdates(
  onUpdate: (flights: CargoFlight[]) => void,
  interval = 3000
): () => void {
  const pollInterval = setInterval(async () => {
    try {
      const flights = await fetchCargoFlights();
      onUpdate(flights);
    } catch (error) {
      console.error("Error fetching flight updates:", error);
    }
  }, interval);

  return () => clearInterval(pollInterval);
}
