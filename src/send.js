const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const dgram = require("dgram");
const ip = require("ip");
const archiver = require("archiver");

const PORT = 5000;
const UDP_PORT = 41234;
const BROADCAST_INTERVAL_MS = 2000;

const createZipFromDirectory = (directoryPath, zipName) => {
    const tempZipPath = path.join(os.tmpdir(), `${zipName}-${Date.now()}.zip`);

    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(tempZipPath);
        const archive = archiver("zip", { zlib: { level: 9 } });

        output.on("close", () => resolve(tempZipPath));
        output.on("error", reject);
        archive.on("error", reject);

        archive.pipe(output);
        archive.directory(directoryPath, false);
        archive.finalize();
    });
};

const prepareShareTarget = async (inputPath) => {
    const fullPath = path.resolve(inputPath);

    if (!fs.existsSync(fullPath)) {
        throw new Error("Path not found");
    }

    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
        const folderName = path.basename(fullPath);
        const zipPath = await createZipFromDirectory(fullPath, folderName);

        return {
            servePath: zipPath,
            downloadName: `${folderName}.zip`,
            isTemp: true,
            sourcePath: fullPath
        };
    }

    return {
        servePath: fullPath,
        downloadName: path.basename(fullPath),
        isTemp: false,
        sourcePath: fullPath
    };
};

const setDownloadNameHeaders = (res, fileName) => {
    const safeFileName = fileName.replace(/"/g, "");
    const encoded = encodeURIComponent(fileName);

    res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeFileName}"; filename*=UTF-8''${encoded}`
    );
};

const send = (filePath) => {
    const app = express();
    let shareTarget = null;
    let broadcastTimer = null;
    let socket = null;
    let shutdownDone = false;
    let isBroadcastStopped = false;

    const stopBroadcast = () => {
        if (isBroadcastStopped) {
            return;
        }

        isBroadcastStopped = true;

        if (broadcastTimer) {
            clearInterval(broadcastTimer);
            broadcastTimer = null;
        }

        if (socket) {
            socket.close();
            socket = null;
        }

        console.log("Broadcast stopped after receiver connected.");
    };

    const cleanup = () => {
        if (shutdownDone) {
            return;
        }

        shutdownDone = true;

        stopBroadcast();

        if (shareTarget && shareTarget.isTemp && fs.existsSync(shareTarget.servePath)) {
            fs.unlinkSync(shareTarget.servePath);
        }
    };

    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
    process.once("exit", cleanup);

    // -------- HTTP SERVER --------
    app.get("/meta", (req, res) => {
        if (!shareTarget || !fs.existsSync(shareTarget.servePath)) {
            return res.status(404).json({ error: "File not found" });
        }

        const stats = fs.statSync(shareTarget.servePath);

        res.json({
            name: shareTarget.downloadName,
            size: stats.size,
            mtimeMs: stats.mtimeMs
        });
    });

    app.get("/download", (req, res) => {
        stopBroadcast();

        if (!shareTarget || !fs.existsSync(shareTarget.servePath)) {
            return res.status(404).send("File not found");
        }

        const stats = fs.statSync(shareTarget.servePath);
        const fileSize = stats.size;
        const range = req.headers.range;

        setDownloadNameHeaders(res, shareTarget.downloadName);
        res.setHeader("Accept-Ranges", "bytes");

        if (!range) {
            res.status(200);
            res.setHeader("Content-Length", fileSize);

            const fileStream = fs.createReadStream(shareTarget.servePath);
            fileStream.on("error", () => {
                if (!res.headersSent) {
                    res.status(500).end("Error reading file");
                    return;
                }

                res.destroy();
            });
            fileStream.pipe(res);
            return;
        }

        const matches = /bytes=(\d*)-(\d*)/.exec(range);

        if (!matches) {
            return res.status(416).send("Invalid range header");
        }

        let start = matches[1] ? Number(matches[1]) : 0;
        let end = matches[2] ? Number(matches[2]) : fileSize - 1;

        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= fileSize) {
            return res.status(416).send("Requested range not satisfiable");
        }

        end = Math.min(end, fileSize - 1);
        const chunkSize = end - start + 1;

        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
        res.setHeader("Content-Length", chunkSize);

        const fileStream = fs.createReadStream(shareTarget.servePath, { start, end });
        fileStream.on("error", () => {
            if (!res.headersSent) {
                res.status(500).end("Error reading file");
                return;
            }

            res.destroy();
        });
        fileStream.pipe(res);
    });

    (async () => {
        try {
            shareTarget = await prepareShareTarget(filePath);

            if (shareTarget.isTemp) {
                console.log(`Folder detected. Sharing as: ${shareTarget.downloadName}`);
            }

            app.listen(PORT, "0.0.0.0", () => {
                console.log("File server running");
            });

            // -------- UDP BROADCAST --------
            socket = dgram.createSocket("udp4");

            socket.bind(() => {
                socket.setBroadcast(true);

                broadcastTimer = setInterval(() => {
                    const message = Buffer.from(`FILE_SERVER:${ip.address()}:${PORT}`);
                    socket.send(message, 0, message.length, UDP_PORT, "255.255.255.255");
                }, BROADCAST_INTERVAL_MS);

                console.log(" Broadcasting presence...");
            });
        } catch (err) {
            console.log("Unable to share this path:", err.message);
        }
    })();
};

module.exports = send;