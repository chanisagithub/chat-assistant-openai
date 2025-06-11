import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import winston from 'winston';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup logging
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp} - ${level}: ${message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'app.log' })
    ],
});

logger.info("Logging is set up.");

const app = express();

// Configure CORS
app.use(cors({
    origin: '*',
    credentials: true,
    methods: '*',
    allowedHeaders: '*'
}));

app.use(express.json());

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

// Get API key from environment variable
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SERPER_API_KEY = process.env.SERPER_API_KEY;
const REALTIME_SESSION_URL = process.env.REALTIME_SESSION_URL;

logger.info(`REALTIME_SESSION_URL: ${REALTIME_SESSION_URL}`);

if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not found in environment variables");
}
if (!SERPER_API_KEY) {
    throw new Error("SERPER_API_KEY not found in environment variables");
}
if (!REALTIME_SESSION_URL) {
    throw new Error("REALTIME_SESSION_URL not found in environment variables");
}

app.post('/session', async (req, res) => {
    console.log(req.body);
    const { voice } = req.query;
    const { property } = req.body;
    if (!property || !property.title) {
        return res.status(400).json({ error: "Missing property data" });
    }
    
    const selectedProperty = property;
    try {
        const instructions = `
        You are Nova, a luxury real estate assistant for Siam Real Estate.
        Specializing in the selected property: ${selectedProperty.title}.
        Follow these rules STRICTLY:
        
        1. FIRST MESSAGE: 
           "Hello. I'm the AI buyer's assistant for ${selectedProperty.title}. 
           I speak any language. Ask me about Villas, the Project, or Krabi location."
        
        2. ALWAYS:
           - Mention property features accurately.
           - Reply in the user's language.
           - Pronounce "Siam" as "stm"
           - Never say "absolutely".
        
        3. AFTER 40 SECONDS:
           Suggest WhatsApp contact:
           "Would you like to chat with a human agent via WhatsApp for more details?"
        
        4. AFTER 1 MINUTE:
           Request contact details:
           "May I have your email/phone to send visuals and connect you with an agent?"
        
        PROPERTY DETAILS:
        - Title: ${selectedProperty.title}
        - Location: ${selectedProperty.location || "Krabi"}
        - Pricing: ${selectedProperty.pricing || "N/A"}
        - Features: ${selectedProperty.key_features?.join("; ") || "N/A"}
        - Amenities: ${selectedProperty.additional_amenities?.join("; ") || "N/A"}
        - Ideal for: ${selectedProperty.buyer_persona || "N/A"}
        - Images available
        
        When the user asks to "chat with an agent":
        Immediately say: "I'll connect you with a Siam Real Estate agent. May I have your name and phone number?"
        
        When the user asks to "show me images":
        Ask for the location and type of property.
        `;

        const response = await axios.post(
            REALTIME_SESSION_URL,
            {
                model: "gpt-4o-realtime-preview-2024-12-17",
                modalities: ["audio", "text"],
                turn_detection: {
                  type: "server_vad",
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 200,
                  create_response: true,
                  interrupt_response: true,
                },
                instructions,
                voice: "alloy",
                temperature: 0.8,
                tools: [
                  {
                    type: "function",
                    name: "open_whatsapp",
                    description: "Trigger when user asks to chat with human agent",
                    parameters: {
                      type: "object",
                      properties: {
                        reason: {
                          type: "string",
                          enum: ["viewing", "pricing", "contract", "general"],
                        },
                        urgency: {
                          type: "string",
                          enum: ["now", "later"],
                        },
                      },
                    },
                  },
                  {
                    type: "function",
                    "name": "show_property_images",
                    "description": "Display property images on the website",
                    "parameters": {
                      "type": "object",
                      "properties": {
                        "location": { "type": "string", "description": "City or area" },
                        "property_type": { "type": "string", "description": "Type of property (e.g., villa, apartment)" }
                      },
                      "required": ["location", "property_type"]
                    }
                  },
                ],
              },
            {
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        res.json(response.data);
    } catch (error) {
        if (error.response) {
            logger.error(`HTTP error occurred: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            res.status(error.response.status).json({ error: error.response.data.error || 'HTTP Error' });
        } else if (error.request) {
            logger.error(`No response received: ${error.message}`);
            res.status(500).json({ error: 'Internal Server Error', details: 'No response from external service' });
        } else {
            logger.error(`Error setting up the request: ${error.message}`);
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    }
});

app.get('/weather/:location', async (req, res) => {
    const { location } = req.params;
    try {
        // Get coordinates for location
        const geocodingResponse = await axios.get(
            `https://geocoding-api.open-meteo.com/v1/search?name=${location}&count=1`
        );
        const geocodingData = geocodingResponse.data;

        if (!geocodingData.results) {
            return res.json({ error: `Could not find coordinates for ${location}` });
        }

        const { latitude: lat, longitude: lon, name: location_name } = geocodingData.results[0];

        // Get weather data with more parameters
        const weatherResponse = await axios.get(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=auto&forecast_days=7`
        );
        const weatherData = weatherResponse.data;

        // Extract current weather
        const current = weatherData.current;
        const daily = weatherData.daily;

        // Create daily forecast array
        const forecast = daily.time.map((time, index) => ({
            date: time,
            max_temp: daily.temperature_2m_max[index],
            min_temp: daily.temperature_2m_min[index],
            precipitation: daily.precipitation_sum[index],
            weather_code: daily.weather_code[index]
        }));

        res.json({
            temperature: current.temperature_2m,
            humidity: current.relative_humidity_2m,
            precipitation: current.precipitation,
            wind_speed: current.wind_speed_10m,
            unit_temperature: "celsius",
            unit_precipitation: "mm",
            unit_wind: "km/h",
            forecast_daily: forecast,
            current_time: current.time,
            latitude: lat,
            longitude: lon,
            location_name: location_name,
            weather_code: current.weather_code
        });

    } catch (error) {
        logger.error(`Error getting weather data for ${location}: ${error.message}`);
        if (error.response) {
            logger.error(`Weather API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            res.status(500).json({ error: `Could not get weather data: ${error.response.data.error || 'Weather API Error'}` });
        } else {
            res.status(500).json({ error: `Could not get weather data: ${error.message}` });
        }
    }
});

app.get('/search/:query', async (req, res) => {
    const { query } = req.params;
    try {
        // Get regular search results
        const response = await axios.post(
            "https://google.serper.dev/search",
            { q: query },
            {
                headers: {
                    "X-API-KEY": SERPER_API_KEY,
                    "Content-Type": "application/json"
                }
            }
        );

        const data = response.data;

        // Get image search results with larger size
        const imageResponse = await axios.post(
            "https://google.serper.dev/images",
            {
                q: query,
                gl: "us",
                hl: "en",
                autocorrect: true
            },
            {
                headers: {
                    "X-API-KEY": SERPER_API_KEY,
                    "Content-Type": "application/json"
                }
            }
        );

        const imageData = imageResponse.data;

        if (data.organic && data.organic.length > 0) {
            const result = data.organic[0]; // Get the first result
            let imageResult = null;

            // Find first valid image
            if (imageData.images) {
                for (const img of imageData.images) {
                    if (img.imageUrl && (
                        img.imageUrl.endsWith('.jpg') || img.imageUrl.endsWith('.jpeg') || img.imageUrl.endsWith('.png') || img.imageUrl.endsWith('.gif') || img.imageUrl.endsWith('.webp') ||
                        img.imageUrl.toLowerCase().includes('images')
                    )) {
                        imageResult = img;
                        break;
                    }
                }
            }

            res.json({
                title: result.title || "",
                snippet: result.snippet || "",
                source: result.link || "",
                image_url: imageResult ? imageResult.imageUrl : null,
                image_source: imageResult ? imageResult.source : null
            });
        } else {
            res.json({ error: "No results found" });
        }

    } catch (error) {
        logger.error(`Error performing search for "${query}": ${error.message}`);
        if (error.response) {
            logger.error(`Serper API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            res.status(500).json({ error: `Could not perform search: ${error.response.data.error || 'Serper API Error'}` });
        } else {
            res.status(500).json({ error: `Could not perform search: ${error.message}` });
        }
    }
});

const PORT = process.env.PORT;
app.listen(PORT, () => {
    logger.info(`Server is running on http://localhost:${PORT}`);
});