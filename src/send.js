const express = require("express");
const fs = require("fs");
const path = require("path");
const dgram = require("dgram");
const ip = require("ip");

const PORT = 5000;
const UDP_PORT = 41234;

const send = (filePath) => {
    const app = express();

    // -------- HTTP SERVER --------
    app.get("/download", (req, res) => {
        const fullPath = path.resolve(filePath);

        if (!fs.existsSync(fullPath)) {
            return res.status(404).send("File not found");
        }

        res.setHeader("Content-Disposition", `attachment; filename=${path.basename(fullPath)}`);

        const fileStream = fs.createReadStream(fullPath);
        fileStream.pipe(res);
    });

    app.listen(PORT, "0.0.0.0", () => {
        console.log("File server running");
    });

    // -------- UDP BROADCAST --------
    const socket = dgram.createSocket("udp4");

    socket.bind(() => {
        socket.setBroadcast(true);

        setInterval(() => {
            const message = Buffer.from(`FILE_SERVER:${ip.address()}:${PORT}`);
            socket.send(message, 0, message.length, UDP_PORT, "255.255.255.255");
        }, 2000);

        console.log(" Broadcasting presence...");
    });
};

module.exports = send;