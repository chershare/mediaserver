import * as dotenv from 'dotenv' 
dotenv.config()

import express from 'express'
import multer from 'multer'
import cors from 'cors'

import sharp, {OutputInfo} from 'sharp'

import config from './config'

import * as fs from 'node:fs'

import * as sqlite3 from 'sqlite3'

const PORT = process.env.PORT ?? 8000

const STORAGE_PATH = "./storage/"
const RESOURCE_IMAGES_DIR_NAME = "resource-images"

let db: sqlite3.Database

let getResourcesQuery: sqlite3.Statement
function prepareStatements() {
  getResourcesQuery = db.prepare("SELECT * FROM resources")
}
function finalizePreparedStatements() {
  getResourcesQuery.finalize() 
}


function runServer() {
  const app = express()

  app.use(cors({origin: config.clientOrigins}))

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

  app.get('/resources', (req, res) => {
    getResourcesQuery.all((err, rows) => {
      if(err == null) {
        console.log("result from query", rows) 
        res.send(rows) 
      } else {
        res.send("Error: " + err)
      }
    })
  })

  app.listen(
    PORT, 
    () => {
      console.log(`Server is running on port ${PORT}`);
    },
  )
}

(async () => {
  await new Promise<void>((resolve, reject) => {
    console.log("trying to connect to", process.env.SQLITE_DB)
    db = new sqlite3.Database(process.env.SQLITE_DB!, err => {
      if(err) {
        reject("could not connect to the db") 
      } else {
        prepareStatements()
        resolve()
      }
    })
  })
  await runServer()
})()
  
