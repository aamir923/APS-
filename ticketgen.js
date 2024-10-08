const callFastAPI = require("./cvapi");
const axios = require("axios");
const { MongoClient } = require("mongodb");
const { Redis } = require("ioredis")

const client1 = new Redis()

let availableSpots = [];   // List to keep track of available parking spots
let reservedSpots = [];    // List to keep track of reserved parking spots

// MongoDB connection URI
const uri = "mongodb://localhost:27017";  // Replace with your MongoDB URI if different
const client = new MongoClient(uri);

async function connectDB() {
    try {
        await client.connect();
        console.log("Connected to MongoDB");

        const database = client.db("parkingDB"); // Database name
        const collection = database.collection("reservedSpots"); // Collection name

        // Clear all reserved spots when the server starts
        await collection.deleteMany({});
        console.log("All reserved spots have been cleared from the database");
    } catch (err) {
        console.error("Failed to connect to MongoDB or clear reserved spots", err);
    }
}

async function saveReservedSpot(spot) {
    try {
        const database = client.db("parkingDB"); // Database name
        const collection = database.collection("reservedSpots"); // Collection name

        const result = await collection.insertOne({ parkingSpot: spot, reservedAt: new Date() });
        console.log(`Reserved spot saved to DB: ${spot}`);
    } catch (err) {
        console.error("Failed to save reserved spot", err);
    }
}

// Function to update the list of available spots every second
async function updateAvailableSpots() {
    try {
        let space = await callFastAPI();  // Get the list of available spots from the video analysis
        availableSpots = space.list.filter(spot => !reservedSpots.includes(spot));
         // Filter out already reserved spots
        console.log("Updated available spots:", availableSpots);

        return availableSpots;
    } catch (err) {
        console.log("Error updating available spots ->", err);
    }
}

// Function to generate a ticket for the first available spot
async function generateTicket() {
    try {
        if (availableSpots.length === 0) {
            console.log("No available spots to assign");
            return;
        }

        let reservedSpot = availableSpots.shift();  // Remove the first spot from the list and reserve it
        reservedSpots.push(reservedSpot);  // Add the reserved spot to the reservedSpots list
        await saveReservedSpot(reservedSpot);  // Save the reserved spot to the database

        let headers = {
            'Content-Type': 'application/json'
        };
        let url = `http://localhost:3300/api/v1/ticket`;
        let body = {
            "parkingSpot": reservedSpot  // Send the reserved spot in the request body
        };
        let data = await axios.post(url, body, { headers });
        console.log("Ticket generated for spot:", reservedSpot);
        return data;
    } catch (err) {
        console.log("Error generating ticket ->", err);
    }
}

async function patchSlots() {
  try {
    const space = await updateAvailableSpots(); // Get available spots
    console.log('Total empty parking slots:', space.length);

    // Check Redis cache
    const cacheValue = await client1.get('parkingData');
    if (cacheValue !== null) {
      return; // Return early if cache exists
    }

    // Patch request to update available slot count
    await axios.patch('http://localhost:3300/api/v1/parkingLot/66636f161cb0542984b19fb4', {
      "count": space.length
    });

    // Fetch updated parking lot data
    const { data } = await axios.get('http://localhost:3300/api/v1/parkingLot/66636f161cb0542984b19fb4');

    // Set cache with an expiration time of 5 seconds
    await client1.set('parkingData', JSON.stringify(data));
    await client1.expire('parkingData', 5);

    console.log('Data patched and cached successfully');
  } catch (err) {
    console.error('Error in patchSlots:', err);
  }
}

// Function to start the process
async function startProcess() {
  
    await connectDB();
    setInterval(patchSlots,1000);
}

startProcess();

module.exports = generateTicket,updateAvailableSpots;
