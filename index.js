const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
const port = 3000;
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const admin = require("firebase-admin");

const serviceAccount = require("./firebase-admin.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  console.log("headers in the middlewaree", req.headers?.authorization);
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "unathorized access" });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;
  } catch (error) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  next();
};

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qa09sjl.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();

    //colelction
    const db = client.db("next-champ");
    const userCollection = db.collection("users");
    const contestCollection = db.collection("contests");

    /////////////////////////Users apis here//////////////////////
    app.get("/users", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.email = email;
      }
      const result = await userCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.createdAt = new Date().toLocaleString();
      user.role = user.role || "user";

      // check if user already exists
      const existingUser = await userCollection.findOne({ email: user.email });
      if (existingUser) {
        return res.send({ message: "User already exists" });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.patch("/users/:id", async (req, res) => {
      const id = req.params.id;
      const roleInfo = req.body;
      const query = { _id: new ObjectId(id) };

      const updatedDoc = {
        $set: {
          role: roleInfo.role,
        },
      };

      const result = await userCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    ////////////////////CONTEST APIS HERE///////////////////////
    app.get("/contests", async (req, res) => {
      const creatorEmail = req.query.creatorEmail;
      const limit = parseInt(req.query.limit);
      const search = req.query.search;

      const query = {};
      if (creatorEmail) {
        query.creatorEmail = creatorEmail;
      }

      if (search) {
        query.$or = [
          { title: { $regex: search, $options: "i" } },
          { type: { $regex: search, $options: "i" } },
        ];
      }

      let cursor = contestCollection.find(query);

      if (!isNaN(limit) && limit > 0) {
        cursor = cursor.limit(limit);
      }
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/contests/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await contestCollection.findOne(query);

      res.send(result);
    });

    // Get contest with only participants who paid / submitted task

    app.delete("/contests/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await contestCollection.deleteOne(query);
      res.send(result);
    });

    app.post("/contests", async (req, res) => {
      const contest = req.body;
      const now = new Date();
      const localTimeString = now.toLocaleString();
      contest.createdAt = localTimeString;
      contest.status = "pending";
      contest.participants = [];
      contest.paymentStatus = "unpaid";
      const result = await contestCollection.insertOne(contest);
      res.send(result);
    });

    app.get("/my-contests", verifyFBToken, async (req, res) => {
      const { creatorEmail } = req.query;

      const query = creatorEmail ? { creatorEmail } : {};

      const result = await contestCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/my-winnings-contest", verifyFBToken, async (req, res) => {
      const result = await contestCollection.find({}).toArray();
      res.send(result);
    });

    app.put("/contests/:id", async (req, res) => {
      const { id } = req.params;
      const updatedContest = req.body;
      const now = new Date();
      const localTimeString = now.toLocaleString();
      updatedContest.updatedTime = localTimeString;

      const query = { _id: new ObjectId(id) };

      const exists = await contestCollection.findOne({
        _id: new ObjectId(id),
        "participants.email": updatedContest.email,
      });

      if (exists) {
        return res.send({ message: "Already added" });
      }
      const updatedDoc = {
        $set: updatedContest,
      };
      const result = await contestCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    app.patch("/contests/:id", async (req, res) => {
      const id = req.params.id;
      const statusInfo = req.body;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          status: statusInfo.status,
        },
      };
      const result = await contestCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    app.patch("/contests/:id/winner", async (req, res) => {
      const id = req.params.id;
      const winnerUpdate = req.body;
      const query = { _id: new ObjectId(id) };

      const updatedDoc = {
        $set: {
          winnerStatus: "declared",
        },
        $push: {
          winner: {
            ...winnerUpdate,
            declaredAt: new Date().toLocaleString(),
          },
        },
      };

      const result = await contestCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    app.delete("/contests/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await contestCollection.deleteOne(query);
      res.send(result);
    });

    /////////////////////My participations api/////////////////
    app.get("/my-participation/:email", verifyFBToken, async (req, res) => {
      const email = req.params.email;

      const result = await contestCollection
        .find({ "participants.email": email })
        .toArray();
      res.send(result);
    });

    app.patch("/submit-task/:id", async (req, res) => {
      const contestId = req.params.id;
      const { email, task, name, image } = req.body;

      // email & task check
      if (!email || !task || !name) {
        return res
          .status(400)
          .send({ success: false, message: "Invalid data" });
      }

      // Check participant exists
      const contest = await contestCollection.findOne({
        _id: new ObjectId(contestId),
        "participants.email": email,
      });

      if (!contest) {
        return res.status(404).send({
          success: false,
          message: "Participant not found in contest",
        });
      }

      // Update participant task
      const result = await contestCollection.updateOne(
        {
          _id: new ObjectId(contestId),
          "participants.email": email,
        },
        {
          $set: {
            "participants.$.task": task,
            "participants.$.name": name,
            "participants.$.image": image,
          },
        }
      );

      res.send({ success: true, result });
    });

    //////////////////PAYMENT Apis//////////////////
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.price) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.name,
              },
            },

            quantity: 1,
          },
        ],
        mode: "payment",
        customer_email: paymentInfo.participant_email,
        metadata: {
          contestId: paymentInfo.contestId,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      console.log(session);
      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log("email:", session.customer_details.email);
      if (session.payment_status === "paid") {
        const contestId = session.metadata.contestId;
        const participant_email = session.customer_details.email;

        // contest fetch
        const contest = await contestCollection.findOne({
          _id: new ObjectId(contestId),
        });

        if (!contest) {
          return res
            .status(404)
            .send({ success: false, message: "Contest Not Found" });
        }

        // check dublicate
        const participantExist = contest.participants?.some(
          (p) => p.email === participant_email
        );

        if (participantExist) {
          return res.send({
            success: true,
            message: "participant already exist",
          });
        }

        const query = { _id: new ObjectId(contestId) };
        const update = {
          $set: {
            paymentStatus: "paid",
          },
          $addToSet: {
            participants: {
              email: participant_email,
              paymentAt: new Date().toLocaleString(),
              task: "",
            },
          },
        };
        const result = await contestCollection.updateOne(query, update);
        return res.send(result);
      }

      return res.send({ success: false });
    });

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment!");
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("NEXT CHAMP server on the way");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
