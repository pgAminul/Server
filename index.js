const express = require("express");
const cors = require("cors");
require("dotenv").config();
const http = require("http");
const socketIo = require("socket.io");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;
const server = http.createServer(app);

// Initialize socket.io with CORS configuration
const io = socketIo(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "https://management-server-rosy.vercel.app",
      "https://task-mangement-client.onrender.com",
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

// Middleware setup
const allowedOrigins = [
  "http://localhost:5173",
  "https://management-server-rosy.vercel.app",
  "https://task-mangement-client.onrender.com",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

app.use(express.json());

// MongoDB Connection

const uri = process.env.DATABASE_PASS_USER;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Function to check if ObjectId is valid
const isValidObjectId = (id) => ObjectId.isValid(id);

// Run function to handle database operations
async function run() {
  try {
    const userCollection = client.db("taskManagerDB").collection("users");
    const taskCollection = client.db("taskManagerDB").collection("tasks");

    io.on("connection", (socket) => {
      console.log("⚡ A user connected");
      socket.emit("welcome", "Welcome to the task manager!");
      socket.on("disconnect", () => {
        console.log("❌ User disconnected");
      });
    });

    // save or update user data on mongodb
    app.post("/user/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = req.body;
      console.log(user, query, email);

      const isExist = await userCollection.findOne(query);
      if (isExist) {
        return res.send(isExist);
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.get("/tasks", async (req, res) => {
      try {
        const result = await taskCollection.find().sort({ index: 1 }).toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching tasks:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // 🔹 **POST: Add New Task**
    app.post("/tasks", async (req, res) => {
      try {
        const task = req.body;
        task.createdAt = new Date(); // Add creation date
        const result = await taskCollection.insertOne(task);
        io.emit("task-updated", task); // Notify all clients
        res.send(result);
      } catch (error) {
        console.error("Error adding task:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // 🔹 **PUT: Update Task (Category, Title, etc.)**
    app.put("/tasks/:id", async (req, res) => {
      const id = req.params.id;
      // console.log('id',id);
      console.log("body", req.body, "id", id);

      if (!isValidObjectId(id)) {
        return res.status(400).send({ message: "Invalid task ID" });
      }

      try {
        const updatedTask = req.body;
        const query = { _id: new ObjectId(id) };
        const updateDoc = { $set: updatedTask };

        const result = await taskCollection.updateOne(query, updateDoc);

        // If no task was updated, return a 404 error
        if (result.modifiedCount === 0) {
          return res.status(404).send({ message: "Task not found" });
        }

        // Fetch updated task to emit full updated data
        const updatedData = await taskCollection.findOne(query);
        io.emit("task-updated", updatedData); // Notify all clients

        res.send(updatedData);
      } catch (error) {
        console.error("Error updating task:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // 🔹 **PUT: Update Task Position (Category, Index) for Drag & Drop with Unique Index**
    app.put("/tasks/reorder/:id", async (req, res) => {
      const id = req.params.id;
      const { category, index } = req.body; // Get new category and index from request body

      // Validate ObjectId
      if (!isValidObjectId(id)) {
        return res.status(400).send({ message: "Invalid task ID" });
      }

      try {
        const query = { _id: new ObjectId(id) };

        // Fetch current task to get category and index before the update
        const currentTask = await taskCollection.findOne(query);

        if (!currentTask) {
          return res.status(404).send({ message: "Task not found" });
        }

        // Step 1: Check if the index already exists in the category
        const existingTask = await taskCollection.findOne({
          category: category,
          index: index,
        });

        // If index already exists, increment it
        if (existingTask) {
          // Increment all subsequent tasks' indices to avoid duplicates
          await taskCollection.updateMany(
            { category: category, index: { $gte: index } },
            { $inc: { index: 1 } }
          );
        }

        // Step 2: Update the current task with the new index and category
        const updateDoc = { $set: { category: category, index: index } };
        await taskCollection.updateOne(query, updateDoc);

        // Step 3: Emit changes via socket to update client in real-time
        io.emit("task-updated", { id, category, index });

        // Send back updated task
        res.send({ message: "Task reordered successfully" });
      } catch (error) {
        console.error("Error updating task:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // 🔹 **DELETE: Remove Task**
    app.delete("/tasks/:id", async (req, res) => {
      const id = req.params.id;

      if (!isValidObjectId(id)) {
        return res.status(400).send({ message: "Invalid task ID" });
      }

      try {
        const query = { _id: new ObjectId(id) };
        const result = await taskCollection.deleteOne(query);

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Task not found" });
        }

        io.emit("task-updated", id); // Notify clients about deletion
        res.send({ message: "Task deleted successfully" });
      } catch (error) {
        console.error("Error deleting task:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
  } catch (error) {
    console.error("Error during MongoDB operation:", error);
    process.exit(1); // Exit the process if DB connection fails
  } finally {
    // Keep MongoDB connection open
    // await client.close();
  }
}

run().catch(console.dir);

// Basic route
app.get("/", (req, res) => {
  res.send("✅ Taskly server is running..");
});

// Start server
server.listen(port, () => {
  console.log(`🚀 Taskly is running on port ${port}`);
});
