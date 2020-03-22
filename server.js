const EventEmitter = require("events");
const { spawn, exec } = require("child_process");
const express = require("express");
const path = require("path");
const fs = require("fs");
const http = require("http");
const WebSocket = require("ws");

function record({
  format,
  input,
  resolution = "640x480",
  framerate = "30",
  changeColor = "white",
  a = "a",
  b = "b",
  c = "c",
  d = "d",
  e = "e"
}) {
  console.log("record video");
  const args = [
    "-f",
    format,
    "-video_size",
    resolution,
    "-r",
    framerate,
    "-i",
    input,
    "-f",
    "mpegts",
    "-codec:v",
    "mpeg1video",
    "-s",
    resolution,
    "-b:v",
    "1000k",
    "-bf",
    "0",
    "pipe:1"
  ];

  console.log(args.join(" "));
  ffmpeg = spawn("ffmpeg", args, { detached: false });

  ffmpeg.on("exit", function(code) {
    console.log("ffmpeg terminated with code " + code);
  });

  ffmpeg.on("error", function(e) {
    console.log("ffmpeg system error: " + e);
  });

  return ffmpeg;
}

class VideoStream extends EventEmitter {
  constructor(options) {
    super();
    this.saving = false;
    this.ffmpeg = record(options);

    // init data
    this.ffmpeg.stdout.on("data", buffer => {
      this.emit("data", buffer);
      if (this.saving && this.stream) this.stream.write(buffer);
    });

    this.ffmpeg.on("close", code => {
      console.log("code", code);
      this.ffmpeg.stdout.removeAllListeners();
      this.ffmpeg.kill();
    });
  }

  save(stream) {
    this.saving = true;
    this.stream = stream;
  }

  unsave() {
    if (this.stream) {
      const streamPath = this.stream.path;
      this.saving = false;
      this.stream.end();
      this.stream = null;
      exec(
        `ffmpeg -y -i ${streamPath} -preset ultrafast ${streamPath}.mp4`,
        (err, stdout, stderr) => {}
      );
    }
  }
}

const videoStreams = new Map();
videoStreams.set(
  "stream1",
  new VideoStream({ format: "avfoundation", input: "0" })
);

const port = process.env.PORT || 8001;
const streamApp = "live";
const app = express();
const httpServer = http.createServer(app);
httpServer.listen(port, () => {
  console.log(`Node Media Http Server started on port: ${port}`);
});
const streamReg = new RegExp(`^/${streamApp}/(.*?)$`);
const wsServer = new WebSocket.Server({ server: httpServer });
const recordPath = path.join(__dirname, "record");
app.use(express.static(path.join(__dirname, "public")));
if (!fs.existsSync(recordPath)) {
  fs.mkdirSync(recordPath);
}
app.use("/record", express.static(recordPath));

app.get("/save/:streamName", (req, res) => {
  const { streamName } = req.params;
  let filename;
  const videoStream = videoStreams.get(streamName);
  if (videoStream) {
    if (videoStream.stream) {
      filename = videoStream.stream.path;
    } else {
      filename = path.join(__dirname, "record", streamName);
      const stream = fs.createWriteStream(filename, { flags: "a" });
      videoStream.save(stream);
    }
  }
  res.send({ filename });
});

app.get("/unsave/:streamName", (req, res) => {
  const { streamName } = req.params;
  let filename;
  const videoStream = videoStreams.get(streamName);
  if (videoStream) {
    filename = videoStream.stream.path;
    videoStream.unsave();
  }
  res.send({ filename });
});

// serve socket flv
wsServer.on("connection", (ws, req) => {
  // console.log(req.url);
  const match = req.url.match(streamReg);

  if (match) {
    const streamName = match[1];
    const videoStream = videoStreams.get(streamName);

    if (videoStream) {
      // let isInited = false;
      const handler = buffer => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(buffer);
      };

      videoStream.on("data", handler);
      ws.on("close", () => {
        if (videoStream) {
          videoStream.off("data", handler);
        }
      });
      ws.on("error", () => {});
    }
  }
});
