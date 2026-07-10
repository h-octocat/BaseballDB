import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import session from "express-session";
import env from "dotenv";
import { sha256 } from "js-sha256";
import multer from "multer";
import fs from "fs/promises";

import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

env.config();

const { Client } = pg;
const client = new Client({
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: "BaseballDB",
});

const app = express();

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 24 * 60 * 60 * 1000, // 10 days * 24 hours * 60 minutes * 60 seconds * 1000 milliseconds = 10 days in ms
      httpOnly: true,
      sameSite: "Lax",
    },
  }),
);
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(passport.initialize());
app.use(passport.session());

// set the view engine to ejs
app.set("view engine", "ejs");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "images/");
  },
  filename: (req, file, cb) => {
    const user = req.user.email || "cards";
    const name = req.body.playerName || "Bob";
    const price = req.body.cardPrice || "Bob";
    const team = req.body.playerTeam || "Bob";
    var string = name + price + team;
    string = string.replace(" ", "");
    const id = sha256(string);
    cb(null, `${user}${id}.jpg`);
  },
});

const upload = multer({ storage });

var timesAccesed = 0;
const saltRounds = 10;

async function createDB(user) {
  console.log(`Adding database for ${user}`);
  client.query(`CREATE TABLE ${user} (
    card_id TEXT NOT NULL,
    card_name VARCHAR(255) NOT NULL,
    card_price DECIMAL(10, 2) NOT NULL,
    card_team VARCHAR(255) NOT NULL
);
CREATE INDEX card_id_hash_index${user} ON ${user} USING hash (card_id);`);
}

async function addCard(name, price, team, db) {
  console.log(`Adding card for ${db}`);
  var string = name + price + team;
  string = string.replace(" ", "");
  var cardid = sha256(string);
  if (await cardExists(cardid, db)) {
    // card already exists
    return false;
  }
  // remove all non-num chars except for decimal
  price = price
    .replace(/[^.0-9]+/g, "")
    .replace(/\.(?=.*\.)/g, "")
    .trim();
  var prompt = `INSERT INTO ${db} VALUES ($1, $2, $3, $4);`;
  await client.query(prompt, [cardid, name, price, team]);
  timesAccesed++;
  if (timesAccesed == 50) {
    timesAccesed = 0;
    // refresh hashes
    client.query("REINDEX INDEX card_id_hash_index;");
  }
  return true;
}

function getCards(db) {
  console.log(`Getting cards for ${db}`);
  return client.query(`SELECT * from ${db};`);
}

async function cardExists(id, db) {
  console.log(`Checking card for ${db}`);
  var result = await client.query(
    `SELECT EXISTS (SELECT 1 FROM ${db} WHERE card_id = '${id}')`,
  );
  if (!result.rows) {
    // no rows no exist
    return false;
  }
  return result.rows[0].exists;
}

async function queryByName(name, db) {
  console.log(`Searching card for ${db}`);
  var result = await client.query(
    `SELECT * from ${db} WHERE card_name = ($1);`,
    [name],
  );
  if (!result.rows || result.rows.length == 0) {
    return 0;
  }
  return result.rows;
}

// db is also user
async function deleteByID(id, db) {
  console.log(`Deleting card for ${db}`);
  try {
    const filePath = path.join(__dirname, "images", `${db}${id}.jpg`);
    await fs.unlink(filePath, (err) => {
      if (err) {
        console.log("error deleting image");
      }
    });
    console.log(`Deleted file for ${db}`);
  } catch (error) {
    console.error(`Error deleting file: ${error.message}`);
  }
  await client.query(`DELETE from ${db} WHERE card_id = '${id}';`);
}

app.listen(80, async function () {
  await client.connect();
  console.log("Server started at port 80");
});

app.get("/", async function (req, res) {
  if (!req.isAuthenticated()) {
    res.redirect("/login");
    return;
  }
  var cards = await getCards(req.user.email);
  var value = 0;
  if (cards.rows) {
    cards.rows.forEach((row) => {
      value += Number(row.card_price);
    });
  }
  res.render("index", {
    cards: cards.rowCount,
    value: value.toFixed(2),
    user: req.user.email,
  });
});

app.get("/add-card", async function (req, res) {
  if (!req.isAuthenticated()) {
    res.redirect("/login");
    return;
  }
  res.render("add-card");
});

app.get("/all", async function (req, res) {
  if (!req.isAuthenticated()) {
    res.redirect("/login");
    return;
  }
  res.render("list-all", {
    rows: (await getCards(req.user.email)).rows,
    user: req.user.email,
  });
});

app.get("/search", async function (req, res) {
  if (!req.isAuthenticated()) {
    res.redirect("/login");
    return;
  }
  res.render("search");
});

app.post("/search", async function (req, res) {
  if (!req.isAuthenticated()) {
    res.redirect("/login");
    return;
  }
  const query = req.body.query;
  const result = await queryByName(query, req.user.email);
  if (result == 0) {
    res.send("<h1>Card does not exist</h1>");
    return;
  }
  res.render("search-result", {
    rows: result,
    user: req.user.email,
  });
});

