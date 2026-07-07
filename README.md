# BaseballDB
A database to store all of your baseball cards.
Get the full story at henryks.net

## Setup
If you want to install BaseballDB on your machine, you are going to need node and postgres. You can install node at [nodejs.org](https://nodejs.org/en/download) and postgres at [postgres.org](https://www.postgresql.org/download/).

Once you have both, install dependencies with `npm i`. Now that you have node dependencies, you have to setup the postgres database and environment variables.

Create a file named `.env` in your main directory and fill it with the following:
```
DATABASE_PASSWORD="YOUR_DB_PASSWORD"
DATABASE_USER="postgres"
SESSION_SECRET="YOUR_SESSION_SECRET"
NODE_ENV="testing/production"
```

Database password is whatever you set your server password to be when setting up postgres, database user is the user that goes with the password to login to your postgres server, the session secret is a random string of characters that you need to generate (keep it a secret), and the node environment is either `testing` or `production`. If you are running it locally, it doesn't matter, but if you are putting it on a public server, use `production`. 

To setup the postgres database, create a database on your sever called "BaseballDB." Inside
