import * as dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import multer from 'multer'
import cors from 'cors'

import sharp, { OutputInfo } from 'sharp'

import config from './config'
import slowDown from 'express-slow-down'

import * as fs from 'node:fs'

import * as sqlite3 from 'sqlite3'

import * as queries from './queries'

const STORAGE_PATH = "./storage/"
const RESOURCE_IMAGES_DIR_NAME = "resource-images"

const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 100, // allow 100 requests per 15 minutes, then...
  delayMs: 500 // begin adding 500ms of delay per request above 100:
  // request # 101 is delayed by  500ms
  // request # 102 is delayed by 1000ms
  // request # 103 is delayed by 1500ms
  // etc.
});

let db: sqlite3.Database

let getResourceQuery: sqlite3.Statement

let searchResourcesQuery: sqlite3.Statement
let searchResourceByCreatorQuery: sqlite3.Statement
const MAX_TAGS = 5

let getResourceImagesQuery: sqlite3.Statement

let getBookingsQueryByAccount: sqlite3.Statement
let getResourceBookingsQuery: sqlite3.Statement


function prepareStatements() {
  getResourceQuery = db.prepare(queries.resourceBase + " AND b.resource_name == ?")
  searchResourcesQuery = db.prepare(queries.resourceBase)
  searchResourceByCreatorQuery = db.prepare(
    queries.resourceBase + " AND b.owner_account_id == ?"
  ) 

  getResourceImagesQuery = db.prepare(`SELECT image_url FROM resource_images WHERE resource_name == ? ORDER BY position`)

  getBookingsQueryByAccount = db.prepare(`SELECT * FROM bookings WHERE booker_account_id == ?`)
  getResourceBookingsQuery = db.prepare(
    `SELECT * FROM bookings WHERE resource_name == $rn AND start <= $until AND end >= $from`
  ) 
}

// TODO call this if the server is shutting down && the program continues to run
function finalizePreparedStatements() {
  getResourceQuery.finalize()
  searchResourcesQuery.finalize()
  searchResourceByCreatorQuery.finalize()

  getBookingsQueryByAccount.finalize()

  getResourceBookingsQuery.finalize()
  getResourceImagesQuery.finalize()
}

function runServer() {
  const app = express()

  app.use(cors({origin: config.clientOrigins}))

  // app.enable("trust proxy"); // only if you're behind a reverse proxy (Heroku, Bluemix, AWS if you use an ELB, custom Nginx setup, etc)
  // apply to all requests
  app.use(speedLimiter);

  // create dirs if they don't exist
  for(let dirName of [RESOURCE_IMAGES_DIR_NAME]) {
    let dir = STORAGE_PATH + dirName 
    if(!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  // app.use('/app', express.static('web-ui'))

  const resourceImageUpload = multer({
    storage: multer.memoryStorage(), 
    limits: {
      fieldNameSize: 100, // should be long enough for a uuid
      fieldSize: 10 * 1024 * 1024 // 20MB max file size
    }
  }).single('image')

  app.post('/resource-images', resourceImageUpload, (req, res) => {
    console.log("received recording upload")

    if(req.file) {
      let filename = Date.now() + '-' +  Math.random().toFixed(10).substring(2) + ".jpg"
      let filepath = STORAGE_PATH + RESOURCE_IMAGES_DIR_NAME + '/' + filename 
      console.log("writing resized image to", filepath) 
      sharp(req.file.buffer).resize(1024, 1024, {fit: 'inside'}).toFormat('jpg').toFile(filepath)
      .then(() => {
        res.send(JSON.stringify({
          ok: true, 
          relativeUrl: filename
        }))
      })
      .catch((e: any) => {
        console.log(e) 
        res.send(JSON.stringify({
          ok: false, 
          error: "failed to process images"
        }))
      }) 
    } else {
      res.send(JSON.stringify({
        ok: false, 
        error: "no image"
      }))
    }
  })

  app.get('/', (_req, res) => {
    res.send("welcome to the chershare api") 
  })

  function serveFile(dir: string, req: express.Request, res: express.Response) {
    let filename = STORAGE_PATH + dir + '/' + req.params.key
    console.log("serving", filename)
    res.setHeader("Content-Type", 'image/jpg')
    fs.createReadStream(filename).pipe(res)
  }

  app.get('/resource-images/:key', (req, res) => {
    serveFile(RESOURCE_IMAGES_DIR_NAME, req, res)
  })


  app.get('/resources/:resourceName/images', (req, res) => {
    getResourceImagesQuery.all(req.params.resourceName, (err, rows) => {
      if(err == null) {
        res.send(rows) 
      } else {
        res.send("Error: " + err)
      }
    })
  }) 

  app.get('/resources/:resourceName/bookings', (req, res) => {
    console.log("resource bookings, query", req.query)
    getResourceBookingsQuery.all(
      {
        $rn: req.params.resourceName, 
        $from: req.query.from, 
        $until: req.query.until
      }, (err, rows) => {
      if(err == null) {
        res.send(rows) 
      } else {
        res.send("Error: " + err)
      }
    })
  }) 

  app.get('/resources/:resourceName', (req, res) => {
    console.log("looking up resource", req.params.resourceName)
    getResourceQuery.all(req.params.resourceName, (err, rows) => {
      if(err == null) {
        console.log("result from query", rows[0])
        res.send(rows[0]) 
      } else {
        res.send("Error: " + err)
      }
    })
  })

  app.get('/resources', (req, res) => {
    let query = queries.resourceBase
    let params = []
    if("creatorAccountId" in req.query) {
      query += " b.creator_account_id == ?" 
      params.push(req.query.creatorAccountId) 
    } 
    db.all(query ,(err, rows) => {
      if(err == null) {
        console.log("result from query", rows) 
        res.send(rows) 
      } else {
        res.send("Error: " + err)
      }
    })
  })

  app.listen(
    config.port, 
    () => {
      console.log(`Server is running on port ${config.port}`);
    },
  )

  app.get('/bookings', (req, res) => {
    console.log("account bookings, query", req.query)
    getBookingsQueryByAccount.all(req.query.accountId, (err, rows) => {
      if(err == null) {
        res.send(rows) 
      } else {
        res.send("Error: " + err)
      }
    })
  }) 
}

(async () => {
  await new Promise<void>((resolve, reject) => {
    console.log("trying to connect to", config.dbFile)
    db = new sqlite3.Database(config.dbFile, err => { //sqlite3.OPEN_READONLY,
      if(err) {
        reject("could not connect to the db") 
      } else {
        prepareStatements()
        resolve()
      }
    })
    db.configure('busyTimeout', 30000)
  })
  runServer()
})()
  