app.post("/add-card", upload.single("card_image"), async function (req, res) {
  if (!req.isAuthenticated()) {
    res.redirect("/login");
    return;
  }
  const name = req.body.playerName;
  const price = req.body.cardPrice;
  const team = req.body.playerTeam;
  if (!name || !price || !team || !req.file) {
    var missing = "image";
    if (!name) {
      missing = "name";
    } else if (!price) {
      missing = "price";
    } else if (!team) {
      missing = "team";
    }
    res.send(
      `<h1 style='font-family: "Poppins", "Helvetica", sans-serif;'>Missing ${missing}!</h1><a style='font-family: "Poppins", "Helvetica", sans-serif;' href="/">Home</a>`,
    );
    return;
  }
  const result = await addCard(name, price, team, req.user.email);
  if (result) {
    res.redirect("/all");
  } else {
    res.send(
      `<h1 style='font-family: "Poppins", "Helvetica", sans-serif;'>Card already exists</h1><a style='font-family: "Poppins", "Helvetica", sans-serif;' href="/">Home</a>`,
    );
  }
});

app.get("/data", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.redirect("/login");
    return;
  } else {
    if (req.query.action == "retrieve") {
      if (req.user.email == req.query.user) {
        console.log(`Fetching image for ${req.user.email}`);
        const filePath = path.join(
          __dirname,
          "images",
          `${req.user.email}${req.query.id}.jpg`,
        );
        res.sendFile(filePath, (err) => {
          if (err) {
            console.log("File not found!");
            return res.status(404).send("Error fetching image!");
          }
        });
        return;
      }
      console.log(`Denied image for ${req.user.email}`);
      res.status(403).send(`Access Denied!`);
    }
  }
});
// /data?action=retrieve&id=id&user=user
app.post("/data", async function (req, res) {
  if (!req.isAuthenticated()) {
    res.redirect("/login");
    return;
  }
  if (req.query.action == "delete") {
    console.log(`Deleting for ${req.user.email}`);
    if (!(await cardExists(req.query.id, req.user.email))) {
      res.send("fail");
    } else {
      await deleteByID(req.query.id, req.user.email);
      res.send("success");
    }
  }
});

app.get("/login", (req, res) => {
  res.render("login.ejs");
});

app.get("/register", (req, res) => {
  res.render("register.ejs");
});

app.get("/logout", (req, res) => {
  if (req.isAuthenticated()) {
    console.log(`Logging out ${req.user.email}`);
    req.logout(function (err) {
      if (err) {
        return next(err);
      }
      res.redirect("/");
    });
  } else {
    res.redirect("/login");
  }
});

app.post("/login", (req, res) => {
  passport.authenticate("local", (unknown, user, err) => {
    if (user) {
      req.login(user, (err) => {
        if (err) {
          res.send({ message: err });
        }
        console.log(`Logged in ${user.email}`);
        res.send({ message: "success" });
      });
    } else {
      console.log(`Failed to log in user: incorrect password`);
      res.send({ message: "Incorrect password" });
    }
  })(req, res);
});

app.post("/register", async (req, res) => {
  let email = req.body.username;
  // this is required because tables cant have special chars in them
  email = email.replace(/[^a-zA-Z0-9_]/g, "");
  const password = req.body.password;

  try {
    const checkResult = await client.query(
      "SELECT * FROM users WHERE email = $1",
      [email],
    );
    if (email == "cards" || email == "users") {
      console.log(`Error registering ${req.body.username}: username taken`);
      res.send(
        `Username taken! Try again! <a href="/login">Or maybe you meant to log in.</a>`,
      );
    }
    if (checkResult.rows.length > 0) {
      console.log(`Error registering ${req.body.username}: username taken`);
      res.send(
        `Username taken! Try again! <a href="/login">Or maybe you meant to log in.</a>`,
      );
    } else {
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error("Error hashing password: ", err);
        } else {
          const result = await client.query(
            "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
            [email, hash],
          );
          const user = result.rows[0];
          req.login(user, (err) => {
            console.log(`Success registering: ${user.email}`);
            createDB(user.email);
            res.send("success!");
          });
        }
      });
    }
  } catch (err) {
    console.log(err);
  }
});

passport.use(
  new Strategy(async function verify(username, password, cb) {
    username.replace(/[^a-zA-Z0-9_]/g, "");
    try {
      const result = await client.query(
        "SELECT * FROM users WHERE email = $1 ",
        [username],
      );
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;
        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            //Error with password check
            console.error("Error comparing passwords:", err);
            return cb(err);
          } else {
            if (valid) {
              //Passed password check
              return cb(null, user);
            } else {
              //Did not pass password check
              return cb(null, false);
            }
          }
        });
      } else {
        return cb(null, false, { message: "User not found!" });
      }
    } catch (err) {
      console.log(`Error authenticating ${username}: ${err}`);
    }
  }),
);

passport.serializeUser((user, cb) => {
  cb(null, user);
});
passport.deserializeUser((user, cb) => {
  cb(null, user);
});

process.on("SIGINT", async () => {
  await client.end();
  process.exit(0);
});
